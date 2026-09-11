package core

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const DefaultQuota int64 = 128 * 1024 * 1024

// AtomicWrite writes only a caller-owned application path, never a peer address.
func AtomicWrite(path string, data []byte) error {
	random, err := randomBytes(6)
	if err != nil {
		return err
	}
	temp := path + "." + fmt.Sprintf("%x", random) + ".tmp"
	file, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		file.Close()
		if !ok {
			os.Remove(temp)
		}
	}()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		return err
	}
	ok = true
	return nil
}

type storeEntry struct {
	Size     int64 `json:"size"`
	Pinned   bool  `json:"pinned"`
	Accessed int64 `json:"accessed"`
	Expires  int64 `json:"expires"`
}
type manifestCache struct {
	Manifest    Manifest
	Fingerprint string
}
type StoreStats struct {
	Count      int   `json:"count"`
	Bytes      int64 `json:"bytes"`
	Quota      int64 `json:"quota"`
	MaxObjects int   `json:"maxObjects"`
	Pinned     int   `json:"pinned"`
}
type ContentStore struct {
	mu         sync.Mutex
	dir        string
	quota      int64
	maxObjects int
	index      map[string]storeEntry
	manifests  map[string]manifestCache
}

func NewContentStore(dir string, quota int64, maxObjects int) (*ContentStore, error) {
	if quota < 1 || quota > 1024*1024*1024 || maxObjects < 1 || maxObjects > MaxStoredObjects {
		return nil, errors.New("limites de armazenamento inválidos")
	}
	s := &ContentStore{dir: dir, quota: quota, maxObjects: maxObjects, index: make(map[string]storeEntry), manifests: make(map[string]manifestCache)}
	if err := os.MkdirAll(filepath.Join(dir, "objects"), 0700); err != nil {
		return nil, err
	}
	indexPath := filepath.Join(dir, "index.json")
	if _, err := os.Stat(indexPath); err == nil {
		data, err := readBoundedFile(indexPath, MaxStoredObjects*512)
		if err != nil {
			return nil, err
		}
		if err = decodeInto(data, MaxStoredObjects*512, &s.index); err != nil {
			return nil, fmt.Errorf("índice inválido: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	files, err := os.ReadDir(filepath.Join(dir, "objects"))
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(file.Name(), ".json")
		if !ValidAddress(id) {
			continue
		}
		path, _ := s.path(id)
		data, readErr := readBoundedFile(path, MaxBundleBytes)
		var b Bundle
		if readErr == nil {
			b, readErr = DecodeBundle(data)
		}
		if readErr == nil && b.Manifest.ID != id {
			readErr = errors.New("endereço não corresponde")
		}
		if readErr == nil {
			readErr = VerifyBundle(b)
		}
		if readErr != nil {
			delete(s.index, id)
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return nil, err
			}
			continue
		}
		previous := s.index[id]
		accessed := previous.Accessed
		if accessed < 0 || accessed > maxSafeInteger {
			accessed = time.Now().UnixMilli()
		}
		if accessed == 0 {
			accessed = time.Now().UnixMilli()
		}
		s.index[id] = storeEntry{Size: int64(len(data)), Pinned: previous.Pinned, Accessed: accessed, Expires: b.Manifest.Expires}
	}
	for id := range s.index {
		path, err := s.path(id)
		if err != nil {
			delete(s.index, id)
			continue
		}
		if _, err := os.Stat(path); err != nil {
			if !os.IsNotExist(err) {
				return nil, err
			}
			delete(s.index, id)
		}
	}
	plan, err := s.plan(0, 0, quota)
	if err != nil {
		return nil, err
	}
	if err = s.removeEntries(plan); err != nil {
		return nil, err
	}
	if err = s.save(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *ContentStore) path(id string) (string, error) {
	if !ValidAddress(id) {
		return "", errors.New("endereço inválido")
	}
	return filepath.Join(s.dir, "objects", id+".json"), nil
}
func readBoundedFile(path string, maximum int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > int64(maximum) {
		return nil, errors.New("objecto armazenado inválido")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, int64(maximum)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maximum {
		return nil, errors.New("objecto demasiado grande")
	}
	return data, nil
}
func fingerprint(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > MaxBundleBytes {
		return "", errors.New("objecto armazenado inválido")
	}
	data, err := readBoundedFile(path, MaxBundleBytes)
	if err != nil {
		return "", err
	}
	return Hash(data), nil
}
func (s *ContentStore) save() error {
	data, err := Canonical(s.index)
	if err != nil {
		return err
	}
	return AtomicWrite(filepath.Join(s.dir, "index.json"), data)
}
func (s *ContentStore) stats() StoreStats {
	r := StoreStats{Count: len(s.index), Quota: s.quota, MaxObjects: s.maxObjects}
	for _, e := range s.index {
		r.Bytes += e.Size
		if e.Pinned {
			r.Pinned++
		}
	}
	return r
}
func (s *ContentStore) Stats() StoreStats { s.mu.Lock(); defer s.mu.Unlock(); return s.stats() }
func (s *ContentStore) plan(needed int64, added int, quota int64) ([]string, error) {
	type candidate struct {
		id    string
		entry storeEntry
	}
	now := time.Now().UnixMilli()
	bytes := needed
	count := len(s.index) + added
	expired := make([]candidate, 0)
	eligible := make([]candidate, 0)
	for id, e := range s.index {
		bytes += e.Size
		if e.Expires <= now {
			expired = append(expired, candidate{id, e})
		} else if !e.Pinned {
			eligible = append(eligible, candidate{id, e})
		}
	}
	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].entry.Accessed == eligible[j].entry.Accessed {
			return eligible[i].id < eligible[j].id
		}
		return eligible[i].entry.Accessed < eligible[j].entry.Accessed
	})
	plan := make([]string, 0)
	selectEntry := func(c candidate) { plan = append(plan, c.id); bytes -= c.entry.Size; count-- }
	for _, e := range expired {
		selectEntry(e)
	}
	for _, e := range eligible {
		if bytes <= quota && count <= s.maxObjects {
			break
		}
		selectEntry(e)
	}
	if bytes > quota || count > s.maxObjects {
		return nil, errors.New("armazenamento cheio; liberte conteúdos fixados")
	}
	return plan, nil
}
func (s *ContentStore) removeEntries(ids []string) error {
	for _, id := range ids {
		path, err := s.path(id)
		if err != nil {
			return err
		}
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		delete(s.index, id)
		delete(s.manifests, id)
	}
	return nil
}
func cloneManifest(m Manifest) Manifest {
	m.Chunks = append([]ChunkRef{}, m.Chunks...)
	m.Keys = append([]KeyEnvelope{}, m.Keys...)
	if m.PublicKey != nil {
		key := *m.PublicKey
		m.PublicKey = &key
	}
	return m
}

