package transport

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

func TestNodeGoRealProcessTCPInteroperability(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node runtime unavailable for mixed-process control")
	}
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "node_modules", "tsx")); err != nil {
		t.Skip("project tsx dependency unavailable")
	}
	child := exec.Command(node, "--import", "tsx", filepath.Join(root, "native", "transport", "testdata", "node-peer.mjs"))
	child.Dir = root
	stdin, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	child.Stderr = &stderr
	if err = child.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	t.Cleanup(func() {
		stdin.Close()
		select {
		case <-exited:
		case <-time.After(3 * time.Second):
			child.Process.Kill()
			<-exited
		}
	})
	messages := make(chan map[string]any, 16)
	go func() {
		defer close(messages)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), MaxPacketBytes)
		for scanner.Scan() {
			var value map[string]any
			if json.Unmarshal(scanner.Bytes(), &value) == nil {
				messages <- value
			}
		}
	}()
	next := func(event string) map[string]any {
		t.Helper()
		timeout := time.NewTimer(6 * time.Second)
		defer timeout.Stop()
		for {
			select {
			case message, ok := <-messages:
				if !ok {
					t.Fatalf("Node exited: %s", stderr.String())
				}
				if message["event"] == event {
					return message
				}
			case <-timeout.C:
				t.Fatalf("Node event %s timed out: %s", event, stderr.String())
			}
		}
	}
	ready := next("ready")
	router := routerFor(t, Options{ID: "go-peer"})
	address := "127.0.0.1:" + strconv.Itoa(int(ready["port"].(float64)))
	if _, err = router.ConnectTCP(address); err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, func() bool { return len(router.Peers()) == 1 })
	goPayload := map[string]any{"from": "go", "text": strings.Repeat("Go → Node <&> λ 😀 ", 5000), "\ue000": "bmp", "\U00010000": "astral", "numbers": []any{json.Number("1e-7"), json.Number("1e21"), json.Number("9007199254740991")}}
	id, err := router.Broadcast(goPayload, SOS, 30*time.Second, false)
	if err != nil {
		t.Fatal(err)
	}
	received := next("payload")
	got, _ := core.Canonical(received["payload"])
	wanted, _ := core.Canonical(goPayload)
	if !bytes.Equal(got, wanted) {
		t.Fatal("Go→Node payload/canonicalization changed")
	}
	route := received["route"].(map[string]any)
	if route["packetId"] != id || route["source"] != "go-peer" {
		t.Fatalf("wrong Node route %+v", route)
	}
	nodePayload := map[string]any{"from": "node", "text": strings.Repeat("Node → Go verified ", 4000), "fraction": 0.0000001}
	command, _ := json.Marshal(map[string]any{"type": "broadcast", "payload": nodePayload, "priority": "normal"})
	if _, err = io.WriteString(stdin, string(command)+"\n"); err != nil {
		t.Fatal(err)
	}
	next("sent")
	delivery := nextFor(t, router)
	expected, _ := core.Canonical(nodePayload)
	if !bytes.Equal(delivery.Payload, expected) || delivery.Route.Source != "node-peer" || delivery.Route.Medium != "tcp" {
		t.Fatal("Node→Go bytes or source route changed")
	}
}
