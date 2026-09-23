# Acceptance traceability

Owner contract: `PROJECT-BRIEF.md`. “done” applies to the stated behavior with the evidence and limitations below, not to all OS/device variants or overall product completion. Constraints remain ongoing obligations. No requirement is closed by dispatch, a CI configuration, or cross-compilation alone.

| ID | Requirement | Status | Evidence / limits |
| --- | --- | --- | --- |
| FR-001 | Local cryptographic identity and proofs | partial | `tests/core.test.ts`, `tests/native/native-interop.test.ts` — Identidades locais, provas e vectores Node↔Go. |
| FR-002 | Encrypted key vault and native secure storage | partial | `tests/core.test.ts`, `docs/STATUS.md` — Cofres cifrados implementados; keychain nativa em falta. |
| FR-003 | Identity export and recovery | done | `tests/e2e/flows.spec.ts`, `docs/evidence/android/documents-fa1481d3` — Exportação/recuperação no host e SAF Android finalfa1481d3; exportação iOS e restantes fluxos nativos ainda limitados. |
| FR-004 | Signed updates and rotation/revocation limits | partial | `docs/ARCHITECTURE.md`, `docs/REMAINING-SCOPE.md` — Alterações assinadas implementadas; rotação/revogação completa em falta. |
| FR-005 | Separate authorship from reading and seeding | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-006 | One-to-one conversations | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-007 | Group conversations and membership authorization | partial | `docs/GROUP-EVENTS.md`, `docs/GROUP-CARRIERS.md` — Eventos/envio/recibos com gates anteriores. C1 automático passou o gate:253 Node/161 Go-race/47 interop/35 SQLite C/38 UI e desktop Linux;62 Axe sem violações. C2/C3, plataformas actuais e revisão independente pendentes. |
| FR-008 | Text messages and replies | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-009 | Photo attachments | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-010 | Audio and voice recording | partial | `tests/e2e/media.spec.ts`, `docs/MEDIA.md` — Codificador e transporte reais; captura sintética, microfone físico não verificado. |
| FR-011 | Video and file attachments | partial | `tests/e2e/media.spec.ts`, `docs/ANDROID.md`, `docs/IOS.md` — Bytes/renderizadores reais e SAF no APKfa1481d3; fluxos iOS/hardware pendentes. |
| FR-012 | Durable offline outbox | partial | `docs/GROUP-EVENTS.md`, `docs/GROUP-CARRIERS.md` — Eventos/envio/recibos com gates anteriores. C1 automático passou o gate:253 Node/161 Go-race/47 interop/35 SQLite C/38 UI e desktop Linux;62 Axe sem violações. C2/C3, plataformas actuais e revisão independente pendentes. |
| FR-013 | Delivery and expiry states | partial | `docs/GROUP-EVENTS.md`, `docs/GROUP-CARRIERS.md` — Eventos/envio/recibos com gates anteriores. C1 automático passou o gate:253 Node/161 Go-race/47 interop/35 SQLite C/38 UI e desktop Linux;62 Axe sem violações. C2/C3, plataformas actuais e revisão independente pendentes. |
| FR-014 | Message reactions | partial | `docs/GROUP-EVENTS.md`, `tests/group-events.test.ts`, `tests/native/group-events.test.ts`, `tests/e2e/flows.spec.ts` — UI de grupos fixos e APIs por épocas verificadas; integração na UI dinâmica e versões móveis actuais pendentes. |
| FR-015 | Message search | partial | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Pesquisa nos objectos carregados; pesquisa sobre todo o histórico autorizado ainda em falta. |
| FR-016 | Owner-only edit and delete semantics | partial | `docs/GROUP-EVENTS.md`, `tests/group-events.test.ts`, `tests/native/group-events.test.ts`, `tests/e2e/flows.spec.ts` — UI de grupos fixos e APIs por épocas verificadas; integração na UI dinâmica e versões móveis actuais pendentes. |
| FR-017 | Blocking and local moderation/reporting strategy | partial | `tests/security.test.ts`, `tests/native/outbox-network.test.ts`, `docs/OUTBOX-PROTOCOL.md` — Bloqueio/denúncia locais e regras de grupos/recibos/retry testadas; bloqueio pausa retry sem revogar cópias. Cancelamento de pacotes locais em alterações de grupo verificado; gestão dinâmica na UI e restante moderação pendentes. |
| FR-018 | Notifications where supported | partial | `tests/e2e/notifications.spec.ts`, `docs/NOTIFICATIONS.md` — Opt-in e privacidade testados com API substituída; apresentação real OS pendente. |
| FR-019 | Social profiles and following | partial | `tests/e2e/social.spec.ts`, `docs/SOCIAL.md` — Perfil assinado e seguir local; relação pública/seguidores em falta. |
| FR-020 | Social posts and privacy controls | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-021 | Feed and comments/reactions | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-022 | Collections and sharing | partial | `tests/social-integration.test.ts`, `tests/e2e/social.spec.ts` — Colecções locais cifradas e partilha por endereço; colecções partilhadas não implementadas. |
| FR-023 | Capability matrix for every social feature | partial | `docs/SOCIAL.md`, `docs/STATUS.md` — Matriz funcional publicada; auditoria final contínua. |
| FR-024 | Content addressed encrypted chunks and author signed manifests | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-025 | Verification on receipt and before display | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-026 | Peer retrieval and reader seed takeover | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-027 | Pin/unpin quotas and eviction/TTL | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-028 | Bandwidth/battery policy | partial | `tests/transport-hardening.test.ts`, `docs/TRANSPORT.md` — Modo baixo consumo e limites de bytes; consumo físico/bateria não medido. |
| FR-029 | Honest replicated availability/deletion semantics | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-030 | Transport adapter abstraction and real sockets | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-031 | Genuinely different serial transport | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-032 | Multiple-hop routes cross supported media | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-033 | Priority and fair scheduling | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-034 | MTU fragmentation and reassembly | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-035 | Retransmission, TTL/hop limits and duplicates | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-036 | Corruption, replay and abuse controls | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-037 | Bootstrap/discovery and NAT tradeoffs | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-038 | Responsive drag/drop personal site builder | partial | `tests/browser/site-studio.spec.ts`, `tests/e2e/site-studio.spec.ts`, `tests/native/site-studio.test.ts` — Estúdio multipágina/13 blocos/media validado; gate final e controlos de corrupção/autoria/seeder passaram. Evidência: docs/evidence/site-studio; publicação HTTPS validada:17 assets e4 testes; docs/evidence/site-studio/live. Toque físico/revisão independente pendentes. |
| FR-039 | Safe declarative block rendering and keyboard/touch alternatives | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-040 | Signed site publication and offline cached foreign site | partial | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-041 | Emergency health, peers and alert provenance | done | `docs/evidence/verification.json`, `tests/core.test.ts`, `tests/e2e/flows.spec.ts`, `docs/STATUS.md` — Implementação e testes do host; limites de plataforma continuam na matriz STATUS. |
| FR-042 | High contrast, large targets and low-power critical messaging | partial | `docs/evidence/ui`, `docs/SIMULATION.md` — Contraste/texto maior/baixo consumo implementados; leitor de ecrã físico e emergência não validados. |
| UX-001 | Original cohesive typography and spacing | partial | `tests/e2e/flows.spec.ts`, `docs/evidence/ui` — Capturas/axe e browser reais; revisão em hardware e leitor de ecrã pendentes. |
| UX-002 | Responsive light/dark states | partial | `tests/e2e/flows.spec.ts`, `docs/evidence/ui` — Capturas/axe e browser reais; revisão em hardware e leitor de ecrã pendentes. |
| UX-003 | Reduced motion and keyboard/screen reader checks | partial | `tests/e2e/flows.spec.ts`, `docs/evidence/ui` — Capturas/axe e browser reais; revisão em hardware e leitor de ecrã pendentes. |
| UX-004 | Real empty/error/loading/offline states without fake controls | partial | `tests/e2e/flows.spec.ts`, `docs/evidence/ui` — Capturas/axe e browser reais; revisão em hardware e leitor de ecrã pendentes. |
| UX-005 | Real screenshots and accessibility audit | partial | `tests/e2e/flows.spec.ts`, `docs/evidence/ui` — Capturas/axe e browser reais; revisão em hardware e leitor de ecrã pendentes. |
| INT-001 | Evaluate RNS interoperability and licensing | done | `docs/TRANSPORT.md` — RNS/licença avaliados; sem compatibilidade implementada ou alegada. |
| INT-002 | Truth matrix for IP BLE Wi-Fi Direct LoRa serial simulation | done | `docs/TRANSPORT.md`, `docs/STATUS.md` — Matriz distingue TCP, série PTY, rádio físico, BLE/Wi-Fi Direct e simulação. |
| INT-003 | Linux native build and execution | partial | `docs/evidence/desktop`, `docs/DESKTOP.md` — Electron e pacote Linux x64 executados; instalador/release assinada pendentes. |
| INT-004 | Windows build and native execution | partial | `docs/evidence/ios/fde529e/observed-ci.json` — Node Windows e pacote desktop passaram em CI fde529e. Execução gráfica Windows continua não verificada. |
| INT-005 | macOS build and native execution | partial | `docs/evidence/ios/fde529e/observed-ci.json` — Node/macOS e pacote desktop passaram em CI fde529e. Execução gráfica, hardware e assinatura macOS continuam por verificar. |
| INT-006 | Android app build and device/emulator execution | partial | `docs/evidence/android-sqlite/apk-136a5103` — APK136a5103/AAR9e2fb77f passaram82 asserções no único emulador API36x86_64 e verificação SQLite Node. AVD/adb próprios parados; novos grupos não estão nesse APK. ARM64 físico, rádios e novos artefactos pendentes. |
| INT-007 | iOS app build signing and device execution | partial | `docs/evidence/ios/fde529e` — Em274004e houve lançamento real e1 XCUITest falhado na WKWebView; emfde529e a fotografia falhou antes do XCTest. Sem fluxo funcional passado. Pré-arranque separado tem22 testes host/estática, sem compilação/execução Apple nessa alteração. Hardware/assinatura bloqueados. |
| INT-008 | Document mobile background relaying restrictions | done | `docs/ANDROID.md`, `docs/IOS.md` — Relaying apenas em primeiro plano, Stop normal no background; restrições documentadas. |
| ACC-001 | Unit/property/fuzz bounds crypto ACL and addressing tests | done | `tests/core.test.ts`, `tests/transport-hardening.test.ts`, `tests/snapshot.test.ts` — 66 testes Node passados, incluindo limites/corrupção/ACL; Go11core+11transport+17app com race. |
| ACC-002 | Real multi-process A-B-C isolation with positive/negative controls | done | `docs/evidence/heterogeneous.json`, `docs/evidence/native/mixed-tcp.json` — Isolamento de topologia com controlos positivos/negativos; não firewall físico. |
| ACC-003 | Heterogeneous multi-hop payload integrity and route evidence | done | `docs/evidence/heterogeneous.json`, `docs/evidence/native/mixed-serial.json` — TCP→serialport por PTYs reais; bytes/autor preservados. |
| ACC-004 | Offline publisher seeder takeover | done | `docs/evidence/native/mixed-tcp.json`, `docs/ANDROID.md` — Autor termina; outro nó serve novo leitor sem reautoria. |
| ACC-005 | Unauthorized edit/decrypt tamper and replay rejection | done | `tests/core.test.ts`, `tests/security.test.ts`, `tests/native/mixed-network.test.ts` — Falhas de escrita/leitura indevidas, tamper e replay com controlos válidos. |
| ACC-006 | Persistence restart and duplicate flood/churn/partition/heal | done | `tests/transport-hardening.test.ts`, `tests/native/mixed-network.test.ts` — Restart, fragmentação, duplicados, churn e partição/heal reais. |
| ACC-007 | Deterministic bandwidth latency loss asymmetry MTU congestion simulation | done | `tests/simulation.test.ts`, `docs/SIMULATION.md` — Simulação determinística separada; 9 testes e16 controlos de cenário. |
| ACC-008 | Storage exhaustion and low-power simulation | done | `tests/simulation.test.ts`, `docs/SIMULATION.md` — Quotas/low-power virtuais explicitamente separados de hardware. |
| ACC-009 | Mutation controls fail if crypto/routing is broken | done | `tests/simulation.test.ts`, `docs/SIMULATION.md` — Controlos deliberadamente quebrados de routing e verificação detectados. |
| ACC-010 | Real-client UI end-to-end all critical workflows | partial | `docs/evidence/verification.json`, `tests/e2e` — 10 percursos browser Node e10 Go passaram; workflows nativos móveis completos pendentes. |
| ACC-011 | Platform CI build matrix without device-test overclaims | partial | `docs/evidence/ci-c3f5b42.json`, `.github/workflows/ci.yml`, `docs/STATUS.md` — Oito jobs c3f5b42 passaram: Node em três OS, Go/UI, três pacotes desktop e build iOS. Alterações locais posteriores ainda não publicadas; novo gate de execução iOS não observado. |
| ACC-012 | Independent security reliability/design review and fix/rerun | partial | `docs/AGENTS.md`, `docs/NATIVE-REVIEW.md`, `docs/APPLICATION-REVIEW.md`, `docs/RELEASE-REVIEW.md` — Revisões reais, correcções e repetição; auditoria continua no âmbito completo. |
| ACC-013 | Acceptance evidence audit and precise README/STATUS | partial | `docs/STATUS.md`, `.codex-delivery/traceability.md` — Evidência actualizada por requisito; contrato total ainda incompleto. |
| CON-001 | No mandatory central content service or hidden runtime CDN | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-002 | No arbitrary site scripts or HTML execution | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-003 | Use maintained crypto primitives and disclose protocol limits | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-004 | Keep current Astra/Copilot Ultra harness/provider/auth unchanged | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-005 | Real complementary agents and truthful task evidence | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-006 | Work only RelayLoom with explicit file ownership | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-007 | Project-scoped caches and at least 15 GiB free | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-008 | No paid services/root/security changes or unrelated data | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-009 | Small coherent verified commits and authorized non-force pushes | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-010 | No disaster readiness or all-OS claim without evidence | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-011 | No unsafe mobile background policy evasion | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |
| CON-012 | No merge or secret publication | in_progress | `docs/AGENTS.md`, `docs/STATUS.md` — Restrição preservada durante a implementação; obrigação contínua. |


