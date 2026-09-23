# Estado actual verificado

Fonte4f309e6: gate finalPASS,540Node/17Go-race/185processos/140porengine,782hashes,27artefactos curados. Benchmark limitado ao cenário medido. CIremoto posterior ainda pendente; oFAILd6d4ddb mantém-se. Todos os handles locais foram recolhidos.

As secções seguintes preservam o histórico; notas de execução emcurso foram ultrapassadas por este estado.

# Serialização nativa — medição e regressão emcurso

## Entrega de recusas consolidada; optimização canónica em regressão

22962 terminou/recolhidoPASS:539Node,17Go/race,185processos,140Chromium/140Firefox/140WebKit, builds e780hashes. Fonte commitada localmente em **ac772242145135894da0d97b1712bc7e9db64c92**; curador52151 terminou/recolhido e guardou55artefactos em docs/evidence/site-contributions/rejection-delivery. Ainda semnovo push, para tratar a falhaCI antes de o repetir. Todo o restante objectivo continua activo.

51033 terminou/recolhido: baseline canónica sem alterar produção. Compatibilidade com referência anteriorPASS; o novo controlo de limite final FALHOU como esperado porque a pontuação final podia exceder24MiB. Benchmarkrace de~1,55MB:142.9/144.2/148.4ms por operação,32alocações e~8,39MB alocados. Logs .cache/canonical-baseline.

Foi aplicado o fastpath de sequênciasASCII sem escapes e a verificação final do orçamento. Unicode/WTF-8/escapes mantêm o percurso anterior.36658 terminou/recolhidoPASS: typecheck,Go/core-race,512combinações decompatibilidade/limites,260vectores combytesesperados doNode, benchmarkrace e teste de recuperação de site. Novo benchmark6.20/5.20/4.97ms,4alocações e~3,10MB; o teste de recuperação passou em31.881s. Não generalizar este microbenchmark a todoo produto nem declarar CI corrigido semnovaexecução. Logs .cache/canonical-fastpath-first.

**64504 emcurso**, driver .cache/canonical-final-gate.mjs, relatório .cache/canonical-final/report.json. Nova regressão completa sobre a produçãoalterada, fontescongeladas ehashesconferidos. Não editar/não relançar enquanto estiver vivo. WIP desta optimização: native/core/canonical.go, native/core/canonical_fastpath_test.go e tests/canonical-runs.test.ts. Não voltar a copiar rascunhos antigos.

Depois: recolher64504, corrigir falhas, consolidar provas comdiferença de versão e gates, actualizarREADME/STATUS/retoma e fazerpushnormal apósconfirmarCIanterior terminal. Continuar incorporação/proveniência/formulários/revisão/publicação/UIde3contas e todoocontrato; o incremento de recusa não conclui as páginas nem o produto.

## Regressão canónica avança para Go

64504 permanece vivo, agora native-race. Typecheck e540testesNodePASS, semfalhas/skips. Os782hashes de fonte continuamiguais. Não editar nem relançar enquanto o gate está activo; depois recolherGo/processos/browsers e só então consolidar a optimização. O microbenchmark continua limitado à serializaçãoASCII local; não implica aceleração uniforme do produto nem passeCIremoto.

## Go/app passou na regressão optimizada

64504 já avançou para native-integration, confirmado vivo. Os17Go/race ebuildnativo terminaramPASS. Go/app terminouPASS em384.325s (execução anterior de entrega de recusas468.735s nestehost), Go/sites10.997s. É uma observação local, não garantia de melhoria uniforme nem passeCI. As restantes fases continuam;782hashes iguais e fontescongeladas.

Preparado .cache/curate-canonical-performance.py, ainda não executado: exige gatePASS/commit com hashes exactos, guarda o controlo de orçamento que falhou antes, oráculos e medições originais/finais. Não curar ou commitar como verificado antes do resultado terminal. Nenhuma fase foi reiniciada por falta de observação.

## Optimização entra na matriz de browsers

64504 confirmado vivo, agora browser-chromium.540Node,17Go/race,185casos entre processos ebuildsnativo/webPASS. Nenhum skip/falha nos relatóriosNode/processos. Matriz140casos porengine emcurso; não anteciparFirefox/WebKit.782hashesiguais, semedições duranteogate. A optimização permaneceWIP atéconclusão/revisão/commit/provas; CIremoto d6d4ddb permaneceFAIL.

## Chromium canónico concluído; Firefox activo

64504 confirmado vivo em browser-firefox. Chromium terminou140casosPASS, semfalhas/skips/flaky, somando-se a540Node/17Go-race/185processos/builds.782hashesiguais. A matrizFirefox/WebKit ainda precisa de resultado terminal; não repetir nem editarfonte. Curador canónico preparado mas nãoexecutado. Depois do gate: revisão/commit/provas, envio normal comCIanterior terminal e continuaçãofuncional de incorporação/proveniência/UI.

## Firefox canónico concluído; WebKit activo

64504 confirmado vivo em browser-webkit. Chromium eFirefox terminaram140casos cada, semfalhas/skips/flaky. WebKit aindaemcurso; nãoantecipar resultado.782hashesiguais. Depois do resultado terminal: rever, commitar os3ficheiros daoptimização, executar .cache/curate-canonical-performance.py, consolidar docs/provas dasrecusas/ac77224 ecanónica, confirmarCIanterior terminal epushnormal. Continuar aprovação/incorporação/proveniência/UI com todososrequisitos; nãodeclarar produtoconcluído.
