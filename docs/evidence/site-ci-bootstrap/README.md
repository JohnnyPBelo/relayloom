# Preparação dos pares Go no CI

O CI35274725658 da fonte6dd879d falhou nos testes que passaram a lançar paresGo: o jobnative-node não compilava o executável antes de npmtest. O logLinux mostra sete falhasENOENT, incluindo o controlo que recusa contarNode comoGo. A alteração acrescenta Go1.26.8 e native:build antes dos testes nos três hosts, mantendo todos os casos e o prazo15min.

Uma árvore Git isolada em .cache/site-ci-clean começou sem .cache/native-app. O Go foi compilado dessa mesmafonte. O primeiro driver local omitiu os assetsWeb que oCI já compilava; esse erro foi conservado. A sequência corrigida fez typecheck/Vite e passou os11testes de selecção de motor/controladores, com processos reais. O workflow foi analisado comoYAML e a ordem e os três hosts foram conferidos. Não é um novo passeWindows/macOS; oCI com esta alteração ainda tem de executar.

A aplicação e os artefactosWeb não mudam. O comando de reprodução completo é npmrunbuild, npm run native:build, npmtest. Os controlos actuais de iOS/radio e o fechointermitenteRTC continuam com os seus estados próprios, sem serem corrigidos por esta preparação.