func (s *ContentStore) Put(bundle Bundle, pinned bool) (bool, error) {
	data, err := Canonical(bundle)
	if err != nil {
		return false, err
	}
	if len(data) > MaxBundleBytes {
		return false, errors.New("conteúdo excede limite")
	}
	snapshot, err := DecodeBundle(data)
	if err != nil {
		return false, err
	}
	if err = VerifyBundle(snapshot); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := snapshot.Manifest.ID
	if _, found := s.index[id]; found {
		return false, nil
	}
	size := int64(len(data))
	if size > s.quota {
		return false, errors.New("conteúdo excede quota")
	}
	plan, err := s.plan(size, 1, s.quota)
	if err != nil {
		return false, err
	}
	path, _ := s.path(id)
	if err = AtomicWrite(path, data); err != nil {
		return false, err
	}
	if err = s.removeEntries(plan); err != nil {
		return false, err
	}
	s.index[id] = storeEntry{Size: size, Pinned: pinned, Accessed: time.Now().UnixMilli(), Expires: snapshot.Manifest.Expires}
	f, err := fingerprint(path)
	if err != nil {
		return false, err
	}
	s.manifests[id] = manifestCache{cloneManifest(snapshot.Manifest), f}
	if err = s.save(); err != nil {
		return false, err
	}
	return true, nil
}
func (s *ContentStore) read(id string, touch bool) (Bundle, error) {
	path, err := s.path(id)
	if err != nil {
		return Bundle{}, err
	}
	entry, ok := s.index[id]
	if !ok {
		return Bundle{}, errors.New("conteúdo indisponível neste nó")
	}
	data, err := readBoundedFile(path, MaxBundleBytes)
	if err != nil {
		return Bundle{}, err
	}
	bundle, err := DecodeBundle(data)
	if err != nil {
		return Bundle{}, err
	}
	if bundle.Manifest.ID != id {
		return Bundle{}, errors.New("endereço não corresponde")
	}
	if err = VerifyBundle(bundle); err != nil {
		return Bundle{}, err
	}
	f, err := fingerprint(path)
	if err != nil {
		return Bundle{}, err
	}
	s.manifests[id] = manifestCache{cloneManifest(bundle.Manifest), f}
	if touch {
		entry.Accessed = time.Now().UnixMilli()
		s.index[id] = entry
	}
	return bundle, nil
}
func (s *ContentStore) Get(id string) (Bundle, error) { return s.GetWithTouch(id, true) }
func (s *ContentStore) GetWithTouch(id string, touch bool) (Bundle, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(id, touch)
}
func (s *ContentStore) Has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.index[id]
	return ValidAddress(id) && ok && entry.Expires > time.Now().UnixMilli()
}
func (s *ContentStore) List() []Manifest {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]Manifest, 0, len(s.index))
	now := time.Now().UnixMilli()
	for id, e := range s.index {
		if e.Expires <= now {
			continue
		}
		path, _ := s.path(id)
		f, err := fingerprint(path)
		if err != nil {
			delete(s.manifests, id)
			continue
		}
		cache, found := s.manifests[id]
		if !found || f != cache.Fingerprint {
			if _, err = s.read(id, false); err != nil {
				delete(s.manifests, id)
				continue
			}
			cache = s.manifests[id]
		}
		result = append(result, cloneManifest(cache.Manifest))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Created == result[j].Created {
			return result[i].ID < result[j].ID
		}
		return result[i].Created < result[j].Created
	})
	return result
}
func (s *ContentStore) Pin(id string, pinned bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.read(id, true); err != nil {
		return err
	}
	previous := s.index[id]
	next := previous
	next.Pinned = pinned
	s.index[id] = next
	if err := s.save(); err != nil {
		s.index[id] = previous
		return err
	}
	return nil
}
func (s *ContentStore) IsPinned(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.index[id].Pinned
}
func (s *ContentStore) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.removeEntries([]string{id}); err != nil {
		return err
	}
	return s.save()
}
func (s *ContentStore) SetQuota(quota int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if quota < 1024*1024 || quota > 1024*1024*1024 {
		return errors.New("quota inválida")
	}
	plan, err := s.plan(0, 0, quota)
	if err != nil {
		return err
	}
	if err = s.removeEntries(plan); err != nil {
		return err
	}
	s.quota = quota
	return s.save()
}
