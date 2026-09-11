// Interop is a development-only stdin/stdout fixture runner. It is not exposed
// by the application or network. Fixture keys remain in project .cache files.
package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func encoded(v any) []byte {
	data, err := core.Canonical(v)
	if err != nil {
		panic(err)
	}
	return data
}
func identity(v any) core.Identity {
	i, err := core.DecodeIdentity(encoded(v))
	if err != nil {
		panic(err)
	}
	return i
}
func bundle(v any) core.Bundle {
	b, err := core.DecodeBundle(encoded(v))
	if err != nil {
		panic(err)
	}
	return b
}
func required(err error) {
	if err != nil {
		panic(err)
	}
}
func run(input map[string]any) (map[string]any, error) {
	alice, reader, eve := identity(input["nodeIdentity"]), identity(input["readerIdentity"]), identity(input["eveIdentity"])
	if err := core.ValidateIdentity(alice.Public); err != nil {
		return nil, err
	}
	password := input["password"].(string)
	recovered, err := core.ImportVault(input["nodeVault"].(string), password)
	if err != nil {
		return nil, err
	}
	if recovered.SignSecret != alice.SignSecret || recovered.BoxSecret != alice.BoxSecret {
		return nil, errors.New("Node vault mismatch")
	}
	nodePrivate, nodePublic := bundle(input["nodePrivate"]), bundle(input["nodePublic"])
	private, err := core.DecryptBundle(nodePrivate, &reader)
	if err != nil {
		return nil, err
	}
	public, err := core.DecryptBundle(nodePublic, nil)
	if err != nil {
		return nil, err
	}
	_, unauthorizedErr := core.DecryptBundle(nodePrivate, &eve)
	forged := nodePrivate
	forged.Manifest.Author = reader.Public
	forgeryErr := core.VerifyBundle(forged)
	corrupt := bundle(input["nodePrivate"])
	key := corrupt.Manifest.Chunks[0].Hash
	chunk, err := base64.StdEncoding.DecodeString(corrupt.Chunks[key])
	if err != nil {
		return nil, err
	}
	chunk[0] ^= 1
	corrupt.Chunks[key] = base64.StdEncoding.EncodeToString(chunk)
	corruptionErr := core.VerifyBundle(corrupt)
	goIdentity, err := core.CreateIdentity("Go & <bridge> 🚀\u2028")
	if err != nil {
		return nil, err
	}
	goVault, err := core.ExportVault(goIdentity, password)
	if err != nil {
		return nil, err
	}
	goPrivate, err := core.CreateBundle(goIdentity, "message", input["payload"], []core.PublicIdentity{alice.Public, reader.Public}, false, core.DefaultTTL)
	if err != nil {
		return nil, err
	}
	goPublic, err := core.CreateBundle(goIdentity, "post", input["payload"], nil, true, core.DefaultTTL)
	if err != nil {
		return nil, err
	}
	canonicalCases := make([]string, 0)
	for _, raw := range input["canonicalCases"].([]any) {
		value, err := core.DecodeJSON([]byte(raw.(string)), core.MaxBundleBytes)
		if err != nil {
			return nil, err
		}
		data, err := core.Canonical(value)
		if err != nil {
			return nil, err
		}
		canonicalCases = append(canonicalCases, string(data))
	}
	lone := identity(input["loneIdentity"])
	if err := core.ValidateIdentity(lone.Public); err != nil {
		return nil, fmt.Errorf("lone surrogate identity: %w", err)
	}
	nodeStore, err := core.NewContentStore(input["nodeStoreDir"].(string), 8*1024*1024, core.MaxStoredObjects)
	if err != nil {
		return nil, err
	}
	seeded, err := nodeStore.Get(nodePrivate.Manifest.ID)
	if err != nil {
		return nil, err
	}
	_, err = core.DecryptBundle(seeded, &reader)
	if err != nil {
		return nil, err
	}
	if !nodeStore.IsPinned(nodePrivate.Manifest.ID) {
		return nil, errors.New("Node store pin lost")
	}
	goStore, err := core.NewContentStore(input["goStoreDir"].(string), 8*1024*1024, core.MaxStoredObjects)
	if err != nil {
		return nil, err
	}
	if _, err = goStore.Put(goPrivate, true); err != nil {
		return nil, err
	}
	if _, err = goStore.Put(nodePrivate, false); err != nil {
		return nil, err
	}
	return map[string]any{"nodeIdentityVerified": true, "loneIdentityVerified": true, "nodeVaultRecovered": true, "nodePrivatePayload": private, "nodePublicPayload": public, "unauthorizedRejected": unauthorizedErr != nil, "readerForgeryRejected": forgeryErr != nil, "corruptionRejected": corruptionErr != nil, "canonicalCases": canonicalCases, "goIdentity": goIdentity, "goVault": goVault, "goPrivate": goPrivate, "goPublic": goPublic, "goStore": goStore.Stats(), "nodeStoreRead": true}, nil
}
func main() {
	defer func() {
		if recover() != nil {
			fmt.Fprintln(os.Stderr, "native interop fixture failed")
			os.Exit(1)
		}
	}()
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 16*1024*1024+1))
	required(err)
	value, err := core.DecodeJSON(data, 16*1024*1024)
	required(err)
	input, ok := value.(map[string]any)
	if !ok {
		panic("fixture object required")
	}
	output, err := run(input)
	required(err)
	result, err := core.Canonical(output)
	required(err)
	_, err = os.Stdout.Write(append(result, '\n'))
	required(err)
}
