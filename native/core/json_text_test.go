package core

import (
	"bytes"
	"strings"
	"testing"
)

func TestJSONTextRunsPreserveEscapesAndUnicode(t *testing.T) {
	prefix := strings.Repeat("aZ09+/=", 8192)
	for _, tc := range []struct{ name, input, want string }{
		{"ascii", prefix, prefix},
		{"escapes", prefix + `\"\\\/\b\f\n\r\t\u0000` + prefix, prefix + "\"\\/\b\f\n\r\t\x00" + prefix},
		{"unicode", prefix + "Olá 🌍\ufffd" + prefix, prefix + "Olá 🌍\ufffd" + prefix},
		{"surrogates", prefix + `\ud800x\udc00\ud83d\ude80` + prefix, prefix + string([]byte{0xed, 0xa0, 0x80}) + "x" + string([]byte{0xed, 0xb0, 0x80}) + "🚀" + prefix},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wire := []byte(`["` + tc.input + `",{"after":true}]`)
			value, err := DecodeJSON(wire, len(wire))
			if err != nil {
				t.Fatal(err)
			}
			list := value.([]any)
			if list[0] != tc.want || list[1].(map[string]any)["after"] != true {
				t.Fatal("string run changed text or consumed the following value")
			}
			// Returned values must own their bytes, including unescaped spans.
			clear(wire)
			if list[0] != tc.want {
				t.Fatal("decoded text aliases the mutable wire buffer")
			}
		})
	}
}

func TestJSONTextRunsDoNotHideInvalidBytes(t *testing.T) {
	prefix := bytes.Repeat([]byte("a"), 65536)
	invalid := [][]byte{
		{0xff}, {0xc0, 0xaf}, {0xe2, 0x82}, {0xed, 0xa0, 0x80},
		[]byte(`\q`), []byte(`\u12x4`), []byte(`\ud800\u12x4`),
	}
	for control := byte(0); control < 32; control++ {
		invalid = append(invalid, []byte{control})
	}
	for _, bad := range invalid {
		wire := append([]byte{'"'}, prefix...)
		wire = append(wire, bad...)
		wire = append(wire, prefix...)
		wire = append(wire, '"')
		if _, err := DecodeJSON(wire, len(wire)); err == nil {
			t.Fatalf("accepted invalid bytes after ASCII run: %x", bad)
		}
	}
	for _, suffix := range []string{"", `\`, `"false`} {
		wire := append([]byte{'"'}, prefix...)
		wire = append(wire, suffix...)
		if _, err := DecodeJSON(wire, len(wire)); err == nil {
			t.Fatalf("accepted incomplete or trailing JSON: %q", suffix)
		}
	}
	wire := append([]byte{'"'}, prefix...)
	wire = append(wire, '"')
	if _, err := DecodeJSON(wire, len(wire)-1); err == nil {
		t.Fatal("long text bypassed byte limit")
	}
}

func BenchmarkDecodeLargeJSONText(b *testing.B) {
	wire := []byte(`{"attachment":"` + strings.Repeat("aZ09+/=", 150000) + `"}`)
	b.SetBytes(int64(len(wire)))
	b.ReportAllocs()
	for b.Loop() {
		if _, err := DecodeJSON(wire, len(wire)); err != nil {
			b.Fatal(err)
		}
	}
}
