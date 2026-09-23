# Estado actual — entrega de recibos verificada, produto incompleto

Fonte426b471, gate finalPASS:531Node,17Go/race,135processos,110porChromium/Firefox/WebKit; typecheck/builds e757hashes verificados. Provas em docs/evidence/site-contributions/receipt-delivery. UIcompleta de contribuições/decisões/proveniência, paridade e restantes requisitos permanecem obrigatórios. CI14457fd falhou apenas em iOSantes do percursofotográfico; browser90+69PASS. Ver STATUS.md/RESUME.md para estado corrente. Relatórios abaixo conservam o histórico de cada versão, sem substituir esta nota.

# Contactos e relay — incremento publicado, 2026-09-15

A web agora apresenta os contactos verificados na lista de conversas e permite autorizar/pausar a retransmissão em A rede. Endereço DM estável e destinatários ordenados evitam duplicar o envio quando a resposta se perde. Código `9abbf20`, publicação `5bc5895…`, Pages `35025782233` com sucesso. 2 oráculos, 55 web, 50 UI Node/Go, Linux, 9 UI-RNS e 3 percursos no URL publicado passaram. Comandos, hashes e falhas corrigidas em docs/evidence/contact-relay.

Bluetooth directo e descoberta automática continuam ausentes. O browser precisa de um perfil desbloqueado e de pares ligados; pode ser suspenso pelo sistema. O produto completo, a paridade integral e a matriz física permanecem por concluir. Nenhum modelo/bridge/configuração ou dado pessoal foi alterado; o trabalho iOS anterior foi preservado.

O restante relatório abaixo é histórico.

# Entrega incremental — web HTTPS, 2026-09-15

A versão web experimental está disponível em https://johnnypbelo.github.io/relayloom/browser/index.html; guia docs/WEB-TWO-DEVICES.md. Código ff2fb60,publicação ec3a3baa,Pages34940021714 success.43testes web locais,50UI Node/Go,desktopLinux e percursoHTTPS real passaram.13ficheiros HTTP com integridade exacta;63 488bytes de anexo entre browsers. Evidência docs/evidence/web-launch.

O produto não está concluído. Dois dispositivos físicos,a paridade integral web,grupos dinâmicos no browser,gate iOS completo,hardware/radios/assinatura/keystores e revisão independente permanecem pendentes. iOSWIP abriu o picker com fotografia visível,mas o selector falhou;main conserva a falha de teclado. O contrato e a recuperação sequencial mantêm-se.

O relatório abaixo é histórico e não substitui STATUS/RESUME actuais.

# In-progress evidence report

Checkpoint de implementação — 2026-09-15: mainf378e13 publicada,90browser/9UI-RNS/50UInativa/desktopLinux no incremento portável e281Node/Go-race/SQLiteC/58interop no gate integral anterior. Há uma observaçãoRTC não explicada, explicitamente aberta. iOSWIP496788b avança após confirmação real do teclado e da mensagem, com selectorFototeca corrigido e novoCIpendente. Autoridade eUI de gruposdinâmicosweb e restante contrato ainda não concluídos. Documentação corrente emREADME/STATUS, evidência emdocs/evidence/browser-matrix, retoma exacta emRESUME.md.

Estado parcial actual: a49e4a4 publicou a aplicação autónoma; b514ead acrescentou o percurso real web/RNS e convites pela UI;2d4d12c corrigiu a fixture de persistência observada no CI. Evidência em docs/evidence/browser-application/milestone,docs/evidence/web-reticulum e docs/evidence/control-envelope-storage. O conjunto criptográfico seguinte ainda corre o gate integral (281Node passaram; restantes etapas pendentes). iOS em ramo WIP/CI próprio, sem passe Apple antecipado. O produto não está concluído e todos os requisitos do proprietário continuam em vigor.

## Progresso: aplicaçãoweb autónoma funcional, ainda incompleta