## Private-state integration checkpoint — 2026-09-12

FR-002/FR-012/ACC-006 now also link to `docs/PROFILE-PERSISTENCE.md` and actual Node↔Go CLI/API migration/profile tests:4 cases passed4.359s after rebuilding Go. Data preservation, real process death, exact pending ID, positive restoration and corruption/missing-DB refusal are tested. FR-007 remains partial: group authority and outbox admission have not yet been unified. Full host/UI/desktop regression passed (152 Node,105 top-level Go/race,15 interop,15 UI per engine, Linux desktop); evidence in `docs/evidence/private-profile`. Mobile artifacts and independent review remain outstanding. Complete valid earlier backups remain an explicit undetectable rollback limit.


A facade transaccional Node/Go foi implementada e verificada:81 Node/36.565s,36 Go de topo com race/169.094s (quatro helpers executados pelos drivers),9 interoperabilidade/45.760s; build8.157s e CLI0.901s. Fontes registadas inalteradas durante o gate. Evidência em `docs/evidence/group-transaction`. A aplicação ainda não usa esta facade para grupos dinâmicos.


## Android protected-state compatibility gate

APK136a5103c82c4c87f6865aa2b68daa5eb60796ac4d420aa8f09d5fea5fd4e2a5, com AAR9e2fb77f9938721c9df7ef82df19e357ab02ff0c417ec40061a82e0f27004585:82 asserções no mesmo emulador API36x86_64 (38 SAF36.693s,15 prazo134.729s,16 mensagens15.355s,13 relay18.913s) e inspecção cifrada0.768s passaram. Hash instalado e inputs inalterados; cofre/JSON legado preservados; SQLite Android e binding autenticados pelo Node. Root reviu a captura nativa final. Instrumentação removida, forwards vazios, AVD/adb próprios parados, identidade preservada. Evidência em `docs/evidence/android-sqlite/apk-136a5103`. FR-002/FR-012/ACC-006 receive this additional versioned emulator evidence. Hardware, native keychain and dynamic-group runtime remain incomplete. The screenshot review strengthened the gate and retained the earlier invalid capture; DOM presence alone is not presentation evidence.


