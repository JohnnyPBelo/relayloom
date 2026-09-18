# Learning log

## Carriers: quotas partilhadas e validação antes do encaminhamento — 2026-09-13

O teste novo reproduziu a quota auxiliar ultrapassada nos dois motores: `cache` aplicava o limite, `output` guardava respostas directamente. `retain` passou a cobrir ambos. Outra prova reproduziu retirada prematura de um controlo quando um pin tornava a nova admissão impossível; agora o plano completo antecede qualquer retirada e a substituição é guardada primeiro. O teste Node injecta também falha de escrita e verifica a conservação das provas; ambos os motores medem os bytes realmente submetidos ao transporte contra4MiB/min, com controlo positivo acima de3MiB. Logs before/corrected/producer-limits em `.cache/group-carriers`.

O teste de sockets do retransmissor opaco mostrou que recusar um controlo público em `receive` chegava tarde: o router já o encaminhava após o callback. A política comum valida envelope privado/tamanho/duração na fronteira do router, sem precisar de decifrar. Controlos rejeitados não recebem ACK de sucesso; a fixture cancela cada retry antes de medir a recusa seguinte, evitando que um pacote anterior satisfaça o contador negativo de outro caso. Node e Go reproduziram a falha e passaram a correcção. Prevenção: distinguir recusa de apresentação, recusa de armazenamento e recusa de trânsito; medir cada fronteira com um destinatário realmente separado.

Os18 vectores são cifrados e verificados independentemente nos dois motores, incluindo Unicode e negativos assinados válidos. Chaves sintéticas ficam apenas na cache temporária privada. A regressão intermédia passou251 testes Node;9 casos dirigidos posteriores passaram9.314s. O gate integral actual ainda está em curso; não atribuir-lhe passes antecipados. Não houve agentes novos/retomados nem alterações a modelos/bridges/configuração.

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


## Confirmações — referência privada após encerramento

O teste de prova histórica em falta removeu primeiro o snapshot ainda referido pelo cursor verificado. Encerrar o grupo NÃO desloca esse cursor privado: a aplicação recusou correctamente corrupção (“Cursor sem estado privado verificado”) e bloqueou a identidade. A fixture deve confirmar uma época/snapshot sucessora antes de encerrar e retirar a prova anterior. A correcção foi só nos testes Node/Go; não enfraquece validação nem transforma corrupção em pausa recuperável. Logs before/corrected em .cache/group-confirmations-proof-*.txt. Evitar assumir que head público e cursor privado coincidem.


## Inventário de artefactos e logs ignorados

rg --files respeita *.log de .gitignore mesmo ao listar o directório de artefactos descarregados. A primeira revisão inferiu incorrectamente ausência do detalhe iOS. Os caminhos explícitos no relatório existem, os hashes conferem e14-execute-ui-test.log identifica identity-created e missing("post form completed"). Usar rg --files --no-ignore para inventariar estes artefactos, ou ler os caminhos exactos do manifesto; não inferir ausência a partir de uma listagem filtrada. Os logs finais de grupo também exigem git add -f explícito, já feito no commitc1d6f89.


## Confirmações históricas — gate concluído, produto incompleto

Build5.598s;224 Node219.220s;148 testes Go de topo/race548.587s (11 helpers pelos drivers);33 interoperabilidade315.613s;SQLite C143.711s;17 UI Node118.995s e17 Go112.607s;22 host iOS2.319s/estática0.050s. Desktop Linux: build0.230s,execução1.011s,pacote5.055s,execução empacotada0.809s.26 Axe sem violações;284 fontes inalteradas. Evidência em docs/evidence/group-confirmations/final.

Sem agentes novos/retomados. Eventos, carriers, UI dinâmica, artefactos móveis actuais e restantes requisitos continuam abertos. iOS1663cbe provou política/arranque e criação de identidade, mas o formulário de publicação não fechou; os logs estavam no artefacto e foram lidos pelo caminho explícito após a listagem ignorar *.log.


## C1 — gate final concluído, contrato incompleto

Build6.056s;253 Node405.684s;161 Go principais/race711.420s (12 helpers pelos drivers);47 interoperabilidade480.894s;35 SQLite C283.498s;19 UI Node138.097s/19 Go128.687s. Desktop Linux preparação0.319s/execução2.412s/pacote --dir7.260s/execução empacotada1.255s.62 Axe sem violações;326 fontes inalteradas. Sessões83929 e43358 terminaram0. Evidência em docs/evidence/group-carriers/final, falhas em adversarial. Root reviu as capturas; revisão independente e plataformas actuais pendentes. C2/C3 e todo o resto de PROJECT-BRIEF continuam activos; não marcar produto completo.


## HTTP de fixtures e início C2 — 2026-09-13

CI Windows distinguiu terminação por sinal de exitCode: controlo offline passou após aceitar ambos e medir recusa de socket com positivo antes de parar. O run seguinte encontrou ECONNRESET num socket HTTP reutilizado e processo vivo; diagnóstico privado foi recolhido do artefacto oculto. Bloquear só o cliente local reproduziu a reutilização de ligação já fechada; bloquear apenas o servidor não. O helper usa uma ligação por RPC/uma tentativa, com regressão não idempotente exactamente uma vez.4 casos afectados passaram92.466s; não inferir o histórico preciso de agendamento do CI nem mexer em timeouts/bridges.

C2 teve dois erros de fixture corrigidos: ProtectedGroupStore.transaction devolve T directo; só GroupRegistry.inTransaction devolve ScopeResult.value. O worker compilado via launchOwned inicia no root, portanto a restrição de cache deve resolver .cache nesse cwd, sem a enfraquecer.6 Node/5 Go-race/interop real/API três percursos passaram; ainda falta transporte/UI de avisos e gate completo. Retire aborta a transacção mesmo se o chamador engolir erro após delete, conservando o convite. Chaves de teste só na cache privada temporária.


## C2: callbacks sob mutex e reabertura de consentimento

O cancelamento Go fazia DB/recuperação dentro de Router.CancelLocal, que segura r.mu. O teste de estado em memória desactualizado reproduziu reentrada no mesmo mutex e expirou12s. Decisões passaram a ser calculadas antes do callback; o mesmo teste passou com race2.326s e o mesmo prazo. Node foi alinhado para não fazer recuperação durante a travessia da fila. Preservar a fronteira: callbacks do router só consultam decisões imutáveis, não chamam DB nem recuperação.

Abertura repetida de um convite com UUID novo apagava consentimento local. A regressão de rede falhou antes da guarda; agora recusa reabrir convite já aceite/admitido e recupera a operação original antes de comparar a versão actual.4 percursos Node/Go passaram17.621s. C2 permanece em integração, com adversariais/partições e UI ainda pendentes.


