# Estúdio de sites — 16 de Setembro de 2026

Pedido do proprietário: liberdade de criação inspirada na complexidade do ZeroNet, dentro de limites. O contrato completo permanece aberto; a prioridade desta etapa é o motor/editor de sites. Recuperação sequencial mantida: sem novos agentes ou alterações a modelos, bridges e serviços. Preservar UIKit/XCTest e restantes alterações locais. Disco inicial: 78 GiB livres.

## Referência e adaptação

ZeroNet original, HelloZeroNet/ZeroNet, branch py3, árvore 454c0b2e7e000fda7000cba49027541fbf327b96; README blob d8e36a717add9a1bd95bed719a02d48e9b419708. A referência descreve content.json assinado, hashes de ficheiros, actualizações por pares, seeding pelos visitantes e índices SQL sobre dados sincronizados. Não executar nem incorporar o daemon legado; não adoptar promessas absolutas de disponibilidade/anonimato. Consultar as implementações de manifestos/permissões e indexação para registar decisões concretas.

O estúdio RelayLoom terá documentos declarativos versionados, páginas/navegação, composições aninhadas, estilos limitados, Markdown seguro, imagens locais ao documento e widgets de publicações autorizadas. A assinatura continua no manifesto RelayLoom; ler/semear não concede edição. HTML/JS/CSS remoto arbitrário continuam proibidos pelo brief. Não anunciar compatibilidade de protocolo ZeroNet.

## Implementação

1. Esquema de site e validação equivalente TS/Go: páginas e referências válidas, IDs únicos, profundidade/número/tamanho finitos, tipos/estilos explícitos e referências a anexos verificadas. Manter leitura das páginas antigas.
2. Rascunho cifrado/publicação/leitura em Node, Go e browser; preservar o documento completo e os limites dos resumos/histórico. Nenhuma migração destrutiva.
3. Estúdio com estrutura de páginas, paleta, inspector, composições por drag/drop/toque/teclado, duplicação, desfazer/refazer, templates, pré-visualização responsiva e importação/exportação declarativa validada. Renderer partilhado pelo editor e leitura de sites.
4. Testes positivos/negativos do esquema e interoperabilidade; UI real nos três motores/Node/Go, site multipágina com media, recuperação de rascunho, importação inválida, autor offline/seeder, autoria e corrupção. Rever capturas e acessibilidade, corrigir e repetir os gates afectados.
5. Actualizar STATUS/README/retoma. Commits/pushes de marcos verificados autorizados; não cancelar CI35034984024 em curso. Publicar apenas os artefactos exactos verificados.

Pendente do contrato global: estado dos dois dispositivos do proprietário, Bluetooth/radios físicos e restantes plataformas, grupos web, keystore/rotação/backup, escala/quotas e revisão independente. Esta etapa não os substitui.

## Estado recuperado e verificações dirigidas

Sessão89508 terminou PASS1/13,7s antes desta continuação. UI nova:2/2 Chromium em19,5s; interface Node1/3,4s e Go1/2,7s. Integração de sites Node→Go→Node e Go→Node→Go:2/2 em6,626s. Acrescentados leitores de Blob partilhados, posts editados, navegação de ferramentas por teclado, upload com texto PT e limites de bytes descodificados exactos. Schema Node40/40 e Go36vectores+fronteira passaram. Estes passes dirigidos não substituem o gate final.

Gate final `node scripts/verify-site-studio.mjs` iniciado na sessão74379; relatório`.cache/site-studio/final/report.json`, consola`.cache/site-studio/gate-console.log`. Não alterar fontes enquanto corre nem relançar sem recolher o resultado. Um único teste/build de cada vez;15GiB reservados. Mantém todos os testes Node, Go-race, interop, browsers Chromium/Firefox/WebKit,UI Node/Go/pacoteLinux,web pública e9UI-RNS. Não está concluído/publicado.

CIanterior35034984024 terminou:Node3plataformas,Go,RNS,web autónoma e3pacotes desktop passaram; iOS falhou naexecuçãoUI,apósbuild/hostpolicy passarem. Não foi cancelado nem alterado o WIPiOS.

