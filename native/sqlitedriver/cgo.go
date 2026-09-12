//go:build android || relayloom_sqlite_cgo

package sqlitedriver

import (
	"database/sql"
	"database/sql/driver"
	"errors"

	sqlite3 "github.com/mattn/go-sqlite3"
)

const Backend = "sqlite3-cgo"

func IsBusy(err error) bool {
	var value sqlite3.Error
	return errors.As(err, &value) && (value.Code == sqlite3.ErrBusy || value.Code == sqlite3.ErrLocked)
}

func init() {
	// Android Bionic provides supported filesystem calls. The pure Go libc's
	// Linux/amd64 SYS_LSTAT is rejected by Android's normal seccomp policy.
	// Require a static build without external extension loading on every open.
	sql.Register("sqlite", &sqlite3.SQLiteDriver{ConnectHook: func(conn *sqlite3.SQLiteConn) error {
		rows, err := conn.Query("SELECT sqlite_compileoption_used('OMIT_LOAD_EXTENSION')", nil)
		if err != nil {
			return err
		}
		defer rows.Close()
		values := make([]driver.Value, 1)
		if err := rows.Next(values); err != nil {
			return err
		}
		if values[0] != int64(1) {
			return errors.New("SQLite C build requires sqlite_omit_load_extension")
		}
		return nil
	}})
}
