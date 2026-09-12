package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const privateLimit = 16 * 1024 * 1024

func b64(data []byte) string { return base64.StdEncoding.EncodeToString(data) }
func unb64(value string, max int) ([]byte, error) {
	if len(value) > max {
		return nil, errors.New("codificação excede limite")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || b64(data) != value {
		return nil, errors.New("codificação inválida")
	}
	return data, nil
}
func readFile(path string, limit int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > int64(limit) {
		return nil, errors.New("ficheiro excede limite")
	}
	data, err := io.ReadAll(io.LimitReader(f, int64(limit)+1))
	if len(data) > limit {
		return nil, errors.New("ficheiro excede limite")
	}
	return data, err
}
func parsePrivate(value any, owner string) (PrivateState, error) {
	p := emptyPrivate()
	m, err := object(value)
	if err != nil {
		return p, err
	}
	mutations, err := object(m["mutations"])
	if err != nil {
		return p, err
	}
	for id, value := range mutations {
		if !core.ValidAddress(id) {
			return p, errors.New("alvo privado inválido")
		}
		m, e := object(value)
		if e != nil {
			return p, e
		}
		created, e := number(m["created"])
		if e != nil {
			return p, e
		}
		expires, e := number(m["expires"])
		if e != nil {
			return p, e
		}
		author := text(m["author"])
		eventID := text(m["eventId"])
		if !core.ValidAddress(author) || (eventID != "" && !core.ValidAddress(eventID)) {
			return p, errors.New("mutação privada inválida")
		}
		mutation := Mutation{Author: author, Created: created, Expires: expires, EventID: eventID}
		if v, ok := m["deleted"]; ok {
			mutation.Deleted, e = boolean(v)
			if e != nil {
				return p, e
			}
		}
		if v, ok := m["text"]; ok {
			s, ok := v.(string)
			if !ok || jsLen(s) > 12000 {
				return p, errors.New("texto privado inválido")
			}
			mutation.Text = &s
		}
		p.Mutations[id] = mutation
	}
	if v, ok := m["collections"]; ok {
		p.Collections, err = validateCollections(v, owner)
		if err != nil {
			return p, err
		}
	}
	if v, ok := m["siteDraft"]; ok {
		draft, err := object(v)
		if err != nil {
			return p, err
		}
		if err = validateContent(Content{"type": "site", "blocks": draft["blocks"], "theme": draft["theme"]}); err != nil {
			return p, err
		}
		if _, err = number(draft["savedAt"]); err != nil {
			return p, err
		}
		p.SiteDraft = draft
	}
	if v, ok := m["outbox"]; ok {
		p.Outbox, err = parseOutbox(v, owner, time.Now().UnixMilli())
		if err != nil {
			return p, err
		}
	}
	return p, nil
}
func copyPrivate(p PrivateState, owner string) (PrivateState, error) {
	value, err := cloneValue(p)
	if err != nil {
		return PrivateState{}, err
	}
	return parsePrivate(value, owner)
}
func privateKey(identity core.Identity, salt []byte) ([]byte, error) {
	secret, err := unb64(identity.BoxSecret, 256)
	if err != nil {
		return nil, err
	}
	return hkdf.Key(sha256.New, secret, salt, "relayloom-local-state-v1", 32)
}
func writePrivate(path string, p PrivateState, identity core.Identity) error {
	plain, err := core.Canonical(p)
	if err != nil {
		return err
	}
	if len(plain) > privateLimit {
		return errors.New("limite de estado privado atingido")
	}
	salt, nonce := make([]byte, 32), make([]byte, 12)
	if _, err = rand.Read(salt); err != nil {
		return err
	}
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	key, err := privateKey(identity, salt)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	sealed := gcm.Seal(nil, nonce, plain, []byte(identity.Public.ID))
	data, err := core.Canonical(map[string]any{"version": 1, "salt": b64(salt), "nonce": b64(nonce), "tag": b64(sealed[len(sealed)-16:]), "data": b64(sealed[:len(sealed)-16])})
	if err != nil {
		return err
	}
	return core.AtomicWrite(path, data)
}
func readPrivate(path string, identity core.Identity) (PrivateState, error) {
	data, err := readFile(path, privateLimit*3/2)
	if os.IsNotExist(err) {
		return emptyPrivate(), nil
	}
	if err != nil {
		return PrivateState{}, err
	}
	value, err := core.DecodeJSON(data, privateLimit*3/2)
	if err != nil {
		return PrivateState{}, err
	}
	m, err := object(value)
	if err != nil {
		return PrivateState{}, err
	}
	version, err := number(m["version"])
	if err != nil || version != 1 {
		return PrivateState{}, errors.New("estado privado inválido")
	}
	salt, err := unb64(text(m["salt"]), 48)
	if err != nil || len(salt) != 32 {
		return PrivateState{}, errors.New("sal privado inválido")
	}
	nonce, err := unb64(text(m["nonce"]), 32)
	if err != nil || len(nonce) != 12 {
		return PrivateState{}, errors.New("nonce privado inválido")
	}
	tag, err := unb64(text(m["tag"]), 32)
	if err != nil || len(tag) != 16 {
		return PrivateState{}, errors.New("tag privada inválida")
	}
	ciphertext, err := unb64(text(m["data"]), privateLimit*3/2)
	if err != nil {
		return PrivateState{}, err
	}
	key, err := privateKey(identity, salt)
	if err != nil {
		return PrivateState{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return PrivateState{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return PrivateState{}, err
	}
	plain, err := gcm.Open(nil, nonce, append(ciphertext, tag...), []byte(identity.Public.ID))
	if err != nil {
		return PrivateState{}, err
	}
	value, err = core.DecodeJSON(plain, privateLimit)
	if err != nil {
		return PrivateState{}, err
	}
	return parsePrivate(value, identity.Public.ID)
}
