package core

import (
	"encoding/json"
	"os"
	"testing"
)

func TestContentReservationProcessFixture(t *testing.T) {
	path := os.Getenv("RELAYLOOM_RESERVATION_FIXTURE")
	if path == "" {
		t.Skip("driven by the real Node/Go reservation process test")
	}
	var q struct {
		StoreDir     string   `json:"storeDir"`
		Action       string   `json:"action"`
		Output       string   `json:"output"`
		Bundles      []Bundle `json:"bundles"`
		Reservations []string `json:"reservations"`
	}
	raw, err := os.ReadFile(path)
	reservationOK(t, err)
	reservationOK(t, json.Unmarshal(raw, &q))
	if len(q.Bundles) != 3 {
		t.Fatal("fixture bundle count")
	}
	s, err := NewContentStore(q.StoreDir, 4*1024*1024, 2)
	reservationOK(t, err)
	var admitted *bool
	switch q.Action {
	case "seed":
		_, err = s.PutReserved(q.Bundles[0], false)
		reservationOK(t, err)
		_, err = s.Put(q.Bundles[1], true)
		reservationOK(t, err)
	case "reserve", "reserve-exit":
		reservationOK(t, s.SetReservations(q.Reservations))
	case "pressure":
		value, err := s.Put(q.Bundles[2], false)
		if err != nil {
			value = false
		}
		admitted = &value
	case "inspect":
	default:
		t.Fatal("unknown fixture action")
	}
	if q.Action == "reserve-exit" {
		os.Exit(78)
	}
	canDecrypt := false
	if b, err := s.GetWithTouch(q.Bundles[0].Manifest.ID, false); err == nil {
		_, err = DecryptBundle(b, nil)
		canDecrypt = err == nil
	}
	result := map[string]any{"reservations": s.Reservations(), "stats": s.Stats(), "aPresent": s.Has(q.Bundles[0].Manifest.ID), "bPinned": s.IsPinned(q.Bundles[1].Manifest.ID), "admitted": admitted, "canDecrypt": canDecrypt}
	raw, err = Canonical(result)
	reservationOK(t, err)
	reservationOK(t, os.WriteFile(q.Output, raw, 0600))
}