## Replay de snapshots incorporados — 2026-09-13

O desbloqueio reaplicava22 vezes autoridade para11 snapshots já guardados. O novo teste reproduziu-o, mantendo um controlo de fecho novo com snapshot inválido. O caminho de no-op só é escolhido após validar estado activo/admissão/cursor e bytes, header, emissores e leitores exactos no mesmo scope autenticado. Node0 aplicações/≈0.7s contra22/≈1.8s; Go/race e17 regressões dirigidas passaram. Não usar ID de carrier ou projecção de UI como substituto dessa prova; estados parcialmente admitidos e toda falha de verificação conservam o caminho normal, incluindo fences. Windows e regressão integral ainda pendentes.


## Web autónoma — fronteira real e liveness de WebRTC

Foi identificado que apps/web era apenas cliente do daemon. O requisito explícito de paridade sem instalação entrou no contrato e no planoW1–W5, sem marcar os passes de UI antigos como browser autónomo. Protocolo portátil e criptografia Web Crypto/scrypt compatíveis foram implementados, com IndexedDB cifrado transaccional e adaptador WebRTC real.

Primeiro typecheck falhou na assinatura DOM Web Locks que inferia Promise<Promise<T>>; tornar a facade async/await preservou a semântica real e passou. Os3primeiros testes browser passaram. A integração seguinte passou4casos mas falhou no seeder: encerrar o contexto do autor não notificou o canal remoto em15s. Foi adicionado controlo de presença limitado2s/5s e o mesmo caso passou9.2s, com prazo inalterado. Não aumentar timeouts por ausência de detecção de pares; distinguir encerramento remoto observado de simplesmente enviar close local.

Não confundir interoperabilidade de bundles/cofres com interoperabilidade de transporte. O programa Go foi efectivamente executado também com bytes produzidos pelo Chromium, e voltou a produzir uma resposta decifrada no navegador; usar chaves produzidas pelo Go dentro do Node não bastava como prova. Grupo/rotas/worker/UI/PWA permanecem por integrar. Sem agentes novos/retomados ou alterações de provider/bridge.

Gate do núcleo web concluído64554:16Node/6Chromium, typecheck/build,366fontes inalteradas. `docs/evidence/browser-foundation` preserva âmbito/logs/falhas. O lockfile não traz nova versão transitiva, apenas torna scrypt uma dependência de execução explícita. Todos os pendentes C2/C3 foram conservados.


## Routing browser e provas de fronteira — 2026-09-14

O protocolo de pacote foi partilhado com os sockets nativos. Recepção global serializada/limitada e validação antes de admissão evitam dupla entrega concorrente; callbacks confirmam armazenamento local sem esperar pelo ACK de outro salto. O RTC passou a multiplexar fragmentos com7turnos prioritários/1justo e a verificar cancelamento depois de backpressure. Controlos reais comprovaram SOS e interrupção de relay sem fechar a ligação própria.

Exigir um único dono de rede por perfil/origem: só serializar as escritas IndexedDB não impediria outro separador de continuar a retransmitir após pause. BrowserMesh mantém Web Lock durante a vida da rede e até drenar operações no close; alterações de preferências serializadas respeitam revogação mais recente mesmo se um enable antigo ainda persistir.

Um teste não abriu RTC em15s, antes de exercer prioridade. A repetição com diagnóstico e os gates passaram, mas sem reproduzir estado da falha original; não chamar isto correcção de conectividade. Preservar log e capturar ICE/canal sem publicar SDP ou credenciais. findLastIndex não faz parte do alvoES2022: usar map/lastIndexOf, sem mudar config por conveniência.

Durante arquivo descobriu-se que reporter.outputFile relativo numa config dentro de tests/browser cria a cache nessa pasta. Resolver caminho da raiz explicitamente; a suite14 foi executada e o JSON real recolhido no destino do CI. Não inventar ficheiros/contagens a partir de caminhos esperados. Fonte de produção idêntica entre gate372fontes e suite ampliada14.


## Web/nativo: contabilização, ACK tardio e retoma de gates

GoWS contava sessões abertas como handshakes pendentes e recusava o5.ºpar. Teste falhou antes; pending agora é retirado na passagem para sessão,8válidos/9.ºrecusado passaram comrace. Escritas de controlos Go são enfileiradas semI/O sob o mutex; cancelamento de fragmento em-flight só publica drop depois da escrita. Origem inválida é validada antes de fechar um convite existente.

A fixtureAxe falhou por usar browser.newPage, que impede a ferramenta de abrir a página auxiliar no contexto; usar newContext/newPage e conservar a auditoria. A aparência real Node/GoWS foi depois revista, sem confundir comUI autónoma.

ACKtardio: o primeiro ensaio passou semprovar retryparcial. O controlo reforçado usa lowPower doemissor+marcadorSos na mesma ligação antes de libertar armazenamento; reproduziu1reassemblagem órfã. Cache deIDs só após verificação/aceitação, limitada4096/prazo do pacote/1h, evita recomeçar a tentativa já aceite. Mesmo prazo3s deassert e15s deassembly; regressão passou4.2s.

271Node e89Go de topo/race já tinham passado385fontes. A retoma verificou hashesde todasasfontes nativas e ambiente; só4ficheiros de browser/test/runner mudaram.18browser e42UI, desktop executado/empacotado,66Axe passaram. Preservar o prefixo originalmenteFAILED porAxe, não reescrever como passe integral. Coder/websocket éISC, não a suposiçãoMIT; copiar licença real e hash. Plataforma física eparidade continuam pendentes.


## UI autónoma: erro vazio, scopeSW e resposta perdida

O worker enviava DOMException.message vazia; oclienteusava truthiness deerror e resolvia como sucesso. Teste deDBcorrompida falhou pelaausência de alerta. Normalizar mensagem e distinguir presença deerror; repetiu comidentidadebloqueada, semreset.

Serviceworker guardavaUI mas oworker emitido em/assets nãoera controlado noarranqueoffline. Trace confirmou503 do worker. Emitirworker em/browser e incluí-lo na lista verificada; teste comservidor503 passou. CacheStoragecorrompida não executa código alterado e sórepara combytes válidos daorigem. A versãodacacheinclui templateSW além doshashes dosassets.

UI mobile precisavaabrirnavegação; Conversas mudavadenomeacessível comcontador. Nomefixo+aria-description conservaramcontagem. Resposta de sendperdida depoisdocommit recuperou mesmoUUID/ID; reserva eledger/transacçãoIDB tiveramcontrole deaborto epressão. Novo gatepassou271Node/26browser/42UI/Linuxpacote,403fontesestáveis/72Axe. Isto não prova dinâmicos/gruposeparidade nemuma revisãoindependente.