## Integração de grupos pela API — gate concluído, produto incompleto

Gate completo: build5.497s;177 testes Node122.851s;118 testes Go de topo com race380.032s (oito helpers omitidos sem fixture e exercitados pelos drivers reais);20 casos de interoperabilidade199.504s; driver C dirigido8.039s;16 UI Node112.105s e16 UI Go106.110s. Desktop Linux: preparação0.239s, execução2.075s, pacote5.377s e execução empacotada0.795s.22 relatórios Axe actualizados sem violações. Fontes inalteradas em todas as fases. Evidência em `docs/evidence/group-runtime/final`. Capturas do editor/social Node e conversa escura Go revistas por root; isto não é revisão independente. Nenhuma nova execução móvel pertence a este gate.

Gestão de épocas está ligada às APIs; admissão/outbox/retenção de conteúdo, carriers P2P automáticos e UI de grupos dinâmicos permanecem pendentes. O objectivo integral continua activo.


## Marco de admissão verificado — 2026-09-13

190 testes Node passaram137.762s;129 testes Go de topo/race396.073s (9 helpers executados pelos drivers de interoperabilidade);24 testes de interoperabilidade219.736s; fronteira SQLite C15.538s;16 UI Node112.941s e16 UI Go103.288s. Build6.072s e CLI0.221s passaram. Desktop Linux: preparação0.224s, execução1.028s, pacote5.347s e execução empacotada0.798s.22 relatórios Axe actualizados, zero violações. Fontes inalteradas em todas as fases. Evidência em docs/evidence/group-content/final.

Reserva/admissão/histórico estão ligados aos dois núcleos. Envio/outbox/carriers/UI dinâmica, artefactos móveis correspondentes e revisão independente permanecem pendentes. O objectivo completo continua activo.


