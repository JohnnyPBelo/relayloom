# Outbox de grupos por épocas — integração em curso

Contrato integral: PROJECT-BRIEF.md. A aplicação continua experimental e incompleta. Esta fase liga a autoridade à outbox e ao transporte local; a publicação dinâmica, confirmações emitidas pela aplicação, carriers de controlo e UI dinâmica ainda não estão activados.

## Estado e transacções

Uma intenção de grupo tem os campos exactos adicionais groupEpoch e groupStopped, juntos. O primeiro identifica a época imutável; o segundo é apenas uma projecção. Um true sem StopRecord autenticado é corrupção; false com StopRecord nunca autoriza nova tentativa. O ID, UUID, leitores, fingerprint e datas originais não são reconstruídos quando os membros mudam.

Os comandos de gestão reconciliam as intenções incompletas dentro da mesma transacção SQLite da mudança de autoridade, incluindo um prefixo restritivo cuja cauda é inválida. O stop usa a capacidade reservada de checkpoints. Não depende de reescrever nem fazer crescer o documento privado; a projecção normalizada pode diferir desse documento até à próxima escrita legítima, que compara o digest real em disco. A reabertura usa a ligação assinada e verifica também paragens órfãs. Retirar uma intenção e o seu stop usa um único commit.

O estado superseded identifica uma intenção incompleta parada. Factos completos de recepção/leitura mantêm received/read, com o contexto de paragem separado quando existe. Expiração e presença dos bytes são factos distintos. A falta de história ou autoridade verificável não concede retry. Os limites continuam128 pendentes/32MiB de payload e256 registos retidos; não existe idempotência infinita após retirada legítima do registo.

## Reservas e transmissão

A reserva automática junta os IDs de quarentena e de envios de grupo pendentes, separada do pin manual. A paragem gravada liberta a reserva automática, conservando o pin manual. Reservas não prolongam TTL nem concedem leitura/autoria.

Cada repetição consulta a autoridade. Quando um envio deixa de estar autorizado, os dois transportes retiram os pacotes originados localmente das listas retidas e das filas dos adaptadores. O predicado de cancelamento é código local, nunca recebido da rede. Uma trama já entregue ao sistema operativo e cópias noutros pares não podem ser recolhidas. A supressão de duplicados permanece activa; tráfego com outra origem não é apagado por esta operação local.

O inventário e o serviço de pedidos de mensagens de grupo do próprio autor verificam a mesma época e intenção. Uma mensagem já confirmada também perde essa permissão de partilha se a autoridade actual for incompatível. Os recibos históricos não são apagados. Um leitor ou relay continua a poder semear uma cópia previamente recebida, sem obter autoria ou chaves adicionais: esta funcionalidade não promete revogação retrospectiva.

Um perfil bloqueado não consegue autenticar o seu diário de envios e adia a partilha de mensagens privadas armazenadas até ao desbloqueio. Mantém encaminhamento de pacotes em trânsito e conteúdo público; um relay sem identidade pode armazenar/semear ciphertext. Esta fronteira conservadora não altera permissões ou políticas do sistema operativo.

## Evidência e trabalho pendente

Testes dirigidos em tests/group-outbox.test.ts, tests/transport-cancellation.test.ts, native/app/group_outbox_test.go e native/transport/cancellation_test.go. Incluem quota normal cheia com controlo de crescimento recusado, rollback e perda de resposta, reabertura com mirror falso/paragem real, mirror forjado, ligação trocada, paragem órfã, conservação de pins/factos, cancelamento TCP/reconexão e pedidos TCP reais com testemunha pública positiva.

O driver tests/native/group-outbox.test.ts provoca saídas reais81/82 antes/depois do commit nos dois núcleos, reabre pela API autenticada do outro motor e volta ao original. A fixture instala o bundle assinado/admitido e a intenção inicial. Isto não prova ainda criação/envio dinâmico pela API, transferência automática das provas, UI ou execução móvel. A revisão desta fase é do agente principal; a recuperação sequencial continua sem novos agentes.

O gate completo passou e está em [evidence/group-outbox/final](evidence/group-outbox/final). 211 testes Node passaram179.064s;141 testes Go de topo com race476.758s (10 helpers omitidos isoladamente e executados pelos drivers);26 casos de interoperabilidade243.460s; fronteira SQLite C75.323s;17 UI Node115.845s e17 UI Go109.616s. Build5.524s;22 testes iOS host1.842s e verificação estática0.032s. Desktop Linux: preparação0.336s, execução1.507s, pacote10.029s e execução empacotada1.280s.26 relatórios Axe actualizados, zero violações. Fontes inalteradas durante os gates. O CI de fde529e refere a base anterior a esta integração. Artefactos Android/iOS anteriores não contêm este código.

Seguem publicação/outbox dinâmica real com cartões dos snapshots, audiência explicitamente revista para UUID novo, mensagens/anexos e confirmações históricas mínimas, partições e alterações de membros, carriers limitados, interface e todos os gates do contrato. Não é uma redução do âmbito.
