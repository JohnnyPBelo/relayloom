package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
)

func contributionReceiptManifestPolicy(m core.Manifest) bool {
	if m.Kind != "site-contribution-receipt" || m.PublicKey != nil || len(m.Keys) < 1 || len(m.Keys) > 2 || m.Expires-m.Created > sites.ContributionReceiptLifetimeMS {
		return false
	}
	total := 0
	for _, chunk := range m.Chunks {
		total += chunk.Size
	}
	if total > sites.ContributionReceiptBytes+128 {
		return false
	}
	for _, key := range m.Keys {
		if key.Reader == m.Author.ID {
			return true
		}
	}
	return false
}
func inspectContributionReceipt(bundle core.Bundle, identity *core.Identity) (map[string]any, error) {
	if bundle.Manifest.Kind != "site-contribution-receipt" {
		return nil, nil
	}
	if !contributionReceiptManifestPolicy(bundle.Manifest) {
		return nil, errors.New("recibos exigem um envelope privado limitado")
	}
	readable := false
	for _, key := range bundle.Manifest.Keys {
		if identity != nil && key.Reader == identity.Public.ID {
			readable = true
		}
	}
	if !readable {
		return nil, nil
	}
	plain, err := core.DecryptBundle(bundle, identity)
	if err != nil {
		return nil, err
	}
	return sites.MatchContributionReceiptEnvelope(bundle, plain)
}
