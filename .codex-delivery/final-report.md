# In-progress evidence report

The full contract is not complete. See `docs/STATUS.md`, `traceability.md`, `implementation-plan.md` and `docs/REMAINING-SCOPE.md`. This is a checkpoint, not a completed-product delivery.

Latest verified continuation: protected SQLite profile migration and transaction-scoped group authority were committed/pushed through e72af64. That CI passed Node on threeOS, Go and three desktop packages; iOS26.4.1 failed at the required Node peer startup before photo/XCTest. The corrective peer preflight/diagnostics passed19 host cases and awaits new Apple CI.

Actual Android execution caught a SYS_LSTAT/seccomp crash in the pure Go libc after successful compilation. The correction selects maintained C SQLite through Bionic with external extension loading omitted; no protection was disabled.78 host Go/race,16 interoperability and15 UI cases passed with the C backend;18 targeted default-backend cases also passed. The corrected APK136a5103 then passed82 emulator assertions plus authenticated migration inspection, with unchanged installed/source hashes and preserved identity/legacy data. The initial screenshot mismatch is retained: the strengthened gate rejects that unpainted frame, requires actual dialog/backdrop pixels and passed the complete repeat. Root reviewed the final native image. The sole AVD/adb and instrumentation were cleaned up; hardware/radio/ARM64/signing remain unverified.

All required next work remains in RESUME.md and STATUS. Group authority is still a library/facade, without dynamic-group admission/outbox/sync/API/UI integration. Key lifecycle/native keystore, full-history search, richer social/profile/media and independent review of new code remain incomplete. This is a progress checkpoint, not product completion.

## Prior continuation record

Current published HEAD90cb649: CI34687481472 passed Node on Linux/macOS/Windows, the complete Go job and all three desktop packages. iOS26.5 boot/build/install passed but photo-fixture import timed out60.651s before XCUITest; evidence is in `docs/evidence/ios/90cb649`. No application iOS execution is inferred. No bridge/provider/settings changes or new/resumed agents were used in this continuation.

Current uncommitted integration replaces the private JSON runtime journal with the interoperable protected SQLite document and signed per-installation binding. Library/process tests passed; the pending Go application race test was recovered as passed196.134s without repetition. New actual API migration/profile tests passed4/4 in4.359s after rebuilding the Go CLI, including process death, cross-engine recovery, exact pending IDs and corruption/missing-state refusal. The first full Node gate found one obsolete JSON inspection among152 tests; corrected to SQLite. The iOS storage-evidence reader now verifies committed SQLite without legacy fallback and15 host controls passed, alongside the corrected collection case (16 total/4.627s). Gate completo concluído: build/typecheck,152 Node/77.381s,105 testes Go de topo com race/379.168s (cinco helpers omitidos em unitários e executados pelos drivers),15 interoperabilidade/145.127s,15 UI Node/107.327s e15 UI Go/101.522s. Desktop Linux: preparação0.239s, execução0.982s, pacote5.161s, execução empacotada0.766s.22 relatórios Axe actualizados, zero violações. As fontes registadas não mudaram durante o gate. Evidência pública em `docs/evidence/private-profile`; produto, grupos dinâmicos e plataformas móveis continuam incompletos.

Node/Go group certificates, protected storage, authority registry and profile ownership are implemented with separately recorded real gates. Dynamic-group authority/admission/outbox/API/UI integration remains pending: a common SQLite substrate alone does not complete it. The private-state architecture, test scopes and complete-valid-backup rollback limitation are in `docs/PROFILE-PERSISTENCE.md`. Sources/evidence in `.cache/private-integration` must be collected before another run. Older Android/APK and Apple artifacts do not cover new imports.

Remaining implementation includes dynamic group runtime integration, key lifecycle/native secure storage, full-history search, richer profile/social/media/templates/notifications, new native artifacts and independent review of new code. Media capture and browser notifications have explicitly synthetic/stub inputs. Physical radios/devices, real microphones, screen-reader hardware, Apple signing and all-platform releases are not claimed. The complete contract remains active.

## Historical milestone evidence

Earlier milestone sources are committed as `02009dd` (media/collections/history), `4ff3556` (desktop host), `25071d8` (Go core/transport), `48df7df` (Go application), `9ac0a15` (Android), and `2aacb70` (iOS source/build tooling). CI c3f5b42 passed all eight jobs, including actual Apple compilation of device/simulator frameworks and an unsigned simulator app plus25 host Foundation assertions. iOS application execution has not happened.

The later outbox milestone `10bdf48` passed79 Node tests,36 Go application normal/race tests,22 core/transport race tests, two independent mixed outbox cases and14 browser cases per backend. The final modal adjustment passed four outbox cases per backend. The owner's separate sequential stability check then passed one selected browser case once in11.7s, with no new/resumed agents.

After that measurement, Android milestone `f3e747a` packaged the final checker/UI as APK27a71947 and passed38 SAF +15 deadline +16 message +11 relay/seed assertions on the same API36x86_64 emulator. Input and installed hashes were checked; identity retained, emulator/adb stopped. The Linux dev/unpacked package was rebuilt and executed with the final UI, authentication controls and sandbox settings preserved. These are version-specific results, not physical-device or disaster-readiness claims.