Browser skillfoi lida para preview; execução NodeREPL existia masbackendIABnãofoidescoberto. Abertura pelopainelretornouqueued; nãoafirmar queabriu/verificou. PreviewVite próprio ficou activo na sessão49020/porta4174, semidentidadepré-criada.


## Recuperação de grupo e rascunho depois do bloqueio — 2026-09-14

A revisão identificou uma segunda leitura assíncrona em recover sem voltar a verificar se o diálogo ainda pertencia à sessão. O teste real perdeu a resposta de uma criação já commitada, reteve a resposta de estado durante recuperação, bloqueou pela UI e entregou a resposta antiga. Depois de desbloquear, o rascunho apagado reapareceu: falha reproduzida (1 passe/1 falha). A closure de chooseConversation conservava o texto anterior ao bloqueio.

A correcção verifica alive depois de cada await que antecede callbacks ou actualização do workspace. Os mesmos dois cenários passaram Node6.6s/Go5.1s, sem segunda criação. A suite UI completa/desktop está pendente. Prevenção: validar a sessão em cada fronteira assíncrona, incluindo recuperações de UUID com mais de uma leitura; não basta verificar apenas a primeira resposta. As cópias de validação exigem um root explícito: uma primeira cópia usou o cwd errado, falhou antes de escrever e foi repetida correctamente antes dos testes.


## Validação visual, Windows e leituras de autoridade — 2026-09-14

Axe não detectou o contador9px fora do botão de convites a320px. A revisão de imagem encontrou-o; a asserção geométrica falhou e passou após usar colunas no botão móvel. O gate completo foi repetido:23 UI Node/23 Go,70 Axe,desktop Linux. A cópia longa produziu socketUnix111bytes; movê-la para.cache/u conservou fontes/estado e permitiu o mesmo arranque com94bytes, sem mudar sandbox.

CIbb85d1a passou Linux/macOS, mas Windows reteve o timeout65s e revelou dois hooks SQLite fora de ordem. Fechar a reabertura em finally, antes do hook da fixture, passou6 testes locais; não inferir passeWindows. O perfil Linux mostrou verificações de assinaturas repetidas em leituras de checkpoint na mesma transacção. Novo cache8/416KiB é estritamente ligado à generation, retorna clones e acaba com o scope. Testes mediram5leituras→1 e provaram invalidar após corrupção/remoção de provas/encerramento, separar transacções e limitar8entradas. O cenário completo instrumentado38.261s→21.171s passou sem mudar prazo ou fases; a regressão completa está em curso. Custo menor num host não substitui o CI Windows.


## CI Go e política de lock do transporte — 2026-09-14

60f514c passou os3jobsNode, incluindo seederWindows30.976s no prazo65s e asduaslimpezasSQLite. O jobGo excedeu o limite global10min do pacoteapp, com o casoByteReserve em1m03; nohost o pacote tinha passado514.819s. A stack activa não estava disponível, por isso não se atribui deadlock nem se aumentam prazos sem diagnóstico. Perfil dirigido em preparação.

Um novo teste APIWS assumiuincorrectamente que bloquear chaves revogava consentimento de relay. Ambos os motores mantêm o transporte opacoatéstop/expiry;isto está alinhado com a separação entre chaves e retransmissão. A fixture passou a provar essa política, a negação de leitura/publicação privadas bloqueadas e a revogação explícita, inclusivequando bloqueado. Os2percursos passaram1.236s;falhaoriginalconservada. Não enfraquecer um requisito para fazer umteste passar, mas também não inventar um requisito de stopque contraria a política existente.


## IntegraçãoGo e caminhosGit — 2026-09-14

GoMemo passou-gaterace integralcom-p=2(app413.181s dentro600s),45SQLiteC,57interop e23UIGo;368fontesestáveis. Commit9866889 publicado,CIactivo. A cópiaWS foi actualizada semtocar nas26alterações; git diff --name-only sem-z devolveu algunsnomesUTF8 comaspas/escapes que git restore recusou. Usar-z e separarNUL resolveu,comhashescomparados antes/depois. Não interpretar nomesde ficheiro human-readableGit como pathspecs exactos.


## Reticulum real e fairness por classe — 2026-09-14

A integração usa o pacote RNS1.5.4 inalterado (licençaReticulum, nãoMIT). O primeiroDM privado atravessouTCP/serialviaRNS e orelaynãoodescifrou, mas o ficheiro28800bytes não terminava apósapartição. Diagnósticos mostraramcontenção de fila. A regressão dirigida dechegadascontínuas deu1/120turnosbulk; inicializar schedulednacontagemactualdeu14/120;a selecçãopelaclassemenosrecentementeservida passouNode/Go-race. Nãoatribuir à referência RNS uma falha nãoisolada: o limite deprópriossegmentosemvoofoi ajustadopara4, retiradossóemordemdeprova, semalterarRNS.

Outros controlos detectaram reinício recusado pelo directóriovazio/interfaces criado pelo RNS, e pequenosobjectosdeseeding presosatrásdeum bulk. Validarconteúdoexecutáveldo directórioe admitirobjectosdeumfragmentoresolveram. Testefinaldirigido passou43,779s semalterarficheiro/partição3s/prazos45s+35s. Autor/ciphertextcorrompidos recusados antesdoarmazenamento, leitura semautoria e replaypassaram6,756s. Logs deiteraçõespreservados;gateisoladointegral emexecução, não concluído.

Prevenção: medirprogresso porprioridade e contagemdefragmentos, nãosóvolume; fluxosnovosnão devemroubarturnosjustos. Configuraçãocriadapelo upstreamfazpartedociclo de reinício. Registarpassesespecíficoscomhashes; não convertergatedirigidoemvalidaçãoderádio,paridade ouprontidão.


## Consolidação web e recolha de evidência — 2026-09-14

A verificação sequencial sobre5e049f1 terminou sem falhas,279Node/26browser/46UI/desktopLinux. Os testes da web escrevem capturas em.cache, mas o novo jobCI recolhia docs/evidence. Corrigidos apenas os caminhos de recolha, com hashes anterior/posterior separados do relatório do gate. Contar apenas8Axe novos da web/transporte; a UI nativa comum é sobrescrita entre motores e não pode ser contada duas vezes a partir da mesma captura. A nova execução iOS confirma a mesma falha de teclado; não chamar ao incremento UIKit uma correcção validada até correr em Apple.


## Convites web e rota RNS — 2026-09-14

A UI nativa cria/revoga capacidades de transporte pela API autenticada, sem mostrar o URL de controlo. O token só fica no componente emissor e desaparece ao fechar/bloquear; a resposta tardia foi retida e entregue depois do bloqueio para testar essa garantia. Revogar fecha a ligação real e mantém a identidade utilizável. As expectativas iniciais do teste usavam uma contagem zero inexistente e pressupunham mudar para Conversas ao desbloquear: corrigidas após ler os estados reais, sem alterar o comportamento da aplicação.

