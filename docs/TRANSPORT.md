# Transport truth table and protocol limits

| Carrier | Implementation | Actual evidence | Unverified or blocked |
| --- | --- | --- | --- |
| TCP/IP | Node TCP sockets, explicit peer addresses, reconnect | Linux process and socket tests, bridge controls | Internet/NAT and physical devices pending; Node CI executes on Windows/macOS |
| Browser WebRTC | `RtcTransportPeer`/`BrowserRouter`/`BrowserMesh`, bounded SCTP/DTLS/ICE with explicit SDP, consent and inventory | Actual Chromium contexts, automatic forwarding/partition/heal/restarted seeder, cancellation and fairness; [routing evidence](evidence/browser-routing) | WS adapter implemented in Node/Go and tested on loopback; autonomous product UI, public WSS/NAT, Firefox/Safari and radio validation still pending; no implicit STUN/TURN |
| Browser/native WebSocket | Origin/capability-bound listener in Node/Go, browser adapter, native packet framing | Actual browser→RTC→WS→Go/TCP→Node/serialPTY route, opaque relays, partition/heal and restarted seeder; [evidence](evidence/browser-native) | Loopback only tested in browser; WSS/certificates/LAN and current mobile artifacts unverified |
| Serial byte stream | serialport device adapter, configurable baud | Linux OS PTY pair, real byte forwarding, heterogeneous three-process test | Physical UART/radio hardware and vendor packet modems not tested; PTY also exercised on macOS CI |
| BLE | Not implemented | None | Device APIs, pairing, MTU, OS restrictions |
| Wi-Fi Direct | Not implemented | None | Platform APIs and real hardware |
| LoRa/RNode | RNS RNodeInterface can be selected in the dedicated adapter configuration; no separate native driver | No physical radio execution | Hardware/firmware, regional airtime, signal range and all platform behavior remain unverified |
| RNS/Reticulum | Real reference RNS1.5.4 sidecar/Link/Channel carrying RelayLoom envelopes | Linux: real TCP → RNS transit router → serial PTY, partition/heal, restarted seeder and authorization/corruption controls passed directed tests | Host milestone validated; physical radios, packaging, per-installation RNS transit policy and browser-combined path pending; see [Reticulum](RETICULUM.md) |
| Simulation | Separate deterministic engine in progress | Reports only after actual simulation test completion | Never substitutes for transport or hardware tests |

## Routing and storage

The experimental wire protocol uses content-hashed JSON envelopes, bounded MTU fragments, per-link ACK/retry, hop limits and duplicate suppression. All stored objects verify author signatures and encrypted chunk hashes. Flooding is bounded and has no route optimization or traffic-analysis resistance. The sender’s route metadata is not an authenticated proof of the physical path; tests additionally control real sockets and OS byte streams.

Configured installations relay by default with a visible pause setting. The current pause setter removes queued forwarding and locally marked seeding traffic. Authored sends are distinct. An already-written fragment cannot be recalled. In-memory retry snapshots are bounded; persistent encrypted object inventory enables store-and-forward recovery after a process restart, subject to quota and expiry.

Manual bootstrap is currently required. TCP listeners bind loopback by default; the owner can select a LAN interface. The local control API remains authenticated and loopback-only. No central server is mandatory. NAT/CGNAT, firewalls and partitions can prevent a path; there is no implicit TURN/relay/cloud service.

## Historical Reticulum evaluation — 2026-09-11

Superseded in implementation scope by the owner-authorized integration on 2026-09-14; see [current adapter, licensing and limits](RETICULUM.md). The following records the earlier evaluation, before any dependency was included.

Sources inspected: [upstream README](https://github.com/markqvist/Reticulum/blob/master/README.md) and [upstream licence](https://github.com/markqvist/Reticulum/blob/master/LICENSE), fetched 2026-09-11. Upstream describes a complete non-IP stack with optional IP carriers and a reference implementation that authoritatively defines its protocol. RelayLoom’s JSON framing, identity addressing and cryptographic envelope are different; inspiration is architectural only.

The observed licence is titled **Reticulum License**, copyright 2016–2026 Mark Qvist. It includes notice retention and additional purpose restrictions (purposeful harm to humans; AI/ML/model training datasets), beyond a standard MIT licence. Do not relabel it MIT or assume unrestricted licence compatibility. No RNS code/package is bundled. A future explicit adapter could carry signed RelayLoom application objects through an RNS-owned destination/resource API, but requires an agreed dependency/version/licence decision, Python/native embedding assessment, MTU/backpressure adaptation and an actual reference-implementation interoperability suite. That work has not been performed.

## Heterogeneous test evidence

`npm test` runs `tests/heterogeneous.test.ts`: A only connects TCP to B; C has no TCP listener and only the serial transport. Disconnecting the PTY byte bridge prevents C from receiving while B stores the object. Reconnecting the bridge restores transfer of the exact 108,000-byte test attachment. Disabling B relay blocks new third-party delivery. With publisher A terminated and B enabled, B serves an object unseen by C without changing A’s author signature. See `docs/evidence/heterogeneous.json` for the actual last completed run.

This is a local test fixture with real processes and supported carrier APIs. It is not a physical disaster deployment, a hostile-network certification or a radio-range test.

## POSIX serial reliability correction

The installed serialport13 native poller retained the OR of requested interests internally but passed only the latest flag set to `uv_poll_start`. CI diagnostics on macOS showed a writable wait stuck after a read ACK rearm. `serial.ts` wraps only the owned port instance to preserve pending read/write/disconnect interests; no installed dependency or OS setting is modified. A deterministic negative control reproduces the lost interest, while real PTY tests recover a stalled partial write using a baud-derived deadline, reconnect, delimiter resynchronization and exact packet replay. All19 transport tests passed locally, and the full Node CI matrix passed at919beec. Physical serial/radio timing remains unverified.
