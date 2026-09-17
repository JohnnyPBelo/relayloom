package groupstore

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/JohnnyPBelo/relayloom/native/core"
	_ "github.com/JohnnyPBelo/relayloom/native/sqlitedriver"
)

type Options struct {
	Create          bool
	Limits          *Limits
	ExpectedStoreID string
	// Preassigned random ID for a separately signed initialization intent.
	NewStoreID string
}
type Store struct {
	db                       *sql.DB
	keys                     keys
	pinnedID                 string
	mu                       sync.Mutex
	active, closed, poisoned bool
}
type Tx struct {
	store                    *Store
	conn                     *sql.Conn
	body                     indexBody
	writable, valid, changed bool
	failed                   error
	generation               uint64
}

func (tx *Tx) Generation() (uint64, error) {
	if err := tx.check(false); err != nil {
		return 0, err
	}
	return tx.generation, nil
}

func Open(path string, identity core.Identity, options Options) (*Store, error) {
	k, err := identityKeys(identity)
	if err != nil {
		return nil, err
	}
	if options.ExpectedStoreID != "" && (!core.ValidAddress(options.ExpectedStoreID) || options.Create) {
		return nil, integrity("registo esperado")
	}
	if options.NewStoreID != "" && (!core.ValidAddress(options.NewStoreID) || !options.Create) {
		return nil, integrity("identificador do novo registo")
	}
	if options.Limits != nil && !options.Create {
		return nil, integrity("limites existentes são autenticados")
	}
	l := DefaultLimits()
	if options.Limits != nil {
		l = *options.Limits
	}
	if err = checkLimits(l); err != nil {
		return nil, err
	}
	if options.Create {
		file, e := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return nil, e
		}
		if e = file.Close(); e != nil {
			return nil, e
		}
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maximumDatabaseBytes(DefaultLimits()) {
		return nil, integrity("ficheiro")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	absolute = filepath.ToSlash(absolute)
	if len(absolute) > 1 && absolute[1] == ':' {
		absolute = "/" + absolute
	}
	uri := url.URL{Scheme: "file", Path: absolute}
	query := url.Values{"mode": {"rw"}, "_pragma": {"busy_timeout(5000)"}}
	uri.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{db: db, keys: k, pinnedID: options.ExpectedStoreID}
	if err = s.initialize(options.Create, l, options.NewStoreID); err != nil {
		_ = db.Close()
		clear(s.keys.box)
		clear(s.keys.signer)
		return nil, err
	}
	return s, nil
}

func (s *Store) initialize(create bool, l Limits, newStoreID string) error {
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY"); err != nil {
		return err
	}
	if create {
		if _, err = conn.ExecContext(ctx, "PRAGMA journal_mode=DELETE; PRAGMA page_size=4096; BEGIN IMMEDIATE"); err != nil {
			return err
		}
		committed := false
		defer func() {
			if !committed {
				_, _ = conn.ExecContext(ctx, "ROLLBACK")
			}
		}()
		if _, err = conn.ExecContext(ctx, fmt.Sprintf("PRAGMA application_id=%d; PRAGMA user_version=1; %s; %s", applicationID, checkpointSQL, recordsSQL)); err != nil {
			return err
		}
		id := newStoreID
		if id == "" {
			var e error
			id, e = randomID()
			if e != nil {
				return e
			}
		}
		body := indexBody{domain, s.keys.owner, id, 0, l, make([]entry, 0)}
		if err = s.saveIndex(conn, body); err != nil {
			return err
		}
		if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
			return err
		}
		committed = true
	}
	rows, err := conn.QueryContext(ctx, "SELECT name, sql FROM sqlite_schema WHERE substr(name,1,7) != 'sqlite_' ORDER BY name")
	if err != nil {
		return err
	}
	var schema [][2]string
	for rows.Next() {
		var name, source string
		if err = rows.Scan(&name, &source); err != nil {
			rows.Close()
			return err
		}
		schema = append(schema, [2]string{name, source})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(schema) != 2 || schema[0] != [2]string{"checkpoint", checkpointSQL} || schema[1] != [2]string{"records", recordsSQL} {
		return integrity("esquema")
	}
	var appID, version, pageSize, pageCount int64
	var mode string
	for _, item := range []struct {
		query  string
		result *int64
	}{{"PRAGMA application_id", &appID}, {"PRAGMA user_version", &version}, {"PRAGMA page_size", &pageSize}, {"PRAGMA page_count", &pageCount}} {
		if err = conn.QueryRowContext(ctx, item.query).Scan(item.result); err != nil {
			return err
		}
	}
	if err = conn.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil {
		return err
	}
	if appID != applicationID || version != 1 || mode != "delete" || pageSize != 4096 {
		return integrity("formato SQLite")
	}
	// Read the index and its count from one actual SQLite snapshot.
	if _, err = conn.ExecContext(ctx, "BEGIN"); err != nil {
		return err
	}
	body, err := s.loadIndex(conn)
	if err != nil {
		_, _ = conn.ExecContext(ctx, "ROLLBACK")
		return err
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return err
	}
	maximum := maximumDatabaseBytes(body.Limits)
	if pageCount*4096 > maximum {
		return integrity("limite físico")
	}
	_, err = conn.ExecContext(ctx, fmt.Sprintf("PRAGMA max_page_count=%d", maximum/4096))
	return err
}

