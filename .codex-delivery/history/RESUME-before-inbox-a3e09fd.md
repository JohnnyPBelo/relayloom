# RelayLoom — retoma após fila e transporte de propostas

**Objectivo integral activo. Produto não concluído.** Ler PROJECT-BRIEF.md e preservar todos os requisitos: messenger/social cifrado, sites expressivos inspirados no ZeroNet, todas as plataformas e web autónoma, meios agnósticos/Reticulum, setup/idiomas PT-PT/EN/ES e Liquid Glass. Só este projecto. Manter Astra/Copilot Ultra e recuperação sequencial: **não criar nem retomar agentes**. Não alterar providers/bridges/autenticação/permissões/serviços. Checkpoint extra de manutenção continua cancelado.

## Local e fonte

- Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`.
- Principal: `/home/absint0o/projects/relayloom`, branch `codex/setup-languages`, HEAD1e83db22ff9b7b9a65a400601b891312a3188960, com WIP histórico separado e preservado.
- Fonte nova commitada: **5a1921c73be13c3cec32c7076fa41a521f1b799c** fila/catálogos e **07b509e57a157cfbca0babdb20cd4fbbb40cf22f** integração API/transporte/cancelamento final. Consultar git log para o commit posterior de provas/documentação.
- **HEAD e origin confirmados2948284c8795d2504234ea7433a12333e298ecc7**, push normal concluído. Commits de provas64ea98a/2948284 seguem os dois de fonte. NovoCI35753597485 criado para esta fonte, queued na última leitura; não afirmar resultado até recolher o gate.
- Fontes apps/packages/native/tests limpas depois dos dois commits; capturas/JSON históricos e symlink node_modules permanecem WIP. Nunca git add -A, reset, force-push ou merge de PR sem aprovação.
- Cerca de35GiB livres na última leitura. Revalidar reserva mínima15GiB antes de novos builds; dependências/caches só no projecto; uma execução pesada de cada vez.

## Implementado e validado neste marco

Fila privada nos três motores: queued, descriptor transport(bundleId/bundleHash/bytes/copied),32operações/32MiB e fonte/certificado/envelope por certificado. Handoff liberta slot de preparação na mesma transacção. Cancelamento/expiração removem payload privado, conservam descriptor para retirar pacotes e não apagam a preparação seguinte. Resultado queued não pode ser expulso pela janela128. Node distingue recusa operacional de corrupção.

API contribution-command: form/state/submit/operation/resume/cancel/inbox. Cliente fornece locator/valores/concessão/prazo/UUID/sequência, nunca source/context/ACL. prepare/sign/seal/queue/copy são fronteiras recuperáveis. Cópia é relida; copied só prova armazenamento local. Retries usam mesmo envelope, política actual e limitação por envelope. Bloqueio/retirada/lock cancelam pacotes próprios; relay pausado para terceiros não impede envio próprio.

Admissão: proposta privada para visitante+dono, TTL limitado, certificado vinculado quando legível; trânsito sem chave conserva bytes opacos. Publicação genérica recusada. Estado periódico sem valores. Browser verifica política na transacção da cópia e revalida permissão/prazo depois de awaits de leitura para transporte.

**Inbox ainda só candidatos verificáveis**, dedupe por certificado e missing-source. Não há journal durável/replay por autor+UUID, recibos, aprovação/rejeição/CAS/reconciliação/proveniência nem recuperação automática da fonte guardada na fila. Sender continua queued até cancelar/expirar. Paleta continua oculta. Não declarar fluxo completo de formulários entregue.

## Testes e processos

**Nenhum teste/processo local deste incremento continua em curso.** Handles67471 (gate amplo),31598 (gate após revisão),95176 (negativo de race) e33844 (positivo) terminaram e foram recolhidos. Não repetir por falta de output do handle; logs/relatórios são terminais.

- Gate amplo `.cache/contribution-submission-final-1/report.json`:505Node PASS,17pacotesGo/race PASS,35processos PASS, typecheck/build nativo/web PASS,49casos por engine Chromium/Firefox/WebKit PASS. Zero falhas/skips/flaky.
- Auto-revisão adicional reteve leitura real de política já concluída enquanto cancelamento era commitado. Browser canServe devolvia true depois de cancelar ou expirar:2FAIL/1PASS (close recusava). Corrigido com revalidação da mesma entrada allowed e do prazo depois do await.
- Gate final `.cache/contribution-submission-reviewed/report.json`: typecheck/build e16casos afectados por engine PASS. Apenas runtimebrowser/harness/testerace mudaram depois do gate amplo; não apresentar os passes Node/Go como novas execuções após esse ajuste.720hashes finais coincidem com as fontes commitadas.
- Dois percursos TCP→serialPTY com senderNode/Go, relayNode sem chave e ownerNode semTCP: hops2, bytes/autoria exactos, recusa de leitura/decriptação pelo relay, partição/heal, ausência com relay pausado apesar de canal positivo, e takeover depois do remetente terminar/socketECONNREFUSED. Não é serial directoGo nemrádio.
- Worker de produção: setup/ligaçãoRTC pelaUI, submissão porRPC fechado, reload pela shelloffline, recuperação exacta e cancelamento conservado; zero API de daemon e nenhuma chave privada em respostas. Não é UI de compor/aprovar propostas.
-73vectores de journal:29aceites/44recusados, resultados canónicos Node/portátil/Go iguais. Os logs de falhas e correcções anteriores estão preservados.

Provas curadas: **docs/evidence/site-contributions/submission**, com gate amplo, subdirectório reviewed, committed-source.json, controlos antes/depois, capturas Chromium/Axe e manifestos. Drivers reproduzíveis no mesmo directório. Não sobrescrever provas. Auto-revisão não é revisão independente.

## Próxima implementação concreta

Ler `.codex-delivery/CONTRIBUTION-INBOX-NEXT.md` e `CONTRIBUTION-SUBMISSION-REVIEW.md`. Não voltar a implementar fila/catálogos/transporte.

1. Journal privado da inbox, quotas sem expulsar pendentes, replay por certificado e autor+UUID, fonte histórica preservada e candidatos sem fonte não admitidos como aprovados.
2. Recuperação autorizada da prova original e recibos assinados do dono, distintos de ACK físico e aprovação.
3. Decisão persistida, CAS/reconciliação de base/esquema/audiência, publicação recuperável relida, proveniência original sem atribuir alterações do dono ao visitante.
4. Só depois paleta/UI PT/EN/ES completa com três contas reais, compor/enviar/rever/aceitar/rejeitar/reconciliar, teclado/toque/Axe/desenho e gates dos três motores.
5. Continuar todo o resto: grupos web dinâmicos, backup/rotação/keystore, empacotamento de meios, plataformas/rádios físicos e revisão independente.

Uma observação visual para a fase UI: a etiqueta lateral «A transmissão está em pausa» pode sugerir pausa de mensagens próprias, embora o controlo pause relay para terceiros. Considerar texto inequívoco e localizado, sem alterar a semântica do consentimento. Não foi mudado neste marco.

## CI e publicação

CI35676434531/f69eb24 terminou FAILURE apenas no iOS; todos os outros jobs PASS, incluindo115browser. Artefactos10675246827/10674387543 recolhidos;27ficheiros iOS conferidos. Provas **docs/evidence/ci-f69eb24**.

iOS26.4.1/Xcode26.6: build/install/startup e importação de fotografia PASS; mensagem privada entregue/verificada peloNode. Falhou no teste linha308 com missing seeded synthetic photo. Captura ui-04 mostra fixture; AX apresenta imagensPXGGridLayout-Info e o teste procura células. Anexo/resposta/recuperação não passaram. Corrigir selector e repetir emApple; não confundir com timeout de importação0a85d7d nem excepção AX de bd419cb. Não mexer em permissões/serviços.

Web pública inalterada: https://johnnypbelo.github.io/relayloom/ — runtime **7fdb76a5de5869efa6ebdd721bc7e8f5efac68af**, distribuição **0fdbd1b9563540a5bc28c74d669668e948aa7667**. Não inclui estas propostas. Nova publicação exige build exacto, gate da distribuição e HTTPS. Os builds locais de teste deste marco precedem commits de fonte e não são releases públicas.

Não afirmar todos os SO/aparelhos testados, rádios físicos, assinaturaApple, revisão independente ou prontidão para catástrofes. Objectivo mantém-se activo.


## Confirmação depois do push

Os logs originais *.log eram ignorados pelo Git e foram acrescentados explicitamente apenas nos dois directórios de provas deste incremento, no commit2948284; os demais WIP permaneceram intactos. Não usar git add -A. Todos os47artefactos do manifesto de submissão estão agora versionados e conferidos; os27ficheiros dos manifestos iOS também. Nenhum teste local activo. CI35753597485 remoto fica emcurso sem ser interrompido. A próxima fase é implementação de inbox/recibos/decisão, não nova execução indiscriminada da mesma suite. Também falta um percurso explícito de proposta browser↔nativo; os gates actuais comprovam propostas RTC browser↔browser e Node↔Go/TCP/serial, sem inventar esse percurso específico.

## Trabalho actual após o marco de envio

Esta secção é mais recente que o resumo do marco acima. Há WIP novo da inbox nos três motores e API de recepção automática, sem commit/push posterior a2948284. Ler **.codex-delivery/CONTRIBUTION-INBOX-IMPLEMENTATION.md** na worktree activa para ficheiros, limites, resultados dirigidos e pendentes.20Node/27processos/61vectores/4percursos de perda de cache/14Firefox/14WebKit/12Chromium+4browser↔nativo passaram, com âmbitos diferentes e fontes/fixtures documentadas.

**Gate amplo vivo: handle13269**, driver `.cache/contribution-inbox-gate.mjs`, relatório `.cache/contribution-inbox-final/report.json`. Não modificar fontes enquanto corre nem relançar sem confirmar estado. A última API já tem durable:true, mas não há recibos, aprovação/CAS/proveniência/UI completa nem obtenção da fonte apenas guardada na fila privada. Paleta continua oculta. Não reduzir o objectivo.

CI35753597485/2948284 terminou CANCELLED por limite acumulado15min, confirmado na anotaçãoGitHub. Ubuntu505Node+34UI passaram; Windows/macOSsucesso; restantesjobsskipped. Workflowlocal separa UI Node/Linux num jobsequencial próprio, preservando cobertura/comandos/matriz e limites existentes; validaçãoYAML passou, execução remota dessa alteração pendente. Isto não envolve configuração de modelos/bridges/serviços.


### Correcção posterior ao gate da inbox

Gate13269 terminou/recolhidoPASS:514Node/17pacotesGo-race/66processos/60casos porengine,732hashes iguais. Uma revisão subsequente reproduziu ocupação da quota por64propostas não autorizadas para source já disponível; controlo correcto2FAIL e depoisfix8PASS. A primeira fixture falhou no teardown e teve apenas os seus processos identificados/encerrados, com auditoria; nenhum workload externo foi tocado.

**Novo gate vivo44836**, `.cache/contribution-inbox-reviewed/report.json`, oito fontes alteradas face ao amplo. Não relançar nem editar fontes até recolher. Ler a última secção de CONTRIBUTION-INBOX-IMPLEMENTATION.md. Ainda não houve commit/push depois de2948284; todos os WIP preservados, público inalterado. Faltam recibos/recusa/aprovação/CAS/proveniência/UI e obtenção de source apenas na fila privada. Objectivo integral activo.
