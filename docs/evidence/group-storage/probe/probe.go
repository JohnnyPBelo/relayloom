package sqliteprobe
import (
 "database/sql"
 _ "modernc.org/sqlite"
)
func Probe() error {
 db, err := sql.Open("sqlite", ":memory:"); if err != nil { return err }; defer db.Close()
 _,err = db.Exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL)"); if err != nil { return err }
 tx,err := db.Begin(); if err != nil { return err }
 if _,err = tx.Exec("INSERT INTO probe VALUES(1,?)", []byte{1,2,3}); err != nil { return err }
 return tx.Commit()
}
