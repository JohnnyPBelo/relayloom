# Transport truth table and protocol limits

| Carrier | Implementation | Actual evidence | Unverified or blocked |
| --- | --- | --- | --- |
| TCP/IP | Node TCP sockets, explicit peer addresses, reconnect | Linux process and socket tests, bridge controls | Internet/NAT traversal and non-Linux execution pending |
| Serial byte stream | serialport device adapter, configurable baud | Linux OS PTY pair, real byte forwarding, heterogeneous three-process test | Physical UART/radio hardware and vendor packet modems not tested |
| BLE | Not implemented | None | Device APIs, pairing, MTU, OS restrictions |
| Wi-Fi Direct | Not implemented | None | Platform APIs and real hardware |
| LoRa/RNode | Not implemented | None | Physical radio, regional/airtime compliance, driver compatibility |
| RNS/Reticulum | Evaluation only, no code included | Public upstream documentation/licence read on 2026-09-11 | No interoperability, addressing or wire-compatibility claim |
| Simulation | Separate deterministic engine in progress | Reports only after actual simulation test completion | Never substitutes for transport or hardware tests |

## Routing and storage

The experimental wire protocol uses content-hashed JSON envelopes, bounded MTU fragments, per-link ACK/retry, hop limits and duplicate suppression. All stored objects verify author signatures and encrypted chunk hashes. Flooding is bounded and has no route optimization or traffic-analysis resistance. The sender’s route metadata is not an authenticated proof of the physical path; tests additionally control real sockets and OS byte streams.

Configured installations relay by default with a visible pause setting. The current pause setter removes queued forwarding and locally marked seeding traffic. Authored sends are distinct. An already-written fragment cannot be recalled. In-memory retry snapshots are bounded; persistent encrypted object inventory enables store-and-forward recovery after a process restart, subject to quota and expiry.

Manual bootstrap is currently required. TCP listeners bind loopback by default; the owner can select a LAN interface. The local control API remains authenticated and loopback-only. No central server is mandatory. NAT/CGNAT, firewalls and partitions can prevent a path; there is no implicit TURN/relay/cloud service.

## Reticulum evaluation

Sources inspected: [upstream README](https://github.com/markqvist/Reticulum/blob/master/README.md) and [upstream licence](https://github.com/markqvist/Reticulum/blob/master/LICENSE), fetched 2026-09-11. Upstream describes a complete non-IP stack with optional IP carriers and a reference implementation that authoritatively defines its protocol. RelayLoom’s JSON framing, identity addressing and cryptographic envelope are different; inspiration is architectural only.

The observed licence is titled **Reticulum License**, copyright 2016–2026 Mark Qvist. It includes notice retention and additional purpose restrictions (purposeful harm to humans; AI/ML/model training datasets), beyond a standard MIT licence. Do not relabel it MIT or assume unrestricted licence compatibility. No RNS code/package is bundled. A future explicit adapter could carry signed RelayLoom application objects through an RNS-owned destination/resource API, but requires an agreed dependency/version/licence decision, Python/native embedding assessment, MTU/backpressure adaptation and an actual reference-implementation interoperability suite. That work has not been performed.

## Heterogeneous test evidence

`npm test` runs `tests/heterogeneous.test.ts`: A only connects TCP to B; C has no TCP listener and only the serial transport. Disconnecting the PTY byte bridge prevents C from receiving while B stores the object. Reconnecting the bridge restores transfer of the exact 108,000-byte test attachment. Disabling B relay blocks new third-party delivery. With publisher A terminated and B enabled, B serves an object unseen by C without changing A’s author signature. See `docs/evidence/heterogeneous.json` for the actual last completed run.

This is a local test fixture with real processes and supported carrier APIs. It is not a physical disaster deployment, a hostile-network certification or a radio-range test.
