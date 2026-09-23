package core

import (
	"bytes"
	"errors"
	"math/rand"
	"os"
	"strings"
	"testing"
)

// Frozen reference of the prior string encoder, for byte compatibility only.
func canonicalPreviousString(out *bytes.Buffer, s string) error {
	out.WriteByte('"')
	const digits = "0123456789abcdef"
	for at := 0; at < len(s); {
		r, n, err := stringRune(s, at)
		if err != nil {
			return err
		}
		at += n
		switch r {
		case '"', '\\':
			out.WriteByte('\\')
			out.WriteByte(byte(r))
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		default:
			if r < 32 || (r >= 0xd800 && r <= 0xdfff) {
				out.WriteString(`\u`)
				out.WriteByte(digits[(r>>12)&15])
				out.WriteByte(digits[(r>>8)&15])
				out.WriteByte(digits[(r>>4)&15])
				out.WriteByte(digits[r&15])
			} else {
				out.WriteRune(r)
			}
		}
		if out.Len() > maxCanonicalBytes {
			return errors.New("JSON demasiado grande")
		}
	}
	out.WriteByte('"')
	return nil
}

func TestCanonicalStringRunCompatibility(t *testing.T) {
	fragments := []string{"abc+/012=", "\"", "\\", "\b\f\n\r\t", string([]byte{0, 1, 31, 127}), "<>&", "á山🚀", "\u2028\u2029", string([]byte{0xed, 0xa0, 0x80}), string([]byte{0xed, 0xbf, 0xbf}), string([]byte{0xff}), string([]byte{0xe2, 0x82})}
	random := rand.New(rand.NewSource(6032026))
	for i := 0; i < 512; i++ {
		var value strings.Builder
		value.WriteString(strings.Repeat("Q", i%97))
		for j := 0; j < 8; j++ {
			value.WriteString(fragments[random.Intn(len(fragments))])
			value.WriteString(strings.Repeat("A", random.Intn(80)))
		}
		var old bytes.Buffer
		before := canonicalPreviousString(&old, value.String())
		after, e := Canonical(value.String())
		if (before == nil) != (e == nil) {
			t.Fatalf("acceptance changed at %d: old=%v new=%v", i, before, e)
		}
		if before == nil && !bytes.Equal(old.Bytes(), after) {
			t.Fatalf("bytes changed at %d", i)
		}
	}
}
func TestCanonicalFinalByteBudget(t *testing.T) {
	for _, fixture := range []struct {
		overhead int
		wrap     func(string) any
	}{
		{2, func(s string) any { return s }},
		{4, func(s string) any { return []any{s} }},
		{8, func(s string) any { return map[string]any{"x": s} }},
	} {
		value := strings.Repeat("A", maxCanonicalBytes-fixture.overhead)
		data, err := Canonical(fixture.wrap(value))
		if err != nil || len(data) != maxCanonicalBytes {
			t.Fatalf("exact boundary: %v %d", err, len(data))
		}
		if _, err = Canonical(fixture.wrap(value + "A")); err == nil {
			t.Fatal("closing punctuation exceeded global byte budget")
		}
	}
}
func BenchmarkCanonicalLargeASCII(b *testing.B) {
	value := strings.Repeat("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=", 43000)
	b.SetBytes(int64(len(value)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := Canonical(value); err != nil {
			b.Fatal(err)
		}
	}
}

// Parent generates expected bytes using the production Node canonicalizer.
func TestCanonicalNodeRunVectorsWorker(t *testing.T) {
	path := os.Getenv("RELAYLOOM_CANONICAL_RUN_VECTORS")
	if path == "" {
		t.Skip("parent-owned Node oracle fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 8*1024*1024 {
		t.Fatal("bounded fixture required", err)
	}
	value, err := DecodeJSON(data, 8*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	rows, ok := value.([]any)
	if !ok || len(rows) > 512 {
		t.Fatal("bounded vector list required")
	}
	for i, raw := range rows {
		row, ok := raw.(map[string]any)
		if !ok {
			t.Fatal("vector shape")
		}
		expected, ok := row["expected"].(string)
		if !ok {
			t.Fatal("oracle missing")
		}
		encoded, err := Canonical(row["value"])
		if err != nil || string(encoded) != expected {
			t.Fatalf("Node bytes differ at %d: %v", i, err)
		}
	}
}
