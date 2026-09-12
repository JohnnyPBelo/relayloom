package app

import (
	"os"
	"path/filepath"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/profiledb"
)

func openPrivateProfile(directory string, identity core.Identity) (*profiledb.Database, PrivateState, string, error) {
	database, err := profiledb.Open(directory, identity, func() (profiledb.Legacy, error) {
		source, err := readFile(filepath.Join(directory, "private-state.json"), privateLimit*3/2)
		if os.IsNotExist(err) {
			data, err := core.Canonical(emptyPrivate())
			return profiledb.Legacy{Bytes: data, SourceDigest: core.Hash([]byte("relayloom/absent-legacy-private-state/1"))}, err
		}
		if err != nil {
			return profiledb.Legacy{}, err
		}
		state, err := decodePrivate(source, identity)
		if err != nil {
			return profiledb.Legacy{}, err
		}
		data, err := core.Canonical(state)
		return profiledb.Legacy{Bytes: data, SourceDigest: core.Hash(source)}, err
	})
	if err != nil {
		return nil, PrivateState{}, "", err
	}
	blob, err := database.Read()
	if err != nil {
		database.Close()
		return nil, PrivateState{}, "", err
	}
	value, err := core.DecodeJSON(blob.Bytes, privateLimit)
	if err != nil {
		database.Close()
		return nil, PrivateState{}, "", err
	}
	state, err := parsePrivate(value, identity.Public.ID)
	if err != nil {
		database.Close()
		return nil, PrivateState{}, "", err
	}
	return database, state, blob.Digest, nil
}
