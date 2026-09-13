# Learning log

## Prevention rules

- Treat a task spawn response as dispatch only; require actual agent outputs/files before claiming delegated work.
- Keep tests and all runtime data within project .cache/.runtime.
- Review cryptographic signatures on received and displayed content, not just initial publication.
- Serial PTY evidence does not prove radio or mobile behavior.

## 2026-09-11 — setup and delegation

Four actual agent tasks accepted but immediately failed: unsupported_input/encrypted_input. Retrying minimal prompts and fresh contexts did not produce engineering output. Preserve provider/authentication as instructed; continue root engineering and record independent-review gate as unmet.

## 2026-09-11 — real transport and UI review

- Initial crypto/socket/process gates passed. Three processes verified TCP-to-serial PTY, partition/heal and offline publisher takeover. This is real OS transport evidence, not physical radio evidence.
- First UI audit found small-text contrast failures. Light tokens were darkened; dark mode also needed the root foreground/background to use theme variables. Failed axe reports were used to fix the actual elements, then rerun.
- An ambiguous group checkbox locator matched a reply control too; tests now identify the checkbox role exactly.
- Same-document launch links after a node restart did not re-read the new capability fragment. A hashchange handler now updates local authentication; recovery test preserves the current page and navigates explicitly.
- Independent design review found cross-recipient drafts and name-only search hiding the selected conversation. Drafts are now keyed by recipient, selection is independent from filtering, and search includes message content. The editor has encrypted local draft save/recovery.
- Independent security review found unauthenticated malformed-path crashes, receipt/public-message semantic bypass, queued ACK amplification, quota/count work amplification and deletion resurrection after cache loss. Root and dedicated agents implemented regressions and fixes. Exact current gates are tracked in STATUS; no completion claim follows from review alone.

## 2026-09-11 — cross-platform CI and second feature milestone

- Public baseline commit 85793be passed the local build, 42 tests, a two-client E2E and simulation gates. CI then exposed platform differences instead of being treated as proof from configuration alone.
- Linux hosted Chromium could not initialize its sandbox. CI now uses the runner-supplied Chrome with `chromiumSandbox: true`; no OS/security setting was disabled. That Linux CI job passed.
- Windows fixture cleanup needed to recognize a signal-terminated child as already stopped. Added a SIGKILL/idempotent-stop regression. The next Windows run passed, then a later run exposed a separate timestamp-cache issue.
- Windows file timestamps can repeat during a same-size overwrite; verified metadata now keys on the actual bounded file bytes, not timestamps. Core test asserts corruption disappears from list before get(), and all 10 core tests pass locally. Native Windows CI rerun remains required for this fix.
- macOS serial fairness timed out twice. Diagnostics show complete SOS but a stalled bulk native write; changing the test to a realistic baud-derived budget did not resolve it. A dependency poller read/write-interest race was then identified by the transport agent; its patch and native rerun are pending. Do not label the latest macOS gate passed based on an earlier run.
- Media E2E found that clearing a file input mutated a live FileList between awaited reads. Snapshotting the list before awaiting fixes loss of later attachments. A conversation-generation guard prevents attaching to a newly selected recipient.
- Named collections now persist inside the authenticated encrypted local state; followed-author filtering and explicit hash retrieval never grant read access. API integration and the collection UI E2E passed. A membership checkbox now updates optimistically and rolls back on failure.
- Node mobile embedding's released runtime is EOL. A maintained Go native core is being compatibility-tested as an actual on-device alternative, rather than presenting an external-daemon WebView as mobile completion. The selected patched Go archive was downloaded from go.dev and verified against its published SHA-256; all caches remain inside the project.

## Application snapshot, lifecycle and Android execution hardening

Independent application review identified request-map growth on transport errors, full-state responses exceeding the native encoder limit, late state responses restoring a locked UI, and received tombstones lost before quota eviction. Both application runtimes now have bounded paginated summaries and authenticated attachment retrieval; tests exercise a legitimate encrypted store above24MiB, history cursors, quota-pressure deletion and failed-broadcast bounds. UI applies generation/response ordering, nonoverlapping polling and lazy attachment requests. A successful response never overrides a later lock with older private state. Summary caches remain identity-scoped, bounded16MiB/1024 and conditional on freshly verified file-byte fingerprints; local ACL/mutation decisions are still reapplied.