func (s *Store) loadIndex(conn *sql.Conn) (indexBody, error) {
	ctx := context.Background()
	var b indexBody
	var count, id, size int
	var storeID, encoding string
	if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM checkpoint").Scan(&count); err != nil {
		return b, integrity("tabela do checkpoint")
	}
	if count != 1 {
		return b, integrity("checkpoint ausente")
	}
	if err := conn.QueryRowContext(ctx, "SELECT id,store_id,typeof(payload),length(payload) FROM checkpoint").Scan(&id, &storeID, &encoding, &size); err != nil {
		return b, integrity("checkpoint ilegível")
	}
	if id != 1 || !core.ValidAddress(storeID) || encoding != "blob" || size < envelopeOverhead || size > maxIndex {
		return b, integrity("checkpoint fora dos limites")
	}
	if s.pinnedID != "" && s.pinnedID != storeID {
		return b, integrity("checkpoint de outro registo")
	}
	var envelope []byte
	if err := conn.QueryRowContext(ctx, "SELECT payload FROM checkpoint WHERE id=1").Scan(&envelope); err != nil {
		return b, integrity("envelope ausente")
	}
	plain, err := s.keys.unseal(envelope, s.keys.aad(storeID, "@index", 0))
	if err != nil {
		return b, err
	}
	b, err = decodeIndex(plain, &s.keys, storeID)
	if err != nil {
		return b, err
	}
	if err = conn.QueryRowContext(ctx, "SELECT count(*) FROM records").Scan(&count); err != nil {
		return b, integrity("tabela de registos")
	}
	if count != len(b.Entries) {
		return b, integrity("registos fora do índice")
	}
	if _, err = account(b, len(envelope)); err != nil {
		return b, err
	}
	s.pinnedID = storeID
	return b, nil
}
func (s *Store) saveIndex(conn *sql.Conn, b indexBody) error {
	sort.Slice(b.Entries, func(i, j int) bool { return b.Entries[i].Key < b.Entries[j].Key })
	encoded, err := core.Canonical(b)
	if err != nil {
		return err
	}
	value := signedIndex{b, base64.StdEncoding.EncodeToString(ed25519.Sign(s.keys.signer, encoded))}
	plain, err := core.Canonical(value)
	if err != nil {
		return err
	}
	if _, err = account(b, len(plain)+envelopeOverhead); err != nil {
		return err
	}
	envelope, err := s.keys.seal(plain, s.keys.aad(b.StoreID, "@index", 0))
	if err != nil {
		return err
	}
	_, err = conn.ExecContext(context.Background(), "INSERT INTO checkpoint(id,store_id,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET store_id=excluded.store_id,payload=excluded.payload", b.StoreID, envelope)
	return err
}

