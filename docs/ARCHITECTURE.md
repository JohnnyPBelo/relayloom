# RelayLoom architecture — evolving implementation

The complete acceptance contract remains PROJECT-BRIEF.md. This is an experimental application, never validated emergency infrastructure.

## Stack and boundaries

Node.js 22 + TypeScript runs a per-installation local daemon. React + Vite provides a responsive local client with bundled assets. Node crypto/OpenSSL supplies Ed25519 signing, X25519 key agreement, HKDF and AES-256-GCM. The daemon owns the password-encrypted identity vault; private keys never enter browser storage. JSON files and encrypted content-addressed chunks are persisted atomically under an explicit project data directory.

The first supported transport is real TCP. A second adapter opens serial devices, tested using OS PTYs; PTYs prove byte-stream adapter behavior, not physical radio performance. A node forwards opaque signed encrypted content over consenting configured links. Routes use bounded flooding/store-and-forward with expiry, hop limit, duplicate suppression, fair priority scheduling and fragmentation. This is a custom experimental protocol, not Reticulum interoperability.

Local HTTP control binds only loopback. A random launch capability authenticates API access; same-origin policy, Host and Origin checks guard browser requests. No central content service, telemetry, remote fonts, CDN or mandatory bootstrap. Peers exchange addresses/contact cards manually. Internet NAT traversal currently requires reachable peer endpoints or a voluntarily configured reachable relay.

## Data and authority

Identity address hashes the signing public key. An author signs manifests containing encrypted chunk hashes and reader key envelopes. Readers can decrypt and seed exact author-signed objects but cannot modify manifests. Public objects explicitly expose their content key; signatures still determine ownership. Local blocks and materialized views are separate from immutable replicated originals. Deletion publishes signed tombstones; copies held by others cannot be recalled. Group membership uses per-object explicit reader ACLs; removal affects future objects only.

## Threat model

Untrusted peers may send malformed, replayed, forged or oversized data, withhold content or flood links. Verify before storage/display, cap frames/objects/queues, enforce expiry and signature, and maintain ownership checks when applying edits. Transport addresses/timing/size remain observable. No anonymity or traffic-analysis resistance is claimed. Static recipient wrapping does not provide a Signal double ratchet or forward secrecy; compromise exposes stored content to which the key has access. OS compromise, browser extensions and a malicious process running as the same user are outside the local capability boundary. Password vault protection depends on a strong passphrase; native keychain integration remains required for production mobile/desktop distribution.

## Milestones

1. Cryptography/store + actual local API/UI + runnable setup and nearest tests.
2. Multi-process heterogeneous routing, fault controls, offline seed takeover and recovery.
3. Messenger/social/site interactions and full UI e2e, accessibility and design refinement.
4. Simulation, independent reviews, platform packaging/CI, fixes and evidence audit.

File ownership for delegated work was assigned explicitly; all delegation attempts failed before execution (see AGENTS.md evidence). Root implementation continues without changing the harness.
