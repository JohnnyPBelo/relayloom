// Package profiledb coordinates signed initialization and a protected private
// document. The application must hold its profile ownership lease while open.
package profiledb

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"crypto/rand"
	"encoding/hex"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
	"github.com/JohnnyPBelo/relayloom/native/profilebinding"
	"github.com/JohnnyPBelo/relayloom/native/profilestate"
)

const initializationKey = "application:initialization"

type Legacy struct {
	Bytes        []byte
	SourceDigest string
}
type initialization struct {
	Domain        string `json:"domain"`
	Nonce         string `json:"nonce"`
	SourceDigest  string `json:"sourceDigest"`
	InitialDigest string `json:"initialDigest"`
}
type Database struct {
	store   *groupstore.Store
	binding profilebinding.Binding
}

func invalid(message string) error { return fmt.Errorf("%w: %s", groupstore.ErrIntegrity, message) }
func exists(path string) (bool, error) {
	_, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}
func readBinding(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 2048 {
		return nil, invalid("ficheiro de ligação inválido")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !actual.Mode().IsRegular() || !os.SameFile(info, actual) || actual.Size() > 2048 {
		return nil, invalid("ligação mudou durante a abertura")
	}
	data, err := io.ReadAll(io.LimitReader(file, 2049))
	if err != nil {
		return nil, err
	}
	if len(data) > 2048 || int64(len(data)) != actual.Size() {
		return nil, invalid("ligação truncada ou excessiva")
	}
	return data, nil
}
func validateLegacy(value Legacy) (Legacy, error) {
	if len(value.Bytes) < 1 || len(value.Bytes) > profilestate.MaxBytes || !core.ValidAddress(value.SourceDigest) {
		return value, invalid("importação privada inválida")
	}
	parsed, err := core.DecodeJSON(value.Bytes, profilestate.MaxBytes)
	if err != nil {
		return value, err
	}
	encoded, err := core.Canonical(parsed)
	if err != nil || !bytes.Equal(encoded, value.Bytes) {
		return value, invalid("importação privada não canónica")
	}
	return value, nil
}
func marker(tx *groupstore.Tx, binding profilebinding.Binding) (initialization, error) {
	var result initialization
	data, exists, err := tx.Get(initializationKey)
	if err != nil {
		return result, err
	}
	if !exists || len(data) > 1024 {
		return result, invalid("falta a inicialização protegida")
	}
	if _, err = core.DecodeJSON(data, 1024); err != nil {
		return result, invalid("inicialização ilegível")
	}
	if err = json.Unmarshal(data, &result); err != nil {
		return result, invalid("inicialização inválida")
	}
	encoded, err := core.Canonical(result)
	if err != nil || !bytes.Equal(encoded, data) || result.Domain != "relayloom/profile-initialization/1" || result.Nonce != binding.Body.Nonce || result.SourceDigest != binding.Body.SourceDigest || !core.ValidAddress(result.InitialDigest) {
		return result, invalid("inicialização não corresponde à ligação")
	}
	return result, nil
}
func writeBinding(path string, binding profilebinding.Binding) error {
	data, err := core.Canonical(binding)
	if err != nil {
		return err
	}
	return core.AtomicWrite(path, data)
}
func Open(directory string, identity core.Identity, loadLegacy func() (Legacy, error)) (*Database, error) {
	bindingPath := filepath.Join(directory, "profile-binding.json")
	databasePath := filepath.Join(directory, "profile-state.sqlite")
	haveBinding, err := exists(bindingPath)
	if err != nil {
		return nil, err
	}
	haveDatabase, err := exists(databasePath)
	if err != nil {
		return nil, err
	}
	var binding profilebinding.Binding
	var legacy *Legacy
	load := func() error {
		value, err := loadLegacy()
		if err != nil {
			return err
		}
		value, err = validateLegacy(value)
		if err != nil {
			return err
		}
		legacy = &value
		return nil
	}
	if haveBinding {
		data, err := readBinding(bindingPath)
		if err != nil {
			return nil, err
		}
		binding, err = profilebinding.Decode(data, identity.Public)
		if err != nil {
			return nil, err
		}
	} else {
		if haveDatabase {
			return nil, invalid("base de dados privada sem ligação assinada; não será reposta")
		}
		if err = load(); err != nil {
			return nil, err
		}
		id := make([]byte, 32)
		if _, err = rand.Read(id); err != nil {
			return nil, err
		}
		binding, err = profilebinding.Prepare(identity, hex.EncodeToString(id), legacy.SourceDigest)
		if err != nil {
			return nil, err
		}
		if err = writeBinding(bindingPath, binding); err != nil {
			return nil, err
		}
	}
	if binding.Body.Phase == "prepared" {
		if legacy == nil {
			if err = load(); err != nil {
				return nil, err
			}
		}
		if legacy.SourceDigest != binding.Body.SourceDigest {
			return nil, invalid("estado legado mudou durante a preparação; preserve ambas as cópias")
		}
	} else if !haveDatabase {
		return nil, invalid("base de dados privada inicializada está ausente; não será reposta")
	}
	options := groupstore.Options{ExpectedStoreID: binding.Body.StoreID}
	if !haveDatabase {
		options = groupstore.Options{Create: true, NewStoreID: binding.Body.StoreID}
	}
	store, err := groupstore.Open(databasePath, identity, options)
	if err != nil {
		return nil, err
	}
	retained := false
	defer func() {
		if !retained {
			store.Close()
		}
	}()
	if binding.Body.Phase == "prepared" {
		err = store.Update(func(tx *groupstore.Tx) error {
			keys, err := tx.Keys("")
			if err != nil {
				return err
			}
			if len(keys) == 0 {
				accounting, err := tx.Accounting()
				if err != nil {
					return err
				}
				if accounting.Revision != 0 {
					return invalid("registo vazio com histórico; não será inicializado de novo")
				}
				digest, err := profilestate.Write(tx, legacy.Bytes, nil)
				if err != nil {
					return err
				}
				data, err := core.Canonical(initialization{"relayloom/profile-initialization/1", binding.Body.Nonce, binding.Body.SourceDigest, digest})
				if err != nil {
					return err
				}
				if err = tx.Put(initializationKey, data, groupstore.Checkpoint); err != nil {
					return err
				}
			}
			initial, err := marker(tx, binding)
			if err != nil {
				return err
			}
			state, err := profilestate.Read(tx)
			if err != nil {
				return err
			}
			if state == nil || state.Digest != initial.InitialDigest || state.Digest != core.Hash(legacy.Bytes) {
				return invalid("estado preparado mudou ou está incompleto")
			}
			keys, err = tx.Keys("")
			if err != nil {
				return err
			}
			if len(keys) != 2+(len(state.Bytes)+profilestate.ChunkBytes-1)/profilestate.ChunkBytes {
				return invalid("registos inesperados antes de concluir a inicialização")
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		binding, err = profilebinding.Commit(identity, binding)
		if err != nil {
			return nil, err
		}
		if err = writeBinding(bindingPath, binding); err != nil {
			return nil, err
		}
	}
	db := &Database{store, binding}
	if _, err = db.Read(); err != nil {
		return nil, err
	}
	retained = true
	return db, nil
}
func (d *Database) Binding() profilebinding.Binding { return d.binding }
func (d *Database) Store() *groupstore.Store        { return d.store }
func (d *Database) Read() (*profilestate.State, error) {
	var state *profilestate.State
	err := d.store.View(func(tx *groupstore.Tx) error {
		if _, err := marker(tx, d.binding); err != nil {
			return err
		}
		var err error
		state, err = profilestate.Read(tx)
		if err != nil {
			return err
		}
		if state == nil {
			return invalid("estado privado inicializado ausente")
		}
		return nil
	})
	return state, err
}
func (d *Database) Update(callback func(*groupstore.Tx) error) error {
	return d.store.Update(func(tx *groupstore.Tx) error {
		if _, err := marker(tx, d.binding); err != nil {
			return err
		}
		if err := callback(tx); err != nil {
			return err
		}
		if _, err := marker(tx, d.binding); err != nil {
			return err
		}
		state, err := profilestate.Read(tx)
		if err != nil {
			return err
		}
		if state == nil {
			return invalid("estado privado inicializado ausente")
		}
		return nil
	})
}
func (d *Database) Write(data []byte, expectedDigest string) (string, error) {
	var digest string
	err := d.Update(func(tx *groupstore.Tx) error {
		var err error
		digest, err = profilestate.Write(tx, data, &expectedDigest)
		return err
	})
	if err != nil {
		return "", err
	}
	return digest, nil
}
func (d *Database) Close() error { return d.store.Close() }
