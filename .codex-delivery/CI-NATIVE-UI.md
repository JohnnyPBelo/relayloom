# CI nativo — separação da UI após cancelamento global

O run35150603062 foi cancelado pelo limite do job native-go de25min. A anotação GitHub diz explicitamente: "The job has exceeded the maximum execution time of 25m0s". Os testes nativos/race, SQLite C e interoperabilidade tinham passado; a UI foi cancelada, e iOS/RNS/pacotes ficaram sem execução nesse run.

A workflow conserva native-go com25min e os mesmos comandos de domínio/interop. A UI passa para native-ui, dependente de native-go, com15min, o mesmo comando/backend/browser e artefacto próprio. RNS, desktop e iOS dependem agora de native-ui. A ordem e a cobertura mantêm-se; não se alteram prazos de casos, permissões, providers ou bridges.

O controlo local .cache/page-organisation/ci-chain-check.json validou YAML, dependências e presença única dos quatro comandos originais. A execução remota da mudança ainda é necessária. Não repetir o job agregado antigo nem chamar a mudança de configuração um passe de iOS.
