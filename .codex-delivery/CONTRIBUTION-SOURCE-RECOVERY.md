# Recuperação da fonte guardada na fila privada

Trabalho a partir de d0c3b55. O turno anterior foi progresso real: inbox/API, controlos, gates e push. Objectivo completo activo; execução sequencial sem agentes novos/retomados. Reserva inicial desta fase cerca de33GiB; mínimo15GiB. Nenhuma alteração de providers/bridges/permissões/serviços.

## Implementação prevista nesta fase

- Comando fechado `contribution-command/obtain-source` recebe apenas o ID da candidata. O motor lê a prova privada, revalida sessão/bloqueio/retirada/prazo e deriva o snapshotId. A consulta não é aprovação nem recibo. O pedido de rede é tráfego próprio e tem limitação de frequência, como a obtenção explícita de recursos.
- O visitante responde a pedidos desse snapshot apenas se existir operação própria queued/copied, não cancelada/expirada e permitida pela política actual. `queuedSource` já conserva e verifica os bytes originais. Não há nova assinatura nem alteração de autoria/audiência; nenhum helper de assinatura/chave é exposto noRPC.
- Fonte é enviada em wire bundle normal, com prioridade bulk. A resposta suporta a submissão própria, mesmo com relay para terceiros pausado; não activa relay nem serve outros dados privados.
- Cada resposta fica ligada a uma operação concreta e ao ID local do pacote. Cancelar/bloquear/retirar/expirar deve retirar só os pacotes desse apoio, preservando publicações independentes e pacotes de outros pares. Acrescentar cancelamento por IDs locais aos routers.
- Browser precisa de autorização local por pacote, fora do wire: guarda síncrona de vida/sessão/prazo e verificação assíncrona da permissão antes da transmissão. Uma resposta retida durante cancelamento não pode escapar depois. A permissão inclui operationId/prazo e nunca é autoridade fornecida pelo peer.
- Pedidos sem candidata, candidatos bloqueados/expirados, sources não referidos por fila activa e cópias adulteradas devem falhar com controlo positivo do mesmo caminho. O suporte não aparece como conteúdo público nos inventários da fila privada.

## Gates

Routers: cancelar ID local preserva outro pacote com payload igual e tráfego de outro originador; fragments/reconnect não reaparecem. API: snapshotId deriva da candidata, caller source/ACL são recusados. Processos Node↔Go: normal cache ausente nos dois lados, fonte apenas na fila do visitante, relay pausado em ambos, pedido explícito e promoção da inbox, bytes/autoria originais. Negativos de cancelamento/bloqueio/retirada/expiração e fonte corrompida. Browser: IndexedDB/cache eviction, autorização retida durante cancelamento, RPC/worker de produção e ligações RTC/WS reais. Regressão apropriada e provas por fonte.

Depois continuar recusa/purga, recibos assinados, decisão/CAS/proveniência e UI completa. Nenhum destes passos reduz o contrato de plataformas/rádios/grupos/recuperação/revisão independente. Não publicar HTML nem activar paleta antes dos respectivos gates.


## Implementação WIP e testes iniciais

Ligado obtain-source nos três motores. Lookup deriva o snapshot da candidata persistida; IDs desconhecidos/campos adicionais são recusados. A fila copiada/activa permite responder com queuedSource, com relay de terceiros pausado. Node/Go guardam IDs de pacotes por source/operação; BrowserMesh recebe uma permissão interna do worker e associa guarda síncrona/assíncrona ao pacote. Cancelamento usa IDs locais e não muda o wire nem a autoria do snapshot. TTL do pacote é limitado por prazo absoluto para não o renovar durante cópia/canonicalização.

Novas primitivas: Router.cancelLocalIds (Node/browser), CancelLocalIDs (Go); BroadcastUntil noGo e deadline opcional Node/Browser. BrowserRouter.LocalPacketPermission não faz parte do wire. MeshProfile.getOwnedSource é opcional para adapters antigos; produção usa RPC profile/contribution-source com pedido fechado. Main client reconhece contribution-source-request e cancel-contribution-source. A resposta antiga de consulta/pacote não pode atravessar um cancelamento.

Resultados recolhidos: seis processos Node↔Go PASS (recuperar, cancelar, bloquear/desbloquear, ambos os relays pausados, fonte ausente das duas caches, bytes/autoria exactos). Cinco testes Node de cancelamento/prazo PASS; Go transport/race PASS. Chromium: recuperação e três fronteiras de cancelamento PASS (consulta retida, validação antes da admissão e pacote bulk emfila); teste de cancelamento por ID preservando payload igual/foreign origin e prazo exacto tambémPASS após corrigir a fixtureRTC.

