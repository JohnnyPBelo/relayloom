# Liquid Glass — interface funcional

Esta camada visual pertence à aplicação React real, servida pelo nó Node ou Go. Usa materiais CSS inspirados em Liquid Glass, sem afirmar refração física ou uso de materiais privados Apple. Não acrescenta bibliotecas, fontes, CDN ou serviços externos. O site publicado mantém a paleta do seu manifesto declarativo.

## Comportamento implementado

- Navegação flutuante, superfícies de leitura estáveis, hierarquia tipográfica, temas claro/escuro e barra móvel com rotas reais. A barra é ocultada durante uma conversa e quando o teclado reduz a área visível; não tapa a área final de uma página, que reserva espaço para ela.
- Pesquisa por botão ou Ctrl/Cmd+K: páginas, acções existentes, conversas e texto de mensagens autorizadas já carregadas. Ignora acentos na pesquisa. Resultado de mensagem abre a conversa e coloca foco na mensagem; mudar de área conserva o rascunho da conversa. Setas/Enter/Escape e retorno de foco suportados.
- A pesquisa exclui mensagens eliminadas, não tem índice persistente nem grava consultas. O bloqueio desmonta o diálogo e remove os resultados. Conteúdo é texto React, sem HTML injectado. Até40 resultados visíveis; a consulta é limitada a256 caracteres.
- Preferência Liquid Glass no dispositivo. O modo de baixo consumo efectivo do nó, alto contraste, cores forçadas e transparência reduzida do sistema suprimem blur. Sem suporte a backdrop-filter, as superfícies são opacas. Movimento reduzido remove a animação. A preferência de efeitos permanece escolhida quando temporariamente suprimida pelo sistema.
- Diálogos nativos seguem a área visível via visualViewport, incluindo o seu deslocamento. Alvos de botões de pelo menos44px; o editor tem alternativas de teclado ao drag/drop e continua a assinar/publicar os blocos existentes.

## Verificação desta iteração

Gate sequencial concluído, saída0: `node scripts/verify-ui.mjs`. O relatório durável fica em `.cache/ui-verification/report.json`, com comando, ambiente relevante, duração, saída e hashes de fontes. Executa typecheck/build, CLI Go, **toda** a suite E2E em Node e Go e build/execução/pacote/execução empacotada do desktop Linux. As289 fontes foram confirmadas inalteradas durante o gate. [Relatório e comandos exactos](evidence/liquid-glass/final/report.json), [âmbito e62 auditorias Axe](evidence/liquid-glass/final/scope.json) e [falhas preservadas](evidence/liquid-glass/failures).

| Verificação final | Resultado |
| --- | --- |
| Typecheck / build web / CLI Go |0 /0 /0;3.959s /1.551s /0.138s |
| E2E completo, Node |19 passaram;142.211s;0 omitidos/instáveis |
| E2E completo, Go |19 passaram;127.734s;0 omitidos/instáveis |
| Desktop Linux: build / arranque |0 /0;0.110s /1.694s |
| AppImage / execução do pacote descompactado |0 /0;10.049s /0.768s |
| Axe |62 relatórios (31 por motor),0 violações |

O executável do pacote descompactado foi efectivamente executado, com daemon separado, API401 sem token/200 autenticada e sandbox preservada. A execução directa do ficheiro AppImage por montagem não foi testada. Fontes dos núcleos/transporte/crypto não mudaram nesta iteração; os seus gates unitários/race/interoperabilidade completos conservam a evidência anterior de confirmações, sem serem apresentados como uma nova execução.

Capturas finais: [conversas claras](evidence/liquid-glass/final/node/messenger-light.png), [escuras](evidence/liquid-glass/final/node/messenger-dark.png), [320px](evidence/liquid-glass/final/node/messenger-mobile-320.png), [pesquisa](evidence/liquid-glass/final/node/commands-dark.png) e [editor móvel](evidence/liquid-glass/final/node/editor-mobile.png). A revisão visual foi feita por root; não substitui revisão independente.

Os novos testes em `tests/e2e/liquid-glass.spec.ts` exercitam mensagens realmente publicadas e recebidas por dois nós, exclusão de uma mensagem eliminada e de outra privada do par, bloqueio via API enquanto a pesquisa está aberta, rascunho, pesquisa sem acentos e teclado. O segundo caso verifica preferências, modo económico real na API, contraste, cores forçadas, navegação móvel, dimensões e alvos em6 áreas×6 larguras (320–1440px), diálogo a390×420 e auditorias Axe/capturas claras/escuras. A conversa com conteúdo recebido é também auditada a320px.

Durante a revisão root, o novo teste descobriu contraste insuficiente **durante** a animação de opacidade da pesquisa. A animação passou a deslocar a superfície sem desvanecer texto. A revisão visual corrigiu também texto claro sobre o aviso translúcido claro. A medição encontrou botões móveis de43px e40px; foi aplicada uma dimensão mínima aos botões, incluindo regras antigas dos breakpoints. A primeira regressão completa após compactar a conversa móvel detectou que o botão directo de envios ficara oculto após reinício; o controlo foi reposto na barra superior, mantendo o mesmo teste de recuperação. Falhas iniciais da fixture foram corrigidas separadamente: resultados limitados ao listbox da pesquisa e espera pela confirmação efectiva de uma preferência remota, sem repetir cliques ou relaxar as asserções.

## Limites

Os viewports móveis do Chromium não são execução Android/iOS nem um teclado de sistema real. Axe e revisão de capturas não equivalem a teste manual com leitor de ecrã nem revisão independente. Browser in-app indisponível nesta sessão; foi usado o harness Playwright existente após a tentativa de ligação falhar, sem alterar bridges/configuração. A recuperação sequencial mantém suspensos os novos agentes; revisão independente desta alteração fica pendente.

A pesquisa integral de todo o arquivo ainda falta. Grupos dinâmicos têm APIs de envio/recibos, mas eventos, carriers e composição/gestão na UI continuam pendentes; esta alteração não completa esses fluxos. Keystore/rotação, restante social/media/templates, notificações reais, artefactos móveis actuais e hardware/rádios conservam os limites de STATUS. Não é um produto concluído nem infraestrutura de emergência validada.