O novo percurso autónomo RNS passou com controlos de isolamento, partição/heal, leitura negada ao relay e seeder reiniciado com autora offline. A regressão final passou26browser/50UI/gateRNS/desktopLinux. Não alterar node_modules partilhado enquanto uma cópia de validação corre: a instalação da dependência criptográfica da fase seguinte foi adiada até o gate terminar.


## Certificados partilhados e chaves degeneradas — 2026-09-14

O port síncrono preserva18 operações de certificados e usa a mesma implementação das regras nos dois adaptadores. O import inicial de equalBytes foi corrigido para curves/utils após typecheck. O teste browser leu os vectores JSON pelo filesystem da fixture, pois o carregador Playwright exigia atributos de importação JSON. Falhas e passes dirigidos preservados em.cache/milestones/group-key-*.

Um controlo adicional com Ed25519 neutro revelou que as primitivas OpenSSL e Go validavam uma prova de cartão degenerado; o modo estrito de noble recusava-a. Os testes de aplicação Node/Go falharam antes da correcção. Implementado filtro de admissão do formato e dos pontos públicos de pequena ordem em Node/browser/Go;48vectores, positivos de geração e imutabilidade dos bytes passaram nos controlos dirigidos. O filtro não substitui a verificação criptográfica nem demonstra falsificação de uma identidade normal. O gate integral ainda corre.

No CIa49e4a4, o routerGo entregava ao destino antes de o consumidor da aplicação gravar o ficheiro. A fixture agora espera ambos os factos separadamente e revê os negativos depois de cada testemunho positivo; dois testes isolados passaram3.208s, commit2d4d12c. Prevenção: um ACK de transporte não é confirmação de persistência ou leitura.


## Matriz WebKit e curvas — 2026-09-15

Firefox28passou antes do port. WebKit precisou de cinco bibliotecas extraídas emcache com hashesAPT fixos. O wrapper substituíaLD_LIBRARY_PATH: mover apenas libs ausentes para os caminhos sys/lib do próprio bundle permitiu arrancar sem mudar binários,wrappers,OS ou sandbox. RegistarABI2.43 e não prometer esse lock noutrosLinux.

A primeira falha grande tinha zero bytes enviados. Um teste isolado passou, mas o probe de ciclos pequenos reproduziu generateKey/importKeyX25519 e, depois de portarX, generateKeyEd25519 a falhar. Não atribuir a causa ao volume sem medição. CurvasNoble existentes resolvem esse caminho mantendov1 e RNGdo browser;512ciclos e operações nativas de curvas forçadas a falhar passaram. Os oráculos de um probe referiam a identidade anterior quando a geração seguinte falhava; rotulados explicitamente, sem os associar à geração inexistente.

Uma falhaRTC posterior observou B-C fechado depois de entregarSOS. Dezrepetições,uma suite comdiagnóstico e todas as suites finais passaram. Não houve correcção de transporte identificada: a observação continua aberta. Instrumentação temporária foi arquivada e retirada antes do gatefinal. Gates finais:90browser,9RNSUI,50UInativa,desktopLinux;42Axe novos. Não confundir oUA Safari do WPE com uma máquinaApple.


## Distribuição web por subcaminho — 2026-09-15

O primeiro typecheck recusou import.meta.env sem os tipos Vite; acrescentada a declaração local. O build Vite reescreve o manifesto para assets/: start_url relativo ./index.html apontava para assets/index.html. O controlo sobre o manifesto realmente emitido falhou antes da correcção. Usar ../browser/ mantém a resolução correcta nas cópias browser e assets, na raiz e sob /relayloom/. Não testar apenas o manifesto fonte/copied.

O controlo de cache inicial usou um documento SVG; o sentinel não sobreviveu à navegação em WebKit. Um segundo ensaio com unregister/reinstalação ficou sem o asset offline; estes resultados estão conservados, sem declarar correcção da gestão de armazenamento do browser. A fixture final mantém outro cliente HTML activo durante a instalação. O teste passa nos três motores; substituir temporariamente o prefixo de limpeza pelo prefixo global no SW compilado reproduz a eliminação indevida e falha exactamente no sentinel. Fonte original restaurada antes do gate.

Gate web estável passou:18 UI na distribuição existente,24 na distribuição pública,1 percurso entre dois processos Chromium/Firefox,63 488 bytes de anexo exactos,recibos e recarga offline. Não são dois dispositivos físicos. O gate da UI Node/Go/pacote Linux terminou PASSED25+25;publicação e teste HTTPS também passaram. A publicação deve usar apenas os assets cujo hash foi verificado; nunca a árvore de trabalho ou os perfis locais.


## Contactos visíveis e relay consentido — 2026-09-15

O contacto existia no cofre mas a lista era derivada apenas de mensagens/grupos; teste UI reproduziu ausência após importação. A primeira candidata juntou linhas com contact: provisório. Ao reconhecer a primeira mensagem como DM, alterava o conteúdo da repetição (conversa antes omitida) e a ordem de destinatários podia mudar. O teste existente de resposta perdida reproduziu2 mensagens em vez de1. Endereço DM canónico desde a linha vazia e destinatários únicos/ordenados no pedido mantêm a mesma operação. Node/Go validam independentemente esse endereço;2oráculos Node e3percursos UI dirigidos passaram. Não mudar a identificação/forma canónica de um pedido quando chega a confirmação.

O checkbox controlado voltava ao valor anterior durante a gravação: acrescentado estado de escolha pendente e confirmação explícita, com interacção desactivada enquanto grava. Os testes aguardam a pausa efectivamente confirmada antes do controlo negativo. Selectores de contacto tiveram de ser limitados ao diálogo porque a mesma pessoa aparece agora também na lista; o placeholder exacto evita coincidir com texto de mensagem. Erros de leitura podem aparecer no diálogo e no fundo; a asserção foi limitada ao diálogo, sem retirar a recusa.

A cadeia UI A–B–C tem apenas A–B e B–C. Duas janelas de observação em pausa, entrega após consentimento, contadores reais, leitura privada recusada ao relay e rascunho/reply preservados passaram nos controlos dirigidos. Gates completos finais passaram: 2 oráculos, 55 web, 50 UI nativa, pacote Linux e 9 UI-RNS; depois passaram os 3 percursos publicados. A opção vazia de URL da fixture foi normalizada antes do gate final. Bluetooth directo continua ausente e está indicado na interface.


## Ligações e meios — 2026-09-15

Cartão identifica o leitor; oferta/resposta estabelece um caminho. UI partilhava estado entre papéis e não observava a conexão no lado respondente: separação e polling de diagnóstico finito. Relato físico continua por confirmar; tab observado era versão antiga e sem pares/contactos. Teste real com duas outboxes pendentes passou após sinalização. Não atribuir causa física a teste no host.

