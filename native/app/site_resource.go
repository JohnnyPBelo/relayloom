package app

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
)

// A carrier can retain opaque private envelopes. If this identity can read
// the resource, validate the closed payload before accepting or serving it.
func inspectResourceBundle(bundle core.Bundle, identity *core.Identity) error {
	if bundle.Manifest.Kind != "site-resource" {
		return nil
	}
	readable := bundle.Manifest.PublicKey != nil
	for _, key := range bundle.Manifest.Keys {
		if identity != nil && key.Reader == identity.Public.ID {
			readable = true
		}
	}
	if !readable {
		return nil
	}
	value, err := core.DecryptBundle(bundle, identity)
	if err != nil {
		return err
	}
	_, err = sites.ParseResource(value)
	return err
}