/browser/index.html já usa UIpartilhada eworker/IndexedDB/RTC/WS, comoutbox/recibos/social/sites ecacheoffline. Gate403fontes passou271Node,26browser,21UI pormotor eexecuçãodo pacoteLinux,72Axe semviolações. Preview local4174activo; evidência docs/evidence/browser-application. Gruposdinâmicos/paridade/plataformas/revisão/assinatura/backupintegral permanecempendentes. FontesGo foramcomparadas comoinalteradas; otestego/race anterior nãofoirepetido nestaetapa. Semnovocommit/push.

## Progresso verificado: adaptador browser/nativo

WebSocket Node/Go, ponteRTC/WS/TCP/serialPTY e autorização/expiração/revogação foram implementados.271Node/89Go de topo-race,18browser,21UI por motor e desktopLinux completo passaram na cadeia documentada;385fontes estáveis/66Axe sem violações.2helpers Go omitidos e falhas/correcções preservadas. Ver docs/evidence/browser-native. Nenhuma conclusão global: UI autónoma/paridade, C2/C3 adversarial/gates restantes, WSS/LAN, plataformas/hardware/keystore/rotação e revisão independente continuam pendentes. Código e evidência locais não commitados.

## Progresso: encaminhamento autónomo no navegador, produto incompleto

Router/Mesh RTC com armazenamento cifrado, inventário/pedidos, consentimento, exclusão entre separadores, prioridades/fairness, cancelamento de fragmentos e retoma por seeder foram implementados. Gate372fontes:22Node transporte+16núcleo+12Chromium, build/typecheck. Após ampliar os controlos e corrigir o destino de reporting,14Chromium passaram juntos29.652s, sem alteração de produção; typecheck final também passou. Evidência em docs/evidence/browser-routing.

Continua por implementar a ponte de transporte browser↔nativo, UI autónoma/worker/PWA e autoridade de grupos/outbox, além de todos os restantes pendentes do contrato. Uma abertura RTC falhou15s antes de medir filas; os passes seguintes não identificaram a causa. Código novo e C2/C3 anteriores preservados localmente, sem commit/push novo. Não é conclusão do produto.

## Progresso adicional: núcleo web autónomo, produto incompleto

O requisito de paridade total sem instalação foi integrado no contrato. `node scripts/verify-browser.mjs` passou16Node+6Chromium e build/typecheck,366fontes estáveis. Cofres/bundles/IndexedDB e WebRTC foram executados realmente; aplicação autónoma/UI/rotas/grupos/outbox/PWA e plataformas continuam pendentes. Evidência em docs/evidence/browser-foundation e matriz docs/WEB.md. Nenhum novo commit/push; alterações prévias C2/C3 preservadas. Não é entrega final do contrato.

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


## Incremento de conectividade/meios — 16 de Setembro de 2026

Produto completo **não concluído**. RNS/meios em `7d3bceb`; web em `359d652`; publicação estática `eafa109…`, Pages `35033701343` success e HTTPS obrigatório. Treze ficheiros conferidos por hash e três testes do URL passaram. Evidência em `docs/evidence/connectivity-media`.

O gate final web passou 67 casos + 2 oráculos e nove percursos UI por Reticulum. O gate RNS e a regressão dos backends passaram; os relatórios distinguem fontes e versões. Reproducer de convite abandonado falhou antes e passou depois. Um episódio de demora BLE durante heal continua sem causa confirmada; os passes seguintes não o apagam.

No IAB real, a cache offline mantinha código antigo após reload. Entrar pela raiz activou o script publicado e preservou o perfil. Não houve observação dos dois dispositivos físicos. Hardware BLE/radios, Bluetooth directo web, incorporação RNS em todos os pacotes, iOS funcional e os restantes requisitos continuam abertos. Nenhum agente novo, modelo/provider/bridge/serviço alterado. RESUME.md contém estado e instruções de continuação.


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


## Entrega de recibos verificada — 23 de Setembro