Tests caught duplicate placement of the history action and a scroll position that kept a restored attachment below the mobile viewport. The action has one location and returning to a conversation scrolls to recent messages. File bytes are now intentionally omitted from periodic state; tests retrieve them from /api/attachment or /api/view and compare exact originals.

The single Android API36x86_64 emulator required recovery of interrupted encryption only in its empty test userdata and explicit owned console/adb ports. Normal authentication and host security remained enabled. The preliminary APK subsequently passed UIAutomator identity creation, actual in-process Go→Node encrypted exchange, stored-ciphertext checks, background listener shutdown/resume and a Node→Android→Node multi-hop/partition/seed takeover gate. Every report records the preliminary APK hash and distinguishes emulator from physical hardware. The final APK must be rebound and rerun after current app hardening; initial success is not substituted for that final gate.

## Final host/emulator gates and reachable desktop control

The final APK was rebuilt after native cache/history changes and its installed SHA-256 was independently matched.16 simple and11 multi-hop/seed/lifecycle assertions passed. A screen capture initially lagged the DOM because a test predicate matched both the old conversation list and the new feed. The fixture now waits for the exact feed, author button, modal and native-visible state; root inspected the actual offline-site screenshot. Capture/DOM alone is not substituted for network bytes and signature controls.

Independent desktop review found that fetching a .invalid host makes a negative test pass even without app network restrictions. The new smoke reaches a harmless loopback server from the main process and a separate sandboxed control renderer; the protected renderer rejects without reaching it. Observed request counters1/1/0 passed, as did rebuilt Linux packaged execution. Never use unreachable hosts as the only evidence of a network boundary.

## Outbox integration, supervision and review — 2026-09-12

The published c3f5b42 CI completed8 jobs including actual Apple compilation and Windows/macOS desktop packaging. Later source-under-edit supervision caught a group reply failing contact lookup; this was not attributed to the earlier green commit. Native owner restored best-effort contact learning and exact signed-roster confirmation resolution, preserved ACLs, and reran the focused test plus stable full gates. Final results remain pending until the source is frozen for each gate.

Independent outbox review required durable acceptance to flush files and parent directory entries on POSIX, read back authenticated metadata after uncertain post-rename failures, journal incoming confirmations before admission can evict their target, keep historical counters after payload/receipt loss, and distinguish retained bytes from pending pin ownership. Raw idempotency is bounded by256 retained operation records; pending records are protected, and the UI requires fresh unlocked state plus an explicit new-send choice for an absent uncertain operation. A locked snapshot's empty outbox never proves pruning.

Tests found nondeterministic recipient order after canonical encrypted-state recovery; snapshots now sort recipient IDs rather than depending on map insertion order. Browser review found a transient contrast failure while a secondary button's background animated between light/dark with an already changed foreground. Secondary surfaces now switch colour coherently. Modal tests must scope controls/text to the dialog because the same message can also occur in the underlying conversation.

## Temporary sequential stability measurement — 2026-09-12

The owner distinguished an approximately 61-second Copilot upstream timeout from the local bridge timeout, with concurrency still only a hypothesis. Root did not change providers, authentication, bridge or safety settings and did not create/resume/interrupt agents. Already active Android and protocol agents finished and returned actual files/results; their pending device/design-only limitations were integrated before testing.

Exactly one selected outbox browser case ran once on Node: `node scripts/e2e.mjs tests/e2e/outbox.spec.ts --grep 'durable composer retries a lost response once' --reporter=line --output=.cache/sequential-stability/outbox`. Result: one passed in 11.7 s, exit 0, zero retries, unchanged production/input hashes. It covered lost-response idempotency, restart, own retry with relay paused, actual received/read transitions, dialog feedback and four captured accessibility states. The output/evidence is retained in `docs/evidence/sequential-stability/2026-09-12`.

