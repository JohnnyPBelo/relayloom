# WebSocket registration barrier in the test

The integrated gate on b15b6e6 reproduced `expected8 connections, got7` under the race detector. HTTP101 can reach the client before the server goroutine returns from websocket.Accept and registers/attaches the stream. Production already counts pending upgrades against the cap; it was not changed.

The fixture now receives an actual protocol pong from every peer before asserting exactly8 active connections, then verifies the ninth request is rejected and an existing connection still responds. It preserves the3s heartbeat deadline and all origin/capability/expiry controls.

Command: `node scripts/go.mjs test -race -count=1 -p=1 ./webpeer`. Result: PASS,2.025s. The prior failure and new output are retained here. Broader RNS/host work remains uncommitted and is not implied by this test-only correction.
