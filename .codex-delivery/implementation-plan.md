# Durable implementation plan

## Contactos e relay — marco concluído, contrato integral aberto

Código9abbf20 publicado na web (distribuição5bc5895), com2oráculos,55web,50UI Node/Go,Linux,9UI-RNS e3percursos HTTPS passados. Ver CONTACT-RELAY-UX.md e RESUME.md. Contactos visíveis, endereço DM estável e consentimento/pausa explícitos; não acrescenta Bluetooth ou descoberta. Continuar o resto do contrato.

## Prioridade actual — web em dois dispositivos, 2026-09-15

Executar [WEB-LAUNCH-IMPLEMENTATION.md](WEB-LAUNCH-IMPLEMENTATION.md): build público HTTPS sob /relayloom/,43 testes web locais passados,regressão UI Node/Go/Linux25+25 passada; assets exactos publicados e URL HTTPS verificado. Depois continuar todos os alvos e a paridade de grupos web. O diagnóstico iOS actual é selector da fotografia visível no CI34917778173; não repetir a falha antiga como se fosse a última. Estados “em curso” abaixo são históricos e não substituem RESUME/STATUS.

## Extensão activa — RNS real e envio agnóstico

INT-010 / PROJECT-BRIEF2026-09-14: integração em.adapters/reticulum e packages/transport/src/reticulum.ts, com perfil/identidade de transporte separados. Testes dirigidos passaram;gate completo em.cache/rn sobreb15b6e6 em curso. Concluircorrecções/regressão/commit;seguir política deconsentimentoRNSporinstalação,peeringdurável,interopweb e dispositivos/rádios. A paridadeweb e todoocontrato anterior continuam obrigatórios. VerRETICULUM-IMPLEMENTATION.md eRESUME.md.

## Extensão activa — W1–W5: web sem instalação

O proprietário acrescentou paridade de TODAS as funcionalidades na web autónoma. Executar [WEB-IMPLEMENTATION.md](WEB-IMPLEMENTATION.md), mantendo todos os pendentes C2/C3, plataformas e auditorias anteriores. Não confundir apps/web com nó P2P no navegador.

Full owner contract: PROJECT-BRIEF.md. Work continues through these phases; a phase is not product completion.

- [x] P0: Read contract, inspect clean repository/resources, preserve harness and scope.
- [x] P0: Create complementary child tasks, preserve initial failures and require real returned code/review/test results. Delegation recovered and results are recorded in docs/AGENTS.md.
- [x] P1: Crypto identity/vault, encrypted content store, real local node API and polished connected UI. Unit and smoke gates; milestone commit/push.
- [x] P2: TCP and serial PTY transports, bounded routing/retry/priority, real 3-process heterogeneous tests, partition/heal, seed takeover.
- [ ] P3: Messaging, groups/attachments, social relationships/posts/comments/reactions/collections, safe profile builder. API/e2e negative controls.
- [ ] P4: Deterministic adverse-link simulation + mutation controls, persistence/abuse/security/reliability review.
- [ ] P5: Responsive light/dark/reduced-motion UI, keyboard/touch and accessibility tests, real screenshots, independent review if harness available.
- [ ] P6: Platform builds/CI/packaging; record exact physical radio, mobile background and Apple hardware/signing blockers. No cross-compile-to-device claim.
- [ ] P7: Contract-by-contract audit, docs/STATUS and README, fixes/reruns, clean coherent pushes.

## Active integration checkpoint — 2026-09-12

Sequential recovery at bff00cc: access policy, durable ledger and authenticated group-management APIs are implemented locally in both engines. Directed mixed HTTP/restart/consent/reentry/rejection controls passed4 cases5.684s; the complete source-frozen host/interop/UI/desktop gate passed; exact results are in `docs/evidence/group-runtime/final`. No new/resumed agents. The next implementation is admission/outbox/retention, then control-carrier synchronization, dynamic-message UI and their full network/device gates. No platform or dynamic-message completion claim. See `RESUME.md` and `docs/GROUP-RUNTIME.md` for current state. The earlier private-state migration and facade gates are complete; historical counts retain their version scope.