// Callbacks cannot reenter this Store. Concurrent callers receive an explicit
// unavailable error; independent processes serialize at BEGIN IMMEDIATE.
func (s *Store) execute(writable bool, callback func(*Tx) error) (err error) {
	s.mu.Lock()
	if s.active || s.closed || s.poisoned {
		s.mu.Unlock()
		return ErrUnavailable
	}
	s.active = true
	s.mu.Unlock()
	var tx *Tx
	var conn *sql.Conn
	begun := false
	defer func() {
		if tx != nil {
			tx.valid = false
		}
		if begun {
			if _, e := conn.ExecContext(context.Background(), "ROLLBACK"); e != nil {
				s.poisoned = true
			}
		}
		if conn != nil {
			conn.Close()
		}
		if errors.Is(err, ErrIntegrity) || (tx != nil && errors.Is(tx.failed, ErrIntegrity)) {
			s.poisoned = true
		}
		s.mu.Lock()
		s.active = false
		s.mu.Unlock()
	}()
	conn, err = s.db.Conn(context.Background())
	if err != nil {
		return err
	}
	begin := "BEGIN"
	if writable {
		begin = "BEGIN IMMEDIATE"
	}
	if _, err = conn.ExecContext(context.Background(), begin); err != nil {
		return err
	}
	begun = true
	b, err := s.loadIndex(conn)
	if err != nil {
		return err
	}
	if writable && b.Revision == maxRevision {
		return integrity("revisão esgotada")
	}
	tx = &Tx{store: s, conn: conn, body: b, writable: writable, valid: true}
	if err = callback(tx); err != nil {
		return err
	}
	if tx.failed != nil {
		return tx.failed
	}
	if writable && tx.changed {
		tx.body.Revision++
		if err = s.saveIndex(conn, tx.body); err != nil {
			return err
		}
	}
	if _, err = conn.ExecContext(context.Background(), "COMMIT"); err != nil {
		s.poisoned = true
		return err
	}
	begun = false
	return nil
}
func (s *Store) Update(callback func(*Tx) error) error { return s.execute(true, callback) }
func (s *Store) View(callback func(*Tx) error) error   { return s.execute(false, callback) }
func (s *Store) ID() (string, error) {
	var id string
	err := s.View(func(tx *Tx) error { id = tx.body.StoreID; return nil })
	return id, err
}
func (s *Store) Accounting() (Accounting, error) {
	var value Accounting
	err := s.View(func(tx *Tx) error { var e error; value, e = tx.Accounting(); return e })
	return value, err
}
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		return ErrUnavailable
	}
	if s.closed {
		return nil
	}
	err := s.db.Close()
	clear(s.keys.box)
	clear(s.keys.signer)
	s.closed = true
	return err
}
func (tx *Tx) check(writable bool) error {
	if !tx.valid || (writable && !tx.writable) {
		return ErrTransaction
	}
	if tx.failed != nil {
		return tx.failed
	}
	return nil
}