As fixtures novas tiveram dois erros: expectativa Entregue quando a UI usa Recebida; esperar que o relay exibisse plaintext privado que correctamente não consegue ler. Usar estados públicos do produto e separar contagem de armazenamento cifrado da lista de conteúdo legível. Pedido nativo de obtenção chama-se retrieve, não request.

BLE simulado: uma partição excedeu 45 s no anexo; execução instrumentada passou sem fix runtime. Preservar essa incerteza, recolher estado da falha e não aumentar prazos nem declarar rádio validado sem evidência. RNS upstream não fornece Bluetooth browser↔browser. Respeitar a matriz de capacidades e o contrato de paridade ainda aberto.


## Convite abandonado e apresentação compacta — 2026-09-15

O gate funcional inicial passou, mas a revisão do lifecycle encontrou tentativas RTC sem limpeza ao fechar o diálogo. Um reproducer real observou 1 par pendente após fechar, quando esperava 0. Adicionado peer-close-pending, que conserva canais abertos; o painel acompanha handles próprios e elimina também resultados recebidos depois do unmount. Reproducer passou após correcção e novo teste cobre criação atrasada de 2 s, sem substituir RTC/cripto. Ambas as mensagens pendentes continuam a chegar e as confirmações permanecem assinadas.

A captura de 390 px mostrou a resposta antes do código a partilhar. Código/cópia movidos para cima e ajuda em três passos recolhível. Repetição integral web e UI-RNS em curso com fontes estáveis; não usar o passe da primeira candidata como evidência desta alteração final. Contrato completo, hardware e revisão independente continuam abertos.


## Estúdio multipágina — 2026-09-16

O primeiro E2E não localizava o select de tipografia devido ao nome acessível implícito incluir as opções. Foram atribuídos nomes explícitos. Uma segunda execução tentava navegar antes de o desbloqueio terminar; a fixture agora espera o ecrã de conversas, sem alterar o prazo nem o produto. O percurso completo passou antes da revisão adicional.

A revisão encontrou texto de posts editados ignorado no widget, imagens repetidas descodificadas por instância e cálculo aproximado de bytes de imagens com padding base64. O renderer passou a respeitar editedText, partilhar/libertar URLs por anexo e as validações TS/Go contam bytes descodificados. O controlo exacto 2MiB/+1byte passa em ambos os motores; o terceiro nível vazio tem um vector positivo. A importação mantém validação estrita em ambos os motores, sem delegar apenas na UI.

Os testes adicionais exercitam teclado, drag/drop para colunas e saída para a raiz, protecção de páginas referenciadas, restauração cifrada, leitura bloqueada, corrupção no disco e seeder reiniciado com autor terminando de facto. Não chamar simples encerramento de separador prova de tomada de seeding por terceiro: o gate entre processos cria um leitor novo e comprova ausência antes de permitir a transmissão.

Os passes dirigidos estão registados em SITE-STUDIO.md; gate integral em curso com fontes estáveis. Recuperação sequencial pedida pelo proprietário mantém revisão independente pendente. Não substituir esse requisito por auto-revisão/Axe.


## PNG do estúdio e conformidade de URLs — 2026-09-16

O primeiro gate integral passou Node323, Go-race, interop60 e Chromium36, mas Firefox deixou a imagem sintética com naturalWidth=0. Fazer scroll não resolveu. A verificação dos chunks com zlib detectou CRC IDAT inválido no PNG copiado; foi substituído por um PNG 1x1 RGBA gerado com CRCs válidos. Firefox passou mantendo naturalWidth=1 e o prazo. Não presumir portabilidade de uma imagem de teste porque um decoder a tolera.

Os controlos novos de URL confirmaram diferenças entre WHATWG URL e Go net/url: escapes malformados, whitespace, aliases numéricos e hosts inválidos tinham resultados diferentes. Política lexical partilhada, 51 vectores e limites explícitos corrigiram os dois motores. Validar a política do protocolo com vectores idênticos, em vez de assumir equivalência entre parsers de cada linguagem.

O primeiro ensaio com terceiro browser mantinha o receptor sem consentimento de sincronização de inventários. A implementação existente exige esse consentimento; a fixture passou a representar um novo nó consentido, mantendo B em pausa para o negativo. Nenhuma política foi relaxada. Firefox e WebKit passaram o site recebido por C depois de Alice fechar, só após B activar a retransmissão.

Gravar antes de publicar evita reabrir um rascunho anterior à publicação. Os dois motores de aplicação passaram o controlo UI com texto alterado depois da gravação manual. O gate integral final está novamente em curso com fontes estáveis; a primeira tentativa e todos os erros foram conservados.


## Mensagens de estado do estúdio — 2026-09-16

O gate Go25/26 falhou porque getByRole(status) assumia um único live region: o indicador de rascunho e um toast são ambos legítimos. Localizar a confirmação pelo conteúdo permite esperar pela gravação sem remover estados acessíveis. Teste funcional dirigido Go passou1/18,3s após a correcção. Preservar sempre o relatório da execução falhada antes de repetir; este erro não prova falha de persistência. A revisão visual também detectou uma quebra de palavra causada por max-width70px no rótulo de bloco. Retirado o limite, mantendo wrapping dos botões; gate visual ainda pendente.


## Proveniência de assets no follow-up visual — 2026-09-16

O script local de retoma repetia a matriz antes do build de verify-ui. appHost usa dist/web estático; por isso comparar hashes das fontes não prova que o browser executou o CSS actual. A captura ainda continha a palavra partida e confirmou a falha de procedimento. Não interromper os testes em curso; conservar o registo, reconstruir explicitamente e repetir a matriz com hashes dos assets. O gate completo scripts/verify-site-studio.mjs já começa por build; o erro foi do follow-up local. Nenhum passe deste controlo preliminar é usado como evidência da correcção visual final.


## Feedback RTC e snapshot do diagnóstico — 2026-09-16

O gate público WebKit falhou44/45: texto de ligação estabelecida com snapshot channel=connecting. A operação real aguardava ready(), mas o feedback manual adiantava-se ao polling. O painel passa a derivar o sucesso apenas do mesmo diagnóstico open/não fechado que exibe; resposta aceite é um estado intermédio. As asserções estritas, prazos e transmissão real permanecem intactos. Não resolver inconsistências entre duas fontes de estado esperando mais no teste; usar uma fonte coerente no produto. Resultado dirigido ainda pendente.


## Estúdio publicado — 2026-09-16

