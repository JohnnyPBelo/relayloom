package transport

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestArrivalStreamCannotStealBulkFairness(t *testing.T) {
	r := routerFor(t, Options{})
	_, peer := attachPipe(t, r)
	type result struct {
		frames []wireFrame
		err    error
	}
	finished := make(chan result, 1)
	go func() {
		reader := bufio.NewReader(peer)
		frames := []wireFrame{}
		for len(frames) < 120 {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				finished <- result{frames, err}
				return
			}
			var frame wireFrame
			if err = json.Unmarshal(line, &frame); err != nil {
				finished <- result{frames, err}
				return
			}
			if frame.Type != "part" {
				continue
			}
			frames = append(frames, frame)
			if frame.Index == frame.Count-1 {
				if _, err = fmt.Fprintf(peer, "{\"t\":\"ack\",\"id\":\"%s\"}\n", frame.ID); err != nil {
					finished <- result{frames, err}
					return
				}
			}
			if len(frames) < 120 {
				if _, err = r.Broadcast(map[string]any{"arriving": len(frames)}, Normal, time.Minute, false); err != nil {
					finished <- result{frames, err}
					return
				}
			}
		}
		finished <- result{frames, nil}
	}()
	bulk, err := r.Broadcast(map[string]any{"bytes": strings.Repeat("x", 80_000)}, Bulk, time.Minute, false)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-finished:
		if result.err != nil {
			t.Fatal(result.err)
		}
		count := 0
		for _, frame := range result.frames {
			if frame.ID == bulk {
				count++
			}
		}
		if count < 29 {
			t.Fatalf("bulk received %d of 120 turns", count)
		}
		if count == 120 {
			t.Fatal("the small-message stream made no progress")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("arrival fairness fixture did not complete")
	}
}