Leitura do log real do job iOS104610894014: `Owned command timed out: seed-synthetic-photo`. O erro foi na preparação da fotografia sintética, após o build e testes do host; não atribuir ao teclado/editor. Resumo sanitizado em`.cache/site-studio/prior-ci-ios-summary.json`.

## Notas da revisão enquanto o gate corre

Não alterar fontes até terminar a operação/gate. Antes de publicar, acrescentar controlos de conformidade para URLs HTTPS com escapes percentuais inválidos, espaços Unicode e hosts IPv4 fora do intervalo: a validação actual usa WHATWG URL em TS e net/url em Go, que podem divergir nesses casos. Ainda é uma hipótese de revisão, não um teste executado. Se se confirmar, alinhar a política lexical e repetir os vectores, integração de sites e gates web afectados.

Melhorias de UX a avaliar: preservar a identidade dos anexos durante edições apenas do documento, para evitar descodificar imagens novamente por tecla; acrescentar página vazia quando o orçamento de 128 blocos já está completo; fazer publicação guardar também o rascunho antes de assinar. Actualmente publicar e guardar são operações separadas, explicitadas no guia, e os limites são impostos na validação de gravação/publicação.

## Gate interrompido por falha real do teste Firefox

Sessão 74379 terminou com exit 1, sem processos/testes deste gate por terminar. Cópia imutável da tentativa em `.cache/site-studio/baseline-final`. Passaram build, native-build, 323 Node, os 16 pacotes Go com race (app 420,485 s), 60 interop (486,818 s) e 36 Chromium (3,0 min). Firefox teve 35 passes e uma falha no `naturalWidth === 1` da imagem do estúdio. WebKit, UI partilhada/desktop, gate público e UI-RNS **ainda não correram nesta tentativa**.

A captura mostrava a imagem abaixo do ecrã. Acrescentar scroll não resolveu (sessão 62488 terminou exit 1; log e trace conservados). A verificação directa com zlib revelou CRC inválido no bloco IDAT do PNG sintético anterior. Os três testes novos agora usam um PNG RGBA 1x1 gerado com chunks/CRC válidos, relatório `.cache/site-studio/png-fixture-check.json`. A execução dirigida Firefox com a imagem válida está na sessão 40833; ler o resultado antes de lançar outro teste. Mantidos a asserção de descodificação e o prazo.

## Correcções confirmadas depois da primeira tentativa integral

- PNG corrigido: Firefox 2/2, 25,1 s, sessão 40833 terminada. As imagens são realmente descodificadas, sem retirar o controlo ou alargar o prazo.
- Conformidade de URLs: os novos controlos reproduziram sete recusas em falta em TS e sete em Go (conjuntos parcialmente diferentes). Política lexical comum para HTTPS, DNS/IPv4, porta, escapes e caracteres; 51 vectores partilhados e quatro controlos TS adicionais (55/55) passaram; Go vectores+fronteira passou. Logs `url-*-before/after.log`.
- O estúdio preserva anexos durante edições só do documento e guarda estados imutáveis no histórico; o orçamento passou a contar bytes de JSON UTF-8 com tamanhos memorizados. Uma página nova começa vazia se o limite global de blocos estiver atingido. Publicar guarda primeiro o rascunho actual.
- Acrescentado terceiro browser novo, autora fechada, seeder em pausa/activo, documento e imagem recebidos pela UI. A primeira fixture não activava o consentimento de C: o protocolo existente só pede inventários automaticamente com participação autorizada. Corrigida a preparação do novo nó; nenhuma política de consentimento foi enfraquecida. Firefox 2/2, 37,0 s, sessão 7105 terminada. Falha inicial em `third-reader-no-consent`, passe em `firefox-third-reader-consent.log`.
- O teste de estúdio suporta agora `RELAYLOOM_LAUNCH_URL=https://johnnypbelo.github.io/relayloom` para validação pública posterior; o gate completo limpa essa variável e continua a testar apenas os artefactos locais.

Próximo: concluir teste UI Node sobre gravação ao publicar, compilar o Go novo, teste UI Go e WebKit dirigido, repetir o gate integral com as fontes finais estáveis. Ainda sem commit/push/publicação deste incremento.