Gate final com build explícito,111 browsers,52 UI Node/Go, pacote Linux,85 casos web e9UI-RNS passou. Quatro gates de domínio foram conservados só após comparação dos hashes. Publicação86cb0c3 da fonte11d52be verificada em17 ficheiros HTTP e4 casos UI no URL. As falhas anteriores foram preservadas; não houve relaxamento de asserções, limites ou prazos. Logs públicos são cópias sanitizadas em.txt com hashes originais; perfis/traces privados ficam locais. Continuar contrato e validar plataformas/rádios/independência sem converter testes do host em aprovação física.


## Localização nativa e confirmação Android — 2026-09-16

O dump UI inicial coincidiu com o arranque da WebView; o seguinte mostrou a UI completa, sem alteração de runtime. Não transformar uma leitura inicial vazia em diagnóstico de falha. A preferência nativa resolve o alias de sistema /data/user/0 antes de verificar que core e ficheiro não são links; os32controlos de leitura e3línguas passaram noAndroid. O ficheiro nunca é escrito pelo helper nem dá autoridade sobre a identidade.

Uma captura mostrava mensagem Em espera apesar de a resposta já existir: a fixture suspendia imediatamente e não aguardava a confirmação assinada. Exigir Recebida antes/depois do restart passou sem alterar transporte ou prazo. Receber uma resposta não prova a persistência de uma confirmação; testar ambos explicitamente. Android final57/38/15/13 e inspecção do perfil passaram.

O colector local de evidência usou inicialmente um caminho relativo com um nível a mais; falhou no import antes de criar ficheiros. Corrigido para ../../scripts. Conservar hashes de originais/sanitizados e nunca substituir os relatórios anteriores. iOS novo continua sem compilação/execuçãoApple; estática/runnerLinux não são substitutos.


## Âmbito do driver HTTPS e falhas de interacção — 2026-09-16

Os novos testes de idiomas usavam appHost local e ignoravamRELAYLOOM_LAUNCH_URL; o script de retoma assumira o comportamento externo que só site-studio possuía. O traceHTTP127.0.0.1 demonstrou a lacuna. uiHost agora escolhe/loga/valida oHTTPS, preservando appHostpara controlos locais; os relatórios incluemapplicationURL e a navegação é conferida. Typecheck e controlospos/negpassaram. Exigir prova de origem real; uma variáveldeambiente no comando não demonstra queo teste aconsumiu.

O novo dirigido atingiu oHTTPS e trocoumensagens/anexo, mas ultrapassou90s antesdefinalizar. Pressãodememória elevada foiobservada,semcausademonstrada. Guardarfalhas; nãoconverterumreportPASS antigofixoem.resultadonovo,seotestenovonãoterminou. A capturabrancaeradeumsegundoseparadorvazio; a captura dotracecorrectomostravaaUI. Registar estafronteira emvezdeinventarfalhadedados/transporteeiniciarloops.


## Cópia de páginas e execução móvel — 2026-09-16

A cópia precisa de IDs próprios em todos os descendentes e de remapear apenas as ligações à própria página; trocar todos os destinos alteraria outras páginas. O início é um ID, não a primeira posição do array. Testes de limites, Unicode, não mutação, UI/undo/persistência e envio assinado a outro processo passaram. A revisão da captura compacta levou a agrupar a acção de início com a posição, deixando os campos mais largos; a matriz dirigida voltou a passar.

O emulador anterior desapareceu após interrupção. Confirmar /proc e adb antes de arquivar o registo e retomar o mesmoAVD; nunca reiniciar só por uma observação lenta. O primeiro Androidpages começou sem rascunho; é necessária uma segunda passagem final para exercitar a restauração do rascunho existente.

No iOS, addmedia passou nesta execução; o erro passou a ser navegação. A captura mostra o menu aberto com a página anterior seleccionada. O XCTest reutilizava uma consulta global definida antes de abrir a gaveta. Nova consulta ao landmark após abertura, condição hittable e diagnóstico de geometria foram preparados; o teste de toqueWebKit passou, mas não valida essa correcção no iOS. Não atribuir a falha actual à fototeca nem fazer um segundo toque automático para mascarar o comportamento.


## Rascunhos grandes e índice web — 2026-09-17

Um PNG sintético válido, maior que 1 MiB, reproduziu «Estado privado excede o limite» na aplicação compilada anterior. A correcção separa valores privados cifrados do índice e mantém a leitura legada. Preservar captura/trace antes de reconstruir; testar o percurso real de guardar, recarregar, desbloquear e comparar os bytes. O teste usa uiHost e confere o URL; o harness de crypto/IndexedDB é apenas prova local. Limpar o feedback da acção anterior evita um sucesso antigo junto de um erro novo.

O marco passou 236 execuções browser/UI, dois oráculos, 36 Axe e Linux build/run/package/run. Uma compilação isolada do commit0c6b58a produziu exactamente os 18 assets validados. A distribuição45ecacdf passou 17 hashes HTTP e 13 percursos HTTPS, incluindo a imagem grande e processos Chromium/Firefox independentes. Todos os handles foram recolhidos.

Logs brutos podem conter whitespace; conservar os hashes em vez de alterar a evidência para passar stylecheck. Ficheiros *.log podem ser ignorados pelo Git: verificar os caminhos do manifesto e adicionar apenas os logs curados explicitamente.

## Catálogo de sites e recuperação — 2026-09-17

Três falhas foram reproduzidas: preparação expirada tratada como corrupção; repetição de um pedido retido expirado sem recuperar o resultado; observações idênticas a voltar a gravar o catálogo. A leitura histórica autentica a recuperação, mantendo a verificação pelo relógio actual na admissão/transmissão. Contadores e cabeças autorizadas sobrevivem à expiração; assinaturas preparadas usam cifra ligada à chave de assinatura. Não retornar bytes para publicação antes de terminar a transacção real.

A primeira fixture de ProfileDatabase não tinha a estrutura exigida de mutations/rascunho e falhou antes do catálogo. Corrigir a fixture, preservando a validação do perfil. O gate completo passou 384 testes Node e Go sites/core; depois da correcção isolada de no-op passaram 12 testes afectados e typecheck. O manifesto de fontes identifica a diferença entre os momentos. Cinco testes terminam realmente processos em fronteiras de commit/cópia; não equivalem a corte de energia físico. APIs, transportes, UI e persistência Go/browser continuam pendentes.

## Diagnósticos iOS — 2026-09-17

No CI1ecbe79, Photos registou sucesso após validação de 59,078497 s, mas o comando de preparação não terminou com sucesso no prazo. Não promover essa linha de log a passe do comando ou da UI. No CI0c6b58a, a falha ocorreu antes, na instalação: o erro de paragem EPERM substituiu a causa original no runner. Conservar a primeira falha e acrescentar a falha de paragem separadamente, sem alterar sinais, alvos, permissões ou prazos. Os 24 testes do host e a estática passaram; execução Apple da correcção continua pendente.


