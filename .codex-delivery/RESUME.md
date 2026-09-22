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

**CI35670707944 /bd419cb estava em curso** na última leitura: Node nos três hosts, Go, interop, UI nativa, RNS e três pacotesdesktop PASS; iOS e browserautónomo em curso. Consultar antes de novo push para não cancelar essa execução. Não atribuir esseCI ao novo código a1040a7/16dbd6a.

CI35661349213 /0a85d7d terminou FAILURE só no iOSseed-synthetic-photo; todos os restantes jobs passaram, incluindo107browser e página extensa em10144ms. Build/install/startup XCTest iOS passaram, mas a fotografia expirou antes do percurso funcional.21artefactos conferidos, docs/evidence/ci-0a85d7d. Não afirmar mensagem/fotografia entregue nem causa do bloqueio comprovada.

Web pública: https://johnnypbelo.github.io/relayloom/ — runtime **7fdb76a5de5869efa6ebdd721bc7e8f5efac68af**, distribuição **0fdbd1b9563540a5bc28c74d669668e948aa7667**, Pages35622927304 SUCCESS. V3 com recursos publicado; novas correcções/formulários não.20hashes HTTPS,6percursos de recursos nos três motores e1entreprocessos com mensagens/anexo/reabertura offline PASS. Provas em docs/evidence/site-optional-resources/v3-ui/live. Publicação nova exige artefactos exactos e gate HTTPS.

A corrida local de pausa do relay foi reproduzida/corrigida anteriormente. A causa histórica de ausência de candidatosICE/ofertaFirefox lenta permanece por esclarecer. Nenhum resultado de software demonstra rádios físicos, todos os aparelhos testados ou prontidão para catástrofes. Apple/signing e paridade completa continuam com os bloqueios/pendentes de docs/STATUS.md.

## Espaço e histórico

A reserva15GiB foi mantida como condição para iniciar builds. Ao cair abaixo, pararam novos builds e removeram-se somente duplicados ignorados/caches sem uso dentro do projecto. Neste incremento: linux-unpacked do principal, com AppImage/source/WIP preservados, e cache Go compilada, mantendo módulos/toolchain/artefactos/provas. Auditorias `.cache/disk-recovery-go-envelope.json` e `.cache/go-build-cache-recovery.json`. A causa de crescimento fora do projecto não foi investigada. Não tocar em outros projectos ou serviços.

O histórico completo anterior foi preservado em `.codex-delivery/history/RESUME-before-go-contribution-envelopes.md`. O turno foi progresso real de implementação e testes; deixar o objectivo activo, sem complete/blocked.