No new upstream 408 was observed in this stage. One successful local test is not a causal concurrency experiment or a provider reliability guarantee. Preserve exact attempt counts, separate wait deadlines from upstream failures, and never silently restart an uncertain run. Android's later source checks must not inherit the earlier APK's 80 emulator assertions; the group fixtures remain design-only. No additional test/build/push was initiated during this measurement.

## Final Android artifact integration after the measurement

Root continued in a separate sequential phase with no new/resumed agents. The final checker/UI APK 27a71947 passed all four emulator gates once: 38 SAF, 15 deadline/lifecycle, 16 message/recovery and 11 relay/seed assertions. Installed hashes matched before/after and recorded Android/web/AAR inputs did not change. The actual listener cutoff was observed at 121264 ms including fixture overhead; do not translate that into a hard scheduling guarantee during physical sleep. The same AVD/identity was retained and owned emulator/adb/test provider were cleaned up.

Verified outbox, iOS runner and Android source were committed as separate milestones. Apple simulator execution remains pending CI; the existing build-only Apple result is not substituted. Source/code checks and physical-device results remain separate evidence classes.

## CI expiry boundary and group certificate foundation

Run34663513261 passed Node on three OS and Go unit/race, then failed the Go-sender mixed outbox check: an expired response still had an automatic pin. Snapshot reconciliation and response projection independently sampled the clock. Real-journal regressions delayed preparation recovery across expiry and reproduced the invariant failure in both Node and Go. The correction carries a single reconciliation observation time into the response; send/retry responses also reconcile coherently. Targeted state/send/retry controls passed in both engines; full validation is recorded separately. Never weaken the pin assertion or inflate the content TTL to hide this boundary.

Separately,11 Node group-certificate cases passed with actual signatures and envelope decryption. The anchor fixes signing authority, not the creator's reading card forever: even the creator's reading-card replacement requires fresh consent and a restrictive transition. Full-card hashes are reused only within one validation call after verifying each card; cached past approval cannot skip verification on later receipt. This module remains unintegrated and has no Go/network/UI acceptance yet.

Root's inspection of the latest native desktop screenshot found onboarding clipped horizontally at its720px minimum window width. The welcome layout keeps a fixed390px form plus an intrinsic-width story column until680px, so existing390px/1440px checks missed the intermediate viewport. A runtime/security smoke is not a responsive-design pass. Add a720px real browser regression and layout assertion in the native smoke, fix the onboarding breakpoint after frozen-source validation ends, then rerun affected gates. Preserve the original screenshot as evidence of the finding.

When preserving the corrective mixed-process results, root initially selected the older published copies from `docs/evidence/outbox/mixed`; their source/binary hashes exposed the mismatch before publication. The actual new results are written to `.cache/native-mixed`. The retained corrective reports were replaced from that source only after matching their timestamps to the recorded command window and comparing their source/CLI hashes with the tested artifacts. Never infer that a documentation evidence directory was refreshed by a test; inspect the writer and validate provenance.

## b09f7f5 recovery checkpoint

The initial short call collected the existing terminal status and showed a clean Git tree without restarting tests. CI34671406360 passed all Node/Go/desktop jobs; iOS progressed past boot (191998ms) and build/install, then timed out importing the synthetic photo (60976ms), before XCUITest. This is a distinct Apple tooling operation, not evidence of another Copilot408 or an application UI failure. Preserve the exact failed stage and cleanup instead of repeating unchanged jobs or claiming simulator boot means application execution. Eleven host-only runner tests passed in one bounded command; they do not clear the Apple gate. No new/resumed agents or bridge/settings changes.

## Protected SQLite metadata foundation

Node's initial8 storage tests passed. Local review then moved quota enforcement ahead of each SQL mutation, so a refused proof can be replaced by an atomic frozen checkpoint using the reserve, and bounded a transaction itself instead of only its final commit. Any caught integrity/SQL failure still aborts the transaction. Added explicit SQL type/length checks before blob reads, a genuine read-key-only forgery with valid AEAD and the wrong signing authority, and a positive demonstration of the full-valid-backup rollback limitation. Final build and all103 Node tests passed. Database pages/journal overhead, application quota integration, expected store-ID pinning and group authorization remain explicit follow-up duties. This is root review, not an independent review.