## Integração de sites e reprodução limpa — 2026-09-17

O driver novo usava until sem predicate e Router.close inexistente. O teste falhou e deixou um nó/worker de fixture; identificar por PID/argv/parentesco, terminar apenas os recursos próprios e corrigir a limpeza antes de repetir. A assinatura dos helpers existentes deve ser lida antes de os reutilizar.

O CI expôs dependência de.cache/tmp previamente criada. Cada fixture agora cria o seu pai através deproject-temp. Verificar a árvoreGit isolada com a pasta ausente, não apagar a cache partilhada. O primeiro arquivo de verificação omitiuplaywright.config; preservar essa falha e completar a cópia a partir da mesma árvore.

Windows pode indicar fim por signalCode enquanto exitCode permanece null. Aguardar o evento terminal com prazo e manter uma prova independente de indisponibilidade; killed não basta. A correcção usa SIGKILL apenas no processo de publicação criado pelo teste e conserva a recusaTCP e o novo seeder.

API Node:397testes+31UI por núcleo/2interoplegados/Linuxpassaram. A camadaGo de registos privados também passou partilha deSQLite real e recusa de contexto diferente. Não são UI de revisões nem paridadeGo/browser completa.

## Catálogo browser, transacções e verificação de UI — 2026-09-17

O catálogo/API assíncrono passou 17 casos dirigidos em cada motor: Chromium, Firefox e WebKit. A cópia do site só começa depois da autorização durável; a recepção recusa site legível inválido antes de guardar/transmitir, mas conserva a possibilidade de relay privado opaco. O runtime tem fila própria porque ingest/flush não partilham a fila das chamadas de controlo.

A nova fixture chamou Mesh.stop inexistente no cleanup; corrigida para Mesh.close, o caso passou. Confirmar os contratos dos helpers antes de os usar, incluindo a limpeza. Outro teste calculou quota como plaintext, mas o orçamento do perfil conta JSON cifrado/base64. A fixture passou depois de calcular a fronteira real, sem aumentar limites. Um script de substituição falhou na asserção e o shell continuou para uma repetição inalterada; separar a alteração e a execução em ferramentas sequenciais, ou usar encadeamento que pare na primeira falha. Falhas preservadas em .cache/browser-site-parity/.cache/site-api-first-failure e site-browser-check-before-quota-fixture.

Dois percursos reais entre browser/Node/Go passaram WebRTC→WebSocket→TCP, controlos de pausa/retoma, privacidade e autoria, histórico e seeder único reiniciado após encerramento do autor. Não são hardware de rádio nem a UI futura de revisões.

Na regressão WebKit, o teste antigo procurava role=status global e encontrou o feedback do estúdio e o toast de uma publicação social anterior. O trace mostra o sucesso do rascunho. A correcção deve procurar o estado dentro do landmark Estúdio do site, mantendo a expectativa e o prazo. Não esperar pelo desaparecimento arbitrário do toast nem escolher o primeiro resultado. A repetição desta correcção ainda está pendente enquanto o gate original termina.

A repetição do selector limitado ao estúdio passou em Chromium/Firefox/WebKit, juntamente com o novo teste do worker compilado. A matriz consolidada cobre 66 cenários por engine (198 combinações), mantendo a primeira execução WebKit como FAIL e os relatórios de correcção separados. Nenhuma fonte de produto ou asset mudou entre a regressão e a repetição. O port está integrado no principal; o contexto/editor seguinte continua numa worktree isolada e não deve ser promovido como UI entregue.


## Estúdio de versões e observação das falhas — 2026-09-17

O controlador actual guarda intenção com base/UUID/digest/audiência/prazo antes de enviar e recupera operações prontas após perda de resposta/reinício real. Node/Go passaram os novos casos. A recuperação de uma versão privada tem de recuperar também os leitores dessa versão; herdar uma publicação posterior pública seria declassificação inesperada. O preview recuperado só permite confirmação depois de verificado.

O primeiro percurso de3contas passou4publicações e2recuperações e falhou no helperde navegação apósreload: a leitura imediata de isVisible escolheu o menu móvel antes do unlock terminar. Aguardar a heading de conversas passou sem mudar prazo ou produto. Gate dofork UI tambémPASS. Não interpretar essa falha dafixture como perda do rascunho.

CIbrowserdc revelou outro problema: o campo de password não apareceu em12s depois de reload no teste de imagemgrande. O artefacto não conserva a captura/trace; não atribuir a causa aRTC,concorrênciaoulease. Melhorar diagnósticos e obter reprodução antes de mudar temporizadores/política de arranque. iOS3f importoua foto, navegou à fototeca e falhouconsulta remota decélulas; as imagensexportadas são anteriores ao picker, não evidência da sua grelha.

A delegação managedFeedback noestúdio suprimia validação local que ocorresse antes de chamar ocontrolador. Foi adicionada onActionError paraapresentar oerro e limparsucessoantigo; ainda precisa detesteUInegativo. Separar alterações e testes: scripts de edição com assert falhado não devem prosseguir para a validação com código inalterado.


## Cobertura por motor e retoma da regressão — 17 de Setembro

Os dois drivers locais site-api-final/go-site-final usavam envgo para uma etapa rotuladaGo; o helper antigo seleccionavaNode. Corrigir a atribuição, preservar os logs e não converter a etiqueta em prova. O runner/helper recusam agora valores desconhecidos e um teste confirma o motor efectivo por API. O novo percursoUI passou emNode eGo com essa confirmação; os CI antigos native-ui também usaram o valorcorrecto native.

O primeiro gate integral do estúdio concluiu410casosNode,409PASS e1FAIL por entrada de tradução«Bloqueado» em falta. Corrigida a entrada, passaram os testes i18n/typecheck/build. A continuação comprova por hash que só mudou essa linha e conserva os outros409resultados. Nunca substituir o relatório originalFAIL por umPASS; registar a correcção e o âmbito preservado separadamente.

A UI Node completa expôs uma fixture legada que guardava um rascunho sem leitores e esperava distribuição pública. O produto inicia esse caso como privado. O teste agora escolhe Público explicitamente e confirma a entrega e a autoria no outro processo. As passagens Node/Go dirigidas e a UI Go32 passaram, sem relaxar a privacidade inicial.

A matriz integral Firefox teve um fecho inesperado deRTC ao pausarrelay, apesar da entrega do SOS próprio e da recusa do conteúdo cancelado. A causa não ficou no trace inicial. Metadados limitados de frames/closeReason foram acrescentados ao teste; cinco repetições, o ficheiro completo e a nova matriz passaram. Registar a ocorrência como não esclarecida; não transformar o passe posterior em prova de uma correcção inexistente. O gate continuou com todas as outras fontes iguais, incluindo WebKit73, nove UI-RNS e pacote Linux. A evidência final indica explicitamente esta observação e a ausência de revisão independente/validação física.

