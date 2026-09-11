# Mixed native application integration

These tests exercise the actual Go and Node application executables through their authenticated HTTP APIs and actual peer transports. They do not replace the application engines with mocks, copy publications between stores, or substitute an in-memory network.

## Run

Build the web assets and native development host first. From the repository root on Linux/macOS:

```sh
npm run build
node scripts/go.mjs build -p=2 -o ../.cache/native-app/relayloom ./cmd/relayloom
npm exec tsx -- --test --test-concurrency=1 tests/native/mixed-network.test.ts
```

The helper starts `.cache/native-app/relayloom` (or `relayloom.exe` on Windows) and the existing Node CLI. It never downloads a runtime, builds Go implicitly, changes bridge/model configuration, or changes system network settings. Node/Go application state is isolated beneath `.cache/native-mixed`; successful runs remove their temporary profiles. Failed profiles remain for diagnosis. Every identity and passphrase is created for the test; this suite never reads a personal profile. Reports omit HTTP capability tokens and private signing material.

The tests are outside the ordinary top-level Node test glob so an unfinished native build cannot produce a misleading baseline result.

## TCP application path

The first test starts Go A, Node B and Go C. A and C each configure exactly one peer: B. C disables its TCP listener (`--tcp-port -1`), and the test checks both endpoint peer lists. These observable constraints and the negative controls establish that the configured application topology has no direct A-C connection; they are not a claim of OS firewall isolation.

The test checks:

- An encrypted Go-authored message and a 98,304-byte attachment traverse Node B, preserving exact bytes and identical signed bundles on all three disks. The initial destination route records two hops.
- Reading at Go C and Node B produces receipts signed by those readers and accepted at Go A.
- Both reader runtimes reject unauthorized edit requests. A valid edit from the original Go author becomes the effective text at B and C.
- Node B stores/relays a private A-C object but cannot read it through the application API or decrypt it with B's exported test identity. Authorized C can read it.
- Stopping B removes every configured path. A publishes during the partition, C cannot obtain the object, and restarting B on its saved peer port restores delivery. The previous HTTP token is rejected.
- Restarted Go C starts locked, rejects an incorrect password, recovers the same identity, attachment and effective edit, avoids duplicate receipts, and signs another message accepted by both runtimes.
- Paused B receives an A-authored public object while C cannot obtain it. After A exits, resuming B lets C retrieve the original signed object from B without transferring authorship.

## Mixed TCP/serial path

On non-Windows hosts with Python PTY support, the second test starts Go A, Node B and Node C. A connects to B over TCP; B connects to C through real `serialport` instances backed by two OS PTYs. C has no TCP listener and only a serial peer.

A 32,768-byte encrypted attachment crosses both media with the Go author's signature, and a signed Node C read receipt travels back to Go A. The existing PTY fixture then suspends byte forwarding: B receives a new publication, C cannot obtain it, and restoring forwarding allows recovery.

The serial segment is implemented by the Node applications. This does not claim that the native Go engine has a serial driver, that a PTY is a physical radio, or that any radio/device has been validated. Windows skips only this PTY scenario. Mobile OS execution and background-relay policy require separate device evidence.

## Results

On 2026-09-11, the exact test command above passed both scenarios on Linux x64: **2/2 passed, no skips, no cleanup failures, 14.96 seconds total**. The TCP scenario took 10.09 seconds; the TCP/serial scenario took 4.63 seconds. The existing Go executable had SHA-256 `112046822e8cd20e0eefae4cce0b6537d3b406a8849bee8cb1c43e76358c2046` both before and after the run. No Go build, SDK installation or configuration change was performed by these tests. A later rebuilt executable needs a new run; this result identifies the binary actually exercised.

Execution details are recorded in `.cache/native-mixed/mixed-tcp.json` and `.cache/native-mixed/mixed-serial.json`, including concrete controls, timestamps, routing counters, cleanup failures and scope limitations. `npm run typecheck` also passed. Browser interaction is tested separately by the native browser E2E task; these tests drive the real application APIs and transports. These results do not establish Windows/macOS execution, Android/iOS runtime behavior or physical-radio compatibility.