## Liquid Glass — extensão de FR-015,FR-042,UX-001…005,ACC-010/012/013

Fonte sobre f37067f: pesquisa/comandos locais autorizados, navegação real por teclado/toque, preferências/contraste/movimento/transparência reduzidos e UI responsiva.19 E2E Node+19 Go,62 auditorias Axe e desktop Linux passaram no gate final74981 com fontes congeladas; comandos/âmbito/capturas em `docs/evidence/liquid-glass/final` e `docs/LIQUID-GLASS.md`. Mensagem recebida real em320px,6 áreas×6 larguras (320–1440px), rascunho/lock/exclusão de eliminado/privado e preferências efectivas incluídos. Defeitos de contraste/alvos/acesso à outbox reproduzidos e corrigidos.

Estes requisitos continuam **partial** no contrato integral: não há pesquisa integral do arquivo, Android/iOS actuais, teste de leitor de ecrã manual, teclado OS físico nem revisão independente desta alteração. Delegação permanece suspensa por instrução do proprietário. Simulação de media/notificações nos testes existentes não é apresentação/gravação real de cada OS.


## Eventos de grupo — APIs verificadas, contrato incompleto

FR-014/edição/eliminação e contexto de grupos avançaram nas APIs Node/Go: autoria original, intersecção de leitores, histórico mínimo, admissão antes de rede e revalidação de filas/seeding. Controlos reais de3 nós com entrada/remoção, autor offline (porta recusada), seeder e reinício; falhas SQL/índice/corrupção e snapshot de memória testados. Gate83716 e desktop48666 terminaram0:236 Node,153 Go de topo/race,38 interop,SQLite C,19 UI por motor,56 Axe arquivados sem violações,300 fontes inalteradas. Comandos/durações em docs/GROUP-EVENTS.md e docs/evidence/group-events/final. Falhas e correcções preservadas separadamente.

Continuam carriers automáticos, criação/gestão dinâmica na UI, pesquisa integral, keystore/rotação, restantes media/social/templates, notificações reais, plataformas e revisão independente. Nenhuma task nova de agente nem alteração a modelos/bridges/configuração. Produto não concluído.


## Extensão web autónoma autorizada — 2026-09-13

FR-043, INT-009 e ACC-014 estão em implementação segundo WEB-IMPLEMENTATION.md. Todos os requisitos de produto passam a exigir paridade web; os estados históricos done nesta tabela referem-se exclusivamente aos runtimes/data dos testes citados, nunca comprovam paridade no browser. Testes de UI sobre /api do daemon não são execução autónoma.

FR-043/INT-009/ACC-014 têm agora evidência parcial em `docs/evidence/browser-foundation`:16Node e6Chromium, comandos/hashes e fontes estáveis. Cofres/bundles nos dois sentidos com Node/Go, IndexedDB cifrado e DataChannel/seeder reais. Continuam in_progress: nenhuma aplicação autónoma com paridade/UI/rotas/grupos entregue.


## Gate de routing concluído — produto incompleto

`node scripts/verify-browser.mjs --routing` passou22Node transporte/16núcleo/12Chromium e build/typecheck,372fontes estáveis.2novos adversariais e o caminho do reporter foram depois integrados:14Chromium passaram29.652s, fontes de produção inalteradas. Ver docs/evidence/browser-routing. Rede automática entre browsers, consentimento, partição/heal e seeder reiniciado são reais; os2routers TCP provam formato wire comum, não ponte de transporte. A aplicação autónoma/UI/grupos/outbox e toda a matriz de paridade continuam em implementação. Uma falha de abertura RTC em15s não tem causa confirmada apesar dos passes posteriores.


## Integração nativa e gate concluídos — 2026-09-14

WebSocket Node/Go real e ponteRTC/WS/TCP/serialPTY executados com autorização, origem, expiração, revogação, relaysopacos, partição/heal e seeder reiniciado.271Node/89Go de topo-race passaram (2helpers omitidos). Após fixtureAxe e correcção reproduzida de ACKtardio,18browser/21UI por motor/desktopLinux passaram com385fontes estáveis e66Axe sem violações. Prefixo nativo e delta browser provados porhashes, sem repetir testes nativos cujas fontes não mudaram. Comandos/tempos/falhas em docs/evidence/browser-native. Nenhum commit/push, fonteglobal continua incompleta.

Pendente: UIweb seminstalação/facade/worker/domínio completo, peering durável e caminhosforaLoopback, orçamento global/admissão sob carga, C2/C3 adversarial/SQLite/interoperabilidade/Windows, plataformas/hardware/revisão. ISC do coder/websocket confirmada na licença real.


## Marco da aplicação autónoma verificado

`node scripts/verify-autonomous.mjs` terminou0:271Node/26browser/21UI pormotor/desktopLinuxbuild+run+package+run,403fontesestáveis,72Axe semviolações. Evidência docs/evidence/browser-application. SemAPIde daemon no cliente/browser/index.html; worker/IndexedDB/RTC/WS/SW reais. FonteGo não mudou desdepasse89race anterior. Gruposdinâmicos e toda arestanteparidade/gates dehardware/revisão continuam obrigatórios. Previewestáticolocal4174activosessão49020; nenhumcommit/pushnovo.


## Integração sequencial de 2026-09-14

Runtime C2/replay publicado como bb85d1a:269 Node,7 Go/race dirigidos,18 percursos mistos,19 UI por motor,360 fontes estáveis (`docs/evidence/group-notice-runtime`). UI dinâmica consolidada localmente como719a53f:23 UI por motor,70 Axe,desktopLinux executado,364 fontes estáveis (`docs/evidence/dynamic-groups/milestone`); inclui falhas/correcções de rascunho após lock e contador móvel. Fecho de reaberturas SQLite nas fixtures:54d298a,6 testes locais; novo passeWindows pendente.

CI34805308160/bb85d1a falhouWindows (261pass/2fail/1cancel/5skip);Linux/macOS passaram,Go/desktop/iOS skipped. O prazo65s do seeder mantém-se. Novo trabalho de cache de leituras por transacção tem6controlos e medição completa38.261s→21.171s noLinux; gate48594 Node integral/interop integral/UI/desktop emcurso na cópia.cache/p. Não atribuir ainda passeglobal ou Windows.

