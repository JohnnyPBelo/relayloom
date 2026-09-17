# API de revisões integrada no nó Node

**Correcção de runtime:** a passagem local rotulada UI Go usou `RELAYLOOM_TEST_BACKEND=go` e executou Node. Não a contar como UI Go. Os restantes testes e logs são preservados. [Âmbito, causa e nova verificação](../site-ui-runtime-correction/README.md).


A aplicação Node cria publicações versionadas através de POSTsite-command, integra as revisões recebidas no catálogo, valida autor/certificado/documento antes de renderizar e recupera a mesma publicação após interrupção. A API genérica não permite contornar a versão. Ainda não há API equivalente Go/browser nem controlos de revisões no editor partilhado.

Gate completo: typecheck e Vite,397testesNode, buildGo,2percursos de interoperabilidade do estúdio legado,31UI Node+31UI Go e Linuxbuild/run/package/run, todosPASS. [Relatório](report.json), [fontes e hashes](manifest.json). As fontes ficaram estáveis durante o gate; depois só mudou o XCTest iOS, num incremento separado ainda por executar emApple.

O teste da aplicação em processos reais verifica versões1/2, leitura de revisão histórica, autor realmente terminado, novo leitor servido por outro nó, permissões privadas, envelope reassinado por outro autor recusado e conflito entre duas instalações da mesma identidade. O conflito requer confirmação explícita das cabeças. O pedido lógico conserva documento, audiência, prazo, UUID e base; repetir não produz outra revisão/cifra.

Falhas injectadas na API mostram ausência de transmissão antes da gravação e conservação de operação committed quando falta espaço/cópia pública. Um processo real termina depois da autorização e antes de gravar o bundle; a aplicação normal retoma exactamente o mesmo ID e entrega ao leitor. Uma cabeça conhecida sem payload não é substituída pela versão antiga ainda disponível. O bloqueio de um leitor suspende cópias privadas e a retoma limpa o erro correspondente.

O percurso TCP→sériePTY tem controlo positivo, ausência durante partição, entrega após heal, autor desligado, novo leitor e pausa/consentimento do seeder. C e o novo leitor não têm listenerTCP e usam só série; A liga apenas a B. PTY é um adaptador real sobre portas virtuais, não rádio físico.

O primeiro driver tinha erros: until foi chamado sem predicate e Router.close não existia. Os casos falharam; os dois processos de fixture que ficaram vivos devido à limpeza falhada foram identificados por PID/argv/parentesco e terminados. Corrigiu-se o driver e repetiram-se todos os percursos. Essa execução não contou como sucesso.

Reprodução: `npm run build`, `npm test`, `npm run native:build`, `node --import tsx --test tests/native/site-studio.test.ts`, `RELAYLOOM_TEST_BACKEND=node node scripts/e2e.mjs` e `RELAYLOOM_TEST_BACKEND=native node scripts/e2e.mjs`. Os comandos exactos dos pacotes e os tempos estão no relatório. Não são provas de UI de revisões ou de execução física em todos os sistemas.

O objectivo completo permanece aberto, incluindo API/persistência Go/browser, editor com endereço/histórico, contribuições, dados declarativos, ficheiros opcionais, rádios/dispositivos e revisão independente.