## Repetição integral em curso

Gravação ao publicar passou UI Node (1/4,2 s) e UI Go (1/2,9 s), incluindo prova de que a alteração ainda não estava no rascunho e passa a estar depois de publicar. WebKit dirigido passou 2/2 (34,7 s), com terceiro leitor/pausa e teclado. Todos estes processos terminaram.

Nova execução integral na sessão **66100**, comando `node scripts/verify-site-studio.mjs`, consola `.cache/site-studio/gate-final-console.log`, relatório `.cache/site-studio/final/report.json`. As fontes estão congeladas. Inclui também o gate C SQLite do host; não equivale a Android. Antes de qualquer alteração ou repetição, recolher o estado deste processo. A primeira tentativa permanece em `baseline-final`; não se perdeu a falha Firefox. Ainda sem commit/push/publicação deste incremento.

## Revisão visual restante antes da publicação

Depois do gate actual terminar, verificar um exemplo válido com três colunas e três níveis no editor, em largura média/desktop e móvel. Os testes existentes cobrem arrastar/aninhamento e edição móvel, mas não essa composição extrema. Confirmar que os controlos permanecem alcançáveis dentro das células; a consulta de largura CSS actual usa a superfície inteira. É uma hipótese de revisão visual, não uma falha já reproduzida. Se precisar de ajuste apenas visual, conservar os gates de domínio com os seus hashes e repetir os gates de UI/publicação sobre os assets finais. Não alterar fontes durante a sessão 66100.

Probe visual preparado, ainda não executado: `.cache/site-studio/dense-layout.spec.ts`, com 13 blocos válidos (3×3), quatro larguras e medição dos botões contra os limites do próprio bloco. Executar apenas depois da sessão 66100 terminar: `node scripts/e2e.mjs --config .cache/site-studio/dense.config.ts`. Integrar o teste permanente e repetir os gates afectados se houver correcção.

## Segunda execução integral e revisão visual

Sessão 66100 terminou FAIL na UI Node, não está em execução. Passaram Node338 (417,212 s), Go-race (app 431,051 s; restantes pacotes cacheados), C SQLite do host, interop60 (453,805 s) e browser36×3 (Chromium3,2 min, Firefox3,7 min, WebKit3,9 min). A UI Node passou25/26; `liquid-glass.spec.ts` detectou largura730 em viewport720 no estúdio. UI Go, desktop, public-web e UI-RNS ainda não correram nessa tentativa. **Não usar o ui-go.log antigo como resultado desta execução.** Cópia integral em `.cache/site-studio/domain-final`; falha específica em `.cache/site-studio/ui-overflow`.

O probe denso reproduziu botões fora dos blocos:36/42/45 nos tamanhos1440/1100/720;0 a390. Corrigidos flex-basis das acções, quebra de linhas nos controlos e consultas de largura por bloco. O mesmo probe passou com0 em todas as larguras (3,6 s) e os dois testes existentes Liquid Glass passaram (16,5 s). Teste denso integrado permanentemente em `tests/browser/site-studio.spec.ts`, com paletas e modos da aplicação.

O Axe inicial não denunciou placeholders vazios; a medição explícita encontrou contraste1,5228 em claro/floresta, abaixo4,5. Correcção usa tinta do site e opacidade0,8. Ao deslocar o campo para a zona visível, Axe identificou a dock translúcida sobre a página tinta (3,69). A dock passou a usar a tinta principal; mantém a transparência. A verificação final de paletas está na sessão de `.cache/site-studio/palettes-final.log` (consultar ferramenta para recolher o resultado).

Preparado `.cache/site-studio/verify-layout-final.mjs` para repetir toda a matriz de browsers, UI Node/Go, pacote Linux, distribuição pública e9UI-RNS. Só herda os quatro gates de domínio com passes e compara todos os hashes; permite apenas os dois CSS revistos e o teste browser alterado desde `domain-final`. O comando completo limpo do repositório continua `node scripts/verify-site-studio.mjs`. Não houve redução de casos ou critérios. Ainda sem commit/push/publicação deste incremento.

