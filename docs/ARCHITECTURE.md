# RelayLoom architecture — evolving implementation

The complete acceptance contract remains PROJECT-BRIEF.md. This is an experimental application, never validated emergency infrastructure.

## Stack and boundaries

Node.js 22 + TypeScript and the interoperable Go core run per-installation local daemons. React + Vite provides the shared responsive Liquid Glass client with bundled assets. Node crypto/OpenSSL and Go supply Ed25519 signing, X25519 key agreement, HKDF and AES-256-GCM. In daemon mode the daemon owns the password-encrypted identity vault; private keys do not enter the UI browser. Protected private state uses the authenticated SQLite/profile transaction boundary documented in PROFILE-PERSISTENCE.md; content-addressed encrypted objects have separate bounded retention.

The owner also requires an autonomous web application without installation and with full product parity. This is a new runtime, not a claim about the existing daemon UI. The browser runtime under implementation uses the same wire identities, canonical signed manifests and vault format, with maintained noble Ed25519/X25519 and scrypt, Web Crypto AES-GCM/HKDF/SHA-256, encrypted IndexedDB state and browser peer transports. Native WebKit curve generation/import intermittently failed in host tests; portable curves retain the same wire and vault formats and are verified against Node/Go. Its keys necessarily exist in browser memory while unlocked. Shared protocol types/canonical encoding have no Node imports. The complete implementation/gate sequence and honest browser capability gaps are in ../.codex-delivery/WEB-IMPLEMENTATION.md. No autonomous feature parity is claimed yet.

The first supported transport is real TCP. A second adapter opens serial devices, tested using OS PTYs; PTYs prove byte-stream adapter behavior, not physical radio performance. A node forwards opaque signed encrypted content over consenting configured links. Routes use bounded flooding/store-and-forward with expiry, hop limit, duplicate suppression, fair priority scheduling and fragmentation. This is a custom experimental protocol, not Reticulum interoperability.

Local HTTP control binds only loopback. A random launch capability authenticates API access; same-origin policy, Host and Origin checks guard browser requests. No central content service, telemetry, remote fonts, CDN or mandatory bootstrap. Peers exchange addresses/contact cards manually. Internet NAT traversal currently requires reachable peer endpoints or a voluntarily configured reachable relay.

## Data and authority

Identity address hashes the signing public key. An author signs manifests containing encrypted chunk hashes and reader key envelopes. Readers can decrypt and seed exact author-signed objects but cannot modify manifests. Public objects explicitly expose their content key; signatures still determine ownership. Local blocks and materialized views are separate from immutable replicated originals. Deletion publishes signed tombstones; copies held by others cannot be recalled. Fixed groups use per-object ACLs. Dynamic groups add signed epochs, admission and durable authority/outbox boundaries with private control carriers; see GROUP-AUTHORITY.md, GROUP-CARRIERS.md and STATUS.md. Removal affects future access and cannot recall delivered keys.

## Threat model

Untrusted peers may send malformed, replayed, forged or oversized data, withhold content or flood links. Verify before storage/display, cap frames/objects/queues, enforce expiry and signature, and maintain ownership checks when applying edits. Transport addresses/timing/size remain observable. No anonymity or traffic-analysis resistance is claimed. Static recipient wrapping does not provide a Signal double ratchet or forward secrecy; compromise exposes stored content to which the key has access. OS compromise, browser extensions and a malicious process running as the same user are outside the local capability boundary. Password vault protection depends on a strong passphrase; native keychain integration remains required for production mobile/desktop distribution.

## Milestones

1. Cryptography/store + actual local API/UI + runnable setup and nearest tests.
2. Multi-process heterogeneous routing, fault controls, offline seed takeover and recovery.
3. Messenger/social/site interactions and full UI e2e, accessibility and design refinement.
4. Simulation, independent reviews, platform packaging/CI, fixes and evidence audit.

Initial delegation failures and subsequent real returned implementations/reviews are recorded in AGENTS.md. Current recovery is sequential by owner instruction, with no new or resumed agents and no harness changes.
