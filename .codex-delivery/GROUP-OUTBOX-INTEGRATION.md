# Próxima integração: envios de grupos com épocas

Todo PROJECT-BRIEF.md permanece activo. A integração da autoridade da outbox está agora em implementação local, posterior ao gate da admissão; ainda não é publicação dinâmica entregue. Execução sequencial, nenhum agente novo/retomado, nenhum provider/bridge/serviço/permissão alterado.

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

## Iteração local em curso — 2026-09-13

Base publicada fde529ed0ff9dad7eacd7b3f157929ba1f3f0d6a (inclui6734f1f/5845515 e diagnóstico iOS). Não confundir com as alterações locais seguintes.

Node/Go têm agora os campos opcionais exactos groupEpoch/groupStopped, estado superseded, contexto de paragem na projecção, reconciliação dentro do commit de gestão, verificação na abertura/repetição e retirada conjunta dos stops ao retirar intenções. O espelho normalizado pode diferir do documento em disco, cujo digest continua a ser comparado. Reservas da outbox de grupo e quarentena partilham uma união; manualPin conserva significado separado. Publicação, envio automático de confirmações, carriers, UI dinâmica e guarda de inventário/seeding próprio continuam pendentes, por isso outbound/messaging continuam false.

As fixtures destes testes instalam uma mensagem realmente assinada/admitida e a intenção correspondente. Não são ainda envio dinâmico pela API. Nove testes Node passaram8.080s, incluindo quota normal cheia e controlo de crescimento recusado, rollback/perda de resposta, reinício com false+stop, true sem stop, ligação alterada e stop órfão. A primeira fixture chamou preference em vez de localAction; erro corrigido, log preservado. Go dirigido detectou primeiro assinaturas erradas da fixture e depois retry em vez de outbox-retry; a repetição corrigida está em .cache/group-outbox-go-second.txt. Confirmar o código de saída antes de atribuir passe. Prefixo restritivo/cauda inválida e retirada conjunta acrescentados depois dos9 Node e precisam do gate actualizado.

Nenhum agente novo/retomado nesta fase. Revisão pelo agente principal, sem substituir o gate independente. Seguem controlos reais de múltiplos processos, mortes antes/depois de commit,128 stops+128 pendentes no ledger (o teste actual só prova o orçamento estrutural), transporte/partição/heal e UI. O contrato não foi reduzido.


## Gate da autoridade concluído

211 testes Node passaram179.064s;141 testes Go de topo com race476.758s (10 helpers omitidos isoladamente e executados pelos drivers);26 casos de interoperabilidade243.460s; fronteira SQLite C75.323s;17 UI Node115.845s e17 UI Go109.616s. Build5.524s;22 testes iOS host1.842s e verificação estática0.032s. Desktop Linux: preparação0.336s, execução1.507s, pacote10.029s e execução empacotada1.280s.26 relatórios Axe actualizados, zero violações. Fontes inalteradas durante os gates. Evidência em docs/evidence/group-outbox/final. Cancelamento local, guarda de inventário/requests e apresentação de pausa/superseded foram implementados e testados depois da nota de iteração acima. A criação/envio dinâmico pela API, emissão de confirmações e carriers permanecem por ligar; não considerar as fixtures de intenções como esse resultado. Seguir o contrato integral após este commit.


## Criação real — implementação seguinte, ainda não versionada

Node group-send.ts e Go group_send.go agora criam mensagens/replies pelas APIs reais a partir do snapshot e do target local autenticados, sem contactos globais. A intenção preparing e a admissão dos bytes localmente assinados/verificados partilham o commit anterior à escrita do content store. O resto do pipeline exige reserva física e ready antes da rede, e nunca recria a partir do preview. Repeat com UUID retido antecede a validação de head novo e devolve o ID/estado original.

Dois processos Node passaram texto/anexo/reply e recusas; três percursos native/node, node/native e native/native passaram ficheiro sem texto/reply e stop/ID. Testes em tests/group-send.test.ts e tests/native/group-send.test.ts; a fixture group-send transfere provas por APIs, mas não injecta chaves nem intenções. Faltam falhas/restart/partições extensas, confirmações históricas pela aplicação, publicação de eventos, carriers e UI dinâmica. Manter os requisitos e gates completos.
