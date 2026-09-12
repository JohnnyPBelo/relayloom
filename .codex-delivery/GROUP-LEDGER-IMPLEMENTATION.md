# Group access ledger — local Node implementation in progress

Full owner contract remains active. Sequential root execution; no new/resumed agents or provider/bridge/settings changes. Current published commit remains bff00cc. This new code is uncommitted and not yet imported by the app.

`packages/groups/src/ledger.ts` now binds a GroupAccess policy and GroupRegistry to the same caller-owned SQLite transaction. It constructs accepted contexts only from the policy decision; callers cannot supply an accepted-history record through its public API. The caller still must verify/decrypt the candidate and validate application content semantics, then provide the real payload size/expiry and protected retained IDs. Application wiring must enforce that boundary.

Implemented records:

- Authenticated accepted contexts, capped4096, with local observation order and expiry. Exact IDs retain history after a restrictive change; unknown old content does not inherit that admission. Unneeded records can be retired at count pressure, but protected IDs/current target are not chosen. A failed replacement does not first delete the prior record.
- Quarantine/awaiting-proof metadata capped128 records and16MiB of actual ciphertext sizes. Replays do not consume another slot. The persisted reason is the FIRST observation; current disposition comes from reevaluating consider(), so a restrictive update does not depend on growing an auxiliary hold row. Expired holds may be retired. Actual byte storage/pinning/eviction integration still belongs to the app; metadata alone is not a claim of retained payload availability.
- Immutable outbox-stop context for up to256 retained operations. A terminal decision is stored with the exact operation/content/group/epoch IDs; another payload cannot reuse that stop. Late completion does not erase the historical stop context. Retiring operations can retire their stops in the same transaction.
- The stop set is a single checkpoint bounded128KiB. A real maximum-reserve control first FAILED when256 stops used separate encrypted/indexed records. Packing the set lets the declared64 maximum group checkpoints,256 maximum authority receipts, stop set and clock fit the SAME4MiB reserve. No limit or reserve was weakened.
- Readers reject expired borrowed scopes even when collections are empty. Missing observation clock/malformed authenticated metadata is rejected rather than interpreted as successful admission.

Observed gates:

- Initial4 ledger cases passed2.237s.
- Byte quota, exhausted ordinary-space stop and scope controls brought the run to7 cases, passed3.661s.
- Separate-stop worst-reserve control failed, preserved in `.cache/group-ledger-reserve-before.txt`; packed stop set then passed8 cases3.976s.
- Final ledger9 + access6 + scoped transaction5 =20 cases passed12.520s; typecheck passed. `.cache/group-ledger-regression.txt` and `.cache/group-ledger-typecheck-final.txt`.

Remaining before integration acceptance:

1. Exercise full4096 history retention/protection and all stop retirement boundaries; add loss/eviction aggregate accounting required by the contract. Test corruption and process death through this exact ledger, not only the substrate.
2. Port the format and behavior to Go and run real shared-file/canonical interoperability against Node, including both SQLite backends where relevant.
3. Integrate with the application coordinator, content-store retention/pins/quarantine inspection and outbox projection. No display, notification, receipt or transmission before the outer commit. Minimal stop must survive ordinary metadata exhaustion and ambiguous writes must lock/read back authenticated state.
4. Complete control/snapshot/invitation/consent carriers, bounded synchronization, explicit enrollment, management APIs/UI and dynamic group messages. Keep fixed groups/DMs on their existing exact-reader rules. Do not accept HTTP-provided contexts as local history.
5. Repeat full runtime/network/UI/mobile gates and independent review when agents are authorized. This ledger is not completed application behavior or disaster-ready infrastructure.

## Full history boundary and loss accounting

The ledger now stores bounded/saturating aggregate counters for history retirement/refusal, hold refusal/expiry and stop retirement in a512-byte checkpoint. Refusal counters count refused observations, NOT globally unique lost objects; the design deliberately does not create unbounded rejection-ID memory. Retained replays do not consume another hold slot or increment refusal counts. Counter corruption is rejected.

