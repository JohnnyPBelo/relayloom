package core

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func testDirectory(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../..", ".cache", "native-core-tests")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "store-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}
func identityFor(t *testing.T, name string) Identity {
	t.Helper()
	i, err := CreateIdentity(name)
	if err != nil {
		t.Fatal(err)
	}
	return i
}
func bundleFor(t *testing.T, i Identity, payload any) Bundle {
	t.Helper()
	b, err := CreateBundle(i, "post", payload, nil, true, DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func requireSameJSON(t *testing.T, a, b any) {
	t.Helper()
	aa, e := Canonical(a)
	if e != nil {
		t.Fatal(e)
	}
	bb, e := Canonical(b)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(aa, bb) {
		t.Fatalf("JSON values differ: %s versus %s", aa, bb)
	}
}

func TestCanonicalJavaScriptVectors(t *testing.T) {
	vectors := []struct{ input, want string }{
		{`{"z":1,"a":"<>&\u2028\u2029"}`, "{\"a\":\"<>&\u2028\u2029\",\"z\":1}"},
		{`[-0,0.000001,0.0000001,100000000000000000000,1e21,1.2345678901234567]`, `[0,0.000001,1e-7,100000000000000000000,1e+21,1.2345678901234567]`},
		{`{"\ue000":1,"\ud83d\ude80":2,"\ud800":3,"\udc00":4}`, "{\"\\ud800\":3,\"🚀\":2,\"\\udc00\":4,\"\ue000\":1}"},
		{`{"__proto__":{"x":1},"x":0,"x":2}`, `{"__proto__":{"x":1},"x":2}`},
	}
	for _, v := range vectors {
		value, err := DecodeJSON([]byte(v.input), 4096)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := Canonical(value)
		if err != nil {
			t.Fatal(err)
		}
		if string(actual) != v.want {
			t.Fatalf("canonical mismatch for %s: %s", v.input, actual)
		}
	}
	for _, v := range []any{math.Inf(1), math.NaN(), func() {}, map[int]string{1: "x"}} {
		if _, err := Canonical(v); err == nil {
			t.Fatalf("accepted invalid type %T", v)
		}
	}
}

func TestParserBoundsAndMalformedData(t *testing.T) {
	for _, input := range []string{`{"x":}`, `[1,]`, `01`, `1e400`, `true false`, `"bad\q"`, `"unterminated`, `{"x" 1}`, string([]byte{'"', 0xff, '"'})} {
		if _, err := DecodeJSON([]byte(input), 4096); err == nil {
			t.Fatalf("accepted invalid JSON %q", input)
		}
	}
	if _, err := DecodeJSON([]byte(`{"x":1}`), 2); err == nil {
		t.Fatal("byte cap missing")
	}
	deep := strings.Repeat("[", 26) + "0" + strings.Repeat("]", 26)
	if _, err := DecodeJSON([]byte(deep), 4096); err == nil {
		t.Fatal("depth cap missing")
	}
	var value any = 0
	for i := 0; i < 26; i++ {
		value = []any{value}
	}
	if _, err := Canonical(value); err == nil {
		t.Fatal("canonical depth cap missing")
	}
}

func TestIdentityAuthorityAndVaultRecovery(t *testing.T) {
	alice := identityFor(t, "\ufeff Alice 🚀 ")
	bob := identityFor(t, "Bob")
	if alice.Public.Name != "Alice 🚀" {
		t.Fatal("JS whitespace mismatch")
	}
	if err := ValidateIdentity(alice.Public); err != nil {
		t.Fatal(err)
	}
	modified := alice.Public
	modified.BoxKey = bob.Public.BoxKey
	if ValidateIdentity(modified) == nil {
		t.Fatal("unbound box key")
	}
	modified = alice.Public
	modified.Name = "Forged"
	if ValidateIdentity(modified) == nil {
		t.Fatal("unbound name")
	}
	vault, err := ExportVault(alice, "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(vault, alice.SignSecret) {
		t.Fatal("plaintext signing secret")
	}
	restored, err := ImportVault(vault, "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	requireSameJSON(t, restored, alice)
	if _, err = ImportVault(vault, "wrong password"); err == nil {
		t.Fatal("wrong password accepted")
	}
	if _, err = ExportVault(alice, "short"); err == nil {
		t.Fatal("short password accepted")
	}
	broken := alice
	broken.SignSecret = bob.SignSecret
	if _, err = ExportVault(broken, "correct horse battery staple"); err == nil {
		t.Fatal("identity/secret mismatch accepted")
	}
}

func TestBundleReaderDoesNotBecomeAuthor(t *testing.T) {
	alice, bob, eve := identityFor(t, "Alice"), identityFor(t, "Bob"), identityFor(t, "Eve")
	payload := map[string]any{"type": "message", "text": "Private <>& 🚀", "count": 3}
	b, err := CreateBundle(alice, "message", payload, []PublicIdentity{bob.Public}, false, DefaultTTL)
	if err != nil {
		t.Fatal(err)
	}
	for _, reader := range []*Identity{&alice, &bob} {
		value, err := DecryptBundle(b, reader)
		if err != nil {
			t.Fatal(err)
		}
		requireSameJSON(t, value, payload)
	}
	if _, err = DecryptBundle(b, &eve); err == nil {
		t.Fatal("unauthorized reader accepted")
	}
	if _, err = DecryptBundle(b, nil); err == nil {
		t.Fatal("private content exposed publicly")
	}
	modified := b
	modified.Manifest.Author = bob.Public
	if VerifyBundle(modified) == nil {
		t.Fatal("reader became author")
	}
	encoded, err := Canonical(b)
	if err != nil {
		t.Fatal(err)
	}
	copy, err := DecodeBundle(encoded)
	if err != nil {
		t.Fatal(err)
	}
	id := copy.Manifest.Chunks[0].Hash
	chunk, _ := decode64(copy.Chunks[id], ChunkSize*2)
	chunk[0] ^= 1
	copy.Chunks[id] = encode64(chunk)
	if VerifyBundle(copy) == nil {
		t.Fatal("ciphertext tamper accepted")
	}
	public := bundleFor(t, alice, payload)
	value, err := DecryptBundle(public, nil)
	if err != nil {
		t.Fatal(err)
	}
	requireSameJSON(t, value, payload)
}

func TestManifestBoundsExpiryAndKeySeparation(t *testing.T) {
	alice := identityFor(t, "Alice")
	now := time.Now().UnixMilli()
	b, err := CreateBundleAt(alice, "post", map[string]any{"text": "Expiry"}, nil, true, 1000, now)
	if err != nil {
		t.Fatal(err)
	}
	if VerifyBundleAt(b, now+999) != nil {
		t.Fatal("valid TTL rejected")
	}
	if VerifyBundleAt(b, now+1000) == nil {
		t.Fatal("expired bundle accepted")
	}
	if _, err = CreateBundle(alice, "../post", "x", nil, true, DefaultTTL); err == nil {
		t.Fatal("bad kind accepted")
	}
	if _, err = CreateBundle(alice, "post", "x", nil, true, 999); err == nil {
		t.Fatal("bad ttl accepted")
	}
	if _, err = CreateBundle(alice, "post", strings.Repeat("x", MaxContent), nil, true, DefaultTTL); err == nil {
		t.Fatal("content byte limit ignored")
	}
	if _, err = decode64("YQ==\n", 32); err == nil {
		t.Fatal("noncanonical base64 accepted")
	}
	if _, err = open(Sealed{}, make([]byte, 16), "x"); err == nil {
		t.Fatal("AES128 downgrade accepted")
	}
}

func TestStoreRestartDedupCountPinsAndDiskVerification(t *testing.T) {
	dir := testDirectory(t)
	alice := identityFor(t, "Alice")
	store, err := NewContentStore(dir, 1024*1024, 3)
	if err != nil {
		t.Fatal(err)
	}
	first := bundleFor(t, alice, map[string]any{"text": "Pinned"})
	if ok, err := store.Put(first, true); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if ok, err := store.Put(first, false); err != nil || ok {
		t.Fatal("deduplication failed", err)
	}
	for i := 0; i < 12; i++ {
		if _, err := store.Put(bundleFor(t, alice, map[string]any{"n": i}), false); err != nil {
			t.Fatal(err)
		}
		if store.Stats().Count > 3 || !store.Has(first.Manifest.ID) {
			t.Fatal("count/pin bound failed")
		}
	}
	store, err = NewContentStore(dir, 1024*1024, 3)
	if err != nil {
		t.Fatal(err)
	}
	if !store.IsPinned(first.Manifest.ID) || len(store.List()) != 3 {
		t.Fatal("restart state lost")
	}
	for _, m := range store.List() {
		if err := store.Pin(m.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	before, err := os.ReadFile(filepath.Join(dir, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Put(bundleFor(t, alice, "No slot"), false); err == nil {
		t.Fatal("pinned cap ignored")
	}
	after, _ := os.ReadFile(filepath.Join(dir, "index.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("rejected cap mutated index")
	}
	if _, err = store.Get("../../secret"); err == nil {
		t.Fatal("path traversal accepted")
	}
	path := filepath.Join(dir, "objects", first.Manifest.ID+".json")
	if err = os.WriteFile(path, []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Get(first.Manifest.ID); err == nil {
		t.Fatal("disk corruption bypassed get")
	}
	for _, m := range store.List() {
		if m.ID == first.Manifest.ID {
			t.Fatal("corrupt cached manifest exposed")
		}
	}
}

func TestStoreMetadataReadDoesNotTouchLRU(t *testing.T) {
	store, err := NewContentStore(testDirectory(t), 1024*1024, 2)
	if err != nil {
		t.Fatal(err)
	}
	alice := identityFor(t, "Alice")
	hot, cold := bundleFor(t, alice, "Hot"), bundleFor(t, alice, "Cold")
	store.Put(hot, false)
	store.Put(cold, false)
	e := store.index[hot.Manifest.ID]
	e.Accessed = 30
	store.index[hot.Manifest.ID] = e
	e = store.index[cold.Manifest.ID]
	e.Accessed = 10
	store.index[cold.Manifest.ID] = e
	listed := store.List()
	listed[0].Author.Name = "Mutated"
	if _, err := store.GetWithTouch(cold.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(bundleFor(t, alice, "New"), false); err != nil {
		t.Fatal(err)
	}
	if !store.Has(hot.Manifest.ID) || store.Has(cold.Manifest.ID) {
		t.Fatal("metadata scan replaced viewing order")
	}
	kept, err := store.Get(hot.Manifest.ID)
	if err != nil || kept.Manifest.Author.Name != "Alice" {
		t.Fatal("metadata cache alias")
	}
}

func TestQuotaRejectionPreservesObjectsAndMalformedIndexFailsSafely(t *testing.T) {
	dir := testDirectory(t)
	store, err := NewContentStore(dir, 4*1024*1024, MaxStoredObjects)
	if err != nil {
		t.Fatal(err)
	}
	alice := identityFor(t, "Alice")
	pinned := bundleFor(t, alice, strings.Repeat("p", 1024*1024))
	cold := bundleFor(t, alice, strings.Repeat("c", 768*1024))
	store.Put(pinned, true)
	store.Put(cold, false)
	before, _ := os.ReadFile(filepath.Join(dir, "index.json"))
	if err := store.SetQuota(1024 * 1024); err == nil {
		t.Fatal("impossible quota accepted")
	}
	after, _ := os.ReadFile(filepath.Join(dir, "index.json"))
	if !bytes.Equal(before, after) || !store.Has(cold.Manifest.ID) || store.Stats().Quota != 4*1024*1024 {
		t.Fatal("failed quota destroyed state")
	}
	if err = store.SetQuota(2 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	if !store.Has(pinned.Manifest.ID) || store.Has(cold.Manifest.ID) {
		t.Fatal("feasible eviction failed")
	}
	if err = os.WriteFile(filepath.Join(dir, "index.json"), []byte(`null`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = NewContentStore(dir, 4*1024*1024, MaxStoredObjects); err == nil {
		t.Fatal("invalid index accepted")
	}
	if _, err = os.Stat(filepath.Join(dir, "objects", pinned.Manifest.ID+".json")); err != nil {
		t.Fatal("invalid index deleted valid data")
	}
}

func TestPasswordUnpairedSurrogatesMatchNodeUTF8(t *testing.T) {
	value, err := DecodeJSON([]byte(`"long \ud800\ud800 \udc00 password"`), 8192)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := CreateIdentity("Password test")
	if err != nil {
		t.Fatal(err)
	}
	vault, err := ExportVault(identity, value.(string))
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := ImportVault(vault, "long \ufffd\ufffd \ufffd password")
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Public.ID != identity.Public.ID {
		t.Fatal("password byte conversion changed identity")
	}
}

func TestStructuralParserBudget(t *testing.T) {
	var data bytes.Buffer
	data.WriteByte('[')
	for i := 0; i < 100_001; i++ {
		if i > 0 {
			data.WriteByte(',')
		}
		data.WriteString("{}")
	}
	data.WriteByte(']')
	if _, err := DecodeJSON(data.Bytes(), MaxContent); err == nil {
		t.Fatal("tiny-container flood bypassed structural budget")
	}
	if _, err := DecodeJSON([]byte(`[{"valid":true}]`), MaxContent); err != nil {
		t.Fatal(err)
	}
}

func TestStoredFingerprintChecksBytesDespiteRestoredTimestamp(t *testing.T) {
	identity, _ := CreateIdentity("Integrity")
	bundle, _ := CreateBundle(identity, "post", map[string]any{"text": "safe"}, nil, true, DefaultTTL)
	dir := testDirectory(t)
	store, err := NewContentStore(dir, DefaultQuota, 16)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(bundle, false); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "objects", bundle.Manifest.ID+".json")
	original, err := fingerprint(path)
	if err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	data, _ := os.ReadFile(path)
	ref := bundle.Manifest.Chunks[0].Hash
	old := bundle.Chunks[ref]
	first := byte('A')
	if old[0] == first {
		first = 'B'
	}
	changed := strings.Replace(string(data), old, string(first)+old[1:], 1)
	if len(changed) != len(data) || changed == string(data) {
		t.Fatal("invalid corruption fixture")
	}
	if err := os.WriteFile(path, []byte(changed), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	now, err := fingerprint(path)
	if err != nil {
		t.Fatal(err)
	}
	if now == original {
		t.Fatal("file bytes changed but fingerprint did not")
	}
	if len(store.List()) != 0 {
		t.Fatal("corrupt metadata remained advertised")
	}
}
