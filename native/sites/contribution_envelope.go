package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"sort"
)

func ParseContributionContent(input any) (map[string]any, error) {
	m, err := object(input, "type", "proposal")
	if err != nil || m["type"] != "site-contribution" {
		return nil, errors.New("conteúdo de proposta inválido")
	}
	cert, err := VerifyContribution(m["proposal"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"type": "site-contribution", "proposal": cert}, nil
}

// MatchContributionEnvelope assumes an authenticated/decrypted outer envelope.
// It does not authorize inbox admission, owner approval, expiry or retransmission.
func MatchContributionEnvelope(bundle core.Bundle, plaintext any) (map[string]any, error) {
	content, err := ParseContributionContent(plaintext)
	if err != nil {
		return nil, err
	}
	cert := content["proposal"].(map[string]any)
	body := cert["body"].(map[string]any)
	author := body["contributor"].(map[string]any)["id"].(string)
	owner, _, _ := ParseAddress(body["target"].(map[string]any)["site"].(string))
	expected := []string{owner}
	if owner != author {
		expected = append(expected, author)
	}
	sort.Strings(expected)
	created, _ := contributionClock(body["created"])
	expires, _ := contributionClock(body["expires"])
	if bundle.Manifest.Kind != "site-contribution" || bundle.Manifest.Author.ID != author || bundle.Manifest.PublicKey != nil || !creationEqual(readersOf(bundle), expected) || bundle.Manifest.Created != created || bundle.Manifest.Expires != expires {
		return nil, errors.New("envelope diferente da proposta privada")
	}
	return content, nil
}