A real SQLite limit fixture populated4096 authenticated synthetic history records (not4096 invented network deliveries). With all IDs protected, admission is refused and history remains4096. Making one record eligible permits replacement, preserves other protected records and keeps the exact count. This case passed43.065s; the complete10-case ledger suite passed49.788s (`.cache/group-ledger-full-history.txt`). The reserve fixture includes the new512-byte counter record without expanding the4MiB budget.

The additional retirement suite passed2 cases10.276s:256 immutable stops,257th refusal, selective retirement retaining the exact first record, nonduplicated aggregate counts, actual hold expiry and malformed counter refusal. `.cache/group-ledger-retirement.txt`. Typecheck passed in `.cache/group-ledger-final-static.txt`. Loss-counter writes are outside the recoverable ordinary-row capacity catch: an actual checkpoint failure must abort, not return quarantine after silently committing admission.

Node format remains local/uncommitted and unintegrated. Go ledger parity, exact-ledger process/crash/corruption interop and app/transport/UI wiring are next. Previous lower-level group-access21-case interop does not prove this new ledger format interoperable.

## Go ledger implementation and real process interoperability

`native/groupledger` now implements the same canonical history/hold/stop/counter records, bounds, observation order, protected-history retirement, bounded stop set and transactional API. It remains unintegrated with the app. `tests/fixtures/group-ledger-worker.ts` and `native/groupledger/worker_test.go` execute real writes, signature verification/decryption and process exits; `tests/native/group-ledger.test.ts` drives them against shared Node-authored authority files.

Observed controls: Go reads Node admissions; Node reads Go admissions and quarantine; Node retry stops are read/retired in Go with matching counters. Both runtimes terminate before commit and leave no partial group closure/admission/stop; after-commit exits preserve all three together, and retained replay keeps the exact observation and stop context. Initial interop passed15.811s.

A further real fixture failed because Go measured held-reason length in UTF-8 bytes while Node's schema uses UTF-16 units. Go now restores the bounded core decoder's WTF-8 representation for that text field and counts UTF-16 units. The corrected fixture includes accents, supplementary emoji and lone surrogates at exactly100 units. Failure: `.cache/group-ledger-unicode-before.txt`; corrected process test15.588s: `.cache/group-ledger-unicode-after.txt`. The same gate also passed with the C SQLite backend18.342s, `.cache/group-ledger-cgo-interop.txt`.

Go/race unit packages groupledger/groupaccess/groupstore passed1.707/1.422/1.808s, including atomic rollback/stop retirement, expired scope rejection, malformed counters and UTF-16 handling. Their worker fixtures are skipped in standalone unit mode and exercised by the real process driver. Node ledger/retirement12 passed50.617s after the final port; typecheck passed. Logs: `.cache/group-ledger-go-regression.txt`, `.cache/group-ledger-node-final.txt`, `.cache/group-ledger-parity-static.txt`. Current interop report: `.cache/group-ledger-interop/report.json`.

Next integration must use the ledger's locally authenticated contexts, actual payload-retention state and immutable outbox records; no HTTP caller may supply trusted history. Application/control-carrier/API/UI integration, wider runtime regression and mobile rebuilds remain required. These tests are not a delivered dynamic-group user flow.


## Actualização de integração

A API autenticada de gestão Node/Go já usa GroupLedger.run/groupledger.Run na transacção privada existente, mas ainda não chama consider/reconcileRetry sobre os conteúdos reais. Pins/retenção, admissão/outbox, carriers e UI permanecem por integrar. A regressão completa está em .cache/group-runtime-final/report.json; o gate dirigido de API é separado dos testes de ficheiros/processos deste registo.


O gate completo desta versão terminou:177 Node,118 Go de topo/race (oito helpers exercitados via interoperabilidade),20 interop,16 UI por núcleo e desktop Linux passaram. Comandos, hashes e limites em docs/evidence/group-runtime/final. O código foi integrado em marcos versionados; as indicações de código local/não commitado nas secções anteriores pertencem ao histórico. API de gestão não é admissão de mensagens dinâmicas.
