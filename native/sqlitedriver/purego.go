//go:build !android && !relayloom_sqlite_cgo

// Package sqlitedriver registers the platform-compatible SQLite implementation.
// All callers retain the same authenticated records and SQLite file format.
package sqlitedriver

import (
	"errors"

	"modernc.org/sqlite"
)

const Backend = "modernc"

func IsBusy(err error) bool {
	var value *sqlite.Error
	return errors.As(err, &value) && (value.Code()&255 == 5 || value.Code()&255 == 6)
}
