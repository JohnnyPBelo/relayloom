package sqliteprobe
import "testing"
func TestSQLiteTransaction(t *testing.T) { if err := Probe(); err != nil { t.Fatal(err) } }