// Abort latches a high-level failure even when its caller swallows the error.
// Preserve the first failure so an integrity error can never be downgraded.
func (tx *Tx) Abort(err error) error {
	if previous := tx.check(false); previous != nil {
		return previous
	}
	if err == nil {
		err = ErrTransaction
	}
	return tx.fail(err)
}
func (tx *Tx) fail(err error) error { tx.failed = err; return err }
func (tx *Tx) find(key string) (entry, int) {
	for i, e := range tx.body.Entries {
		if e.Key == key {
			return e, i
		}
	}
	return entry{}, -1
}
func (tx *Tx) Keys(prefix string) ([]string, error) {
	if err := tx.check(false); err != nil {
		return nil, err
	}
	keys := make([]string, 0)
	for _, e := range tx.body.Entries {
		if strings.HasPrefix(e.Key, prefix) {
			keys = append(keys, e.Key)
		}
	}
	sort.Strings(keys)
	return keys, nil
}
func (tx *Tx) Get(key string) ([]byte, bool, error) {
	if err := tx.check(false); err != nil {
		return nil, false, err
	}
	if !keyPattern.MatchString(key) {
		return nil, false, errors.New("chave inválida")
	}
	e, i := tx.find(key)
	if i < 0 {
		return nil, false, nil
	}
	var size int
	var encoding string
	var envelope []byte
	if err := tx.conn.QueryRowContext(context.Background(), "SELECT typeof(payload),length(payload) FROM records WHERE slot=?", e.Slot).Scan(&encoding, &size); err != nil || encoding != "blob" || size != e.Bytes {
		return nil, false, tx.fail(integrity("registo ausente ou tamanho diferente"))
	}
	if err := tx.conn.QueryRowContext(context.Background(), "SELECT payload FROM records WHERE slot=?", e.Slot).Scan(&envelope); err != nil {
		return nil, false, tx.fail(integrity("registo ilegível"))
	}
	if core.Hash(envelope) != e.Digest {
		return nil, false, tx.fail(integrity("registo trocado ou corrompido"))
	}
	plain, err := tx.store.keys.unseal(envelope, tx.store.keys.aad(tx.body.StoreID, e.Key, e.Revision))
	if err != nil {
		return nil, false, tx.fail(err)
	}
	return plain, true, nil
}
func (tx *Tx) Put(key string, plain []byte, class StorageClass) error {
	if err := tx.check(true); err != nil {
		return err
	}
	if !keyPattern.MatchString(key) || len(plain) > maxRecord || (class != Data && class != Checkpoint) {
		return errors.New("registo fora dos limites")
	}
	old, at := tx.find(key)
	revision := tx.body.Revision + 1
	envelope, err := tx.store.keys.seal(plain, tx.store.keys.aad(tx.body.StoreID, key, revision))
	if err != nil {
		return err
	}
	slot, err := randomID()
	if err != nil {
		return err
	}
	e := entry{key, slot, revision, core.Hash(envelope), len(envelope), class}
	candidate := tx.body
	candidate.Revision = revision
	candidate.Entries = make([]entry, 0, len(tx.body.Entries)+1)
	for _, previous := range tx.body.Entries {
		if previous.Key != key {
			candidate.Entries = append(candidate.Entries, previous)
		}
	}
	candidate.Entries = append(candidate.Entries, e)
	size, err := indexSize(candidate)
	if err != nil {
		return err
	}
	if _, err = account(candidate, size); err != nil {
		return err
	}
	if at >= 0 {
		if _, err = tx.conn.ExecContext(context.Background(), "DELETE FROM records WHERE slot=?", old.Slot); err != nil {
			return tx.fail(err)
		}
	}
	if _, err = tx.conn.ExecContext(context.Background(), "INSERT INTO records(slot,payload) VALUES(?,?)", slot, envelope); err != nil {
		return tx.fail(err)
	}
	tx.body.Entries = candidate.Entries
	tx.changed = true
	tx.generation++
	return nil
}
func (tx *Tx) Delete(key string) error {
	if err := tx.check(true); err != nil {
		return err
	}
	if !keyPattern.MatchString(key) {
		return errors.New("chave inválida")
	}
	e, i := tx.find(key)
	if i < 0 {
		return nil
	}
	if _, err := tx.conn.ExecContext(context.Background(), "DELETE FROM records WHERE slot=?", e.Slot); err != nil {
		return tx.fail(err)
	}
	tx.body.Entries = append(tx.body.Entries[:i], tx.body.Entries[i+1:]...)
	tx.changed = true
	tx.generation++
	return nil
}
func (tx *Tx) Accounting() (Accounting, error) {
	var result Accounting
	if err := tx.check(false); err != nil {
		return result, err
	}
	size, err := indexSize(tx.body)
	if err != nil {
		return result, err
	}
	result, err = account(tx.body, size)
	if err != nil {
		return result, err
	}
	var pages int64
	if err = tx.conn.QueryRowContext(context.Background(), "PRAGMA page_count").Scan(&pages); err != nil {
		return result, tx.fail(err)
	}
	result.SQLiteBytes = pages * 4096
	return result, nil
}

// Owner and RecordRevision expose authenticated binding without sharing the
// mutable index. They obey the same transaction lifetime as Get and Accounting.
func (tx *Tx) Owner() (string, error) {
	if err := tx.check(false); err != nil {
		return "", err
	}
	return tx.body.Owner, nil
}

// StoreID exposes only authenticated, immutable context for nested records.
func (tx *Tx) StoreID() (string, error) {
	if err := tx.check(false); err != nil {
		return "", err
	}
	return tx.body.StoreID, nil
}
func (tx *Tx) RecordRevision(key string) (int64, bool, error) {
	if err := tx.check(false); err != nil {
		return 0, false, err
	}
	if !keyPattern.MatchString(key) {
		return 0, false, errors.New("chave de registo inválida")
	}
	e, i := tx.find(key)
	return e.Revision, i >= 0, nil
}
