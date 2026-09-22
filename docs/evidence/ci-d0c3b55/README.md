# CI d0c3b55 — falha distinta no iOS

Execução [35772935519](https://github.com/JohnnyPBelo/relayloom/actions/runs/35772935519), fonte **d0c3b55ff6d312222a1bc72e0fa48a8019822976**. Resultado global FAILURE apenas em iOS. A matriz Node, o novo job UI Linux, Go/race, interoperabilidade, UI Go, Reticulum, os três pacotes desktop e browser autónomo terminaram com sucesso. Esta execução não cobre a recuperação de origem posterior.

O artefacto iOS10717234174 tinha357222bytes. Foram recolhidos e conferidos os22ficheiros dos seus dois manifestos, sem divergências. `run.json` conserva o estado dos jobs; `ios-verification.json` conserva os caminhos originais da recolha, agora copiados em `ios/`.

O build/install/startup XCTest e a importação da fotografia passaram. O percurso criou identidade, publicou um post e avançou pela ligação TCP/navegação. A observação do par Node não confirmou nenhuma mensagem: senderID é null, messages vazio e replyReadConfirmed false. O watcher registou um TimeoutError de observação e interrompeu xcodebuild após168790ms. O teste não chegou à fase da fototeca. Não confundir com a falha de selector de f69eb24 nem afirmar entrega privada nesta execução.

O código do watcher abortava a execução à primeira falha de leitura de estado com limite10s. **3ac8faf** passa a repetir apenas essa observação read-only até duas vezes, enquanto o processo próprio está vivo e dentro do deadline global original. Não repete mutações, não aumenta deadlines e continua a recusar erros de protocolo, estado malformado, processo terminado e três timeouts. Regista os timeouts sem conceder passe de XCTest ou de entrega.

Os **27 testes host-only** do runner passaram depois da alteração, e a sintaxe Node foi verificada. Isto ainda não é uma repetição em Apple nem demonstra a causa do atraso da API. Anexo, resposta, recuperação e o selector da fotografia continuam pendentes até uma nova execução real. Nenhuma permissão, bridge, modelo ou serviço foi alterado para contornar a falha.
