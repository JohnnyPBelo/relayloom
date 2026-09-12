package profilelock

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestProfileOwnershipInteropFixture(t *testing.T) {
	dir := os.Getenv("RELAYLOOM_PROFILE_FIXTURE_DIR")
	if dir == "" {
		t.Skip("driven by real Node/Go profile ownership processes")
	}
	output := os.Getenv("RELAYLOOM_PROFILE_FIXTURE_OUTPUT")
	lease, err := Acquire(dir)
	if err != nil {
		bytes, _ := json.Marshal(map[string]string{"error": err.Error()})
		if e := os.WriteFile(output, bytes, 0600); e != nil {
			t.Fatal(e)
		}
		return
	}
	defer lease.Close()
	if err = os.WriteFile(output, []byte(`{"acquired":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	fmt.Println("AUTHORITY_WORKER_READY")
	command, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if command == "crash\n" {
		os.Exit(75)
	}
}
