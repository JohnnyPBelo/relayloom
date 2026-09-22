# Inbox durável — integração em curso sobre 2948284

**Objectivo integral activo; produto não concluído.** Execução sequencial, sem novos/retomados agentes; Astra/Copilot Ultra e reserva mínima de 15 GiB mantidos. O código abaixo continua WIP, sem novo commit/push. A fonte pública e o CI anterior não incluem este incremento.

## Implementação efectiva

- `packages/sites/src/contribution-inbox.ts` e `native/sites/contribution_inbox.go`: journal equivalente Node/portátil/Go, 256 entradas, 64 pendentes, 32 pendentes por contribuidor, quatro descritores de conflito, 1 MiB de metadados, 32 MiB de provas e limite individual de 6 MiB+16 KiB. As quotas globais reais também se aplicam. Não expulsa pendentes. Expiração remove a prova privada e conserva metadados durante 30 dias após o maior prazo observado, sem memória infinita de UUIDs.
- Dedupe por certificado e autor+UUID, mesmo entre sites da mesma identidade dona. Reempacotamento não substitui os bytes originais; conflito não cria outra candidata. Overflow conserva marca e maior validade, com descritores/escritas limitados.
- Catálogos persistentes nos três motores: `packages/sites/src/contribution-inbox-catalog.ts`, `packages/browser/src/contribution-inbox.ts`, `native/sites/contribution_inbox_catalog.go`. Admissão e anexação da fonte são commits separados. Conservam envelope/source exactos, verificam hash/tamanho/certificado/contexto histórico e revalidam política/prazo/sessão. Estado inicial missing-source, depois verified-candidate; nenhum deles é aprovação ou recibo.
- Namespace novo `contribution-inbox`, com AAD/HKDF próprio `relayloom/site-contribution-inbox-private/1`, separado da fila contribution. Go/Node lêem e escrevem na mesma SQLite; a chave de leitura não permite extrair a prova protegida pela chave de assinatura. Browser usa o armazenamento signing-owned existente e chave/AAD separados pelo nome privado.
- **API integrada nos três runtimes.** A recepção grava prova antes da cache normal; a chegada posterior da fonte pode promover uma candidata pendente. A consulta inbox recupera envelopes antigos ainda válidos, usa a prova privada mesmo sem cache e devolve `durable: true`. Bloqueio/retirada continuam aplicados. Corruptos não se tornam candidatas; no browser há um tipo de erro de integridade que não é consumido como recusa operacional.
- Consultas de fontes alheias à identidade dona não percorrem a sua inbox. Os valores continuam fora do estado periódico. A paleta de formulários permanece oculta.

## Ainda em falta

Recuperação por protocolo de uma fonte conservada SOMENTE na fila privada do visitante, incluindo com relay para terceiros pausado; recibos assinados do dono; decisão/aprovação/rejeição/CAS/reconciliação; proveniência das linhas; UI completa PT/EN/ES com três contas e revisão independente. A chegada por gossip de uma fonte na cache normal foi testada; não é prova da recuperação a partir da área privada da fila. Sender continua queued sem recibo do dono.

O contrato completo de plataformas/rádios, grupos web dinâmicos, recuperação/rotação/keystore, setup/idiomas/Liquid Glass mantém-se. Os testes não são dispositivos físicos, rádios ou prontidão para catástrofes.

## Evidência dirigida já recolhida

