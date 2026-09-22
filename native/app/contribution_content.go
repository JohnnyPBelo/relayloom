package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
)

func contributionManifestPolicy(m core.Manifest) bool {
	if m.Kind != "site-contribution" || m.PublicKey != nil || len(m.Keys) < 1 || len(m.Keys) > 2 || m.Expires-m.Created > sites.ContributionLifetimeMS {
		return false
	}
	for _, key := range m.Keys {
		if key.Reader == m.Author.ID {
			return true
		}
	}
	return false
}
func inspectContributionBundle(bundle core.Bundle, identity *core.Identity) (map[string]any, error) {
	if bundle.Manifest.Kind != "site-contribution" {
		return nil, nil
	}
	if !contributionManifestPolicy(bundle.Manifest) {
		return nil, errors.New("propostas exigem um envelope privado limitado")
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
	value, err := core.DecryptBundle(bundle, identity)
	if err != nil {
		return nil, err
	}
	return sites.MatchContributionEnvelope(bundle, value)
}