All five subsequent milestones were pushed through `3d6641a`. Its run34663513261 passed Node on Windows/macOS/Linux and Go unit/race, but failed the Go-sender mixed outbox expiry/pin invariant; dependent desktop/iOS jobs were skipped. Root reproduced the defect in both engines and added real-journal boundary controls. State, repeated-send and retry controls pass after the correction. Full corrective validation is active and recorded in `.cache/expiry-consistency`; the93-test local Node suite has passed, including11 separate local group-certificate cases. Old APK/desktop artifacts do not include the newer expiry correction. See `docs/OUTBOX-SNAPSHOT-EXPIRY.md`.

At this earlier checkpoint, remaining implementation included dynamic group membership (then only the Node certificate library), key lifecycle/native secure storage, remaining mobile export/notification workflows, full-history search/context, broader templates/social controls and continued platform/review gates. Media capture is synthetic and browser notification tests use stubs. Physical radios/devices, real microphones, Apple signing and all-platform releases are not claimed. Progress remains active and resumable.


## Integração de grupos pela API — gate concluído, produto incompleto

Gate completo: build5.497s;177 testes Node122.851s;118 testes Go de topo com race380.032s (oito helpers omitidos sem fixture e exercitados pelos drivers reais);20 casos de interoperabilidade199.504s; driver C dirigido8.039s;16 UI Node112.105s e16 UI Go106.110s. Desktop Linux: preparação0.239s, execução2.075s, pacote5.377s e execução empacotada0.795s.22 relatórios Axe actualizados sem violações. Fontes inalteradas em todas as fases. Evidência em `docs/evidence/group-runtime/final`. Capturas do editor/social Node e conversa escura Go revistas por root; isto não é revisão independente. Nenhuma nova execução móvel pertence a este gate.

Gestão de épocas está ligada às APIs; admissão/outbox/retenção de conteúdo, carriers P2P automáticos e UI de grupos dinâmicos permanecem pendentes. O objectivo integral continua activo.


## Marco de admissão verificado — 2026-09-13

190 testes Node passaram137.762s;129 testes Go de topo/race396.073s (9 helpers executados pelos drivers de interoperabilidade);24 testes de interoperabilidade219.736s; fronteira SQLite C15.538s;16 UI Node112.941s e16 UI Go103.288s. Build6.072s e CLI0.221s passaram. Desktop Linux: preparação0.224s, execução1.028s, pacote5.347s e execução empacotada0.798s.22 relatórios Axe actualizados, zero violações. Fontes inalteradas em todas as fases. Evidência em docs/evidence/group-content/final.

Reserva/admissão/histórico estão ligados aos dois núcleos. Envio/outbox/carriers/UI dinâmica, artefactos móveis correspondentes e revisão independente permanecem pendentes. O objectivo completo continua activo.


## Marco de criação/envio — gate concluído, produto incompleto

Build5.816s;219 testes Node194.189s;144 testes Go de topo com race507.918s (11 helpers executados pelos drivers);30 casos de interoperabilidade270.997s; fronteira SQLite C115.655s;17 UI Node115.990s e17 UI Go110.472s.22 testes host iOS1.887s e estática0.030s. Desktop Linux: preparação0.233s, execução1.041s, pacote5.812s, execução empacotada0.800s.26 relatórios Axe actualizados, zero violações.277 ficheiros de fonte inalterados durante os gates. Evidência em docs/evidence/group-send/final.

APIs/falhas/mortes verificadas; confirmações automáticas, eventos, carriers, composição/gestão dinâmica e restantes requisitos continuam pendentes. iOS1aaca64 produziu captura real de falha do isolamento antes da WebView; nenhum fluxo funcional passou. A próxima correcção deve preservar a política e provar sintaxe com o compilador WebKit real.


## Confirmações históricas — gate concluído, produto incompleto

Build5.598s;224 Node219.220s;148 testes Go de topo/race548.587s (11 helpers pelos drivers);33 interoperabilidade315.613s;SQLite C143.711s;17 UI Node118.995s e17 Go112.607s;22 host iOS2.319s/estática0.050s. Desktop Linux: build0.230s,execução1.011s,pacote5.055s,execução empacotada0.809s.26 Axe sem violações;284 fontes inalteradas. Evidência em docs/evidence/group-confirmations/final.

Sem agentes novos/retomados. Eventos, carriers, UI dinâmica, artefactos móveis actuais e restantes requisitos continuam abertos. iOS1663cbe provou política/arranque e criação de identidade, mas o formulário de publicação não fechou; os logs estavam no artefacto e foram lidos pelo caminho explícito após a listagem ignorar *.log.


## C1 — gate final concluído, contrato incompleto

Build6.056s;253 Node405.684s;161 Go principais/race711.420s (12 helpers pelos drivers);47 interoperabilidade480.894s;35 SQLite C283.498s;19 UI Node138.097s/19 Go128.687s. Desktop Linux preparação0.319s/execução2.412s/pacote --dir7.260s/execução empacotada1.255s.62 Axe sem violações;326 fontes inalteradas. Sessões83929 e43358 terminaram0. Evidência em docs/evidence/group-carriers/final, falhas em adversarial. Root reviu as capturas; revisão independente e plataformas actuais pendentes. C2/C3 e todo o resto de PROJECT-BRIEF continuam activos; não marcar produto completo.
