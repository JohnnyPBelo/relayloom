# Persistência de recibos — concluída no âmbito em f131652

O turno anterior foi progresso: 6e1f530, bf12d51 e 1a53620 enviados; provas/documentação em 0f4d5df local. CI 35794083324/1a53620 confirmado vivo na matriz Node. Não o cancelar nem iniciar agentes. Todo o PROJECT-BRIEF e os bloqueios/paridade/revisão independente permanecem activos. Reserva inicial cerca de23 GiB, mínimo15 GiB.

## Implementação e invariantes

- Intenção do recibo guardada no mesmo commit que autentica e guarda a origem da candidata. Capturar card público do contribuidor e referência original, verifiedAt/created fixos e prazo próprio finito. O estado receipt na própria entrada é a intenção autoritativa; assinatura/envelope ficam numa preparação separada. Um único índice permite verificar origem e criar intenção no mesmo commit, sem dois journals poderem divergir. Registos antigos sem marcador continuam legíveis; só se migram a partir da prova ainda existente, nunca de metadados inventados de descartes antigos.
- Preparações no namespace signing-owned contribution-receipt com domínio/AAD/HKDF distinto em Node/Go e namespace privado no browser. Intenções no índice signing-owned da inbox: até 256 entradas e 1 MiB de metadados partilhados, 64 KiB por preparação e 4 MiB de preparações no total, além da quota global real. Retenção derivada do prazo original da proposta+30dias; expirar remove assinatura/envelope de preparação e conserva metadados até esse limite. Quota não expulsa envios activos silenciosamente.
- Fases prepared→signed→queued→copied (copied é indicador da fila), com assinatura e envelope exactos persistidos em commits separados. Cópia relida antes de emissão. Repetições recuperam os mesmos bytes/ID/nonce/prazos; bloco, retirada, sessão e prazos são revalidados. Descarte da prova na inbox não apaga uma intenção/recibo já guardado.
- Cancelamento/expiração da proposta do visitante não apagam um facto de recepção confirmado. Admissão de um recibo exige corresponder à operação privada anteriormente autorizada e copiada; preparação/assinatura isoladas não bastam. Fecho da fila e libertação do payload têm de ser transaccionais; ACK físico não é recibo nem aprovação.
- Catálogos e helpers internos não são RPC de assinatura. Runtime/transportes, recibo tardio, encerramento de retries e UI continuam separados até estarem efectivamente integrados/testados. A paleta fica oculta até ao fluxo completo de proposta/revisão/decisão/publicação/proveniência.

## Verificações

Vectores Node/portátil/Go para fases, troca de referências/cards, corrupção, quotas e prazos. SQLite real partilhada pelos motores, saída antes/depois dos commits e perda de resposta, sem assinatura antes de intenção durável. IndexedDB real com transacções retidas/lock e recuperação. Depois entrega RTC/WS/TCP/serial com relay sem leitura, partição/heal, cancelamento e recibo tardio, worker compilado e três contas pela UI. Não reatribuir os gates anteriores à implementação nova.


## Persistência de recibos — WIP em 23 de Setembro

Trabalho activo sobre0f4d5df; último push1a53620,CI 35794083324 confirmado vivo (matrizNode/node-uiPASS,Goemcurso na última leitura). Não cancelar com push novo. Só este projecto, sequencial sem agentes,23 GiBlivres.

Novo journal de recibos na entrada de inbox, preparado no mesmo commit da verificação de origem. Metadados de card/referência/prazo fixos sobrevivem a descarte/expiração; assinatura/envelope exactos emnamespace contribution-receipt com HKDF/AAD separados. APIs internas signReceipt/sealReceipt/receiptBundle/copyReceipt emNode/Go/browser; ainda semruntime de entrega ouUI. Protocolos purosde fases/quotas; migração de registos antigos só com prova/source retida e autorizada. Descarte antigo semmaterial não ganha recibo.