The Go port exposed a shared edge: replacing an observed integrity error with another callback error/panic could leave the handle reusable. Both engines now retain poisoning from the original read failure, independently of the callback outcome. The actual shared-database test preserves24 updates/revision27 across Node and Go, recovers staged writer exits in both directions and checks positive/negative corrupted-row controls. Root review then found SQLite LIKE's underscore wildcard admitted a deliberately created `sqliteXconcealed` table; both regression tests failed before replacing the pattern with a literal prefix comparison. Preserve these red controls and distinguish the larger earlier104/76/7 gate from the final12/10/1 corrective gate. Do not infer that a simulator boot, package cross-build or in-memory driver probe executed the app or real mobile persistence.

The next CI push also includes a concrete diagnostic for the observed addmedia timeout: read only the owned simulator's recent photolibraryd/assetsd/mstreamd logs within15seconds and the original global/disk bounds. A diagnostic error must not replace the primary failure or stop cleanup. Thirteen host tests verify scope/error preservation, with static/typecheck and a repeated storage interop pass because the fixture imports the same process supervisor module. No Apple execution is inferred; the next actual CI result is required. This replaces a blind unchanged retry with a bounded evidence-gathering step and does not change services, permissions or timeout allowances.

## Authority-state ordering counterexample

The new Node registry initially treated a valid current snapshot as enough for an existing member, even if an intermediate creator-signed roster lacked required consent. Root constructed both signed transitions and the actual test observed `active` instead of `awaiting-snapshot`. A persisted `checkedThrough` cursor now prevents that bypass while allowing a newcomer to begin validation at its explicitly accepted fresh join, without old reading keys. Out-of-order valid snapshots remain pending until the missing intermediate snapshot arrives. Thirteen registry tests passed, including actual process CAS/crash/lost-response controls; Go registry and app/API/UI integration remain pending. Do not mistake this local metadata implementation for transport/admission integration.

## Post-maintenance authority recovery

Recovered a terminal Go test from its existing command/output files after the process handle disappeared; all recorded hashes matched. Do not restart an uncertain test just because a GUI/session handle is gone.

Full-quota root regression showed that durable leave rolled back when its deduplication record used ordinary storage. Leave/close receipts now use the bounded checkpoint reserve and a closed head is stored in the group checkpoint, preserving idempotence without ordinary space. Another real regression found a valid removal followed by an invalid signature left the reader active because the whole page rolled back. Preserve already verified incoming prefixes before reporting invalid trailing network input; never swallow actual storage/integrity failures. Distinguish these root reviews from independent review, and keep new metadata semantics unadvertised as application capabilities until admission/outbox/UI integration exists.

## Index capacity and actual runtime ownership — 2026-09-12

Root reproduced a valid encrypted index near4MiB refusing a stop checkpoint despite the separate serialized-byte reserve. Ordinary index entries now leave explicit headroom in both engines. The real18 717-row Node/Go control succeeds with the production guard and fails with only that guard removed through a temporary test overlay; never modify the actual source/provider/security settings for such controls. Keep the original failure and distinguish the full app/UI gate before this library-only correction from the targeted corrective gates afterwards.

An adversarial retained-operation test correctly poisoned the store, then its helper incorrectly tried to obtain StoreID from that poisoned handle. Fix the ID before inducing failure and use the pinned value on reopen; never relax poisoning to make the fixture pass. The first index fixture also widened its storage-class string in TypeScript; a literal annotation fixed static checking without changing runtime behavior.

Node/Go application profile ownership now lasts through transport/worker shutdown. Constructors release the lease on failure without resetting the rejected configuration, and stopped instances reject stale work after another engine takes over. Restarting test fixtures must close every owned node before removing a directory, especially for live SQLite handles on Windows. Actual mixed CLI/API tests preserved the exact pending outbox operation across engine takeover. Full host/UI/desktop gates passed; new mobile artifacts still require rebuild and execution.