- **20 testes Node PASS**: inbox, vectores, quatro namespaces privados e fila. `.cache/contribution-inbox-node-storage.log`.
- **61 vectores** Node/portátil/Go: 25 aceites e 36 recusados; resultados canónicos completos iguais. `.cache/contribution-inbox-vectors.json`.
- **27 testes entre processos PASS**, com workers Go compilados com race: retoma Node↔Go, crashes reais antes/depois de admissão e de anexar fonte, bloqueio, corrupção, expiração, transposição entre os quatro namespaces/stores e leituras/escritas reais. `.cache/contribution-inbox-native-storage.log`.
- **8 testes de admissão/envio/restart/relay anteriores PASS** depois da integração. `.cache/contribution-inbox-network-first.log`.
- **4 percursos API de processos PASS**: recepção automática antes de abrir inbox, perda dos dois ficheiros de cache com remetente parado/socket ECONNREFUSED, reabertura e bloqueio; proposta sem fonte permanece sem valores até chegar a fonte real por TCP. `.cache/contribution-inbox-deferred-source.log`.
- **12 Chromium + 14 Firefox + 14 WebKit PASS** nos percursos dirigidos. Os 14 incluem worker de produção depois de novo build. Logs `contribution-inbox-browser-runtime-first.log`, `contribution-inbox-firefox.log`, `contribution-inbox-webkit.log`; os respectivos JSON foram preservados. A diferença de contagem é worker, não cenários inventados.
- **4 percursos adicionais Chromium PASS**: propostas browser↔Node e browser↔Go nos dois sentidos por RTC→WebSocket, com terceira identidade intermediária sem chave de leitura, próprio envio com relay pausado, topologia e recusa de leitura. `.cache/contribution-inbox-web-native-chromium.log/report.json`. Isto usa origem HTTP loopback e WS local, não prova HTTPS/WS entre dispositivos físicos.
- Typechecks e builds dirigidos PASS. As duas execuções Go `-run TestContributionInbox...` anteriores aos workers eram apenas precompilação com teste ignorado/ausente; não são evidência de comportamento.

## Falhas das fixtures preservadas

1. Default randomUUID inferiu tipo template demasiado estreito; anotado como string. `contribution-inbox-typecheck-fixture-before.log`.
2. O teste de corrupção esperava texto inglês closed, mas o erro real era Registo fechado. A recusa e fecho já funcionavam; corrigido o oráculo. Primeiro resultado 6 PASS/1 FAIL, em `contribution-inbox-node-first.log`; depois passou.
3. A comparação browser da fonte usava JSON.stringify e confundia ordem de propriedades com dados alterados. Trocada por canonical, sem alterar o produto. Primeiro 2 PASS/1 FAIL, depois 3 PASS; logs/JSON `contribution-inbox-chromium-first*` e `contribution-inbox-chromium-fixed.log`.

## Gate amplo em curso — não duplicar

Driver `.cache/contribution-inbox-gate.mjs`; relatório `.cache/contribution-inbox-final/report.json`; **handle13269**. Verificar o handle/relatório antes de retomar. Sequencial: typecheck, Node integral, 17 pacotes Go/race, build nativo, processos de contribuições/rede mista/novo storage, build web e browsers afectados nos três engines. Guarda hashes antes/depois e pára à primeira falha. Não modificar apps/packages/native/tests/scripts/.github enquanto corre.

Todos os outros handles locais deste incremento foram recolhidos e são terminais. Não repetir suites por falta de output do handle. Capturas/JSON antigos e symlink node_modules permanecem WIP separados; não git add -A/reset/force-push.

## CI 2948284 e correcção local da organização

CI35753597485 é terminal CANCELLED. Ubuntu passou 505 Node e 34 UI, mas a anotação GitHub confirma `The job has exceeded the maximum execution time of 15m0s`. Não é HTTP408 do modelo nem falha dos testes. Windows/macOS terminaram sucesso; os jobs posteriores foram skipped e não estão validados por esta execução.

Log/observação/anotações em `.cache/ci-2948284/` e `.cache/ci-2948284-observation.json`. Não foi necessário descarregar o artefacto grande de 147348293 bytes. `.github/workflows/ci.yml` separa agora a UI Node/Linux num job node-ui, depois da matriz Node e antes de native-go. Mesmos comandos/Chrome/matriz/deadlines por teste, limites existentes de jobs preservados e novo job de 15 minutos. A validação YAML/estrutura passou em `workflow-validation.json`; **o workflow editado ainda não correu remotamente**. Nenhum provider, bridge, autenticação, permissão ou serviço externo foi alterado.

## Próximo passo

Recolher o gate amplo, corrigir falhas se houver e consolidar a fonte com provas precisas. Depois completar recuperação da fonte privada e recibos/decisão/proveniência conforme CONTRIBUTION-INBOX-NEXT.md; não activar a paleta prematuramente. O objectivo mantém-se activo.


## Gate amplo concluído e correcção da revisão

