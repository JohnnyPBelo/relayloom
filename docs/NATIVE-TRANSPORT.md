# Native transport

`native/transport` implements the existing RelayLoom router protocol in Go. It has real TCP listeners/reconnecting clients and a generic ordered-byte-stream attachment API. The code shares the `native/core` canonical JSON and SHA-256 implementation; it does not introduce a new network or encryption format.

## API

```go
router, err := transport.New(transport.Options{
    ID: "optional-router-id",
    Validate: func(payload json.RawMessage) error {
        // Validate the application envelope and signed bundle here.
        return nil
    },
})
address, err := router.ListenTCP("127.0.0.1:0")
cancel, err := router.ConnectTCP("127.0.0.1:12345")
id, err := router.Broadcast(payload, transport.SOS, 2*time.Minute, false)
delivery, err := router.Next(ctx)
router.SetLowPower(true)
router.SetRelay(false)
peers, counters := router.Peers(), router.Counters()
err = router.Close()
```

`New` enables relay by default; set `DisableRelay: true` to start paused. The ID defaults to cryptographic random bytes. Empty `ListenTCP` addresses default to loopback. Non-loopback listener addresses require an explicit caller choice. This is the packet transport, not an unauthenticated application-control service.

`Broadcast` snapshots its JSON-compatible payload. Its final `relayOnly` argument marks inventory, request and seeding traffic for cancellation when relay is paused. Authored sends use `false`. Pause removes marked pending and retained packets; it cannot recall bytes already written. Low-power mode defers bulk fragments while allowing normal/SOS traffic. `Next` supplies the bounded local delivery queue and respects cancellation. Snapshots and mutating router operations are safe for concurrent callers.

The application must supply `Validate` to verify its payload schema, signatures and encrypted bundle. A routing packet hash detects content changes; the unsigned routing envelope does not authenticate a civil identity or prove emergency provenance. Hop lists and source IDs are routing metadata. No TLS, anonymity guarantee or emergency certification is implied.

## Stream adapter contract

```go
link, err := router.Attach(stream, transport.LinkOptions{
    Medium: "my-byte-stream",
    Address: "adapter-local-description",
    RetryInterval: 120*time.Second,
    WriteTimeout: 120*time.Second,
})
```

The stream must implement `io.ReadWriteCloser`, preserve byte order, support concurrent read/write, and make `Close` interrupt blocked reads and writes. The router owns the stream after successful attachment. A broken adapter that does not meet that contract can prevent shutdown. Generic-stream reconnection remains the caller's responsibility; the router replays retained packets when a replacement stream is attached.

No JNI, Bluetooth, Wi-Fi Direct, USB serial, LoRa or physical radio driver is implemented here. `net.Pipe` in tests exercises this generic API in memory; it is not physical-medium evidence. TCP uses actual OS sockets. The Go package is suitable for integration into native/mobile bindings but does not itself establish Android/iOS runtime or background-relay support.

## Wire format and budgets

The wire uses newline-delimited JSON `part` and `ack` frames. Parts contain the existing 64-character packet ID, zero-based fragment index/count, and canonical base64 bytes. Empty lines may delimit a partial frame after stream reconnection. Packet IDs hash the canonical source/created/expires/maxHops/priority/payload body; hops are carried separately. UTF-16 key ordering, JavaScript number formatting and JSON escaping come from the shared core codec.

| Resource                            | Bound                                       |
| ----------------------------------- | ------------------------------------------- |
| Packet                              | 6 MiB                                       |
| Decoded fragment / frame            | 2,048 bytes / 4,096 bytes                   |
| Pending packets per link            | 64 / 16 MiB; normal/bulk leave SOS reserves |
| Partial assemblies per link         | 8 / 16 MiB                                  |
| Retained retry snapshots            | 64 / 16 MiB, shared across links            |
| Local delivery queue                | 64 / 16 MiB                                 |
| Active links / reconnecting clients | 24 / 24                                     |
| Duplicate history                   | 4,096 unexpired IDs                         |
| Pending ACK IDs / emitted ACK rate  | 64 / 64 per second per link                 |
| Input                               | 12 MiB and 8,192 frames per second per link |
| Rejected frames                     | Disconnect at 32 in a receive window        |
| TTL / hop limit                     | At most one hour / twelve hops              |

One writer per link handles ACKs and payload fragments. ACKs coalesce by ID. Every fourth eligible data fragment serves the least recently served transfer; admission reservations prevent unfinished high-priority traffic from permanently occupying every reassembly slot. TCP retries unacknowledged complete transfers after two seconds. Generic streams default to 120 seconds; adapters may set explicit timing based on their medium. A write deadline closes the owned stream if it stops progressing.

All routing retry state is currently memory-only. Restart recovery and content persistence belong to the native application/core store. Eviction, full queues, TTL expiry and unavailable paths can prevent delivery. The byte budgets describe retained protocol data, not a claim that total process RSS equals their sum: decoded Go objects, map entries, buffers, native/runtime overhead and in-flight parsing also occupy memory.

## Verification

Local result on 2026-09-11: Go 1.26.8, Linux x64, `test -race -p=2 ./transport` passed11 tests after accounting and queue/replay hardening, including the installed Node subprocess control. The earlier nine-test result (7.92 seconds) predates those added regressions. This is host-native transport evidence, not mobile or physical-radio evidence.

Run from the repository root with its project-scoped Go toolchain and caches:

```sh
node scripts/go.mjs test -p=2 ./transport
node scripts/go.mjs test -race -p=2 ./transport
```

The suite includes a real Node subprocess loaded through the project's installed `tsx`, connected to the Go test process over an actual TCP socket. Both directions verify large payload bytes, Unicode/number canonicalization and route IDs. This fixture lives under `native/transport/testdata`; it is not picked up by the ordinary Node test glob. If Node or the project `tsx` installation is missing, the mixed test explicitly skips, so a Go-only pass must not be reported as interoperability evidence.

Additional tests exercise TCP-to-generic-stream forwarding, relay-off and hop-limit negative controls, schema rejection, malformed/replay floods, bounded assemblies/output/delivery/dial queues, SOS preemption with continuing bulk progress, dropped-fragment and missing-ACK retransmission, reconnect/offline replay, and consent/TTL cancellation. Linux native execution is the local evidence; other OS/device behavior requires the corresponding CI or device run. Physical radio and mobile operating-system background behavior remain unverified.