Visual follow-up: the mobile feed currently renders the singular count as “1 publicações em cache”. Fix its pluralization with the next UI iteration; the layout/contrast controls passed but this copy detail remains visible. No claim of finished design or dynamic-group UI follows.

## Clean-cache CI report persistence

Run34686129024 passed Node on all three OS and Go build/unit/race, then both new interop report writers failed ENOENT at their final artifact writes. A root supervisor-created output directory masked the missing setup locally. Each test now creates its own evidence directory. Both failures reproduced from exact b86a5b1 sources in a project-local clean copy; each full case then passed independently with that directory absent (23.228s/10.563s). Sharing dependency caches must not imply the existence of per-test output paths. Preserve artifact write failures as failed tests, and do not count downstream skipped jobs as execution.


## Private migration review and recovery — 2026-09-12

The pending Go app/race run completed successfully and was recovered from its durable output instead of restarted after a lost handle. A new root regression then showed Node accepted a malformed legacy mutations array and committed initialization. Validate semantic private data before writing the signed intent; reuse the existing declarative-content rules for draft/publication validation and cap the legacy file read before allocation. The regression failed before and passed after; a TypeScript overload mistake in the test assertion was corrected before the build passed.

Four actual CLI/API migration/profile cases passed after rebuilding Go, with unchanged input hashes. They preserve identity/draft/collections, exact pending outbox IDs, committed updates across real process death and engine takeover, unreadable legacy ignoring, refusal of missing state, positive exact restoration, and corruption rejection without reset. These are Linux process tests, not mobile or physical power-loss evidence. Broader regression is tracked separately.

CI90cb649 passed Node/Go/desktop but iOS again stopped during synthetic-photo import (60.651s), before XCUITest. The bounded diagnostic captured library rebuild/errors/readiness without proving why addmedia hung. Direct job/artifact API retrieval succeeded after the aggregate gh log call timed out; record the actual failed stage instead of conflating API retrieval, simulator tooling and Copilot upstream failures. Do not repeat the unchanged photo setup or claim Apple execution from boot/build/install.

Root inspected the current real site-editor and mobile-social captures during the private-state UI gate. Layout remains legible at the captured desktop/mobile widths; this is visual inspection, not independent design or physical touch/screen-reader evidence. Further copy polish is concrete: “1 publicações em cache” and “1 ligações activas” need singular forms; editor block labels HERO/TEXT should use the same Portuguese names as the add-block controls. The editor's explanatory text exposes implementation vocabulary that can be simplified without changing safe rendering. Apply after the frozen gate, then recapture affected UI; do not silently edit sources during source-hash verification.


Gate completo concluído: build/typecheck,152 Node/77.381s,105 testes Go de topo com race/379.168s (cinco helpers omitidos em unitários e executados pelos drivers),15 interoperabilidade/145.127s,15 UI Node/107.327s e15 UI Go/101.522s. Desktop Linux: preparação0.239s, execução0.982s, pacote5.161s, execução empacotada0.766s.22 relatórios Axe actualizados, zero violações. As fontes registadas não mudaram durante o gate. Evidência pública em `docs/evidence/private-profile`; produto, grupos dinâmicos e plataformas móveis continuam incompletos.


## Borrowed authority transaction and cancellation

A borrowed scope must latch its failure on the outer transaction: merely returning an error lets an outer callback accidentally swallow it and commit partial changes. Both engines now expose an explicit abort that retains the first integrity error, and scope errors use it. The hostile-callback controls exercise errors swallowed both inside and outside the scope.

The first Node scope run passed3/4 but a cancelled transaction emerged as “Inicialização protegida do perfil ilegível”: the initialization parser caught transaction errors as data corruption. Moving the tx read outside the parsing catch preserves cancellation and allows the valid database to remain usable, while malformed marker bytes still fail closed. Corrected Node scope+factory12 passed; final controls include full-quota fence persistence and real cross-runtime process exits. No dynamic-group admission/API/UI claim follows.

A facade transaccional Node/Go foi implementada e verificada:81 Node/36.565s,36 Go de topo com race/169.094s (quatro helpers executados pelos drivers),9 interoperabilidade/45.760s; build8.157s e CLI0.901s. Fontes registadas inalteradas durante o gate. Evidência em `docs/evidence/group-transaction`. A aplicação ainda não usa esta facade para grupos dinâmicos.


