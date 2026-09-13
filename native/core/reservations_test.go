package core

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func reservationOK(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func TestReservationsSurviveRestartAndPressureWithoutChangingPins(t *testing.T) {
	dir := testDirectory(t)
	i := identityFor(t, "Reserves")
	a, b, c := bundleFor(t, i, "held"), bundleFor(t, i, "manual"), bundleFor(t, i, "incoming")
	s, err := NewContentStore(dir, 4*1024*1024, 2)
	reservationOK(t, err)
	_, err = s.PutReserved(a, false)
	reservationOK(t, err)
	_, err = s.Put(b, true)
	reservationOK(t, err)
	if s.IsPinned(a.Manifest.ID) {
		t.Fatal("automatic reserve became manual pin")
	}
	raw, err := Canonical(a)
	reservationOK(t, err)
	if s.Stats().ReservedBytes != int64(len(raw)) {
		t.Fatal("reserved byte accounting")
	}
	s, err = NewContentStore(dir, 4*1024*1024, 2)
	reservationOK(t, err)
	if _, err = s.Put(c, false); err == nil {
		t.Fatal("reserved object evicted")
	}
	if !s.Has(a.Manifest.ID) || !s.Has(b.Manifest.ID) {
		t.Fatal("refusal changed content")
	}
	reservationOK(t, s.SetReservations(nil))
	_, err = s.Put(c, false)
	reservationOK(t, err)
	if s.Has(a.Manifest.ID) || !s.IsPinned(b.Manifest.ID) || s.Stats().Reserved != 0 {
		t.Fatal("release lost manual pin or did not allow eviction")
	}
}

func TestReservationByteQuotaRefusalIsAtomic(t *testing.T) {
	dir := testDirectory(t)
	i := identityFor(t, "Bytes")
	a, b := bundleFor(t, i, strings.Repeat("b", 900000)), bundleFor(t, i, "ordinary")
	s, err := NewContentStore(dir, 4*1024*1024, MaxStoredObjects)
	reservationOK(t, err)
	_, err = s.PutReserved(a, false)
	reservationOK(t, err)
	_, err = s.Put(b, false)
	reservationOK(t, err)
	before, err := os.ReadFile(filepath.Join(dir, "index.json"))
	reservationOK(t, err)
	if err = s.SetQuota(1024 * 1024); err == nil {
		t.Fatal("quota below reserve accepted")
	}
	after, err := os.ReadFile(filepath.Join(dir, "index.json"))
	reservationOK(t, err)
	if !bytes.Equal(before, after) || !s.Has(b.Manifest.ID) || s.Stats().Quota != 4*1024*1024 {
		t.Fatal("quota refusal altered existing state")
	}
	reservationOK(t, s.SetReservations(nil))
	reservationOK(t, s.SetQuota(1024*1024))
	if s.Stats().Bytes > 1024*1024 {
		t.Fatal("released byte quota exceeded")
	}
}

func TestReservationDoesNotExtendSignedExpiry(t *testing.T) {
	dir := testDirectory(t)
	i := identityFor(t, "Expiry")
	a, err := CreateBundle(i, "post", "expires", nil, true, 1000)
	reservationOK(t, err)
	s, err := NewContentStore(dir, 4*1024*1024, 1)
	reservationOK(t, err)
	_, err = s.PutReserved(a, true)
	reservationOK(t, err)
	time.Sleep(1100 * time.Millisecond)
	s, err = NewContentStore(dir, 4*1024*1024, 1)
	reservationOK(t, err)
	if s.Has(a.Manifest.ID) || len(s.Reservations()) != 0 || s.Stats().Bytes != 0 {
		t.Fatal("reservation kept an expired signed object")
	}
}

func TestReservationCorruptionCannotReleaseExistingProtection(t *testing.T) {
	dir := testDirectory(t)
	i := identityFor(t, "Corruption")
	a, b := bundleFor(t, i, "held"), bundleFor(t, i, "corrupt")
	s, err := NewContentStore(dir, 4*1024*1024, 2)
	reservationOK(t, err)
	_, err = s.PutReserved(a, false)
	reservationOK(t, err)
	_, err = s.Put(b, false)
	reservationOK(t, err)
	if err = s.SetReservations([]string{b.Manifest.ID, strings.Repeat("0", 64)}); err == nil {
		t.Fatal("unknown reservation accepted")
	}
	requireSameJSON(t, s.Reservations(), []string{a.Manifest.ID})
	for key, value := range b.Chunks {
		prefix := "A"
		if value[0] == 'A' {
			prefix = "B"
		}
		b.Chunks[key] = prefix + value[1:]
		break
	}
	raw, err := Canonical(b)
	reservationOK(t, err)
	reservationOK(t, os.WriteFile(filepath.Join(dir, "objects", b.Manifest.ID+".json"), raw, 0600))
	if err = s.SetReservations([]string{b.Manifest.ID}); err == nil {
		t.Fatal("corrupt reservation accepted")
	}
	requireSameJSON(t, s.Reservations(), []string{a.Manifest.ID})
}

func TestReservationWriteFailureProtectsUnionUntilReconciliation(t *testing.T) {
	dir := testDirectory(t)
	i := identityFor(t, "Failure")
	a, b, c := bundleFor(t, i, "before"), bundleFor(t, i, "requested"), bundleFor(t, i, "pressure")
	s, err := NewContentStore(dir, 4*1024*1024, 2)
	reservationOK(t, err)
	_, err = s.PutReserved(a, false)
	reservationOK(t, err)
	_, err = s.Put(b, true)
	reservationOK(t, err)
	path := filepath.Join(dir, "index.json")
	backup := path + ".backup"
	reservationOK(t, os.Rename(path, backup))
	reservationOK(t, os.Mkdir(path, 0700))
	if err = s.SetReservations([]string{b.Manifest.ID}); err == nil {
		t.Fatal("obstructed index write succeeded")
	}
	if len(s.Reservations()) != 2 || !s.IsPinned(b.Manifest.ID) {
		t.Fatal("failed write lost union or manual pin")
	}
	if _, err = s.Put(c, false); err == nil {
		t.Fatal("failed release enabled eviction")
	}
	if !s.Has(a.Manifest.ID) {
		t.Fatal("previous reservation was evicted")
	}
	reservationOK(t, os.Remove(path))
	reservationOK(t, os.Rename(backup, path))
	reservationOK(t, s.SetReservations([]string{b.Manifest.ID}))
	s, err = NewContentStore(dir, 4*1024*1024, 2)
	reservationOK(t, err)
	requireSameJSON(t, s.Reservations(), []string{b.Manifest.ID})
	if !s.IsPinned(b.Manifest.ID) {
		t.Fatal("reconciliation lost manual pin")
	}
}

func TestReservationDuplicateAtCountLimitAndMalformedIndex(t *testing.T) {
	dir := testDirectory(t)
	i := identityFor(t, "Duplicate")
	a := bundleFor(t, i, "one")
	s, err := NewContentStore(dir, 4*1024*1024, 1)
	reservationOK(t, err)
	_, err = s.Put(a, true)
	reservationOK(t, err)
	for n := 0; n < 2; n++ {
		inserted, e := s.PutReserved(a, false)
		reservationOK(t, e)
		if inserted {
			t.Fatal("duplicate inserted")
		}
	}
	if !s.IsPinned(a.Manifest.ID) {
		t.Fatal("duplicate lost manual pin")
	}
	path := filepath.Join(dir, "index.json")
	raw, err := os.ReadFile(path)
	reservationOK(t, err)
	raw = bytes.Replace(raw, []byte(`"reserved":true`), []byte(`"reserved":"yes"`), 1)
	reservationOK(t, os.WriteFile(path, raw, 0600))
	if _, err = NewContentStore(dir, 4*1024*1024, 1); err == nil {
		t.Fatal("malformed reservation index accepted")
	}
}