Falhas de implementação/fixture conservadas: patch inicial pôs deadline no callback requestSource em vez de publishSource, apanhado pelo typecheck; corrigido sem executar código errado. A fixture nativa tinha continue fora de loop, corrigido para return antes de executar testes. A primeira fixture de router browser chamou link.ready antes do evento ondatachannel; acrescentada espera limitada pela existência real do canal. Logs contribution-source-deadline-typecheck.log, contribution-source-process-typecheck.log e contribution-source-router-browser.log. Positivos nos logs correspondentes fixed/first e late-cancel. Não chamar estas falhas de defeitos de rádio/modelo.

Ainda falta: teste/integração de worker de produção para obter origem, controlos de bloqueio/retirada/expiração/corrupção na nova resposta, Firefox/WebKit, interop/multi-hop desta origem privada e regressão dos transportes/apps após os novos métodos. Não há commit/push deste WIP. Nenhum teste local está emcurso na última recolha (handles99948/79949/34742/16517/51007/41927/93010/43444/50915 terminais). Todos os requisitos de recibos/decisões/UI e produto completo continuam pendentes, sem redução.


## Alargamento e gate amplo iniciado

Novo build de produção e15testesFirefox PASS;15WebKit PASS, incluindo os novos controlos RPC do worker (sem origem antes da fila activa, lease com autor/operação/prazo correctos, campos extra recusados e ausência após cancelar). O gateFirefox antecede estas asserções adicionais do worker; não reatribuir-lhes esse passe. O worker não recebeu chaves privadas. A obtenção efectiva fonte-só-fila porRTC é testada no motor browser com bridge real para Mesh; falta ainda um percursoUI de obter/rever formulário, que continua oculto.

Guarda browser capta também identidade e metadados autor/leitores; bloquear invalida respostas pendentes e o pacote de apoio, sem activar relay. Routers mantêm cancelamento porIDs locais e expiração absoluta. Não há alteração do formato wire nem nova assinatura do snapshot. Teste browser de router foi corrigido para esperar o evento real de criação do datachannel antes de ready; não alterar timeouts do produto.

**Gate amplo agora vivo: handle68627**, driver `.cache/contribution-source-gate.mjs`, relatório `.cache/contribution-source-final/report.json`. Sequencial: typecheck, Node integral,17pacotesGo/race,buildnative,processos de source/inbox/storage/rede mista,buildweb,browsers afectados incluindorouting/native-transport nos três engines. Não modificar fontes nem relançar enquanto vivo. O código continuaWIP sobre d0c3b55; nenhum push novo e HTML público inalterado. Recepção não é recibo/aprovação; recusa/CAS/proveniência/UI continuam obrigatórios.


### Observação do gate sem relançar suites

Continuação de verificação: handle68627 confirmado vivo. Typecheck e Node integral terminaramPASS (**516testes, zero falhas/skips**); native-race emcurso. Relatório `.cache/contribution-source-final/report.json`. Nenhuma fonte alterada durante o gate. CI35772935519/d0c3b55 passou a matrizNode, node-ui, native-go e native-interop; native-ui emcurso na última leitura. Não atribuir resultados desseCI aoWIP da recuperação de fonte. O plano de recibos/decisões está em CONTRIBUTION-RECEIPTS-NEXT.md e não é implementação. Próximo passo: recolher68627 e continuar conforme o resultado, sem reiniciar por timeout de observação.


## Recuperação da origem — gate concluído, 22 de Setembro

593459a/16c5963: cancelamento por IDs locais, prazo absoluto e obtenção explícita da origem na fila privada com relay pausado. 516 Node, 17 pacotes Go/race, 74 casos entre processos, builds e 78 casos por browser PASS; 733 hashes confirmados contra 16c5963. Provas docs/evidence/site-contributions/source-recovery. Não há recibos/decisões/UI completa; continuar CONTRIBUTION-RECEIPTS-NEXT.md. Contrato integral e execução sequencial preservados.

CI35772935519/d0c3b55 falhou só em iOS, watcher com TimeoutError antes da fototeca e sem mensagem confirmada. 3ac8faf repete apenas observações readonly limitadas; 27 host tests PASS, sem repetição Apple. Provas docs/evidence/ci-d0c3b55. Não confundir estes resultados com a falha anterior do selector nem declarar iOS corrigido.