Paridadewebcontinuaobrigatória e parcial: móduloautónomo local comUIpartilhada/RTC/WS/IndexedDB/worker/SW, mas gruposdinâmicos e restantecontrato aindaabertos. CódigoWS/browser/app e documentação respectiva porconsolidar. Não altera qualquer requisito de plataformas, rádios ou revisãoindependente.


## INT-010 — integração real Reticulum e envio agnóstico

Estado parcial: adaptador RNS1.5.4 real, configuração dedicada, envelopes assinados/cifrados e testes de partição/heal/seeder com origens Node/Go. Gate completo em curso; ver `docs/RETICULUM.md` e `.codex-delivery/RETICULUM-IMPLEMENTATION.md`. Faltam política de trânsito por instalação, peering durável, combinação browser/RNS, embalagem e rádio físico. A avaliação histórica INT-001 não equivale à conclusão desta integração.


## Consolidação browser sobre 5e049f1 — 2026-09-14

A sessão3463 terminou0. Gate `node scripts/verify-autonomous.mjs`:279 Node,26 browser,23 UI por motor e desktop Linux build/run/package/run,442 fontes estáveis. Evidência em docs/evidence/browser-application/milestone. A paridade dinâmica continua obrigatória e pendente. O CI5e049f1 passou Node3SO/Go/RNS/desktop e falhou iOS no fecho do teclado; incremento Apple preservado separadamente. Próximo: rota web autónoma↔Reticulum com controlos/UI, grupos dinâmicos e restante contrato.


## Ponto de integração actual — 2026-09-14

FR-043/INT-009/ACC-014/INT-010: o marco b514ead acrescenta a rota autónoma web → WS → RNS TCP/router → série PTY, envio/resposta pela UI, partição/heal, anexo22 000bytes e seeder reiniciado com autora offline. Gate:26browser/25UI por motor/RNS/desktopLinux. Evidência exacta em docs/evidence/web-reticulum; a paridade completa continua pendente.

FR-001: controlo de chave Ed25519 degenerada falhou em Node e Go antes da correcção. Implementado filtro comum de admissão; controlos dirigidos passaram. Gate integral no candidato.cache/gc em curso, sem passe antecipado. O port de certificados ainda não é um registo de autoridade ou UI de grupos dinâmicos no browser.

A correcção de teclado iOS foi publicada apenas no ramo WIP codex/ios-keyboard-verification, eec2806. CI34902268397 em curso; controlo Python local não compila Swift nem executa iOS. Nenhuma alteração de bridge/configuração/serviços externos ou novo agente.


O gate criptográfico89503 terminou0:457fontes,281Node,Go/race16pacotes,SQLiteC5pacotes,58interop,28browser,50UI,desktopLinux. Evidência docs/evidence/group-certificate-profile. Os certificados estão verificados; autoridade/armazenamento/outbox/UI de grupos no browser continuam pendentes. Nenhum passe de hardware ou iOS foi inferido.


## Matriz Linux e curvas portáveis — 2026-09-15

FR-001/CON-003/FR-043/INT-009/ACC-014/INT-010:30testes browser por engine (Chromium153,Firefox155,WebKit26.6),3percursosUI-RNS por engine,25UI Node/25Go e pacoteLinux passaram. Evidência docs/evidence/browser-matrix. Geração/importação de curvas nativas do WebKit falhou nos controlos; curvasNoble preservamv1 e passaram512ciclos/RFC7748/interop. O fechoRTC anterior fica em aberto, não reclamado como corrigido. Autoridade/outbox/UI de gruposweb,dispositivos/Safari/radios e revisãoindependente continuam pendentes.


## Distribuição web real por HTTPS — 2026-09-15

Extensão web de PROJECT-BRIEF/ACC-010:ff2fb60 acrescenta build público sob /relayloom/,caminhos portáveis,cache por scope e publicação exacta verificada.43testes web locais,50UI nativa,Linux executado;URLHTTPS também testado com dois processos e63 488bytes de anexo exactos. docs/evidence/web-launch e docs/WEB-TWO-DEVICES.md. A paridade de todas as funcionalidades e a execução em dois dispositivos físicos permanecem pendentes; esta distribuição não fecha o contrato.


## Contacto imediatamente utilizável e relay consentido — 2026-09-15

`9abbf20` acrescenta entradas de contactos persistidos com endereço DM definitivo, sem objectos/mensagens fictícios. O teste de resposta perdida reproduziu uma duplicação na primeira candidata e passou após estabilizar endereço e destinatários. A área A rede controla consentimento/pausa e mostra capacidades/ausências reais. 2 oráculos, 55 web, 50 UI Node/Go, Linux e 9 UI-RNS passaram; 3 percursos HTTPS também passaram depois de publicar. Evidência: docs/evidence/contact-relay. Bluetooth, descoberta, hardware, paridade integral e todos os critérios restantes continuam abertos.


## Incremento de conectividade/meios, 2026-09-15 — validação em curso

FR-006/012/013: dois envios previamente pendentes recebem confirmações após sinalização real; cartões não criam ligações automaticamente. Novo diagnóstico de conexão não exporta SDP/endereços/chaves. Teste `tests/browser/connectivity.spec.ts`, gate integral ainda em curso em `.cache/connectivity/gates/report.json`.

FR-030/031/032/034, INT-Reticulum e paridade web: catálogo upstream completo de configurações internas, adaptadores UDP/Backbone/KISS/AX25 exercitados no host e BLE Nordic UART Linux com PTY/GATT simulado. Hardware, outras plataformas e acesso Bluetooth directo web não estão fechados. Resultados e ocorrência de timeout BLE em `.codex-delivery/CONNECTIVITY-MEDIA.md`; guia `docs/RETICULUM-MEDIA.md`. Configuração aceite não equivale a driver testado em rádio.