## Actual Android syscall rejection after a successful build

The first APK containing the SQLite profile substrate built/aligned/installed but crashed before SAF assertions. The owned emulator crash buffer reported SIGSYS, SYS_SECCOMP, syscall6 on x86_64. modernc/libc's Linux/amd64 Xlstat64 directly invokes SYS_LSTAT; Go's standard Lstat uses fstatat. Never relax Android seccomp or infer runtime support from cross-compilation. A maintained C SQLite backend via Bionic is being validated; other existing targets retain modernc. Its connections require external extension loading to be omitted at compile time, with a real negative build-option control.

The first C host gate caught a meaningful portability difference: the held profile lock can be reported during db.Conn before BEGIN EXCLUSIVE. Typed SQLite busy/locked codes are now classified at both boundaries, retaining the same second-owner refusal and zero-wait policy. Both drivers passed the correction. Full C Go/race, cross-process interoperability and real UI then passed; the corrected APK must still pass the owned emulator gates before being called device-verified.

The maintained gomobile wrapper manages platform tags itself, so pass the SQLite omission tag explicitly to gomobile as well as the build environment. After application maintenance, the unversioned python alias was also absent; using the installed python3 fixed the project build launcher without modifying global PATH/aliases.

The iOS26.4.1 compatibility probe failed earlier than photo import: after a326s boot, the required Node peer missed its20s startup deadline. Collected stderr was never saved. The runner now checks that prerequisite before expensive simulator startup, records bounded sanitized stderr and explicit startup phases, and keeps the same deadline. The actual host-peer/bootstrap/auth test passed; this is still not Apple UI evidence or a proof of the underlying macOS timeout cause.


## Native screenshot is a separate gate from DOM geometry

The first corrected Android APK passed80 assertions and authenticated profile migration, but root's actual screenshot review found the contact list where the report claimed an offline site dialog. Its WebView.draw companion image was blank. Do not infer painted native output from dialog[open], innerText or WebView visibility.

The same APK passed a directed repeat after stronger geometry/hit-test checks and produced the correct native image. The Chromium long-page control (45 contacts, deep scroll, cached author offline) also passed without changing app code. The fixture now validates a light dialog surface and dimmed backdrop in the actual UiAutomation screenshot, waiting a bounded number of frames; the preserved earlier image fails this check and the correctly painted one passes. These controlled pixels verify that the compositor caught up with the already verified dialog; WebView.draw is not treated as proof. All four emulator gates are being repeated with the strengthened capture check, without deleting their earlier mismatch or changing production UI.


Final corrected emulator gate: APK136a5103c82c4c87f6865aa2b68daa5eb60796ac4d420aa8f09d5fea5fd4e2a5, com AAR9e2fb77f9938721c9df7ef82df19e357ab02ff0c417ec40061a82e0f27004585:82 asserções no mesmo emulador API36x86_64 (38 SAF36.693s,15 prazo134.729s,16 mensagens15.355s,13 relay18.913s) e inspecção cifrada0.768s passaram. Hash instalado e inputs inalterados; cofre/JSON legado preservados; SQLite Android e binding autenticados pelo Node. Root reviu a captura nativa final. Instrumentação removida, forwards vazios, AVD/adb próprios parados, identidade preservada. Evidência em `docs/evidence/android-sqlite/apk-136a5103`. The complete strengthened run is separate from the earlier80 assertions with a failed screenshot review.


## Gestão de grupos pela API real — 2026-09-12

Os testes Go dirigidos ao núcleo passaram, mas os dois percursos HTTP mistos falharam com operação desconhecida: o servidor Go ainda não encaminhava a acção nova. Acrescentado o encaminhamento autenticado, os quatro casos passaram. Prevenção: um método Handle testado não prova que a operação está acessível pela API de produção; conservar os percursos de processos reais nas duas direcções. Logs .cache/group-runtime-mixed-first.txt e group-runtime-mixed-after-route.txt.

