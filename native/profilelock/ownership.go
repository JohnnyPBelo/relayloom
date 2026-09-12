// Package profilelock provides cooperative process ownership of one profile.
// It stores no identity/content and never kills a PID or guesses lease expiry.
package profilelock

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

const applicationID = 0x524c504c
const schemaSQL = "CREATE TABLE ownership (version INTEGER PRIMARY KEY CHECK(version = 1))"

var ErrInUse = errors.New("este perfil já está aberto noutro processo; feche-o antes de voltar a abrir")

type Lease struct {
	mu   sync.Mutex
	db   *sql.DB
	conn *sql.Conn
}

func Acquire(directory string) (lease *Lease, err error) {
	path := filepath.Join(directory, "profile-owner.sqlite")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err == nil {
		err = file.Close()
	} else if os.IsExist(err) {
		err = nil
	}
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 65536 {
		return nil, errors.New("ficheiro de exclusividade inválido")
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
	query := url.Values{"mode": {"rw"}, "_pragma": {"busy_timeout(0)"}}
	uri.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	conn, err := db.Conn(context.Background())
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	active := false
	defer func() {
		if err != nil {
			if active {
				_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
			}
			_ = conn.Close()
			_ = db.Close()
			if strings.Contains(err.Error(), "database is locked") || strings.Contains(err.Error(), "SQLITE_BUSY") {
				err = fmt.Errorf("%w: %v", ErrInUse, err)
			}
		}
	}()
	exec := func(query string) error { _, e := conn.ExecContext(context.Background(), query); return e }
	if err = exec("PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY"); err != nil {
		return nil, err
	}
	if err = exec("BEGIN EXCLUSIVE"); err != nil {
		return nil, err
	}
	active = true
	var appID, version int
	if err = conn.QueryRowContext(context.Background(), "PRAGMA application_id").Scan(&appID); err != nil {
		return nil, err
	}
	if err = conn.QueryRowContext(context.Background(), "PRAGMA user_version").Scan(&version); err != nil {
		return nil, err
	}
	readSchema := func() ([][2]string, error) {
		rows, e := conn.QueryContext(context.Background(), "SELECT name,sql FROM sqlite_schema WHERE substr(name,1,7) != 'sqlite_' ORDER BY name")
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		result := [][2]string{}
		for rows.Next() {
			var pair [2]string
			if e = rows.Scan(&pair[0], &pair[1]); e != nil {
				return nil, e
			}
			result = append(result, pair)
		}
		return result, rows.Err()
	}
	schema, err := readSchema()
	if err != nil {
		return nil, err
	}
	if appID == 0 && version == 0 && len(schema) == 0 {
		if err = exec(fmt.Sprintf("PRAGMA application_id=%d; PRAGMA user_version=1; %s; INSERT INTO ownership(version) VALUES(1)", applicationID, schemaSQL)); err != nil {
			return nil, err
		}
		if err = exec("COMMIT"); err != nil {
			return nil, err
		}
		active = false
		if err = exec("BEGIN EXCLUSIVE"); err != nil {
			return nil, err
		}
		active = true
	}
	if err = conn.QueryRowContext(context.Background(), "PRAGMA application_id").Scan(&appID); err != nil {
		return nil, err
	}
	if err = conn.QueryRowContext(context.Background(), "PRAGMA user_version").Scan(&version); err != nil {
		return nil, err
	}
	var mode string
	if err = conn.QueryRowContext(context.Background(), "PRAGMA journal_mode").Scan(&mode); err != nil {
		return nil, err
	}
	schema, err = readSchema()
	if err != nil {
		return nil, err
	}
	if appID != applicationID || version != 1 || mode != "delete" || len(schema) != 1 || schema[0] != [2]string{"ownership", schemaSQL} {
		return nil, errors.New("formato de exclusividade inválido")
	}
	var count, stored int
	if err = conn.QueryRowContext(context.Background(), "SELECT count(*),min(version) FROM ownership").Scan(&count, &stored); err != nil {
		return nil, err
	}
	if count != 1 || stored != 1 {
		return nil, errors.New("estado de exclusividade inválido")
	}
	return &Lease{db: db, conn: conn}, nil
}
func (l *Lease) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.db == nil {
		return nil
	}
	_, err := l.conn.ExecContext(context.Background(), "ROLLBACK")
	connectionErr := l.conn.Close()
	dbErr := l.db.Close()
	l.conn = nil
	l.db = nil
	return errors.Join(err, connectionErr, dbErr)
}