Fecho do incremento (não do produto), 2026-09-16: gate final web 67+2 e UI-RNS 9 passaram, assim como 3 testes HTTPS e conferência dos 13 ficheiros publicados. Códigos 7d3bceb/359d652, Pages eafa109. Convites abandonados/resultados tardios agora são libertados; perfis e canais abertos preservados. Evidência: docs/evidence/connectivity-media. O caso físico, rádio, iOS e paridade completa permanecem pendentes.


## Setup e idiomas, 2026-09-16

FR-044/045 parcialmente realizados: gate geral345Node/Go-race+SQLiteC/62interop/129browser/60UI/Linux/121candidataweb+2oráculos/9RNS passou. Android57smoke(inclui32reader e3línguas)/38documentos/15prazo/13relay + perfil privado passaram no APKd2dd1ab1. docs/evidence/onboarding-languages e docs/SETUP-LANGUAGES.md. Conteúdo de autoria não traduzido, preferências não alteram cofre/relay. iOS novo somente preparação+estática/22runner noLinux; Apple, dispositivos e revisão independente pendentes. Sem publicação nova nem conclusão integral antecipada.


## Organização de páginas — candidata em verificação

FR-038/FR-040: duplicação/ordem com IDs novos, ligação à própria cópia, início e anexos preservados. 64domínio, Node/Go/3browsers dirigidos,31UI Node+31Go e Linux build/run/package/run passaram; Android25asserções com documento exacto recebido porNode e rascunho recuperado. Matriz integral e gatesAndroidfinais ainda em curso/pendentes. docs/evidence/page-organisation; não encerra sites nem o produto.

FR-045: HTTPS02188da/eff7e9b9 verificado em17assets e10percursosUI, docs/evidence/onboarding-languages/live/final. iOS02188da compilado/startup executado, falha funcional na navegação; correcçãoXCTest e fallbackPT ainda aguardam novoCI.


## Incremento de 17 de Setembro — FR-038/039/040 e FR-005

A correcção de rascunhos grandes está publicada: fonte0c6b58a, distribuição45ecacdf. Foram verificados236testesbrowser/UI,2oráculos,36Axe,Linuxbuild/run/package/run e, depois,17hashesHTTP+13percursosHTTPS. Provas em docs/evidence/private-values. Mantêm-se as limitações de plataforma/revisão independente.

Revisões: certificados interoperáveis e catálogo Node com persistência/cancelamento/expiração/recuperação por processos têm testes locais. Não estão ligados à API/rede/UI nem à persistência Go/browser; não fechar requisitos de endereços permanentes, contribuições ou paridade por estes resultados. O gate do catálogo passou384testesNode eGo sites/core; a correcção posterior de escrita idempotente passou12testes afectados/typecheck. Evidência emdocs/evidence/site-revisions; APIs/transportes/UI e paridade persistente continuam pendentes.

## Incremento 2026-09-17 — catálogo/API browser de sites

FR-038 e FR-040: catálogo de versões, autoria, histórico e recuperação locais implementados em browser; a UI de revisões ainda está em preparação e o estatuto integral continua parcial. CON-002: sites legíveis com snapshot/payload/autoria inválidos recusados antes da admissão e forwarding. INT-009 e ACC-014: seis percursos reais Browser/Node/Go em WebRTC/WebSocket/TCP e matriz consolidada de 66 cenários por engine, com uma correcção de selector de teste e repetição dirigida. Evidência: docs/evidence/browser-site-api. FR-045 continua parcial: idiomas existentes passaram regressão; os controlos novos do histórico ainda não estão integrados. Não há validação de hardware nem revisão independente nova.


## 17 de Setembro — estúdio de publicação versionada

FR-038/FR-040: controlos de histórico, leitores, prazo, versão de partida, idempotência, conflitos e recuperação implementados na UI partilhada. Persistência de contexto e comportamento testados em Node/Go/browser; 32 UI por runtime, 73 por engine, nove UI-RNS e pacote Linux. FR-045: novos controlos testados em EN/ES com texto criado pelo utilizador preservado; a experiência completa mantém estatuto parcial. INT-009/ACC-014: percursos mistos continuam verificados, com uma ocorrência Firefox de fecho do canal ao pausar relay ainda sem causa esclarecida. CON-002: publicação e recuperação continuam limitadas a conteúdo declarativo assinado. Evidência docs/evidence/site-editor-versions e errata site-ui-runtime-correction. Publicação HTML, hardware, contribuições/dados, ficheiros opcionais e revisão independente continuam pendentes.


## Tabelas declarativas — 18 de Setembro de 2026

FR-038/039/040 e CON-002: documento v2 com tabelas, tipos/CSV/JSON/undo, consulta local, assinaturas e seed em Node/Go/browser. Commits09a2422/10f037a, provas emdocs/evidence/site-data:138Node,Go/race,11interop,8UI nativa e108browser. Correcções com falhas preservadas e repetição dos gates afectados. Publicação web ainda pendente; contribuições, opcionais, revisão independente e plataformas físicas continuam em aberto. Não fechar paridade completa por este incremento.


## Publicação das tabelas — 18 de Setembro de 2026

FR-038/039/040: fonte59c9bd1, distribuiçãof6758222, Pages35317766195. Gate público102UI normal+108UI distribuição+1entreprocessos; HTTPS19hashes,15percursos de páginas/tabelas e1entreprocessos com mensagens/anexo/reload offline. Provas emdocs/evidence/site-data/live. A tentativa anterior interrompida e os seus dois timeouts continuam registados; passes seguintes não demonstram a causa original. O contrato completo permanece parcial; ficheiros opcionais/contribuições, revisão independente e hardware/plataformas continuam abertos.

## Criação de recursos opcionais — 18 de Setembro (gate em curso)

FR-038/FR-040, FR-024–027 e CON-002: catálogos persistentes e APIs Node/Go/browser para criar/retomar recursos sem broadcast, com leitura de cópia exacta, audiência, quotas, UUID/sequência e expiração. Inicialmente passaram2percursos Node↔Go,7Chromium e os gates de catálogos descritos no plano. A regressão Node completa passou450testes; os restantes gates estão emcurso. docs/SITE-RESOURCES.md distingue essa implementação de documento v3, obtenção por snapshot e UI ainda pendentes. Sem novoresultado dehardware ourevisãoindependente; a inspiraçãoZeroNet mantém-se parcial. Não considerar biblioteca/API como entrega completa das páginas.