## Previous checkpoint — 2026-09-12

- Public main and origin remain at c3f5b42; its eight CI jobs passed, including three Node platforms, Go, desktop packages and actual Apple compilation. Later source is committed as outbox10bdf48, iOS runner4913ef4, Androidf3e747a and design-only groupse1d17d0; new CI results must still be observed after push.
- Node/Go outbox: encrypted durable intents, finite idempotency, per-recipient delivery/read facts, expiry and restart retry with relay-for-others disabled are implemented. Latest broad results: 79 Node tests, 36 Go application tests normal/race, 11 core + 11 transport race, two independent mixed-process outbox cases, 14 browser cases on each backend. Later modal-feedback correction passed four outbox cases on each backend. These are prior runs, not newly launched sequential checks.
- Desktop: Linux sandboxed dev and unpacked executable passed with reachable loopback positive/negative network controls. Latest small shared-UI changes still require packaging again before claiming that package contains them.
- Android: final APK `27a71947…` includes the elapsed-deadline checker and final shared UI. All 80 assertions passed once across SAF, deadline, message and relay gates; installed hashes matched before/after. Host policy/session assertions also passed. The AVD and isolated adb were stopped and retained. No physical-device, microphone or OS-notification claim follows.
- iOS: c3f5b42 built device/simulator frameworks and an unsigned simulator app on Xcode26.6; 25 Foundation host assertions passed. A real simulator runner/XCUITest was delivered and integrated into the local workflow, with 11 host-only runner checks. Its Apple execution has not happened. Device signing/hardware remain blocked on external capabilities.
- Dynamic groups: `docs/GROUP-EPOCHS.md` and declarative fixtures are a proposed contract, not implementation or executed cryptographic/network tests.

## Immediate execution sequence

1. Temporary sequential check completed: all active agents returned, no new/resumed tasks, exactly one selected browser case passed in 11.7 s without retries. See `SEQUENTIAL-CHECK.md` and its retained result/output/screenshots. No further gates or push/CI belong to this measurement. The result does not establish the cause of upstream 408s.
2. After the completed measurement, coherent outbox/mobile/runner commits and final Android package/gates are complete. Push normally and observe actual Apple simulator execution; rebuild desktop for the final UI. Preserve each earlier version's evidence boundaries.
3. Implement authenticated group membership epochs with explicit future-only semantics, signed cross-runtime vectors and adversarial real network/UI gates; no promise to revoke delivered keys or erase peer copies.
4. Complete remaining mobile document/export and actual generic notifications; reuse the same Android AVD. Add ARM64 builds without downloading another image. Attempt iOS compilation/execution only through genuine Apple runners/tooling.
5. Extend profile/social templates and moderation controls, review key recovery/rotation, and continue full contract audit. Keep unsupported physical radios, Apple signing and hardware tests explicit.

`docs/REMAINING-SCOPE.md` maps concrete gaps from source. This sequence advances the complete contract; it does not redefine completion as the current baseline. Each agent keeps explicit ownership and must return actual results.


A facade transaccional Node/Go foi implementada e verificada:81 Node/36.565s,36 Go de topo com race/169.094s (quatro helpers executados pelos drivers),9 interoperabilidade/45.760s; build8.157s e CLI0.901s. Fontes registadas inalteradas durante o gate. Evidência em `docs/evidence/group-transaction`. A aplicação ainda não usa esta facade para grupos dinâmicos.


## Iteração activa — autoridade da outbox, 2026-09-13

Base publicada fde529e. Integração Node/Go local: paragens no commit de autoridade, mirror não autoritativo, guarda na abertura/retry, retiro conjunto, união de reservas, cancelamento local em todos os adaptadores e controlo de inventário/pedidos do autor. A interface já apresenta pausa/interrupção e desactiva retry não autorizado; teste real dirigido dos dois núcleos e Axe desktop/móvel passou. As fixtures instalam bundle/intenção, por isso composição/envio dinâmico e carriers continuam tarefas seguintes.

