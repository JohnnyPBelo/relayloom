# RelayLoom — retoma após catálogo Go e envelopes, 22 de Setembro de 2026

**Objectivo integral activo. O produto não está concluído.** Manter PROJECT-BRIEF.md: messenger/social P2P cifrado, sites expressivos inspirados no ZeroNet, Windows/Android/macOS/iOS/Linux e web autónoma com paridade, Reticulum/meios agnósticos, setup, PT/EN/ES e Liquid Glass. Só este projecto. Manter Astra/Copilot Ultra e recuperação sequencial: **não criar nem retomar agentes**. Não alterar modelos/providers/bridges, autenticação, permissões, serviços ou outros projectos. Checkpoint extra de manutenção cancelado.

## Onde continuar e o que preservar

- Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`.
- Principal: `/home/absint0o/projects/relayloom`, branch `codex/setup-languages`, HEAD1e83db22ff9b7b9a65a400601b891312a3188960. WIP histórico separado e preservado. Nunca git add -A, reset, force-push ou merge de PR sem aprovação.
- Origin estava **bd419cb308fb6e4d043842e11bb14d6975676701**. Novos commits locais: **a1040a7** tempos fixos e **16dbd6a** catálogo Go/envelopes. Consultar git log/status e a nota final para o commit posterior de provas/documentação e eventual push.
- Capturas/JSON antigos e symlink node_modules continuam como WIP; não incluir indiscriminadamente. Fontes deste incremento estão commitadas e coincidem com os hashes testados.
- Reserva obrigatória **15GiB**; última leitura cerca de15,6GiB. Revalidar antes de cada gate pesado. Dependências/caches no projecto; uma execução pesada local de cada vez.

## Implementação existente — não repetir a portabilidade Go

O documento v4 e a consulta `contribution-command/form` já estão em Node/Go/browser: apenas snapshotId/pageId/formId, contexto extraído da cópia assinada/cifrada, campos/tabela/revisão/audiência do mesmo documento, política de visitante/bloqueio/retirada/prazo/sessão. A resposta não é uma capacidade de autorização para futuras assinaturas. A paleta de formulários permanece oculta.

Submissão privada e concessão de publicação são verificações distintas. `verifyForSubmission` usa o contexto original; `verifyPublicationScope` verifica a audiência proposta sem aprovar/publicar/CAS. `verifyForForm` mantém a composição anterior. Uma concessão pública não torna público o envelope da proposta.

**Os três catálogos estão implementados**: intenção+snapshot guardados antes de assinar; assinatura noutro commit; `seal` guarda envelope exacto num terceiro passo privado. Node↔Go retomam a mesma SQLite e preservam certificados/bytes. O namespace contribution é derivado da posse da chave de assinatura e tem AAD próprio; ler/semear não concede autoria.128resultados/1MiB, uma preparação activa, contador monotónico e janela contígua; prepared/signed/cancelled/expired. O formato de stage antigo sem envelope continua legível.

`createBundleAt` em Node/browser mantém criação/expiração escolhidas pela intenção, como o helper Go existente. A função normal mantém o relógio normal. Tempo fixo não faz nonce determinístico: só um envelope realmente commitado é recuperado com os mesmos bytes. Antes do commit, nenhum ID/envelope sai do catálogo. Corrupção do envelope retido é recusada sem gerar outro. `authorizedBundle` revalida política/prazo e não envia.

O envelope exige tipo site-contribution, autor visitante, leitores exactos visitante+dono (uma identidade se coincidem), manifest.publicKey=null e tempos iguais ao certificado. Os helpers internos não foram acrescentados à whitelist RPC.

**Ainda não há API de submissão, cópia para transporte/outbox/inbox, recibos, aprovação/rejeição/reconciliação CAS, proveniência de linhas ou UI completa de propostas.** Selado não significa enviado/entregue/aprovado. Não activar a paleta sem o fluxo funcional.

## Gates concluídos e provas

**Nenhum teste local deste incremento está em curso.** Handle6285 terminou/recolhido0. Todos os handles anteriores (incluindo94269 Go-race,95440 concorrência e74342 limpeza delimitada) foram recolhidos. Não reiniciar por falta de handle.

- `.cache/contribution-go-envelope-final/report.json`: **500 Node PASS**, native-build/web-build/typecheck PASS, **18 testes de catálogo entre processos PASS**, **21 percursos por browser** em Chromium/Firefox/WebKit (63execuções) PASS, sem skips/falhas/flaky.706hashes de fonte antes/depois coincidem.
- `.cache/contribution-envelope-go-race-final.log`: Go `./core ./sites` com race PASS na mesma fonte, após reconstrução da cache. Não são todos os pacotes Go.
-53vectores de transições (18aceites/35recusados) Node/portátil/Go concordam em resultados canónicos completos. O contrato de certificados anterior tem57vectores (14/43); não confundir as duas famílias.
- Os18testes de processos incluem retoma nos dois sentidos, quotas, corrupção, bloqueio, expiração, seis fronteiras de interrupção Go e concorrência. No controlo concorrente, Go retém uma transacção de escrita, Node inicia/aguarda sem produzir resultado, e só após commit ambos recuperam o mesmo envelope/contador.
- Browser: lock durante assinatura/selagem aborta o commit e permite retomar; envelope exacto após reopen; corrupto é recusado com zero tentativas de regeneração; prazos e sessão são revalidados. Os21percursos também cobrem aplicação real, mensagens/recibos, páginas/social, identidade/cofres e armazenamento/offline. Não são percursos UI de enviar/aprovar propostas.
- Provas curadas: **docs/evidence/site-contributions/envelopes**. Driver `.cache/contribution-go-envelope-gate.mjs`; curador `.cache/curate-contribution-go-envelope.mjs` já executado, recusa sobrepor resultados. `.cache/contribution-envelope-final-source.json` regista a fonte de referência.

### Falhas/correcções preservadas

1. Driver Go inicial transformava relógio negativo em0, mascarando o input; fixture corrigida. `.cache/contribution-go-operations-first.log`.
2. Primeiro controlo Go de prazo usava fingerprint de TTL diferente; corrigido antes do negativo definitivo. `.cache/contribution-policy-clock-initial-handle-observation.log`.
3. Negativo definitivo reproduziu assinatura aceite depois de expirar durante política em Node/Go. Corrigida a recusa antes de assinar e a verificação final com relógio actual. Positivo a-1ms passa; a0ms é recusado. Browser comprova zero chamadas de assinatura. `.cache/contribution-policy-clock-valid-before.log` e gates posteriores.
4. Worker testado com cinco métodos proibidos ainda esperava três recusas. O produto recusava os cinco; corrigido só o oráculo. `.cache/contribution-envelope-worker-expectation-before.*`.
5. Preflight omitia tsconfig.json na enumeração, sem qualquer hash divergente; detectado/corrigido antes de testes. `.cache/contribution-go-envelope-preflight.json`.

A revisão é do implementador, **não independente**. Ver CONTRIBUTION-ENVELOPE-REVIEW.md. Os marcos anteriores e suas falhas continuam em preparation/authenticated-context/document-v4.

## Próxima implementação concreta

Ler **.codex-delivery/CONTRIBUTION-SUBMISSION-INTEGRATION.md**. Começar pela integração de API e handoff durável para transporte, não voltar a implementar o catálogo Go.

1. Comando de submissão recebe somente locator/valores/concessão/prazo/UUID/sequência. Motor resolve novamente a fonte; nunca aceitar source/context/ACL do cliente. prepare/sign/seal são commits recuperáveis separados.
2. Persistir intenção de transporte e ligação certificado↔envelope antes da cópia para store que participa em inventário/gossip. Revalidar política e sessão dentro da cópia. No browser putBundle aceita uma mutação privada, enquanto commit já aceita várias: estender internamente de forma compatível para política+outbox na mesma revisão, sem reentrada no perfil dentro da transacção.
3. Libertar o único slot de preparação só depois de handoff durável; permitir fila limitada de submissões. Conservar ID para cancelar pacotes depois de expiração/cancelamento e conservar prova histórica do formulário. Quotas/contrapressão não podem descartar trabalho pendente.
4. Admitir site-contribution nos três motores com vínculo de envelope/certificado e contexto original na inbox. Relay sem chave conserva bytes opacos. Distinguir ACK físico, inbox verificada e aprovação; recibos assinados pelo dono e ligados à proposta.
5. Decisão do dono, CAS/reconciliação de base/esquema/audiência, recibos e proveniência. Nova revisão só se torna publicada após reler a cópia real. Alterações do dono não se apresentam como assinatura do visitante.
6. UI PT/EN/ES Liquid Glass completa; só então paleta. Três contas reais, offline/partition/heal, autor offline/seeder, perda de resposta, quotas/corrupção/concorrência, teclado/toque/Axe/desenho. Todo o resto do PROJECT-BRIEF continua obrigatório: grupos web dinâmicos, backup/rotação/keystore, meios/plataformas físicas e revisão independente.

## CI e publicação

**CI35670707944 /bd419cb terminou FAILURE só no iOS.** Node nos três hosts, Go, interop, UI nativa, RNS, três pacotes desktop e112browser PASS. iOS importou a fotografia e entregou uma mensagem privada verificada pelo Node; falhou depois na consulta AX do photospicker, linha318. Anexo/reply/recovery não concluíram.26artefactos conferidos, capturas inspeccionadas e provas em docs/evidence/ci-bd419cb. Não confundir com o timeout de importação do CI anterior nem atribuir esse resultado ao código a1040a7/16dbd6a.

CI35661349213 /0a85d7d terminou FAILURE só no iOSseed-synthetic-photo; todos os restantes jobs passaram, incluindo107browser e página extensa em10144ms. Build/install/startup XCTest iOS passaram, mas a fotografia expirou antes do percurso funcional.21artefactos conferidos, docs/evidence/ci-0a85d7d. Não afirmar mensagem/fotografia entregue nem causa do bloqueio comprovada.

Web pública: https://johnnypbelo.github.io/relayloom/ — runtime **7fdb76a5de5869efa6ebdd721bc7e8f5efac68af**, distribuição **0fdbd1b9563540a5bc28c74d669668e948aa7667**, Pages35622927304 SUCCESS. V3 com recursos publicado; novas correcções/formulários não.20hashes HTTPS,6percursos de recursos nos três motores e1entreprocessos com mensagens/anexo/reabertura offline PASS. Provas em docs/evidence/site-optional-resources/v3-ui/live. Publicação nova exige artefactos exactos e gate HTTPS.

A corrida local de pausa do relay foi reproduzida/corrigida anteriormente. A causa histórica de ausência de candidatosICE/ofertaFirefox lenta permanece por esclarecer. Nenhum resultado de software demonstra rádios físicos, todos os aparelhos testados ou prontidão para catástrofes. Apple/signing e paridade completa continuam com os bloqueios/pendentes de docs/STATUS.md.

## Espaço e histórico

A reserva15GiB foi mantida como condição para iniciar builds. Ao cair abaixo, pararam novos builds e removeram-se somente duplicados ignorados/caches sem uso dentro do projecto. Neste incremento: linux-unpacked do principal, com AppImage/source/WIP preservados, e cache Go compilada, mantendo módulos/toolchain/artefactos/provas. Auditorias `.cache/disk-recovery-go-envelope.json` e `.cache/go-build-cache-recovery.json`. A causa de crescimento fora do projecto não foi investigada. Não tocar em outros projectos ou serviços.

O histórico completo anterior foi preservado em `.codex-delivery/history/RESUME-before-go-contribution-envelopes.md`. O turno foi progresso real de implementação e testes; deixar o objectivo activo, sem complete/blocked.


## Estado final confirmado depois do push

**HEAD e origin f69eb2442c3db373a81748c20cd87470f020ef37**, push normal confirmado. **Novo CI35676434531** criado para essa fonte, queued na última leitura. O CI anterior35670707944 é terminal. Não repetir/retomar os handles locais já concluídos; nenhum teste local está vivo. Fontes apps/packages/native/tests/scripts limpas e commitadas; WIP histórico preservado.

Continuar pela API de submissão/handoff para transporte e inbox/aprovação/UI, não pela portabilidade Go que já foi concluída. O gate actual está guardado e o HTML público não foi actualizado. Objectivo integral activo; manter Astra/Copilot Ultra, execução sequencial e a reserva15GiB. Não alterar bridges/configurações/serviços nem criar/retomar agentes.


## Bloqueio de capacidade no disco durante a integração de envio

Não há testes/processos locais em curso. HEAD/origin continuam f69eb2442c3db373a81748c20cd87470f020ef37; novo CI35676434531 em curso na última consulta. Nenhum push posterior. O turno produziu código WIP e controlos negativos reais; não está validado como milestone.

WIP actual: packages/sites/src/contribution-operations.ts acrescenta queued e descritor transport (bundleId/bundleHash/bytes/copied), limites32operações/32MiB, checkCertificate e transições queue/copied; preserva formatos anteriores e bloqueia a retirada de queued na janela128. packages/sites/src/contribution-catalog.ts contém o handoff Node para payloads privados por certificado, getters/cópia/expiração/cancelamento; falta testar essa fila e portar para Browser/Go. **Não está exposta na API, não há envio implementado.** Typecheck das alterações Node passou antes do bloqueio; nenhum teste novo da fila foi executado.

Controlos `.cache/contribution-cancel-before-browser.log` e `contribution-cancel-before-go.log` reproduziram um bug real: cancelar novamente uma operação antiga apagava a preparação mais recente. Node já foi corrigido no refactor; foram agora aplicadas correcções mínimas Browser/Go para remover stage só quando a operação cancelada ainda estava prepared/signed. **Essas duas últimas alterações ainda precisam de format/typecheck e rerun dos controlos.** Os testes novos estão no fim de tests/browser/site-contribution-catalog.spec.ts e tests/native/site-contribution-catalog.test.ts. Não reclassificar os negativos como passe.

O disco tem menos de15GiB. Limparam-se apenas executáveis antigos de testes Go, cache compilada Go e quatro arquivos inactivos de instalação (três Electron e Go), com lsof e hashes registados; módulos, ferramentas instaladas, app binaries, fontes/WIP e provas preservados. Auditorias `.cache/submission-disk-test-cache-recovery.json` e `submission-disk-archives-recovery.json`. A margem recuperada desapareceu novamente; não investigar/apagar outros projectos ou serviços.

Foi enviado pedido assíncrono ao proprietário para libertar pelo menos5GiB adicionais. **Não iniciar compilações/testes sem restaurar e verificar a reserva15GiB**, preferindo margem para o pico de compilação. O pedido permanece pendente. Assim que houver espaço: confirmar df, guardar as falhas/proveniência, formatar os dois fixes, repetir os controlos de cancelamento, terminar a fila nos três motores com testes transaccionais/limites/crash e ligar API/transporte/inbox/decisão/UI conforme CONTRIBUTION-SUBMISSION-INTEGRATION.md. Manter todo o objectivo, Astra/Copilot Ultra e recuperação sequencial sem agentes.


## Segunda verificação do bloqueio de disco

Reserva ainda indisponível:14,333GiB na última leitura. Não foram iniciados testes/compilações nem alteradas fontes neste turno. O pedido assíncrono de pelo menos5GiB adicionais permanece sem resposta. A espera verificou o job concreto CI35676434531: native-ui terminou PASS; Node nos três hosts, Go, interop e pacotes Windows/Linux também PASS; RNS, macOS package e iOS ainda em curso. Isto cobre f69eb24, não o WIP da fila/cancelamento. Nenhum processo local vivo.

O turno anterior foi progresso de implementação; esta continuação realizou uma espera verificada pelo CI e confirmou pela segunda vez consecutiva o impedimento local. Não marcar produto concluído. Revalidar espaço antes de qualquer execução; se o mesmo impedimento persistir na próxima continuação sem outra acção útil, aplicar a auditoria de blocked prevista pelo objectivo.


## Terceira verificação — objectivo bloqueado por capacidade

Espaço confirmado14,159GiB, abaixo da reserva15GiB, na terceira continuação consecutiva com o mesmo impedimento. Limpezas seguras identificadas já foram feitas; módulos/toolchains/app artifacts/provas/perfis e WIP continuam preservados. O pedido de pelo menos5GiB adicionais ao proprietário permanece pendente. Sem compilações/testes locais iniciados desde o bloqueio.

CI35676434531 continua sem ser interrompido: Node Windows/macOS/Linux,Go,interop,UI nativa e três pacotes desktop PASS; RNS/iOS ainda em curso na última leitura. Não declarar o resultado global nem atribuir o CI ao WIP local da fila/cancelamento.

Objectivo marcado blocked apenas pela falta persistente de espaço, não concluído nem reduzido. Após o proprietário libertar espaço, confirmar a margem real e retomar pelo WIP documentado acima: format/typecheck e controlos de cancelamento, portabilidade da fila Browser/Go, testes transaccionais e API/transporte/inbox/aprovação/UI. Não criar agentes nem alterar Astra/Copilot Ultra, bridges, configurações, serviços ou outros projectos.


## Reserva reposta e retoma efectiva

A retoma confirmou35,278GiB livres e o objectivo activo. O bloqueio de capacidade foi resolvido por mudança externa; não houve limpeza adicional ou alterações de serviços/modelos. CI35676434531 terminou FAILURE apenas em iOS; todos os restantes jobs passaram. Recolher causa exacta/artefactos antes de atribuir essa falha a fases anteriores.

Iniciada validação dos fixes de cancelamento: formatação Browser/Go, typecheck, reconstrução Go/race da fixture (cache tinha sido limpa), controlos Go/Chromium. Logs `.cache/contribution-cancel-recovery-*`, `contribution-cancel-after-{go,browser}.log`. Não repetir se o handle estiver vivo. A fila continua WIP só no protocoloTS/catálogoNode; não exposta àAPI, Go/browser ainda precisam de portabilidade da fila.


## Retoma confirmada — integração privada de propostas, 22 de Setembro

Esta secção substitui as indicações anteriores de que a fila/API não existe. HEAD/origin f69eb2442c3db373a81748c20cd87470f020ef37; worktree activa .cache/site-optional-resources. Código abaixo é WIP preservado, ainda sem novo commit/push/publicação. Objectivo integral activo, execução sequencial sem novos/retomados agentes. Reserva verificada cerca de35GiB; mínimo15GiB continua obrigatório.

Fila queued implementada em Node/browser/Go:32operações/32MiB, payload privado por certificado, libertação transaccional do slot, descriptor conservado após cancelamento/expiração, cópia relida antes de copied=true. Cancelamento idempotente de operação antiga já não apaga preparação seguinte. Recusas operacionais Node não invalidam storage; corrupção continua erro de integridade.

API contribution-command form/state/submit/operation/resume/cancel/inbox ligada aos três motores. prepare/sign/seal/queue/copy são fronteiras recuperáveis. Publicação usa transportes existentes, retry5s/republicação30s; pausa do relay não impede tráfego próprio. Bloqueio/retirada/lock cancelam pacotes próprios; browser revalida policy na transacção da cópia e antes de emissão tardia. Publicação genérica de site-contribution recusada. Envelope privado para visitante+dono, certificado vinculado, leitura/admissão separadas de trânsito opaco. Estado periódico não inclui valores.

Inbox devolve SOMENTE candidatos verificáveis (dedupe certificado) ou missing-source. Faltam journal durável/replay por autor+operação, recibos, aprovação/rejeição/CAS/reconciliação/proveniência e recuperação automática do snapshot privado conservado na fila. Sender permanece queued até cancelar/expirar; copied não é entrega. Paleta de formulários continua oculta. Nenhuma entrega integral desta funcionalidade é afirmada.

Gates prévios recolhidos, nenhum handle antigo pendente: Node16PASS após corrigir classificação, interop23PASS, catálogo Chromium6PASS, envio/admissão4PASS, envio/restart/partition-heal4PASS, guards de rede Chromium5PASS. Logs .cache/contribution-{queue-node-fixed,queue-interop,queue-chromium,admission-send,send-restart,network-guards-chromium}.log.73vectores (29/44) canónicos Node/portátil/Go. Typecheck PASS. Ainda falta regressão integral, Go/race completo, produção worker/GUI e alargamento dos browsers do WIP.

Retoma actual: Firefox5PASS (copy bloqueio/retirada/lock/lost-copy + RTC real), .cache/contribution-guards-firefox.log e report.json. Primeira invocação usou config sem projectos e não executou testes; erro preservado em contribution-network-guards-firefox-webkit.log. Usar RELAYLOOM_MATRIX_ENGINE com tests/browser/matrix.config.ts. WebKit equivalente iniciado; recolher handle/log antes de repetir. Próximo: produção worker/setup/reload, integração multi-hop/adaptadores, gate integral e commit coerente antes de inbox/decisão/UI.

CI35676434531/f69eb24 terminou FAILURE apenas em iOS; todos os restantes jobs PASS. Artefactos iOS(10675246827) e browser(10674387543) descarregados em .cache/ci-f69eb24. Relatório iOS confirma arranque, seed de fotografia e mensagem privada verificada pelo Node; falha no percurso após photo-picker-requested. Conferir logs/hashes para identificar erro exacto. Não extrapolar de CI anterior. Isto testa f69eb24, não o WIP.

Web pública continua runtime7fdb76a/distribuição0fdbd1b, sem estas propostas. Publicação nova exige build exacto/gates/HTTPS. Não declarar paridade total, rádios físicos, hardware Apple/signing ou prontidão para catástrofes.