Gate acima concluído: 78cc38c/96e35c1, 450 Node, Go sites/app com race, 19 testes de interoperabilidade, 57 casos de browser e 23 percursos UI de regressão; 20 relatórios Axe sem violações. Os hashes de 628 ficheiros de fonte correspondem ao commit. Provas em docs/evidence/site-optional-resources/creation. FR-038/FR-040 continuam parciais: UI dos recursos, documento v3, contribuições, revisão independente e hardware permanecem no contrato.


FR-038/FR-040/CON-002 — recursos v3 implementados na UI e nos motores; permanecem parciais/em curso. Gate anterior à revisão: 461 Node, 17 pacotes Go/race, 92 interop, 5 SQLite C, 34 UI Node + 34 UI Go, 97 por browser (291), typecheck/builds PASS; 659 hashes estáveis. Provas em docs/evidence/site-optional-resources/v3-ui/pre-review. Testes novos para concorrência de leitura, paletas e URLs em execução contra o produto ainda sem correcções. Não cobre aprovação pós-revisão, distribuição pública, dispositivos físicos ou revisão independente.


## Recursos v3 verificados localmente e integração — 19 de Setembro

FR-038/039/040 continuam parciais. Código8faad72: 306execuçõesbrowser,68UI Node/Go,4unitários,backend porhashes,desktopLinux eRNS8+3UI PASS, comfalhasanteriorespreservadas. Integração do principal1e83db2 altera sótrês fontes de testes/diagnósticoiOS;25host+2estáticospassaram, semexecuçãoApple. Todosos64ficheirosWIPanteriores foram preservados. Provas docs/evidence/site-optional-resources/v3-ui/final e integration. Publicação v3, contribuições, paridade/hardware e revisãoindependente continuamabertos.


## Publicação dos recursos v3 — 21 de Setembro de 2026

FR-038/039/040 e INT-009: fonte runtime 7fdb76a, distribuição 0fdbd1b9; vinte hashes HTTPS, seis percursos de recursos em três browsers e um de mensagens/anexo entre processos independentes passaram. Gate prévio 135 UI normal e 141 distribuição + um entre processos, com proveniência da retoma e falhas anteriores preservadas. Provas em docs/evidence/site-optional-resources/v3-ui/live. Continuam parciais: contribuições/formulários, grupos web, recuperação/rotação, plataformas/hardware actuais e revisão independente. A ausência histórica de candidatos ICE não foi demonstrada como resolvida pelos passes seguintes.


## Desempenho, relay e contrato de contribuições — 21 de Setembro

FR-038/039/040 e INT-009 continuam parciais. Código def424f/5f6a929: gate local 107 WebKit, 2 UI de recursos Node/Go, 33 contratos, Go sites/race e Linux build/run/package/run PASS. Os 12 casos dirigidos por engine e os passes anteriores 104 Chromium/104 Firefox conservam proveniência; oito ficheiros mudaram depois dessas matrizes anteriores. Provas em docs/evidence/site-resource-performance, incluindo falhas antes/depois e página com 123 referências.

995861d contém um contrato autónomo de contribuição assinado e limitado, verificado com 48 vectores e browsers reais. Não implementa ainda envio/aprovação pela aplicação nem fecha contribuições, paridade, plataformas/hardware ou revisão independente. A publicação HTTPS permanece 7fdb76a/0fdbd1b9 até novo gate de distribuição.


FR-038/039/040, continuação v4 local: vínculo declarativo formulário→tabela, cópia com referências, compatibilidade v1-v3 e admissão por revisão assinada passaram 79 testes Node, 24 vectores TS/Go, Go/race, build e seis casos de browser. Provas em docs/evidence/site-contributions/document-v4. Continuam parciais: journal/replay, transporte/inbox, aprovação/reconciliação/proveniência, UI de contribuições e restante contrato. CI35661349213 cobre 0a85d7d, anterior a este incremento; não atribuir-lhe validação de v4. A regressão completa v4 continua pendente.


## Contribuições: consulta e preparação privada — 22 de Setembro

FR-038/039/040 e CON-002 continuam parciais. ac54af4 liga consulta de contexto assinado/cifrado a Node/Go/browser, com dois processos TCP e gates de contexto/worker. b8a8a9e separa submissão/divulgação;6749483 implementa journal e catálogo Node/browser e codec privado Go. 494 Node PASS após corrigir tradução e janela de resultados; build, catálogo nos três browsers, Go sites/race e interop de storage com positivos/negativos PASS. Provas em docs/evidence/site-contributions/authenticated-context e preparation.

Ainda faltam catálogo Go, submissão/transporte/outbox/inbox, aprovação/reconciliação/proveniência, UI e restante contrato integral. O CI35661349213 da fonte anterior0a85d7d passou107browser e todos os jobs excepto iOSseed-synthetic-photo; não abrange os commits novos. A publicação permanece7fdb76a/0fdbd1b9. Nenhuma alegação de todos os dispositivos testados ou prontidão para catástrofes.


## Catálogo Go e envelopes privados — 22 de Setembro

FR-038/039/040, DATA e CON-002 continuam parciais no produto. a1040a7 acrescenta tempos fixos e16dbd6a completa catálogo Go/selagem persistente nos três motores. Gate local500Node,18processos,builds e21 casos por browser PASS; Go core/sites-race,53vectores(18/35),crashes/quotas/corrupção e writerconcorrente têm provas. Ver docs/evidence/site-contributions/envelopes.

Não conclui submissão/outbox/inbox/aprovação/proveniência/UI nem os restantes requisitos. O CI35670707944 testa bd419cb, anterior aos novos commits. Publicação HTTPS permanece7fdb76a/0fdbd1b9; hardware/Apple e revisão independente continuam com as limitações declaradas.


## Submissão privada integrada — 22 de Setembro

