# Web em dois dispositivos — 2026-09-15

Pedido: disponibilizar a aplicação web por URL e continuar todos os alvos. O contrato integral, a recuperação sequencial e as alterações locais anteriores mantêm-se. Nenhum agente novo é criado nesta etapa.

## Plano em execução

1. Criar distribuição estática autónoma própria, servível sob `/relayloom/`, sem a entrada da API nativa. Tornar worker, manifesto e cache offline relativos à instalação. Não alterar CSP, permissões ou segurança do browser.
2. Exercitar o build público: caminhos, integridade, contexto seguro, UI real de duas identidades, RTC, mensagens/recibos, anexos e recuperação offline. Manter os controlos e a matriz existente. Processos/contextos de teste não são dispositivos físicos.
3. Publicar os ficheiros verificados em GitHub Pages do próprio repositório, por HTTPS, sem dados de utilizadores. A origem distribui código; não hospeda mensagens, identidades ou sinalização. O pedido de disponibilizar a web autoriza esta publicação; nenhuma bridge/provider/serviço alheio é alterado.
4. Verificar o URL efectivo e entregar instruções simples para dois dispositivos na mesma rede alcançável. Não prometer atravessar qualquer NAT sem um caminho compatível. Todo o requisito de paridade web continua em aberto onde ainda falta implementação.
5. Continuar iOS e restantes aplicações/grupos web. Actualizar README/STATUS/retoma com comandos, resultados e bloqueios reais.

## Estado inicial confirmado

HEAD/origin: f378e130456d036315d9a0b432d65e71b22860a3. 20 GiB livres; mínimo 15 GiB. GitHub Pages ainda não configurado (API 404, has_pages=false). Ficheiros UIKit/XCTest e documentação/evidências anteriores preservados.

CI main34916793582 e WIP34917778173 terminaram: todos os jobs excepto iOS passaram. Artefactos de iOS recolhidos em `.cache/milestones/web-launch/{ios-main,ios-wip}` (menos de 5 MB). Main continua a falhar no teclado. WIP496788b fechou o teclado, publicou, ligou por TCP e guardou mensagem privada; abriu Fototeca, mas falhou em `seeded synthetic photo`. Não declarar fluxo iOS completo passado. Os logs `gh run view --log` vieram vazios; o diagnóstico acima vem dos artefactos XCTest.

## Resultados

Gate público terminado PASS:18 UI do build existente,24 no build público,1 percurso UI Chromium↔Firefox em processos separados (63 488 bytes exactos,recibos,offline). Gate `node scripts/verify-ui.mjs` terminado PASSED:25 Node,25 Go,desktop Linux build/run/package/run. Ambos com fontes estáveis. Evidência em docs/evidence/web-launch.

Código commitado em ff2fb60. Publicação estática ec3a3baa8ed39d103d9b9a4f7823be355bc9fd88 em codex/web-pages, push normal e nenhuma alteração ao índice/branch de trabalho. Pages criado apenas neste repositório; https_enforced=true confirmado. CI de distribuição34940021714 terminou success. URL HTTPS respondeu200/título RelayLoom;13 ficheiros de execução com hashes/bytes iguais. O teste publicado Chromium↔Firefox passou14.5s,sem daemon/comunicação com backend e com recarga offline. Nenhuma bridge/provider/permissão de browser ou serviço alheio alterado.
