# Descarte local recuperável — implementação em curso

Base f3f32fc, contrato integral activo. Execução sequencial, sem agentes novos/retomados. Implementar a gestão da pressão de quota antes de activar revisão de formulários. Não é uma recusa assinada entregue ao contribuidor; recibos/decisões remotas continuam no próximo incremento.

- Comando fechado dismiss(id, revision) no perfil dono: revisão CAS evita eliminar uma candidata que mudou desde a revisão. Repetição do mesmo descarte é idempotente; revisões futuras são recusadas.
- Terminal dismissed com dismissedAt, prova privada removida no mesmo commit, verifiedAt histórico preservado. Não apaga recepção factual, não publica dados nem assinatura nova. Expiração não ressuscita nem reclassifica descarte. A retenção finita e limites de metadados existentes continuam.
- A inbox fornece management com revisão e metadados mínimos, sem valores ou provas, inclusive para candidatas bloqueadas/não verificáveis. Descarte não depende de permissão de leitura do autor bloqueado; depende da sessão e autoridade privada local. Não muda o bloqueio nem reabre pedidos de origem.
- Replays e envelopes alternativos do mesmo certificado ficam suprimidos; conflitos do mesmo UUID continuam limitados. Quota de provas é libertada sem expulsar outras pendentes. Não há promessa de defesa universal contra Sybil nem eliminação de cópias na cache/pares.
- Compatibilidade de registos antigos Node/Go/browser. Corromper a prova não pode ser ocultado por descarte: validar antes de remover e falhar fechado. Verificar fronteiras de commit/reabertura, concorrência e sessão/lock.
- Gates: vectores canónicos, catálogos SQLite partilhados Node/Go com falhas reais, API entre processos e replay/reinício, IndexedDB/browser/worker. Depois recibos privados assinados, decisões CAS/proveniência e UI completa PT/EN/ES com três contas. Paleta continua oculta até o fluxo integral funcionar.


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


## Descarte privado e autorização de retry — 22 de Setembro

**6e1f530:** o dono pode descartar uma candidata através do comando privado, inclusive quando o visitante está bloqueado ou falta a origem. A revisão evita actuar sobre uma vista desactualizada. Prova e estado terminal mudam no mesmo commit; reenvios não reabrem a candidata e o facto histórico de verificação é preservado. A libertação é da quota lógica da inbox; não apaga cópias na cache/pares. Ainda não é recusa assinada nem fluxo completo na interface.

Passaram 46 testes Node, seis pacotes Go/race (quatro com cache) e 87 casos entre processos. O primeiro gate browser encontrou três falhas WebKit; dois controlos reproduziram uma autorização invalidada por retry idêntico. A correcção preserva a referência em retries iguais, mantendo a invalidação após revogar. A revisão passou **89 casos em cada Chromium/Firefox/WebKit**, com os dois ficheiros alterados e os passes anteriores distinguidos. [Comandos, falhas e provas](../docs/evidence/site-contributions/dismissal). Recibos, aprovação/CAS/reconciliação/proveniência e UI de três contas continuam obrigatórios. HTML público inalterado.