Ao ampliar para saída/reentrada, a fixture assumiu incorrectamente que resume era um no-op num grupo activo. O contrato existente exige suspensão por capacidade, pelo que a fixture passou a exigir recusa e conservação do estado, sem enfraquecer produção. Os quatro casos ampliados passaram5.684s; falha preservada em .cache/group-runtime-reentry.txt e correcção em group-runtime-reentry-corrected.txt.

O parsing Go de cabeçalhos raw é incremental dentro da transacção: assinatura e esquema inválidos na cauda são rejeições de dados, enquanto o prefixo restritivo fica gravado. Parsing tipado de toda a página antes de abrir a transacção perderia essa propriedade. Cinco variantes de cauda e controlos de erro antes/depois do commit/digest desactualizado passaram com race. A regressão completa está em curso; não atribuir os resultados anteriores aos novos binários móveis.


## Integração de grupos pela API — gate concluído, produto incompleto

Gate completo: build5.497s;177 testes Node122.851s;118 testes Go de topo com race380.032s (oito helpers omitidos sem fixture e exercitados pelos drivers reais);20 casos de interoperabilidade199.504s; driver C dirigido8.039s;16 UI Node112.105s e16 UI Go106.110s. Desktop Linux: preparação0.239s, execução2.075s, pacote5.377s e execução empacotada0.795s.22 relatórios Axe actualizados sem violações. Fontes inalteradas em todas as fases. Evidência em `docs/evidence/group-runtime/final`. Capturas do editor/social Node e conversa escura Go revistas por root; isto não é revisão independente. Nenhuma nova execução móvel pertence a este gate.

Gestão de épocas está ligada às APIs; admissão/outbox/retenção de conteúdo, carriers P2P automáticos e UI de grupos dinâmicos permanecem pendentes. O objectivo integral continua activo.


## Reserva automática é distinta do pin manual — 2026-09-12

A primeira implementação Go falhou no restart: o decoder comum exige os campos exactos do struct, mas o serializer omitira reserved=false. Também falhou o teste antigo de restart, pelo que não era apenas uma fixture nova. A correcção limita o default reservado=false ao índice local de disponibilidade e reutiliza a validação estrita restante; não torna opcionais campos de certificados/mensagens. Go/core/race passou8.951s; a prova de processos Node/Go passou5.562s com reserva persistida, saída78, pin manual preservado e controlo negativo de retirada da reserva.

Uma escrita incerta da lista de reservas conserva a união da selecção antiga/nova em memória até reconciliação. O teste obstrui apenas index.json da fixture; a mesma pressão que perderia o objecto sem essa protecção deve falhar antes de qualquer retirada. Reservar bytes não concede admissão e não aumenta TTL. Integração com o ledger da aplicação ainda pendente.


## Marco de admissão verificado — 2026-09-13

190 testes Node passaram137.762s;129 testes Go de topo/race396.073s (9 helpers executados pelos drivers de interoperabilidade);24 testes de interoperabilidade219.736s; fronteira SQLite C15.538s;16 UI Node112.941s e16 UI Go103.288s. Build6.072s e CLI0.221s passaram. Desktop Linux: preparação0.224s, execução1.028s, pacote5.347s e execução empacotada0.798s.22 relatórios Axe actualizados, zero violações. Fontes inalteradas em todas as fases. Evidência em docs/evidence/group-content/final.

Reserva/admissão/histórico estão ligados aos dois núcleos. Envio/outbox/carriers/UI dinâmica, artefactos móveis correspondentes e revisão independente permanecem pendentes. O objectivo completo continua activo.


## Outbox de épocas: paragens não podem ficar só na projecção — 2026-09-13

O mirror groupStopped exige o StopRecord correspondente e a sua ligação imutável; abertura e retry validam também contexto/autor/leitores. A mudança de membros grava a paragem na reserva transaccional, mesmo com o espaço normal cheio e sem reescrever o documento privado. O cancelamento abrange as filas locais do transporte e as guardas de inventário/pedidos, incluindo mensagens já confirmadas. Pacotes em trânsito e cópias de outros pares permanecem fora da promessa de recolha.

