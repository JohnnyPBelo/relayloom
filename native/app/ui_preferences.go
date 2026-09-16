package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"io"
	"os"
	"path/filepath"
)

func validateUIPreferences(value any) (map[string]any, error) {
	p, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Preferências de interface inválidas")
	}
	for key, v := range p {
		switch key {
		case "language":
			s, ok := v.(string)
			if !ok || !contains([]string{"pt-PT", "en-GB", "es-ES"}, s) {
				return nil, errors.New("Preferências de interface inválidas")
			}
		case "theme":
			s, ok := v.(string)
			if !ok || !contains([]string{"light", "dark"}, s) {
				return nil, errors.New("Preferências de interface inválidas")
			}
		case "glass", "largeText", "highContrast":
			if _, ok := v.(bool); !ok {
				return nil, errors.New("Preferências de interface inválidas")
			}
		default:
			return nil, errors.New("Preferências de interface inválidas")
		}
	}
	return p, nil
}
func readUIPreferences(dir string) (map[string]any, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	before, err := root.Lstat("ui-preferences.json")
	if os.IsNotExist(err) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Size() > 4096 {
		return nil, errors.New("Preferências de interface inválidas")
	}
	f, err := root.Open("ui-preferences.json")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	actual, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !actual.Mode().IsRegular() || !os.SameFile(before, actual) {
		return nil, errors.New("Preferências de interface inválidas")
	}
	bytes, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return nil, err
	}
	if len(bytes) > 4096 {
		return nil, errors.New("Preferências de interface inválidas")
	}
	value, err := core.DecodeJSON(bytes, 4096)
	if err != nil {
		return nil, errors.New("Preferências de interface inválidas")
	}
	record, ok := value.(map[string]any)
	if !ok || len(record) != 2 {
		return nil, errors.New("Preferências de interface inválidas")
	}
	version, err := number(record["version"])
	if err != nil || version != 1 {
		return nil, errors.New("Preferências de interface inválidas")
	}
	return validateUIPreferences(record["values"])
}
func (n *Node) UIPreferences() (map[string]any, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return nil, errors.New("nó encerrado")
	}
	return readUIPreferences(n.Dir)
}
func (n *Node) saveUIPreferencesLocked(patch map[string]any) (map[string]any, error) {
	if _, err := validateUIPreferences(patch); err != nil {
		return nil, err
	}
	next, err := readUIPreferences(n.Dir)
	if err != nil {
		return nil, err
	}
	for k, v := range patch {
		next[k] = v
	}
	bytes, err := core.Canonical(map[string]any{"version": 1, "values": next})
	if err != nil {
		return nil, err
	}
	if err = core.AtomicWrite(filepath.Join(n.Dir, "ui-preferences.json"), bytes); err != nil {
		return nil, err
	}
	return next, nil
}