Handle13269 terminou/recolhido0: **514 Node, 17 pacotes Go/race (alguns inalterados reutilizaram cache Go), 66 testes entre processos, builds e60casos porengine** passaram.732hashes de fonte antes/depois coincidem. Relatório `.cache/contribution-inbox-final/report.json` é terminalPASS.

A revisão acrescentou um controlo TCP de64propostas autenticadas mas de dois contribuidores não autorizados para um formulário disponível, seguido de uma proposta autorizada e de um post positivo no mesmo canal. Primeiro houve erro de fixture (`wire.close` inexistente) que mascarou as asserções e impediu limpeza. Foram identificados pela árvore/cwd e encerrados somente os dois processos de teste e o worker desse ensaio; perfis/logs preservados, auditoria em contribution-inbox-quota-fixture-cleanup.json. Handle10238 terminal/recolhido; nenhum serviço alheio foi tocado. Corrigida a fixture para `await wire.stop()` e teardown garantido.

A repetição válida (**handle92073**) reproduziu2FAIL: o post positivo chegava, mas a proposta permitida não aparecia porque os pedidos inválidos ocupavam a quota privada antes de verificar a fonte. Log `contribution-inbox-quota-before-valid.log`. Não confundir com o erro inicial da fixture.

Correcção: métodos internos checkSource nos três catálogos e preflight no receptor, quando o snapshot já está disponível, antes de reservar espaço privado. Reutiliza a mesma validação de contexto/certificado; não devolve capacidade àUI nem modifica o formato de persistência. Quando falta a fonte, mantém a candidata limitada para verificação posterior. O envelope continua a poder existir na cache criptograficamente verificada sem ser admitido na inbox. O positivo corrigido passou8testes de admissão/perda de cache/fonte tardia (`contribution-inbox-quota-after.log`, handle56208 terminado).

Adicionado controlo browser que conserva oito envelopes na cache sem ocupar qualquer chave privada de inbox e depois admite o visitante permitido. Ainda por recolher no gate de revisão. **Gate actual vivo: handle44836**, driver `.cache/contribution-inbox-reviewed-gate.mjs`, relatório `.cache/contribution-inbox-reviewed/report.json`. Verifica oito ficheiros de diferença face ao gate amplo e congela a fonte. Typecheck,20Node afectados,Go app/sites-race,buildnative,processos de storage/rede/inbox,buildweb e browsers afectados. Não modificar fontes nem repetir enquanto está vivo.

Continuam pendentes recusa/purga controlada de candidatas não verificáveis, gestão de pressão causada por fontes ainda desconhecidas e a UI de revisão; não activar a paleta antes desses controlos, recibos e decisões. A correcção acima cobre a fonte já disponível e não constitui uma garantia geral contra spam/sybil. Todo o resto do contrato mantém-se.


## Marco de inbox guardado — estado final local

Código **a3e09fd/55b0d4e**, workflow **eb2a5b4**. Gate amplo terminouPASS (514Node/17pacotesGo-race/66processos/60casos porengine). Revisão de quota terminouPASS (20Node,Go app/sites-race,41processos,19casos porengine).732hashes antes/depois e contra o código commitado conferem. Handles13269/44836 e todos os controlos anteriores foram recolhidos; nenhum teste local deste incremento permanece vivo. Provas completas em docs/evidence/site-contributions/inbox, com negativos/positivos e auditoria do erro de teardown.

FR-038/039/040 permanecem parciais: já há inbox durável naAPI, mas faltam obtenção da origem apenas na fila privada, gestão de recusas/purga, recibos assinados, aprovação/reconciliação/CAS/proveniência e UI completa. Candidatas sem fonte continuam limitadas e podem exercer contrapressão; não prometer resistência geral a spam/sybil nem activar a paleta antes da revisão. Todos os restantes requisitos de grupos web, recuperação/rotação/keystore, plataformas/rádios, acessibilidade e revisão independente mantêm-se.

CI2948284 foi cancelado por15min acumulados após505Node+34UI UbuntuPASS; restantesplataformasNodePASS e jobs seguintesSKIPPED. A alteração de organização ainda necessitaCIremoto. Público7fdb76a/0fdbd1b inalterado; não declarar produto concluído.
