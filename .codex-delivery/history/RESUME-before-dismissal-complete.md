# RelayLoom — retoma após recuperação da origem privada

**Objectivo integral activo; produto não concluído.** PROJECT-BRIEF.md mantém messenger/social cifrado, sites expressivos inspirados no ZeroNet, cinco plataformas e web autónoma com paridade, meios agnósticos/Reticulum, setup PT-PT/EN/ES e Liquid Glass. Manter Astra/Copilot Ultra e execução sequencial: não criar nem retomar agentes. Não alterar providers/bridges/autenticação/permissões/serviços. Checkpoint adicional de manutenção cancelado.

## Estado confirmado

Worktree activa `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal permanece em `codex/setup-languages` / `1e83db22`, com WIP histórico preservado. Fontes locais: `593459a` cancelamento por IDs/prazos absolutos, `16c5963` recuperação de origem privada e `3ac8faf` observação iOS. Origin confirmado em `d0c3b55` antes do próximo push normal. Nunca usar git add -A, reset, force-push ou merge sem aprovação. Capturas/JSON históricos e symlink node_modules não pertencem automaticamente ao incremento.

Disco revalidado: cerca de 23 GiB livres; mínimo 15 GiB. Uma execução pesada local de cada vez, caches/dependências no projecto. Nenhum teste local conhecido deste incremento continua vivo; os handles antigos foram recolhidos. Não relançar suites por perda do handle.

## Implementado e verificado

Fila privada e inbox durável nos motores Node, Go e browser. Recuperação explícita (`contribution-command/obtain-source`) da origem que só existe na fila activa do visitante, mesmo com relay de terceiros pausado. Preserva bytes, ID, assinatura, autoria e audiência do snapshot. Cancelamento local por ID preserva pacotes independentes e de outros originadores; prazo absoluto não renova a concessão. Worker fornece uma autorização interna limitada, sem chaves privadas.

Gate terminal PASS `.cache/contribution-source-final/report.json`: 516 Node, 17 pacotes Go/race (cache de pacotes inalterados identificada nos logs), 74 casos entre processos, typecheck, builds nativo/web, 78 casos em cada Chromium/Firefox/WebKit. 733 hashes iguais antes/depois e reconferidos contra `16c5963`. Não atribuir esse gate à alteração iOS posterior. Provas curadas em `docs/evidence/site-contributions/source-recovery/`.

CI `35772935519` / `d0c3b55`: FAILURE apenas em iOS; todos os outros jobs PASS. O watcher do par Node sofreu TimeoutError; nenhuma mensagem confirmada (`senderID:null`, `messages:[]`). XCTest terminou antes da fototeca. Artefacto 10717234174 e 22 ficheiros dos seus manifestos verificados. É distinto da falha anterior do selector de fotografia. Provas em `docs/evidence/ci-d0c3b55/`.

`3ac8faf` limita a duas repetições apenas leituras de estado com TimeoutError, com processo vivo/deadline original; não repete mutações. 27 testes host-only `node --test apps/ios/Tests/SimulatorRunnerTests.mjs` e sintaxe PASS. Ainda sem repetição em Apple; não afirmar iOS corrigido. Fotografia, anexo, resposta e recuperação continuam por validar nesse ambiente.

## Continuar implementação

Ler `CONTRIBUTION-RECEIPTS-NEXT.md`, `CONTRIBUTION-SOURCE-RECOVERY.md`, docs/SITE-CONTRIBUTIONS.md. O gate de origem está concluído: não repetir essa implementação. Continuar recibos privados assinados do dono, recusa/purga que liberte quota, decisões com CAS/base/esquema/audiência e proveniência. ACK físico, recepção verificada e aprovação/publicação são factos diferentes. Recibo tardio não renova prazo; cancelamento não apaga recepção histórica. Persistir intenção, assinatura e envelope exacto antes de emissão; recuperação e replays finitos.

A paleta de formulários permanece oculta até compor/enviar/rever/recusar/aceitar/reconciliar/publicar funcionarem com UI PT/EN/ES e três contas reais. Continuam grupos web dinâmicos, backup/rotação/keystore, plataformas, rádios e revisão independente. A revisão própria não cumpre a revisão independente; não há novos agentes nesta recuperação sequencial.

HTML público inalterado: runtime `7fdb76a5de5869efa6ebdd721bc7e8f5efac68af`, distribuição `0fdbd1b9563540a5bc28c74d669668e948aa7667`, https://johnnypbelo.github.io/relayloom/. Só publicar após gate da distribuição exacta/HTTPS. Nenhuma alegação de disaster-ready, rádios físicos ou todas as plataformas testadas.


## Descarte local — WIP posterior a f3f32fc

Push normal de f3f32fca43299a5bfab8a92b503f5ae3336c42e2 confirmado. CI35786710953 criado; última leitura em curso na matriz Node. Não lhe atribuir WIP posterior.

O incremento actual implementa dismiss(id,revision) Node/Go/browser, com descarte local atómico, CAS, libertação da quota de provas, metadados finitos e verifiedAt preservado. `inbox.management` permite gerir candidatas bloqueadas/não verificáveis sem devolver valores/provas. Não envia recusa assinada, não publica e não apaga cópias nas caches/pares. Detalhes em CONTRIBUTION-DISMISSAL.md.

Testes dirigidos: 11 Node incluindo 88 vectores Node/portátil/Go (34 aceites/54 recusados), 14 testes armazenamento entre processos, 4 processos TCP/replay/reinício, produção worker2PASS e 7controlosIndexedDB ChromiumPASS depois de corrigir a ordem dafixture. Dois novos controlos de crash doNode aguardam o gate seguinte. A primeira corrida browserconcurrent-source assumia ordem de entrada errada; odescarte ganhou e aorigem foi correctamente recusada. Fixture agora retém explicitamente atransacção e verifica asduasordens; sem alterar deadlines/produto para acomodar oteste.

**Gate sequencial em curso: handle45853**, `.cache/contribution-dismiss-gate.mjs`, relatório `.cache/contribution-dismiss-final/report.json`. Fontes congeladas durante o gate. Inclui typecheck, regressão Nodecontribuições/storage, seis pacotesGo/race afectados, buildnative, processos, buildweb e regressão de85casos porengine prevista (contar resultado terminal, não afirmar passe antecipado). Recolher antes de alterar fontes ou repetir testes. Nenhum agente novo/retomado. Reserva23GiB.

Depois consolidar provas/commit verificado e continuar recibos privados, decisão/CAS/reconciliação/proveniência e UIcompleta. Descarte local não satisfaz recusa assinada nem resolução universal despam. Paleta/HTMLpúblico inalterados; todoocontrato mantém-se.


## Gate de descarte terminou com falhas WebKit — investigar antes de commit

Handle45853 terminou e foi recolhido: typecheck,46Node,seispacotesGo/race,builds,87processos e85Chromium/85Firefox PASS; WebKit82PASS/3FAIL. Falhas: recuperar origem só na fila, cancel-before-admission e cancel-queued; a origem/ponto de retenção não chegou dentro dos15s existentes. Descarte7/7 e worker2/2 passaram também emWebKit, mas o gate global éFAIL. Não consolidar comoPASS nem repetir a suite sem diagnóstico.

Controlos determinísticos novos (`contribution-source-retry-before.log`) reproduziram2FAIL: retendo uma consulta já concluída e executando resume da mesma operação, canServe e sourceForRequest recusavam-na porque finish substituía o objecto de autorização sem haver revogação. A correcção mantém a referência interna quando o registo é canonicamente igual; stop/revoke continua a remover a referência, e uma autorização posterior usa outra. Quatro controlos novos testam com/sem revogação e pedido fresco positivo. É um defeito real; a relação com todas as falhas da rede ainda precisa do passe seguinte.

**Teste dirigido emcurso: handle34744**, typecheck + serve-race/send WebKit, logs `.cache/contribution-source-retry-fixed/`. Não iniciar novo teste pesado. O gateanterior deve permanecerFAIL. Depois do resultado, repetir a regressão browser relevante nos três engines com build de produção novo, conservar os passes Node/Go da fonte anterior e enumerar os dois ficheiros alterados. Só então consolidar descarte e correcção. Recibos continuam rascunhos não integrados em `.cache/receipt-staging/`; não lhes atribuir qualquer passe.


## Correcção da autorização de retry — revisão em execução

Handle34744 terminou0: typecheck e17WebKitPASS, incluindo todas as três falhas de recuperação/cancelamento anteriores e quatro controlos de identidade estável/revogação. Nenhum deadline foi alterado. Gate de revisão **handle55805**, `.cache/contribution-dismiss-reviewed-gate.mjs` e `.cache/contribution-dismiss-reviewed/report.json`: typecheck/build e89casos porbrowser previstos. Confere que apenas runtimebrowser e oteste de concorrência mudaram desde o gateFAIL; os passes46Node/seisGo-race/87processos são preservados com proveniência e não contados como novas execuções. Não alterar fontes até recolher este gate. Code de descarte/correcção aindaWIP; f3f32fc é oúltimo push. CI35786710953 dessecommit aindaemcurso (matrizNode/node-uiPASS,Goemcurso).