Fixtures novas tiveram erros próprios corrigidos e preservados: Node chamou preference em vez de localAction; Go usou assinaturas erradas de Anchor/PutReserved e retry em vez de outbox-retry. O teste de orçamento256 foi inicialmente inserido dentro do ciclo de outro teste; o runner cancelou quatro subtestes quando o pai acabou. Movido para o nível superior, com execução sequencial; o passe anterior das quatro saídas reais continua com a sua evidência específica. Não atribuir falhas de fixture a produção nem cancelar cobertura para obter verde.


Gate completo da autoridade da outbox concluído: 211 testes Node passaram179.064s;141 testes Go de topo com race476.758s (10 helpers omitidos isoladamente e executados pelos drivers);26 casos de interoperabilidade243.460s; fronteira SQLite C75.323s;17 UI Node115.845s e17 UI Go109.616s. Build5.524s;22 testes iOS host1.842s e verificação estática0.032s. Desktop Linux: preparação0.336s, execução1.507s, pacote10.029s e execução empacotada1.280s.26 relatórios Axe actualizados, zero violações. Fontes inalteradas durante os gates. Evidência em docs/evidence/group-outbox/final. O teste de mutação da cache respeita o bloqueio após falha de integridade: reabre com o mesmo store ID para verificar rollback, em vez de tentar continuar num handle invalidado. A fixture de prova em falta passou a avançar primeiro o cursor válido, conservando a recusa de corrupção do snapshot actual. Produção não relaxou esses controlos. A publicação/carriers/composição dinâmica e o restante contrato continuam pendentes.


## Recuperação de criação/envio e Unicode — 2026-09-13

As oito mortes reais antes/depois de preparing/ready passaram com APIs e sockets reais. O primeiro ACK da fixture era um pacote que a aplicação correctamente recusava; a testemunha passou a usar request válido, sem relaxar produção. A variante159 caracteres+emoji reproduziu depois uma falha real: Node slice(0,160) produzia meio surrogate, Go preservava o carácter completo e rejeitava a pré-visualização no restart. Novos previews Node preservam o carácter completo; Go aceita exactamente o prefixo legado quando todas as ligações ao bundle verificado coincidem. Outros prefixes continuam recusados. O gate dirigido corrigido está registado em RESUME.md; ainda não atribuir passe global. Prevenção: testar fronteiras UTF-16 nas duas direcções, incluindo metadados de versões anteriores, além dos bytes de anexos.


## Marco de criação/envio — gate concluído, produto incompleto

Build5.816s;219 testes Node194.189s;144 testes Go de topo com race507.918s (11 helpers executados pelos drivers);30 casos de interoperabilidade270.997s; fronteira SQLite C115.655s;17 UI Node115.990s e17 UI Go110.472s.22 testes host iOS1.887s e estática0.030s. Desktop Linux: preparação0.233s, execução1.041s, pacote5.812s, execução empacotada0.800s.26 relatórios Axe actualizados, zero violações.277 ficheiros de fonte inalterados durante os gates. Evidência em docs/evidence/group-send/final.

APIs/falhas/mortes verificadas; confirmações automáticas, eventos, carriers, composição/gestão dinâmica e restantes requisitos continuam pendentes. iOS1aaca64 produziu captura real de falha do isolamento antes da WebView; nenhum fluxo funcional passou. A próxima correcção deve preservar a política e provar sintaxe com o compilador WebKit real.


## O parser WebKit não é NSRegularExpression — 2026-09-13

A captura real de1aaca64 isolou o ramo de erro de compileContentRuleList; os testes Foundation anteriores só contavam regras, por isso não detectavam a sintaxe específica do WebKit. A expressão(/|$) contraria a restrição documentada do marcador final. Foi substituída pela união de duas expressões com a mesma fronteira de origem, mantendo bloqueio/excepções. A política tem agora controlos positivos/negativos de compilação WebKit e matriz de origens/tipos de recurso; estes ainda aguardam execução Apple, enquanto22 testes host do runner/estática passaram. Não assumir que um regex válido em Foundation/JavaScript é aceite pelo motor de isolamento de outra plataforma.
