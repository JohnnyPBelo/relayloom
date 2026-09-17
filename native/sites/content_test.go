package sites

import (
	"math/rand"
	"regexp"
	"testing"
)

func TestSiteBase64SyntaxMatchesReference(t *testing.T) {
	original := regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)
	values := []string{"", "=", "==", "===", "AA==", "A=A", "AAA=", "AAAA", "AAAA\n", "_", "-", "😀"}
	random := rand.New(rand.NewSource(27))
	for i := 0; i < 10000; i++ {
		data := make([]byte, random.Intn(64))
		for j := range data {
			data[j] = byte(random.Intn(256))
		}
		values = append(values, string(data))
	}
	for _, value := range values {
		if siteBase64Syntax(value) != original.MatchString(value) {
			t.Fatalf("base64 acceptance changed for %q", value)
		}
	}
}
