# Eventos de grupo — APIs e persistência verificadas

As APIs Node/Go publicam reacções, comentários, edições e eliminações sobre mensagens de grupos por épocas. O gate local desta fase passou; não conclui os carriers automáticos de provas nem a composição/gestão dinâmica na interface. `messaging=false` e `outbound=false` continuam a identificar essa integração incompleta.

## Autoria e audiência

`publish` recebe `edit`, `reaction` ou `comment` com `conversation`, `groupEpoch`, `targetEpoch`, `target` e `groupAudience=target`. Exige o head actual exacto, mensagem original localmente admitida e os seus bytes assinados/verificados. O motor deriva os cartões da intersecção entre membros actuais e leitores originais; os destinatários pedidos devem coincidir exactamente, podendo omitir apenas o próprio remetente. Um membro novo não recebe retroactivamente chaves de conteúdo anterior. Só o autor original pode editar.

Reacções levam `emoji` e `value`; comentários/edições levam texto não vazio. Os campos permitidos são explícitos; não se aceitam cartões, anexos ou campos adicionais neste percurso. TTL e listas de destinatários são limitados. Os eventos não ultrapassam intencionalmente a vida restante do alvo, sujeito ao mínimo de um segundo dos bundles.

`delete` usa exclusivamente o payload histórico mínimo: `type`, `target`, `conversation`, `targetEpoch`, `groupAudience=historical`. Só o autor original o pode assinar; a audiência é a mensagem original completa. Um encerramento ou remoção de destinatários não converte esta eliminação em texto novo nem transfere autoria. O tombstone local persiste pelas regras de materialização existentes; não apaga cópias retidas por outros pares.

## Persistência e retransmissão

Criar o bundle, verificar a assinatura, decifrar e admitir o evento ocorre antes de escrever no ContentStore ou emitir pacotes. O alvo vem dos bytes verificados e do ledger autenticado, nunca de um resumo HTTP. A observação posterior à escrita materializa alterações pelo percurso existente.

Estes eventos seguem a publicação genérica: não têm recibos de entrega próprios, UUID de operação eterno nem reconstrução a partir de uma pré-visualização. Bytes retidos podem propagar mais tarde por inventário/pedido, dentro de quota/TTL. Uma falha depois de persistir bytes pode ter resultado incerto: o evento original pode ser recuperado e servido depois; não se promete cancelamento de uma publicação apenas porque a resposta falhou. Sem bytes não se reconstitui o evento.

Para eventos novos do próprio autor, inventário/pedidos revalidam admissão, ligação ao alvo, provas históricas e autoridade da época. Alterações de grupo, bloqueio e lock retiram futuras tramas locais das filas, incluindo uma cópia retida cujo ficheiro foi removido. O predicado do router é puro; não consulta armazenamento nem altera a sua configuração. As cópias de outros leitores continuam a ser seeders e não adquirem autoria. Tramas já entregues ao sistema operativo e cópias remotas não são recolhidas.

## Controlos dirigidos e gate pendente

- APIs e TCP reais: Node/Node e Go/Node, Node/Go, Go/Go passaram reacção/comentário/edição/eliminação, recusa de não autor, head encerrado, audiência original e zero contactos globais.
- Três nós em Node e em duas combinações Go/Node passaram entrada de novo leitor sem chaves antigas, intersecção de audiência, autor desligado com porta recusada, outro leitor a servir mensagem/edição, reinício do autor, remoção e nova época, edição ilegível pelo removido e eliminação histórica que ainda chega ao leitor removido.
- Node: rollback/perda de resposta no commit, erro antes/depois de escrita do payload, cancelamento e pedido/inventário com testemunha TCP positiva. Ausência de prova histórica pausa publicação e seeding sem corromper o cursor actual; prova exacta repõe a autoridade.
- Go com race: falhas de commit, cinco cenários de fila com transferência bulk real retida e controlo positivo, prova histórica ausente/alterada/exacta. Falha física do índice após escrita de payload e recuperação pelo processo reiniciado conservaram os bytes assinados exactos no TCP.

`tests/group-events.test.ts`, `tests/group-event-failures.test.ts`, `tests/group-event-seeding.test.ts`, os respectivos drivers `tests/native` e `native/app/group_events_test.go` contêm os controlos. As fixtures trocam **provas de controlo explicitamente pelas APIs**; isto não é sincronização automática P2P de certificados. As mensagens/eventos são transferidos pelos sockets.

O primeiro gate passou236 Node, mas detectou uma segunda leitura de anexos na consulta Go preparada (29.100.032 bytes contra14.485.480 de baseline). A consulta passou a partilhar os manifestos acabados de verificar. O teste original passou sem alterar o orçamento, e foi acrescentado um controlo de corrupção com outbox de mensagens vazia. As falhas da fixture (erro esperado para payload evictado, espera pelo rate limit e tipagem de tuplos) estão separadas das falhas de produção.

## Gate final concluído

Comando: `python3 .cache/group-events-final/run.py`, seguido de `python3 .cache/group-events-final/desktop.py`. As cópias dos scripts, comandos exactos, logs e hashes estão em [evidence/group-events/final](evidence/group-events/final); [falhas preservadas](evidence/group-events/failures).

| Verificação | Resultado |
| --- | --- |
| Build | passou,5.580s |
| Node |236 testes,291.635s |
| Go com race/count=1 |153 testes de topo,621.017s;11 helpers exercitados pelos drivers de interoperabilidade |
| CLI Go | passou,0.962s |
| Interoperabilidade |38 testes,378.001s |
| SQLite C |31 testes de topo da fronteira,207.489s;2 helpers não executados isoladamente |
| UI Node / Go |19 /19 testes,134.686s /133.737s |
| Host iOS / estática |22 testes,1.975s /0.029s; sem executar Swift localmente |
| Desktop Linux | build0.208s,execução1.878s,pacote descompactado4.889s,execução do pacote0.876s |

Os drivers de morte/recuperação acima usam o Go padrão; não se atribui execução com SQLite C aos helpers omitidos nessa invocação.

300 fontes foram confirmadas inalteradas durante o gate e a execução desktop. Foram arquivados56 relatórios Axe únicos actualizados, todos sem violações. O runner amplo partilha6 ficheiros raiz entre os motores: ambos os testes fizeram as asserções, mas os JSON Node substituídos pelos Go não foram inventados no arquivo. A evidência Liquid Glass anterior tem o seu arquivo separado de62 relatórios.

As capturas do editor e conversa foram novamente geradas por clientes reais. Revisão independente, carriers, UI dinâmica, artefactos móveis actuais e rádios/hardware permanecem pendentes. O CI93f24f1 anterior passou Node/Go/desktop, mas falhou no helper nativo de teclado iOS antes do submit; não continha estes eventos. Não se afirma validação para catástrofes.