Regressão completa sequencial em .cache/group-outbox-final/run.py (relatório/source-hashes no mesmo directório), depois desktop.py. Não modificar fontes enquanto corre. Não criar/retomar agentes. Não repetir gates concluídos por perda de handles. Só publicar após os gates aplicáveis passarem e os resultados serem arquivados; conservar falhas e limitações.

Depois deste marco, substituir os bloqueios temporários de envio por publicação/outbox real a partir de snapshots/targets, UUID novo com audiência revista, confirmações históricas mínimas, partições e alterações de membros; seguir com carriers e interface de grupos e o resto de PROJECT-BRIEF.md. Não encerrar o objectivo nesta infra-estrutura.


## Criação/envio real em validação — 2026-09-13

FR-007/FR-012: APIs Node/Go criam mensagens/anexos/replies com snapshot/head e audiência exacta. Admissão/intenção partilham commit; reserva e ready precedem rede. Falhas/mortes reais/Unicode e compatibilidade antiga verificadas; gate completo .cache/group-send-final em curso com fontes congeladas. Confirmar relatório antes de novo código/commit. Depois integrar confirmações segundo GROUP-CONFIRMATIONS-INTEGRATION.md, eventos, partições, carriers e UI dinâmica. O contrato integral mantém-se.


## Marco de criação/envio — gate concluído, produto incompleto

Build5.816s;219 testes Node194.189s;144 testes Go de topo com race507.918s (11 helpers executados pelos drivers);30 casos de interoperabilidade270.997s; fronteira SQLite C115.655s;17 UI Node115.990s e17 UI Go110.472s.22 testes host iOS1.887s e estática0.030s. Desktop Linux: preparação0.233s, execução1.041s, pacote5.812s, execução empacotada0.800s.26 relatórios Axe actualizados, zero violações.277 ficheiros de fonte inalterados durante os gates. Evidência em docs/evidence/group-send/final.

APIs/falhas/mortes verificadas; confirmações automáticas, eventos, carriers, composição/gestão dinâmica e restantes requisitos continuam pendentes. iOS1aaca64 produziu captura real de falha do isolamento antes da WebView; nenhum fluxo funcional passou. A próxima correcção deve preservar a política e provar sintaxe com o compilador WebKit real.


## Confirmações históricas — gate concluído, produto incompleto

Build5.598s;224 Node219.220s;148 testes Go de topo/race548.587s (11 helpers pelos drivers);33 interoperabilidade315.613s;SQLite C143.711s;17 UI Node118.995s e17 Go112.607s;22 host iOS2.319s/estática0.050s. Desktop Linux: build0.230s,execução1.011s,pacote5.055s,execução empacotada0.809s.26 Axe sem violações;284 fontes inalteradas. Evidência em docs/evidence/group-confirmations/final.

Sem agentes novos/retomados. Eventos, carriers, UI dinâmica, artefactos móveis actuais e restantes requisitos continuam abertos. iOS1663cbe provou política/arranque e criação de identidade, mas o formulário de publicação não fechou; os logs estavam no artefacto e foram lidos pelo caminho explícito após a listagem ignorar *.log.


## Liquid Glass funcional — marco de interface,2026-09-13

Pedido do proprietário priorizou UI/UX sem cancelar o contrato. Implementados material CSS com fallback, preferências, pesquisa/comandos autorizados com teclado/lock, barra móvel, conversa compacta e controlos44px. Gate final74981 terminou0:19 Node142.211s/19 Go127.734s,62 Axe sem violações e desktop Linux compilado/executado/empacotado/executado,289 fontes inalteradas. `docs/LIQUID-GLASS.md` e `docs/evidence/liquid-glass/final` guardam comandos/fontes/âmbito/falhas corrigidas. Nenhum novo agente/modelo/provider/bridge alterado; recuperação sequencial mantida.

P3/P5/P6/P7 permanecem abertos. Seguem eventos/carriers e composição/gestão dinâmica com audiências verificadas; pesquisa integral, keystore/rotação, social/media/templates/notificações e gates móveis/revisão independente. iOS f370 passou arranque mas excedeu60.306s na fotografia; não chegou ao fluxo funcional. Não fechar o objectivo por este marco.


