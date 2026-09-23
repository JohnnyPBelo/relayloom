package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
)

func contributionRejectionManifestPolicy(m core.Manifest) bool {
	if m.Kind != "site-contribution-rejection" || m.PublicKey != nil || len(m.Keys) < 1 || len(m.Keys) > 2 || m.Expires-m.Created > sites.ContributionRejectionLifetimeMS {
		return false
	}
	total := 0
	for _, chunk := range m.Chunks {
		total += chunk.Size
	}
	if total > sites.ContributionRejectionBytes+128 {
		return false
	}
	for _, key := range m.Keys {
		if key.Reader == m.Author.ID {
			return true
		}
	}
	return false
}
func inspectContributionRejection(bundle core.Bundle, identity *core.Identity) (map[string]any, error) {
	if bundle.Manifest.Kind != "site-contribution-rejection" {
		return nil, nil
	}
	if !contributionRejectionManifestPolicy(bundle.Manifest) {
		return nil, errors.New("recusas exigem um envelope privado limitado")
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
	return sites.MatchContributionRejectionEnvelope(bundle, plain)
}
