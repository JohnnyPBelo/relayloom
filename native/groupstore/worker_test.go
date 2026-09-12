package groupstore

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"testing"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

// This helper is invoked by the real Node↔Go storage driver with private
// temporary input. An ordinary unit run skips it and never invents a pass.
func TestStoreProcessWorker(t *testing.T) {
	config := os.Getenv("RELAYLOOM_STORE_WORKER")
	if config == "" {
		t.Skip("executed by the Node cross-runtime process test")
	}
	var input struct{ Mode, Path, IdentityPath, Marker, StoreID string }
	if err := json.Unmarshal([]byte(config), &input); err != nil {
		t.Fatal(err)
	}
	secret, err := os.ReadFile(input.IdentityPath)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := core.DecodeIdentity(secret)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(input.Path, identity, Options{Create: input.Mode == "create", ExpectedStoreID: input.StoreID})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	switch input.Mode {
	case "create":
		err = s.Update(func(tx *Tx) error {
			if e := tx.Put("head:go", []byte("Go → Node — ficheiro cifrado"), Checkpoint); e != nil {
				return e
			}
			return tx.Put("counter", []byte("0"), Data)
		})
	case "exchange":
		err = s.Update(func(tx *Tx) error {
			data, ok, e := tx.Get("head:node")
			if e != nil {
				return e
			}
			if !ok || string(data) != "Node → Go — propriedade de assinatura" {
				return fmt.Errorf("Node payload mismatch")
			}
			return tx.Put("head:go", []byte("Go confirmou bytes Node"), Checkpoint)
		})
	case "increment":
		fmt.Println("STORE_WORKER_READY")
		if _, e := bufio.NewReader(os.Stdin).ReadString('\n'); e != nil {
			t.Fatal(e)
		}
		for i := 0; i < 12; i++ {
			if err = s.Update(func(tx *Tx) error {
				data, ok, e := tx.Get("counter")
				if e != nil {
					return e
				}
				if !ok {
					return fmt.Errorf("counter missing")
				}
				value, e := strconv.Atoi(string(data))
				if e != nil {
					return e
				}
				return tx.Put("counter", []byte(strconv.Itoa(value+1)), Data)
			}); err != nil {
				break
			}
		}
	case "crash":
		err = s.Update(func(tx *Tx) error {
			if e := tx.Put("counter", []byte("999"), Data); e != nil {
				return e
			}
			if e := tx.Put("uncommitted", make([]byte, 256*1024), Data); e != nil {
				return e
			}
			if e := os.WriteFile(input.Marker, []byte("writes-staged-before-commit"), 0600); e != nil {
				return e
			}
			os.Exit(73)
			return nil
		})
	case "read":
		err = s.View(func(tx *Tx) error { _, _, e := tx.Get("head:go"); return e })
	case "index-reserve":
		err = s.Update(func(tx *Tx) error {
			accepted := 0
			for i := 0; i < 16; i++ {
				e := tx.Put(fmt.Sprintf("growth:go:%d", i), []byte{}, Data)
				if errors.Is(e, ErrCapacity) {
					if accepted == 0 {
						return fmt.Errorf("positive ordinary-index control failed")
					}
					return tx.Put("checkpoint:go-stop", []byte("left"), Checkpoint)
				}
				if e != nil {
					return e
				}
				accepted++
			}
			return fmt.Errorf("ordinary index growth consumed protected index headroom")
		})
		if err == nil {
			accounting, e := s.Accounting()
			if e != nil {
				t.Fatal(e)
			}
			data, e := json.Marshal(accounting)
			if e != nil {
				t.Fatal(e)
			}
			err = os.WriteFile(input.Marker, data, 0600)
		}
	case "recover":
		err = s.View(func(tx *Tx) error {
			data, ok, e := tx.Get("counter")
			if e != nil {
				return e
			}
			if !ok || string(data) != "24" {
				return fmt.Errorf("committed counter lost")
			}
			_, found, e := tx.Get("uncommitted")
			if e != nil {
				return e
			}
			if found {
				return fmt.Errorf("crash committed staged data")
			}
			return nil
		})
	default:
		t.Fatal("unknown worker mode")
	}
	if err != nil {
		t.Fatal(err)
	}
}