## Eventos de grupo — APIs verificadas, contrato incompleto

FR-014/edição/eliminação e contexto de grupos avançaram nas APIs Node/Go: autoria original, intersecção de leitores, histórico mínimo, admissão antes de rede e revalidação de filas/seeding. Controlos reais de3 nós com entrada/remoção, autor offline (porta recusada), seeder e reinício; falhas SQL/índice/corrupção e snapshot de memória testados. Gate83716 e desktop48666 terminaram0:236 Node,153 Go de topo/race,38 interop,SQLite C,19 UI por motor,56 Axe arquivados sem violações,300 fontes inalteradas. Comandos/durações em docs/GROUP-EVENTS.md e docs/evidence/group-events/final. Falhas e correcções preservadas separadamente.

Continuam carriers automáticos, criação/gestão dinâmica na UI, pesquisa integral, keystore/rotação, restantes media/social/templates, notificações reais, plataformas e revisão independente. Nenhuma task nova de agente nem alteração a modelos/bridges/configuração. Produto não concluído.


## C1 — gate final concluído, contrato incompleto

Build6.056s;253 Node405.684s;161 Go principais/race711.420s (12 helpers pelos drivers);47 interoperabilidade480.894s;35 SQLite C283.498s;19 UI Node138.097s/19 Go128.687s. Desktop Linux preparação0.319s/execução2.412s/pacote --dir7.260s/execução empacotada1.255s.62 Axe sem violações;326 fontes inalteradas. Sessões83929 e43358 terminaram0. Evidência em docs/evidence/group-carriers/final, falhas em adversarial. Root reviu as capturas; revisão independente e plataformas actuais pendentes. C2/C3 e todo o resto de PROJECT-BRIEF continuam activos; não marcar produto completo.


## Marco da aplicação autónoma verificado

`node scripts/verify-autonomous.mjs` terminou0:271Node/26browser/21UI pormotor/desktopLinuxbuild+run+package+run,403fontesestáveis,72Axe semviolações. Evidência docs/evidence/browser-application. SemAPIde daemon no cliente/browser/index.html; worker/IndexedDB/RTC/WS/SW reais. FonteGo não mudou desdepasse89race anterior. Gruposdinâmicos e toda arestanteparidade/gates dehardware/revisão continuam obrigatórios. Previewestáticolocal4174activosessão49020; nenhumcommit/pushnovo.


## Conectividade e meios, 2026-09-15

Milestone activo documentado em CONNECTIVITY-MEDIA.md: corrigir mistura de códigos entre papéis e acompanhar ligação nas duas pontas; preservar duas outboxes pendentes; expandir interfaces internas Reticulum e adaptar BLE Nordic UART no Linux; executar gates sequenciais, rever e publicar web depois de passar. Contrato completo continua aberto. Não activar novos agentes durante recuperação sequencial. Bloqueios: estado dos dois dispositivos do proprietário ainda não observado; hardware rádio/GATT real, paridade web e restantes plataformas continuam pendentes.


## Estúdio de sites — incremento de 16 de Setembro de 2026

FR-038/039/040: estúdio multipágina, composição aninhada, imagens, Markdown seguro, modelos, importação/exportação e rascunho cifrado implementados em Node/Go/web. Fonte e limites em docs/SITE-STUDIO.md; evidência local/registo em .codex-delivery/SITE-STUDIO.md. O gate68777 terminou com a corrida de diagnóstico RTC documentada. O gate final43274 passou com build explícito e hashes dos assets. A publicação86cb0c3 da fonte11d52be passou17 hashes HTTP e4 testes no URL. O estudo de ZeroNet não implica execução de scripts, compatibilidade de protocolo nem disponibiliza já permissões para contribuidores.

Concluídos: UI Node/Go/desktop, public-web, Reticulum, revisão das capturas, evidência sanitizada, fonte e publicação exacta com testes HTTPS. O suplemento built-browser-final não foi necessário: verify-publish-final.mjs reconstruiu antes da matriz completa. Conferir .cache/site-studio/post-push.json/git antes de repetir entrega. UIKit/XCTest WIP continua separado. Não fechar P3/P5/P6/P7 ou o contrato integral.

