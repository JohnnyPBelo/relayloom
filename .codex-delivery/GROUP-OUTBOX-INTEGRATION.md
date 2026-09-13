# Próxima integração: envios de grupos com épocas

Todo PROJECT-BRIEF.md permanece activo. Esta página prepara implementação posterior ao gate da admissão; não é uma funcionalidade entregue. Execução sequencial, nenhum agente novo/retomado, nenhum provider/bridge/serviço/permissão alterado.

## Estado de partida

A admissão já existe em Node/Go e conserva contexto histórico, quarentena e mutações em transacções reais. O envio dinâmico e a emissão de confirmações estão temporariamente recusados. A outbox existente mantém17 campos exactos por intenção,128 pendentes/32MiB de payload reservado,256 operações totais. Os estados correntes são pending/received/read/expired/unavailable/blocked. O ledger já implementa stop/reconcileRetry/retireStops com paragem mínima na reserva de checkpoints.

## Direcção de implementação

- Acrescentar binding imutável `groupEpoch` à intenção de mensagem de grupo; `conversation` já identifica o grupo estável. O bundle, fingerprint, leitores e UUID originais não mudam. O parser requer os campos de grupo em conjunto e recusa grupo com conversation do tipo dm. Campos de mensagens legadas continuam exactos.
- Reservar na criação um booleano `groupStopped: false` para a projecção do stop. A passagem false→true não aumenta o JSON privado. Esse booleano nunca é autoridade: true sem stop correspondente no ledger é corrupção; false com stop não permite retry. Assim o parser estrutural pode continuar a contar o orçamento de pendentes mesmo quando há128 operações antigas superseded mais128 novas pendentes.
- A verdade mínima é o StopRecord autenticado. Toda mudança de autoridade (incluindo prefixo restritivo com cauda inválida) chama reconcileRetry das intenções ainda não completadas na MESMA transacção, antes de devolver a resposta. Não exigir escrita/crescimento do documento privado para gravar esse stop. A normalização do booleano pode ser só em memória e persistir com a próxima escrita privada legítima; se falhar, o stop já impede novas tentativas. Comparar o digest real da versão em disco antes da próxima escrita.
- Ao abrir/desbloquear, validar as relações intenção/stop e a reserva efectiva antes de transmitir ou devolver a outbox. Cada tentativa automática/manual repete a autorização, mesmo que uma projecção anterior ainda mostrasse pending. Um erro incerto exige leitura pela ligação assinada, sem fallback ao JSON legado.
- O orçamento efectivo exclui operações com stop mas conserva os limites de registos. Uma nova intenção normaliza os stops antes de calcular/admitir/persistir o conjunto. A retirada de operações e de stops órfãos é feita no mesmo commit; não apagar um stop de uma operação ainda retida para obter espaço.
- A projecção mantém contagens/horas históricas. received/read completos conservam esse estado mesmo se existir contexto de paragem anterior; o stop continua visível em campo separado. Operações incompletas com stop são superseded. Expiração é uma informação distinta. Pausa por prova em falta não é entrega nem paragem terminal.
- Libertar reserva automática depois do commit do stop, preservando manualPin. Coordenar reservas de quarentena e envios; o reconciliador actual só conhece held e precisa de agregar ambos. Se a reserva falhar, não transmitir.
- Preparar conteúdo novo deriva os cartões/audiência do snapshot actual e do contexto local do alvo, não dos contactos globais. Verificar expected head. As excepções históricas têm o payload mínimo exacto e cartões dos leitores originais. Respostas/edições novas usam a intersecção original/actual; nunca alargar automaticamente a audiência de um bundle pendente.
- Repetir uma operação superseded devolve o mesmo ID/estado. Uma nova publicação exige novo UUID, audiência actual revista e escolha explícita; não reconstruir automaticamente anexos/texto ausentes a partir de um preview truncado.
- Auditar também inventário/seeding próprio e emissão de confirmações: um caminho de sincronização não pode contornar a paragem da intenção local. Cópias já transmitidas e pacotes em trânsito permanecem fora da promessa de revogação.

## Controlos obrigatórios

1. Criar/enviar/receber por APIs reais Node/Go com cartões de grupo sem contacto global, mensagens/anexos e confirmações históricas mínimas; fake tags e leitores errados falham.
2. Partição, adicionar membro e recuperar: repetir bytes/ID/leitores originais; recém-chegado não recebe a chave antiga. Remover/rekey/reentrar/fechar/sair/conflito: stopped/superseded persistido e nenhum novo retry da intenção incompatível.
3. Prefixo restritivo+cauda inválida e stop no mesmo commit; morte antes/depois de commit nos dois núcleos, perda de resposta e retorno do mesmo UUID. Confirmar tráfego real com controlos positivos/negativos.
4. Quota normal cheia: stop mínimo ainda persiste. Mirror privado ausente/falhado não reabre retry.128 stops antigos+128 pendentes novos não ultrapassam reserva e reabrem correctamente. Booleano forjado sem stop é recusado.
5. Preservar manualPin, factos parciais e confirmações tardias; libertar só a reserva automática. Retenção finita/retirada não autoriza replay automático incerto.
6. Provar que callbacks de envio, inventário, confirmação, view/attachment e recuperação consultam a mesma autoridade. Depois ligar carriers e UI real e repetir gates de todos os requisitos afectados.

Esta direcção deve ser ajustada se os controlos revelarem uma contradição; não reduzir o contrato para acomodar uma implementação parcial.
