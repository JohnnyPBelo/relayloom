# Group admission policy — Node implementation in progress

Full PROJECT-BRIEF scope remains active. Sequential root only; no new/resumed agents or provider/bridge/settings changes. Published HEAD remains bff00cc. This work is local and uncommitted.

`packages/groups/src/access.ts` now implements typed epoch/target/historical bindings, exact pinned reader cards, current and additions-only delayed admission, restrictive-path quarantine, exact previously accepted context, minimal historical receipt/delete exceptions, target-reader intersection and author-only edits. It consumes verified/decrypted candidates and trusted accepted contexts; it does NOT authenticate arbitrary context records supplied by a network caller.

`GroupAccess` requires a live borrowed `GroupRegistry` transaction. `RegistryTransaction.generation()` invalidates its per-transaction cache after any write, not only after transaction completion. The initial counterexample showed an earlier cached permission surviving a closure in the same transaction; the test failed before the generation fix and passes after. Escaped policy instances also reject use after the scope. A newcomer cannot retry an intent from an epoch it never belonged to. Group tags are recognized by presence and reject falsy/non-string discriminator values; future application dispatch must never fall back to legacy authorization for tagged malformed data.

Tests in `tests/group-access.test.ts` use actual identities, signed/encrypted bundles, SQLite authority and explicit joins/removal/rejoin. Cases cover old reader sets/newcomer decryption failure, accepted history versus unseen old content, restrictive retry stop, minimal historical receipts, same-transaction closure, target intersection/newcomer exclusion and forged edit authorship. The broader authority/storage/transaction gate passed46 cases20.936s before the final original-author/type guards; six policy cases and typecheck passed after the original-author guard. Final strict-shape run is being collected in `.cache/group-access-final/strict-shape-*`. Preserve `.cache/group-access-stale-before.txt` as the observed failing control, plus `.cache/group-access-first.txt`, `group-access-after.txt` and `group-access-regression.txt`.

Still required before product claims:

1. Go parity for transaction generation/scoped access and this policy, with canonical mixed-runtime tests.
2. Authenticated bounded accepted-history records4096, quarantine128/16MiB, immutable outbox stop context and quota accounting. Never trust a caller-supplied AcceptedGroupContext as evidence.
3. Runtime coordinator in the actual apps: process valid control chains before unaccepted cached content; decide admission/outbox stops in the same transaction; only display/receipt/transmit after commit. Preserve a minimal durable stop even when private-document growth cannot fit. Retain partial/completed confirmations and exact original operation/payload/readers.
4. Real control/snapshot/invitation/consent carriers and bounded discovery/requests, explicit user enrollment (unknown hints must not allocate64 permanent group slots), management APIs/UI and dynamic group sending. Fixed groups/DMs must keep their own exact-reader rules.
5. Positive/negative real network, partition/heal, removal/rejoin, historical events, quota, process death and UI gates on both runtimes; rebuild affected mobile artifacts. Independent review remains pending during the owner-required sequential recovery.

The policy is not yet imported by the application. Do not describe these library tests as completed dynamic-group messaging or UI support.

Final collection: session43497 completed exit0;6 policy cases passed5.284s and typecheck passed. No local test from this phase remains running. Code stays uncommitted until the integration milestone is coherent and reviewed.

## Go parity and actual shared-file decisions

Go parity now exists in `native/groupaccess`, with `groupstore.Tx.Generation` and `groupauthority.Registry.ScopeGeneration` enforcing the same transaction-local cache lifecycle. The optional fixture worker verifies/decrypts actual signed bundles inside its Go process and reads the Node-authored protected SQLite authority directly.

`tests/native/group-access.test.ts` passed in15.932s:21 matching decisions across current/additions-only content, newcomer decryption failure/invalid original retry, restrictive removal, exact retained history, historical minimal receipts, forbidden extra content, target intersection, wrong edit author, rejoin and closure within the same transaction. Report: `.cache/group-access-interop/report.json`. This is real process/file/cryptography evidence, not application network/UI integration.

Go/race groupaccess and groupstore passed (packages1.430s/1.737s); the process helper is intentionally skipped without its fixture input. Node policy+transaction11 passed5.961s after moving shared test fixtures to `tests/fixtures/group-access.ts`. Typecheck passed. A final focused Go scope regression is being collected from `.cache/group-access-scope-go.txt`; input hashes are in `.cache/group-access-interop/final-input-hashes.json`.

All code remains local/uncommitted. The next essential step is the authenticated accepted-history/quarantine/outbox-stop ledger and actual app coordinator, not an API that trusts arbitrary supplied accepted contexts. No dynamic-group runtime, UI or new mobile support is claimed by this parity work.


## Actualização de integração

As duas aplicações já importam o registo/autoridade através da API autenticada de gestão. Esta integração ainda não chama a política para admitir mensagens; não confundir importação com entrega dinâmica. O gate completo desta versão está em .cache/group-runtime-final/report.json e o contrato de fronteira em docs/GROUP-RUNTIME.md.


O gate completo desta versão terminou:177 Node,118 Go de topo/race (oito helpers exercitados via interoperabilidade),20 interop,16 UI por núcleo e desktop Linux passaram. Comandos, hashes e limites em docs/evidence/group-runtime/final. O código foi integrado em marcos versionados; as indicações de código local/não commitado nas secções anteriores pertencem ao histórico. API de gestão não é admissão de mensagens dinâmicas.