Depois deste marco, priorizar liberdade funcional dos sites (endereços/revisões estáveis, módulos de dados e contribuições assinadas com permissões e orçamentos), sem misturar autoria e leitura. Estes itens são trabalho pendente, não compromissos implementados por este documento. Continuam também paridade de grupos web, backup/rotação/keystore, embalagem de meios em todas as apps, dispositivos/rádios físicos e revisão independente.


## Setup/idiomas — gates Linux e Android concluídos

FR-044/045: apresentação/configuração guiada,1031entradas emPT/EN/ES, preferências perfil/browser e separação de conteúdo de autoria implementadas. Gate geral completo PASS; Android finald2dd1ab1 executado com57smoke/38documentos/15prazo/13relay e perfil cifrado autenticado. Evidência docs/evidence/onboarding-languages. iOS nativo/XCTest é uma candidata ainda por compilar/executar emApple; manter WIP e limites. Guardar marcos separados de backend/UI/Android e branch de integração Apple; publicar só assets exactos do gate público. Antes de repetir gate, conservar o relatório anterior. Continuar depois sites: endereços/revisões, permissões de contribuição assinada e ficheiros opcionais. Todos os restantes requisitos mantêm-se.

## 2026-09-17 — catálogo/API browser de sites verificados

Concluída a integração local de IndexedDB, runtime serial, site-command e validação/relay na aplicação browser. A matriz consolidada tem 66 cenários por motor (198 engine/cenário), depois da correcção dirigida de dois selectores de estado num teste; as restantes fontes e os assets mantiveram os hashes. Inclui seis percursos reais Browser/Node/Go em três meios e o worker compilado. Evidência docs/evidence/browser-site-api. Não é conclusão do contrato nem publicação no HTML.

Seguinte: contexto durável do rascunho e controlador de publicação/histórico/recuperação no estúdio. Candidata isolada em .cache/browser-site-parity: modelo/validação e persistência do contexto em três runtimes, componente de histórico com API real e PT/EN/ES, ainda sem ligação ao estúdio. Dois testes TypeScript, um teste Go de contexto e typecheck passaram; APIs de persistência/contexto, UI, acessibilidade, os fluxos de resposta perdida e todos os gates dessa candidata ainda pendentes. Não misturar os resultados da candidata com o marco browser validado do principal.


## 17 de Setembro — estúdio integrado, gate local terminado

O gate local do estúdio foi concluído e recolhido. Consultar docs/evidence/site-editor-versions: 410 casos Node com correcção isolada de tradução, Go/race, 69interop, SQLite C, 32UI Node e32UI Go efectivos, 219browser, nove UI-RNS, 24hostiOS/static e Linuxbuild/run/package/run. Mantém-se aberta a causa de um fecho intermitente de ligação Firefox na pausa de relay; repetições diagnosticadas passaram, sem correcção de transporte demonstrada. Não usar o resultado como prontidão para catástrofes.

Seguinte: validar a distribuição pública com site-publication/site-worker agora incluídos, conferir o commit e os hashes dos assets, publicar HTML experimental com os limites descritos e verificar no HTTPS. Continuar depois contribuições/dados declarativos/ficheiros opcionais, grupos dinâmicos web, backup/rotação/keystore, meios e hardware/plataformas e revisão independente. Manter execução sequencial e preservar os dados/WIP do projecto.


## Recursos opcionais — criação persistente verificada, 18 de Setembro

Os catálogos e a criação nos três motores estão verificados localmente em 78cc38c/96e35c1. Provas em docs/evidence/site-optional-resources/creation.

Próximo: documento v3 e API que extrai a referência de um snapshot autenticado; biblioteca de recursos, ficheiros e tabelas na UI; testes UI de disponibilidade, pedido explícito, autor offline, partição e privacidade. Depois continuar contribuições/formulários assinados, grupos web dinâmicos, recuperação/rotação/keystore, plataformas/rádios e revisão independente. O objectivo integral mantém-se activo.


