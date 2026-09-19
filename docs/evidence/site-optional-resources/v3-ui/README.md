# Referências v3, biblioteca e leitor — gates locais consolidados

O estado mais recente está em `final/summary.json`:306 execuções de browser,68 UI Node/Go,quatro unitários,builds,execução/pacote Linux,oito RNS e três UI-RNS PASS. O backend do gate inicial conserva os hashes relevantes. `final/report.json` distingue execução/proveniência; a falha de socket do primeiro arranque está preservada. As secções cronológicas abaixo conservam os estados intermédios. Este incremento implementa recursos opcionais em sites assinados e na UI partilhada; não conclui RelayLoom. A revisão é do implementador, não independente. O HTML público ainda usa a versão v2 identificada em STATUS.

## Regressão anterior às correcções

`pre-review/report.json` contém os comandos exactos, ambiente específico de cada fase, resultados e hashes das 659 fontes antes/depois. `pre-review/summary.json` resume as fases; `manifest.json` identifica os logs por hash/tamanho.

Passaram typecheck, build web/Go, 461 casos Node, 17 pacotes Go com race, 92 interoperabilidade, cinco pacotes SQLite C, 34 UI Node, 34 UI Go e 97 por browser Chromium/Firefox/WebKit (291). As suites UI/browser não tiveram falhas nem skips. Os casos sobrepostos entre gates não devem ser somados como testes distintos.

## Controlos negativos da revisão

`review-before` conserva três falhas observadas contra o produto anterior: busy limpo por um pedido ultrapassado, contraste/paleta incorrectos e associação transitória de novo nome/MIME com URL antigo. O primeiro teste de paletas encontrou também uma remontagem durante scroll; a repetição dirigida observou as seis combinações completas. Ambos os relatórios estão preservados.

- `overlap.json`: motor real, dois pares RTC, primeira obtenção requested, inspect available e resposta seguinte retida. O botão estava activo prematuramente; após libertar a resposta, bytes/autoria foram verificados.
- `preview.json`: fronteiras reais de MutationObserver e cleanup, com os bytes/MIME de cada Blob. Os downloads estabilizados eram correctos; a associação transitória falhava.
- `palettes.json`: seis combinações da paleta do site e tema da app, com auditorias Axe antes/depois da obtenção. Não há exclusões de contraste.

Para reproduzir os controlos num checkout isolado da candidata, construir e executar `tests/browser/site-resource-review.spec.ts` com a configuração `tests/browser/matrix.config.ts` e `RELAYLOOM_MATRIX_ENGINE=chromium`. Aplique `review-before/revert-ui-fixes.patch` **apenas nesse checkout de teste** para regressar às duas fontes anteriores e reconstruir o web build. O patch foi reconstruído das alterações e os bytes resultantes foram comparados, exactamente, com os hashes do gate original em `baseline-source-hashes.json`; não é uma nova execução dos testes históricos. Os comandos das execuções reais estão nos relatórios JSON.

## Primeira correcção e verificação seguinte

O primeiro gate passou typecheck/build e registou sete casos UI aprovados, uma falha de contraste e um caso sem conclusão antes de ser interrompido. Handle/driver/PID foram confirmados ausentes; não foi chamado PASS. Os resultados de overlap e preview passaram. Um diagnóstico posterior recolheu as regras CSS reais: regras antigas do tema escuro ainda sobrepunham botões/links dos sites claros. Os selectores do recurso foram delimitados pela superfície e pelo elemento, sem !important nem diminuir Axe.

O gate `.cache/resources-post-review-fixed/report.json` falhou no foco Firefox; o controlo e a correcção estão em `reader-focus`. O ajuste tipográfico seguinte expôs uma herança de cor indevida, corrigida e validada nas seis paletas dos três engines em `palette-controls`. A regressão actual é `.cache/resources-final-regression/report.json`, com hashes estáveis: Chromium101/101 e Firefox101/101 PASS; WebKit e restantes fases em curso. Difere do gate original em resource-view.tsx, resources.css, visit.tsx e no novo teste de revisão. Reexecuta todos os percursos UI afectados nos três browsers e nos motores Node/Go, além de build/run/package/run Linux e regressão com a referência RNS. A aprovação final deste incremento permanece pendente até terminar.

## Limites

Os pares e transportes são processos reais neste host; não equivalem a dispositivos físicos. Rádios, iOS/Android actuais, assinatura Apple, paridade completa, contribuições/formulários assinados e revisão independente permanecem no contrato. Um teste de GATT/PTY é uma simulação dessas interfaces físicas, não Bluetooth/LoRa no ar. Este incremento ainda requer integração e distribuição exacta/HTTPS.


## Capacidade de composição e cancelamento

`inspection-budget` conserva a falha original numa página válida de128blocos/123referências:64disponíveis e59erros de orçamento. A primeira tentativa de fixture com128irmãos foi correctamente recusada; esse relatório também está separado. A fila automática mantém o limite global do cliente e os limites do documento.

Os controlos positivos verificam123referências, fecham/reabrem com4respostas reais retidas, confirmam que119pedidos ainda não iniciados foram descartados e obtêm os bytes exactos do último recurso. Quatro unitários e5Chromium/5Firefox/15WebKit passaram; o último número inclui três repetições. A primeira fixture de inventário retinha estado1 e podia impedir o polling seguinte; a versão corrigida retém só o estado real da versão2. Os resultados históricos não são apagados.

A execução integral actual é `.cache/resources-bounded-final/report.json` (handle4347):102 porbrowser,UI Node/Go,desktop eRNS, com663hashes e sete diferenças explícitas face ao gate inicial. Ainda emcurso. Os nomes dos gates anteriores neste documento são históricos; não os tratar como activos nem como aprovação da candidataactual.


## Execução actual com o orçamento limitado

A regressão activa é `.cache/resources-bounded-final/report.json`, handle4347, com663fontes e sete diferenças explícitas face ao gate inicial. Unitários4/typecheck/build PASS e Chromium102/102 PASS; Firefox e as fases seguintes ainda emcurso. Os gates `.cache/resources-final-regression` e anteriores são históricos e terminaram com as falhas/limitações descritas acima. Não inferir aprovação integral a partir dos controlos dirigidos.