**426b471:** Node, Go e browser entregam o recibo privado assinado pelo dono e fecham atomicamente a fila do visitante. A confirmação exige vínculo à operação anteriormente copiada; recibos tardios conservam cancelled/expired sem renovar autorização. Cache recebida antes de unlock é recuperada; um recibo autêntico sem história local não fecha RTC nem inventa confirmação. O processamento do dono roda lotes limitados e conserva os mesmos envelopes após quota/retry.

Passaram **531 Node, 17 pacotes Go/race, 135 testes entre processos e 110 casos por cada Chromium/Firefox/WebKit**, além de typecheck/builds. Os controlos incluem falhas de commit, concorrência real, partição/seeder com dono offline, mensagens positivas durante recusa e corrupção. [Provas, comandos e falhas corrigidas](../docs/evidence/site-contributions/receipt-delivery).

**Recepção continua distinta de aprovação/publicação.** Faltam recusa assinada, decisões/CAS/reconciliação/proveniência e a interface completa de contribuições de três contas. Paleta e HTML público ainda no estado anterior. Restantes requisitos de plataformas, rádios, grupos web, recuperação/keystore e revisão independente mantêm-se.

## Persistência de recusa verificada — 23 de Setembro

**627ad6c:** Node, Go e browser guardam a decisão explícita do dono e retiram a prova da proposta no mesmo commit. A revisão da inbox impede decisões sobre uma vista desactualizada. Repetir conserva motivo, destinatário autenticado e prazo; assinatura, envelope e cópia sobrevivem a reinícios. Recibos anteriores e outras preparações mantêm-se intactos.

Passaram **535 testes Node, 17 pacotes Go/race, cobertura de 167 casos entre processos e 120 casos por cada Chromium/Firefox/WebKit**, além dos builds. O primeiro gate teve cinco arranques bloqueados pela reserva de disco; a revisão repetiu os seis casos do ficheiro afectado e manteve a proveniência dos restantes passes, com fontes iguais. O relatório original continua FAIL. [Provas e comandos](../docs/evidence/site-contributions/rejection-storage).

**Ainda sem envio/admissão automática da recusa nem interface completa de revisão.** Seguem transporte/API, incorporação com CAS, reconciliação, proveniência e três contas na UI. O HTML público permanece anterior; todo o contrato de plataformas, rádios, paridade, recuperação e revisão independente continua activo.

## Entrega de recusa e serialização nativa verificadas — 23 de Setembro

**ac77224** liga a recusa assinada à entrega e admissão em Node/Go/browser. A recepção conserva a decisão local de cancelamento/expiração, não apaga recibos anteriores e não reabre filas. Orçamento combinado, seeding opaco, percursos RTC→WS/TCP, recuperação e autorizações revogadas foram verificados. [Provas da entrega](../docs/evidence/site-contributions/rejection-delivery).

**4f309e6** copia sequências ASCII sem escapes em bloco, conservando Unicode/WTF-8/escapes e os bytes válidos; o orçamento global conta também a pontuação final. O controlo de limite falhou antes e passou depois. O microbenchmark local com race mediu cerca de143–148ms antes e5–6ms depois; não é uma promessa de aceleração uniforme. [Oráculos, medições e regressão](../docs/evidence/canonical-performance).

A regressão final passou **540 Node, 17 pacotes Go/race, 185 casos entre processos e 140 por cada Chromium/Firefox/WebKit**, com typecheck/builds e782hashes exactos. Os resultados da versão anterior permanecem ligados à sua própria fonte. O CI remoto anterior d6d4ddb continuaFAIL; o novo resultado remoto ainda precisa de execução.

**O produto permanece incompleto.** Aprovação/incorporação, reconciliação, proveniência e a interface completa de propostas com três contas continuam por concluir, tal como os restantes requisitos do PROJECT-BRIEF. HTML público inalterado, sem nova alegação de hardware, Safari/iOS, paridade integral ou revisão independente.