Passes dirigidos:12Nodeinitial;26processosinitial;45vectores(17aceites/28recusados) Node/portátil/Go;17Chromiumincluindo6novoscasosrecibo;limpeza de129recibosreais passou cominterrupção após128 remoções e retoma daúltima;65processosstorage/inbox incluindo novas namespaces ecrashesNode/GoPASS. Foram acrescentados depois vectoresdequota/cache de cardclosed-shape,migração,2métodosnegadosnoRPC econcorrênciaGo/Node: não lhesatribuir ospassesanteriores.

**Verificação dirigida actual handle2152**, `.cache/receipt-persistence-reviewed/`: typecheck,vector+Node inbox,1casoconcorrênciaGo/Node comcommitretido. Recolher antes de novo teste pesado. Depois gateamplo comfontescongeladas e provas porhash, corrigir/repetir como necessário, consolidar semcancelarCIvivo. O próximo passo deproduto continua runtime/admissão/entregarecibos e fechoatómicodafila do visitante, decisões/CAS/proveniência eUI completa.

Notas deimplementação: nova cache local de cards guarda apenas os bytes canónicos deidentidades públicasintegralmente verificadas; não guarda política, assinatura deproposta, permissões ousessão. exactShape é verificado antes daconsulta de cache para recusar símbolos/getters; controlosdedicados. LimpezaBrowser éfeita emlotes128dentro docap192 chaves portransacção,sem aumentar esse limite. Metadados e assinaturas mantêm orçamentosglobais efinite retenção. Registos antigos continuamlegíveis emcódigo novo; regressão entre motores antigos/novos não é suportada.


## Gate de persistência iniciado

Handle2152 terminou0: typecheck,50 vectores(18 aceites/32 recusados)+14Node inbox e1 testeconcorrênciaGo/NodePASS. Novo **handle75891**,driver `.cache/receipt-persistence-gate.mjs`,relatório `.cache/receipt-persistence-final/report.json`: typecheck,Nodeintegral,17 Go/race,buildnative,processos,buildeweb e97 casospor browser previstos (usar osresultados finaispara contagens). Fontescongeladas; não modificar nem repetir enquantoestivervivo. Nenhuma entrega automática de recibos é inferida deste gate; runtime continua próximo incremento. Mesmo contrato integral e recuperação sequencial.


## Observação terminal parcial do gate

526 Node PASS(zerofalhas/skips),17 pacotes Go/race PASS(app/sitesexecutados,restantescached),buildnative/webPASS e117 casos entre processos PASS. Chromium 97 PASS; Firefox em curso em75891. Não declarar gatePASS enquanto Firefox/WebKit não terminarem. Os745hashesde fontes continuam iguais. A testagemcurtaGoTestContributionincluía helpersskipped;prova deinteroperabilidade é odriverdeprocessos, não esse passecurto. Nenhuma assinatura/recibo foi enviadoa umvisitante porruntime nesteincremento.


## Recibos com persistência recuperável — 23 de Setembro

**f131652:** verificar a origem guarda também a intenção do recibo. Os motores Node/Go/browser persistem assinatura, envelope exacto e indicador de cópia em etapas recuperáveis; os mesmos bytes e prazos sobrevivem a reinícios, descarte e expiração da proposta. Um registo antigo sem prova não recebe confirmação inventada. As preparações têm namespace privado próprio, quotas e limpeza finita, sem transferir autoridade de assinatura a leitores.

Passaram **526 Node, 17 pacotes Go/race, 117 casos entre processos e 97 casos por cada Chromium/Firefox/WebKit**, além de typecheck/builds. Os logs distinguem cache Go de execução nova. O controlo de 129 recibos e perda de resposta prova a limpeza em lotes sem aumentar o limite da transacção browser. [Comandos, hashes e âmbito](../docs/evidence/site-contributions/receipt-persistence).

**Ainda sem entrega automática de recibos ou fecho da fila do visitante por confirmação.** Seguem runtime, recusa assinada, aprovação/CAS/reconciliação/proveniência e UI completa com três contas. O HTML público permanece na versão anterior; todo o contrato de plataformas, rádios, recuperação, grupos web e revisão independente mantém-se.
