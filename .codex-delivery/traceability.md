# Acceptance traceability (in progress)

No requirement is complete solely because code exists. Exact gate evidence is tracked in docs/STATUS.md.

| ID | Requirement | Phase | Status |
| --- | --- | --- | --- |
| FR-001 | Local cryptographic identity and proofs | P1 | in_progress |
| FR-002 | Encrypted key vault and native secure storage | P1 | in_progress |
| FR-003 | Identity export and recovery | P1 | in_progress |
| FR-004 | Signed updates and rotation/revocation limits | P4 | todo |
| FR-005 | Separate authorship from reading and seeding | P1 | in_progress |
| FR-006 | One-to-one conversations | P3 | in_progress |
| FR-007 | Group conversations and membership authorization | P3 | in_progress |
| FR-008 | Text messages and replies | P3 | in_progress |
| FR-009 | Photo attachments | P3 | in_progress |
| FR-010 | Audio and voice recording | P3 | in_progress |
| FR-011 | Video and file attachments | P3 | in_progress |
| FR-012 | Durable offline outbox | P2 | in_progress |
| FR-013 | Delivery and expiry states | P3 | in_progress |
| FR-014 | Message reactions | P3 | in_progress |
| FR-015 | Message search | P3 | in_progress |
| FR-016 | Owner-only edit and delete semantics | P3 | in_progress |
| FR-017 | Blocking and local moderation/reporting strategy | P3 | in_progress |
| FR-018 | Notifications where supported | P3 | in_progress |
| FR-019 | Social profiles and following | P3 | in_progress |
| FR-020 | Social posts and privacy controls | P3 | in_progress |
| FR-021 | Feed and comments/reactions | P3 | in_progress |
| FR-022 | Collections and sharing | P3 | in_progress |
| FR-023 | Capability matrix for every social feature | P7 | todo |
| FR-024 | Content addressed encrypted chunks and author signed manifests | P1 | in_progress |
| FR-025 | Verification on receipt and before display | P1 | in_progress |
| FR-026 | Peer retrieval and reader seed takeover | P2 | in_progress |
| FR-027 | Pin/unpin quotas and eviction/TTL | P1 | in_progress |
| FR-028 | Bandwidth/battery policy | P2 | in_progress |
| FR-029 | Honest replicated availability/deletion semantics | P7 | todo |
| FR-030 | Transport adapter abstraction and real sockets | P2 | in_progress |
| FR-031 | Genuinely different serial transport | P2 | in_progress |
| FR-032 | Multiple-hop routes cross supported media | P2 | in_progress |
| FR-033 | Priority and fair scheduling | P2 | in_progress |
| FR-034 | MTU fragmentation and reassembly | P2 | in_progress |
| FR-035 | Retransmission, TTL/hop limits and duplicates | P2 | in_progress |
| FR-036 | Corruption, replay and abuse controls | P4 | todo |
| FR-037 | Bootstrap/discovery and NAT tradeoffs | P2 | in_progress |
| FR-038 | Responsive drag/drop personal site builder | P3 | in_progress |
| FR-039 | Safe declarative block rendering and keyboard/touch alternatives | P3 | in_progress |
| FR-040 | Signed site publication and offline cached foreign site | P3 | in_progress |
| FR-041 | Emergency health, peers and alert provenance | P3 | in_progress |
| FR-042 | High contrast, large targets and low-power critical messaging | P5 | in_progress |
| UX-001 | Original cohesive typography and spacing | P5 | in_progress |
| UX-002 | Responsive light/dark states | P5 | in_progress |
| UX-003 | Reduced motion and keyboard/screen reader checks | P5 | in_progress |
| UX-004 | Real empty/error/loading/offline states without fake controls | P5 | in_progress |
| UX-005 | Real screenshots and accessibility audit | P5 | in_progress |
| INT-001 | Evaluate RNS interoperability and licensing | P4 | todo |
| INT-002 | Truth matrix for IP BLE Wi-Fi Direct LoRa serial simulation | P7 | todo |
| INT-003 | Linux native build and execution | P6 | todo |
| INT-004 | Windows build and native execution | P6 | todo |
| INT-005 | macOS build and native execution | P6 | todo |
| INT-006 | Android app build and device/emulator execution | P6 | todo |
| INT-007 | iOS app build signing and device execution | P6 | todo |
| INT-008 | Document mobile background relaying restrictions | P6 | todo |
| ACC-001 | Unit/property/fuzz bounds crypto ACL and addressing tests | P4 | todo |
| ACC-002 | Real multi-process A-B-C isolation with positive/negative controls | P2 | in_progress |
| ACC-003 | Heterogeneous multi-hop payload integrity and route evidence | P2 | in_progress |
| ACC-004 | Offline publisher seeder takeover | P2 | in_progress |
| ACC-005 | Unauthorized edit/decrypt tamper and replay rejection | P4 | todo |
| ACC-006 | Persistence restart and duplicate flood/churn/partition/heal | P4 | todo |
| ACC-007 | Deterministic bandwidth latency loss asymmetry MTU congestion simulation | P4 | todo |
| ACC-008 | Storage exhaustion and low-power simulation | P4 | todo |
| ACC-009 | Mutation controls fail if crypto/routing is broken | P4 | todo |
| ACC-010 | Real-client UI end-to-end all critical workflows | P5 | in_progress |
| ACC-011 | Platform CI build matrix without device-test overclaims | P6 | todo |
| ACC-012 | Independent security reliability/design review and fix/rerun | P7 | todo |
| ACC-013 | Acceptance evidence audit and precise README/STATUS | P7 | todo |
| CON-001 | No mandatory central content service or hidden runtime CDN | P1 | in_progress |
| CON-002 | No arbitrary site scripts or HTML execution | P3 | in_progress |
| CON-003 | Use maintained crypto primitives and disclose protocol limits | P1 | in_progress |
| CON-004 | Keep current Astra/Copilot Ultra harness/provider/auth unchanged | P0 | in_progress |
| CON-005 | Real complementary agents and truthful task evidence | P0 | in_progress |
| CON-006 | Work only RelayLoom with explicit file ownership | P0 | in_progress |
| CON-007 | Project-scoped caches and at least 15 GiB free | P0 | in_progress |
| CON-008 | No paid services/root/security changes or unrelated data | P0 | in_progress |
| CON-009 | Small coherent verified commits and authorized non-force pushes | P7 | todo |
| CON-010 | No disaster readiness or all-OS claim without evidence | P7 | todo |
| CON-011 | No unsafe mobile background policy evasion | P6 | todo |
| CON-012 | No merge or secret publication | P7 | todo |
