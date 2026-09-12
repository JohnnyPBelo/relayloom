package sqlitedriver

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestSelectedDriverPreservesTransactionalBlobAndNoExtensionLoading(t *testing.T) {
	root := filepath.Join("..", "..", ".cache", "sqlite-driver")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	directory, err := os.MkdirTemp(root, "case-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	db, err := sql.Open("sqlite", filepath.Join(directory, "driver.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE proof(value BLOB NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("INSERT INTO proof(value) VALUES(?)", []byte{0, 255, 17}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM proof").Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback: %d %v", count, err)
	}
	if Backend == "sqlite3-cgo" {
		var disabled int
		if err := db.QueryRow("SELECT sqlite_compileoption_used('OMIT_LOAD_EXTENSION')").Scan(&disabled); err != nil || disabled != 1 {
			t.Fatalf("extension loading was not omitted: %v", err)
		}
	}
}