## Estado final da correcção visual

A dock corrigida preserva transparência e usa tinta principal para manter contraste sobre conteúdo escuro. Teste denso final passou1/9,7 s: quatro larguras, seis combinações de paleta/modo, contraste dos placeholders>=4,5 e Axe. A medição anterior1,5228 e a falha da dock3,69 estão preservadas; não foram alterados os mínimos dos testes.

Nova execução de UI/publicação iniciada com `node .cache/site-studio/verify-layout-final.mjs`, consola `.cache/site-studio/layout-final-console.log`, relatório `.cache/site-studio/layout-final/report.json`. Esta execução compara a árvore com `domain-final`: só permite diferenças em `apps/web/src/site/studio.css`, `apps/web/src/liquid-glass.css` e `tests/browser/site-studio.spec.ts`. Os quatro gates de domínio só são herdados se todos tiverem exit0 e os restantes hashes forem idênticos. Fontes congeladas até ao resultado; não repetir os testes de domínio inalterados nem omitir os gates de UI afectados. Ainda sem commit/push/publicação deste incremento.

## Retoma e falha do gate UI Go

A sessão 96559 terminou FAIL: Chromium/Firefox/WebKit passaram37 cada; UI Node passou26; UI Go passou25/26. O erro exacto em flows.spec.ts:232 foi um locator estrito de role=status que encontrou o indicador do novo estúdio e o toast anterior. Não foi falha da gravação nem do transporte. Preservados relatório, logs e artefactos em .cache/site-studio/status-ambiguity. As duas asserções de gravação/publicação agora seleccionam a confirmação pelo texto, mantendo a verificação visível e o reload. Comando RELAYLOOM_TEST_BACKEND=native node scripts/e2e.mjs tests/e2e/flows.spec.ts passou1/18,3s.

A revisão das capturas mostrou o nome DESTAQUE partido no limite de70px; retirado esse limite e conservado o nome, permitindo aos botões envolverem. Controlo denso dirigido em curso (sessão41922, labels-dense.log). Preparado verify-release-final.mjs, com saída própria release-final; herda só os quatro gates de domínio após comparar hashes, permitindo apenas os dois CSS e dois testes UI alterados. Repete111 browsers, UI Node/Go/desktop, publicação candidata e9UI-RNS. Ainda sem commit/publicação.

## Correcção de proveniência do build na retoma sequencial

A sessão68777 está activa: node .cache/site-studio/verify-release-final.mjs, saída release-final. As fontes estão congeladas. A revisão da captura revelou que appHost serve dist/web sem reconstruir: os primeiros111 browsers e o controlo labels-dense ainda usam o CSS anterior (renderer-B2UqdJlF.css, com max-width70px). Esses passes NÃO validam a última alteração visual. Não interromper a operação; verify-ui reconstrói o bundle, e verify-public-web faz builds próprios. Depois de a sessão terminar, repetir os111 browsers com build explicitamente anterior e hashes dos assets antes/depois. A publicação está bloqueada até esta validação. Preservar as tentativas e não renomear um passe sobre assets antigos como passe da fonte nova. O teste dirigido Go do locator continua válido: só esse teste foi alterado e o runtime era o mesmo.

## UI partilhada e desktop concluídos nesta retoma

verify-ui do gate68777 terminou PASSED: typecheck6131ms, build web2752ms, build Go196ms, UI Node26/172915ms, UI Go26/162685ms, desktop build144ms, execução1328ms, pacote11219ms e execução do pacote836ms. As fontes permaneceram estáveis e o build inclui o ajuste de rótulos. O gate public-web está em curso. A matriz browser inicial ainda será substituída pelo suplemento com build explícito. Ainda sem commit/push/publicação.

## Diagnóstico de ligação desfasado — gate68777 terminou FAIL

A candidata pública passou39 percursos default; na matriz pública passou44/45. WebKit connectivity.spec.ts:187 recebeu channel=connecting depois da mensagem Ligação estabelecida. A API peer-accept aguarda link.ready(), mas o texto de sucesso manual podia antecipar o snapshot periódico do diagnóstico. Corrigido apenas BrowserPeerPanel: depois da resposta aceita mostra confirmação em curso, e o sucesso depende exclusivamente do mesmo diagnóstico open/não fechado que a UI apresenta. Não se modificaram o transporte, os prazos nem as asserções dos testes.