FR-038/039/040 e CON-002 permanecem parciais. 5a1921c/07b509e ligam fila privada recuperável e API/transporte Node/Go/browser; inbox ainda só candidatos. Gate505Node,17pacotesGo/race,35processos,49casos porenginePASS. Uma correcção final de cancelamento/expiração apósawait foi reproduzida e passou gate separado16casos porengine/typecheck/build; provas e deltas exactos em docs/evidence/site-contributions/submission. Público7fdb76a/0fdbd1b inalterado. Faltam inbox durável/replay, recuperação de fonte, recibos, aprovação/CAS/reconciliação/proveniência/UI, além dos restantes requisitos de plataformas/rádios/grupos web/rotação e revisão independente. Próxima implementação: CONTRIBUTION-INBOX-NEXT.md.


## Marco de inbox guardado — estado final local

Código **a3e09fd/55b0d4e**, workflow **eb2a5b4**. Gate amplo terminouPASS (514Node/17pacotesGo-race/66processos/60casos porengine). Revisão de quota terminouPASS (20Node,Go app/sites-race,41processos,19casos porengine).732hashes antes/depois e contra o código commitado conferem. Handles13269/44836 e todos os controlos anteriores foram recolhidos; nenhum teste local deste incremento permanece vivo. Provas completas em docs/evidence/site-contributions/inbox, com negativos/positivos e auditoria do erro de teardown.

FR-038/039/040 permanecem parciais: já há inbox durável naAPI, mas faltam obtenção da origem apenas na fila privada, gestão de recusas/purga, recibos assinados, aprovação/reconciliação/CAS/proveniência e UI completa. Candidatas sem fonte continuam limitadas e podem exercer contrapressão; não prometer resistência geral a spam/sybil nem activar a paleta antes da revisão. Todos os restantes requisitos de grupos web, recuperação/rotação/keystore, plataformas/rádios, acessibilidade e revisão independente mantêm-se.

CI2948284 foi cancelado por15min acumulados após505Node+34UI UbuntuPASS; restantesplataformasNodePASS e jobs seguintesSKIPPED. A alteração de organização ainda necessitaCIremoto. Público7fdb76a/0fdbd1b inalterado; não declarar produto concluído.


## Recuperação da origem — gate concluído, 22 de Setembro

593459a/16c5963: cancelamento por IDs locais, prazo absoluto e obtenção explícita da origem na fila privada com relay pausado. 516 Node, 17 pacotes Go/race, 74 casos entre processos, builds e 78 casos por browser PASS; 733 hashes confirmados contra 16c5963. Provas docs/evidence/site-contributions/source-recovery. Não há recibos/decisões/UI completa; continuar CONTRIBUTION-RECEIPTS-NEXT.md. Contrato integral e execução sequencial preservados.

CI35772935519/d0c3b55 falhou só em iOS, watcher com TimeoutError antes da fototeca e sem mensagem confirmada. 3ac8faf repete apenas observações readonly limitadas; 27 host tests PASS, sem repetição Apple. Provas docs/evidence/ci-d0c3b55. Não confundir estes resultados com a falha anterior do selector nem declarar iOS corrigido.


## Descarte privado e autorização de retry — 22 de Setembro

**6e1f530:** o dono pode descartar uma candidata através do comando privado, inclusive quando o visitante está bloqueado ou falta a origem. A revisão evita actuar sobre uma vista desactualizada. Prova e estado terminal mudam no mesmo commit; reenvios não reabrem a candidata e o facto histórico de verificação é preservado. A libertação é da quota lógica da inbox; não apaga cópias na cache/pares. Ainda não é recusa assinada nem fluxo completo na interface.

Passaram 46 testes Node, seis pacotes Go/race (quatro com cache) e 87 casos entre processos. O primeiro gate browser encontrou três falhas WebKit; dois controlos reproduziram uma autorização invalidada por retry idêntico. A correcção preserva a referência em retries iguais, mantendo a invalidação após revogar. A revisão passou **89 casos em cada Chromium/Firefox/WebKit**, com os dois ficheiros alterados e os passes anteriores distinguidos. [Comandos, falhas e provas](../docs/evidence/site-contributions/dismissal). Recibos, aprovação/CAS/reconciliação/proveniência e UI de três contas continuam obrigatórios. HTML público inalterado.



## Certificado de recibo e observação iOS

bf12d51: protocolo privado de recibo do dono,52 vectores Node/portátil/Go e1 caso real por browser PASS, além de typecheck/Go-sites-race. Sem journal/transporte/UI; não é recibo entregue. Provas docs/evidence/site-contributions/receipt-protocol. Continuar persistência e integração antes das decisões/publicação/proveniência e UI de três contas.

CI35786710953/f3f32fc confirmou mensagem privada em iOS e falhou no selector da fotografia visível;27 ficheiros do artefacto conferidos. 1a53620 ajusta apenas o selector XCTest ao AX observado. Verificação local estrutural PASS, Swift/Apple ainda por executar. Provas docs/evidence/ci-f3f32fc. Não reclassificar os passes do commit anterior como validação do selector novo.


## Recibos com persistência recuperável — 23 de Setembro

**f131652:** verificar a origem guarda também a intenção do recibo. Os motores Node/Go/browser persistem assinatura, envelope exacto e indicador de cópia em etapas recuperáveis; os mesmos bytes e prazos sobrevivem a reinícios, descarte e expiração da proposta. Um registo antigo sem prova não recebe confirmação inventada. As preparações têm namespace privado próprio, quotas e limpeza finita, sem transferir autoridade de assinatura a leitores.

Passaram **526 Node, 17 pacotes Go/race, 117 casos entre processos e 97 casos por cada Chromium/Firefox/WebKit**, além de typecheck/builds. Os logs distinguem cache Go de execução nova. O controlo de 129 recibos e perda de resposta prova a limpeza em lotes sem aumentar o limite da transacção browser. [Comandos, hashes e âmbito](../docs/evidence/site-contributions/receipt-persistence).

**Ainda sem entrega automática de recibos ou fecho da fila do visitante por confirmação.** Seguem runtime, recusa assinada, aprovação/CAS/reconciliação/proveniência e UI completa com três contas. O HTML público permanece na versão anterior; todo o contrato de plataformas, rádios, recuperação, grupos web e revisão independente mantém-se.