## Recursos v3 — revisão antes da entrega

Documento v3, referência autenticada e biblioteca/leitor já implementados. Gate integral vivo52729; manter fontes estáveis. Após terminar: reproduzir pedidos sobrepostos, as seis combinações de paleta/app no leitor e associação transitória de URL/ficheiro; corrigir e repetir o âmbito afectado. Rascunho dos testes guardado em `.cache/resource-review-ui.spec.ts`, ainda não executado. Depois curar provas, desktop/RNS, integração preservando iOS1e83db2, publicação exacta/HTTPS. Contribuições/formulários assinados e todo o contrato seguinte mantêm-se obrigatórios.


## Recurso v3 publicado; contribuições assinadas a seguir — 21 de Setembro

Publicação exacta 0fdbd1b9 da fonte runtime7fdb76a: 20 hashes HTTPS, seis UI de recursos e um entre processos PASS. O gate de distribuição 141+1 passou após preservar a tentativa com ICE sem candidatos; causa histórica ainda não resolvida. A documentação/provas/harness podem ser commitados localmente; adiar o push até CI35618030583 terminar para não o cancelar.

Próxima implementação: formulários declarativos e propostas assinadas pelo visitante, com regras de contribuidores e audiência explícitas; aprovação/rejeição pelo dono sem transferir autoria, replay limitado/persistente, reconciliação de base/esquema e contribuição privada sem promoção involuntária. Protocolos TS/Go, UI/runtime nos três motores e percursos reais de três contas são obrigatórios. A fase não substitui grupos web dinâmicos, backup/rotação/keystore, apps móveis e hardware/meios, nem revisão independente. Manter trabalho sequencial e limites de armazenamento.


## Gate das correcções concluído — 21 de Setembro

Handle 29159 terminou com código 0: typecheck, 33 contratos, Go sites/race, build, 107 WebKit, recursos UI Node/Go e pacote Linux executado. Curadoria em docs/evidence/site-resource-performance. Não repetir este gate sem novas alterações ou falha que o justifique. Chromium/Firefox completos anteriores mantêm fonte própria e os 12 casos dirigidos por engine cobrem a alteração final.

Enviar os marcos separados e verificar o CI; depois integrar documento v4, contexto autenticado, journal privado/replay, inbox e aprovação, proveniência e UI PT/EN/ES com três contas reais. A versão pública só recebe artefactos exactos validados. Toda a cobertura de grupos web, recuperação/rotação/keystore, plataformas/meios, hardware e revisão independente mantém-se.


A fundação do documento v4 foi implementada depois desse push: esquema ligado a tabela, cópias com referências e fronteiras de assinatura em Node/Go/browser. Gate delimitado com 79 testes Node, 24 vectores, Go/race, build e seis casos de browser PASS. Próxima fase: contexto autenticado da API e journal privado/replay, depois inbox/aprovação/proveniência e UI real. CI35661349213 está em curso para 0a85d7d; preservar essa execução e o HTML público actual. A regressão completa v4 continua pendente.


## Preparação privada concluída como módulo, integração continua

Gate76653 terminado0:494Node,build ecatálogoFirefox/WebKit;ChromiumdirigidoPASS. Registos ecomandos emdocs/evidence/site-contributions/preparation. Não repetir a suite por desconhecer umhandle; as fontes estão commitadas em6749483. Próximo trabalho concreto: portar contribution-operations/contribution-catalog paraGo e testar a mesmaSQLite nas duasdirecções com crashes/quotas/corrupção; depois ligar preparação/submissão àAPI com contexto autenticado, envelope/outbox/inbox, aprovação/proveniência eUI.

O CI anterior0a85d7d acabou com falha só na importação de fotografia iOS, antes do percursofuncional. Novo push normal pode agora arrancar sem cancelar esseCI. Confirmar origin/run depois de enviar o novo marco. O HTML público mantém a distribuição verificada existente; não publicar WIP nem inferir que gates antigos cobrem novosbytes.