Preservados resultados/traces locais em .cache/site-studio/diagnostic-race; traces com estado sintético privado não serão publicados. UI Node26/Go26 e pacoteLinux passaram antes desta correcção; o gate parou antes dos9UI-RNS. Target WebKit no build público explicitamente reconstruído em curso (sessão81333). Preparado verify-publish-final.mjs: build explícito antes da matriz, hashes dos assets durante os111casos, depois52UI/desktop, public-web e9UI-RNS. Só os domínios com hashes compatíveis serão herdados. O suplemento built-browser-final preparado anteriormente não foi executado e deixa de ser necessário se este gate passar. Ainda sem commit/publicação.

## Nova candidata activa

O comando dirigido inicial81333 só falhou na ordem de argumentos --project; não executou testes. Invocação corrigida node scripts/e2e.mjs --config tests/browser/public.config.ts tests/browser/connectivity.spec.ts --project=webkit passou2/21,7s (sessão24607), sobre o build público reconstruído. Não houve mudança de asserções, timeout, transporte ou crypto.

Iniciado node .cache/site-studio/verify-publish-final.mjs, sessão43274, consola publish-final-console.log e relatório publish-final/report.json. Este gate começa pelo build e prende os hashes de dist/web durante os111browsers. Repete52UI/desktop,85casosweb+2oráculos e9UI-RNS; os números são âmbito previsto até confirmar resultados. As fontes estão congeladas. Sem commit/publicação.

Matriz final43274 concluída com assets estáveis: browser-chromium37/195252ms, browser-firefox37/237216ms, browser-webkit37/242611ms. Continua em UI/desktop; ainda sem gate global PASS ou publicação. Não repetir a matriz sem alteração nova.

## Gate final local PASS

Terminou em 2026-09-16T10:54:22.257Z. 338 testes Node; 16 pacotes Go com race (app executada, restantes cacheados); 5 pacotes SQLite C do host; 60 testes de interoperabilidade; 37 casos por motor Chromium/Firefox/WebKit (111); 26 UI Node e26 UI Go; build/execução/pacote/execução Linux; 85 casos do gate web público e2 oráculos; 9 percursos UI-RNS. Evidência sanitizada em docs/evidence/site-studio, incluindo a falha de locator, a corrida no feedback RTC, o PNG inválido e a proveniência dos builds. Nenhuma dessas falhas foi omitida nem convertida em passe. A execução final inclui build anterior à matriz e hashes de assets estáveis; as antigas matrizes sobre CSS anterior não são usadas como passe final. Revisão independente e todos os restantes requisitos do contrato continuam abertos. Próximo: commit local explícito, publicar assets exactos, validar HTTPS, guardar evidência e push normal único da fonte/documentação sem cancelar CI.

## Fonte e pedido de publicação

Fonte local11d52bed4c6712c5af90d1aecd828e572d9d54cf criada depois de conferir37 hashes das fontes staged contra o gate.168 ficheiros seleccionados explicitamente; WIP iOS/GroupNotices preservado. node scripts/publish-web.mjs --publish terminou com DEPLOYMENT_REQUESTED:86cb0c37713a2ec978ce1844654517c69e8ab1ce, Pages35087757274 em curso. O push da main fica para depois da verificação HTTPS/documentação, sem cancelar CI entre dois commits.

## Publicação e HTTPS PASS

Pages35087757274 terminou success. Fonte11d52be; distribuição86cb0c3. node .cache/site-studio/verify-live.mjs terminou PASS (sessão10200):17 assets HTTP coincidem por hash/tamanho;3 testes do estúdio/34,0s e1 percurso de processosChromium/Firefox/14,5s. Evidência pública em docs/evidence/site-studio/live. Fonte/documentação serão enviadas num push normal da main, sem alterar o WIP iOS ou encerrar outros serviços. Produto completo, dispositivos/radios e revisão independente continuam abertos.