## Tabelas declarativas e revisão dos controlos — 18 de Setembro

FR-038/FR-040: o incremento liga tabelas v2 ao estúdio e aos validadores Node/Go/browser. A conversão imediata de números por tecla perdia a vírgula intermédia; manter texto durante edição e converter em blur/Enter. Trocar o tipo de coluna não pode converter null em texto vazio. Datas/ligações vazias voltam a null. As importações são UTF-8 estrito e validadas antes de substituir; CSV mantém identificadores como001 e JSON preserva tipos.

O teste de importação e depois o do tamanho de página reproduziram nomes acessíveis que incluíam texto das opções. Declarar o nome do select explicitamente e testar por label exacta. Axe passou antes, mas as capturas mostraram botões de44px com texto vertical e o input de ficheiro extra; a disposição móvel passa a usar bases de160px e foi acrescentado um controlo geométrico. Não considerar ausência de violações Axe uma revisão de design completa. Campos inválidos precisam de indicação local e aria-invalid, além de um alerta global.

O primeiro gate terminou138Node, Go sites/app comrace,11interop e4UI por motor nativo sem falhas. Chromium teve34PASS e2FAIL: a fixture multilingue inventara “My page”/“Mi página”, apesar de o catálogo usar “My site”/“Mi sitio”. Corrigir a fixture sem mudar nomes do produto ou aumentar prazos. O relatórioFAIL e os traces são preservados em `.cache/site-data-gate/first`. O gate refined volta a executar Node/UI/browser afectados; os testes Go/interop anteriores só podem ser conservados após comparar hashes. A função exportada validSiteCell conserva o mesmo algoritmo validado anteriormente; a diferença é reutilização na indicação de erro da UI.

Outra revisão comprovou que Intl apresentava0000-02-29 como29/02/1 sem era. O renderer passa a incluir a era nesse ano, com teste de componente. O teste do componente anterior à correcção do select foi preservado em `.cache/site-data-reader-before`. Consultas continuam locais e não alteram dados assinados.

CI35276560255 não passou iOS: startup e seed-synthetic-photo terminaram0, execute-ui-test terminou65. As três capturas funcionais guardadas ainda mostram o setup/teclado. O relatório não permite atribuir a causa ao picker nem provar que o texto foi introduzido. Guardar o resultado real e investigar com evidência suficiente, sem repetir automaticamente a explicação de uma execução anterior.

O suplemento após a matriz108PASS expôs uma perda de edição emFirefox logo depois deguardar: revision15→16,mas o campo regressava a1.25 apósfill1e-. O código restaurava foco noframe seguinte e só detectava pointerdown/keydown. Um controlo com o callback adiado reproduziu a retirada defoco da célula nova antes da correcção. Respeitar input/focusin e recusar reposição quando já existe outro elemento activo; não acrescentar uma espera àfixture para ocultar a corrida. A reprodução e os quatropercursos deeditor passaram três vezes (15PASS), mas a regressãoUI completa ficou novamente emexecução no gateafter-focus. Ocorreu durante automaçãofill; o controlo cobre também mudanças defoco que não começam por teclado/rato, sem afirmar testecom leitor deecrã físico.


A última matriz after-focus teve uma falha Axe WebKit de contraste em.primary: texto branco com base transparente sob um degradê. O controlo de background-color confirmou rgba(0,0,0,0); acrescentar uma base opaca sob o mesmo degradê. A matriz contrast-final passou8UI e108browsers, fontes estáveis. Não ocultar a falha com uma espera ou exclusão Axe. A consolidação respeita typecheck sem stdout: logSHA256null significa sem ficheiro de saída, não criar um log fictício nem repetir o teste.


## Retoma do gate público e confirmação histórica — 18 de Setembro

Após interrupção, o handle3664 e o PID1475015 já não existiam. O relatório RUNNING era apenas estado antigo; conservar cópia e marcar a observação de interrupção sem inventar conclusão. O log continha duas falhas UI. Os traces mostram espera de actionability num contacto e deadline no fim da auditoria multilingue; a repetição dirigida dos três percursos passou sem mudar produto/prazos. Não atribuir a causa a concorrência, RTC ou à nova tabela sem prova.

CI35291208941: Windows/Linux NodePASS, macOS426PASS/1FAIL; restantes jobs não executados. A fixture de admissão ainda recusava qualquer confirmação, embora já existam confirmações históricas válidas. Aguardar a entrega automática reproduziu a falha localmente. Substituir a expectativa obsoleta por controlos mais fortes: ausência antes da admissão, delivery/receipt exactos depois, época/leitores/autoria/cifra correctos, e recusa de receipt legado injectado. Os oito casos Node/Go passaram. Não enfraquecer para simplesmente ignorar confirmações nem consultar um snapshot antigo.


## Recursos opcionais: bloqueio e cópia exacta — 18 de Setembro

A criação fica em stage privado até existir intenção durável; ready só pode seguir uma releitura verificada do ContentStore. Um put bem sucedido não prova a cópia exacta: o teste browser injecta falha após guardar e a retomada conserva assinatura/ID. Repetições não dependem de resolver cartões outra vez. O catálogo autentica o stage historicamente antes de tratar expiração, evitando mascarar corrupção como prazo ultrapassado.

No browser, o resolver de contactos tem de consumir snapshot pré-carregado para evitar reentrada do lockexclusivo. Entre esse snapshot e a cópia um leitor pode ser bloqueado. A cópia verifica o bloqueio dentro da transacção real; a injecção desse interleaving passou no Chromium inicial. O controlo de concorrência também recusou o segundo pedido da mesma sequência. Catálogos Node/Go já passaram morte de processos e SQLite partilhada; 450testesNode completos passaram no gateactual. Restantes gates aindaemcurso. Preservar falhas originais e não transformar inicial7Chromium em matriz3engines.

Nos artefactos iOS, a numeração exportada de PNG não é ordemcronológica. OlogXCTest/exportação e todasascapturas têm de ser lidos juntos. Em1e83db2 há mensagem recebida peloNode e falhaAX dafototeca; os avisosCoreData não demonstramcausa. Não inferir fase a partirdeui-03isolado nem dispensara foto.

O gate concluiu: Go/race também passou (app 495,542s; gate anterior 515,3s), assim como 19 testes de interoperabilidade, 57 casos de browser e 23 percursos UI; 20 relatórios Axe sem violações. A diferença para os 92s de Go normal era esperável na execução com race; não a atribuir a deadlock sem evidência. Não foram interrompidos processos nem aumentados prazos. Os hashes de 628 ficheiros do commit 96e35c1 foram comparados com o relatório. A UI dos recursos permanece pendente.
