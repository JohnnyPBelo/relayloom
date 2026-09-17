# iOS — instalação e erro de paragem separados

[CI 35174446730](https://github.com/JohnnyPBelo/relayloom/actions/runs/35174446730), fonte `0c6b58a`. Xcode26.6/iOS26.4.1, sem novos runtimes descarregados. A compilação passou; a instalação não obteve sucesso dentro do prazo (registo de65154ms, exitCode-1). A paragem do grupo de processos devolveu `kill EPERM`, e o runner substituiu a falha original por esse erro. Não chegou à fotografia nem ao teste de arranque/fluxo funcional. [Relatório original](ci-0c6b58a.json).

O runner conserva agora a primeira falha e regista separadamente stopFailure, com sanitização. A sequência/scope dos sinais, os processos alvo, os limites, as permissões e a configuração dos serviços permanecem os mesmos. A falha de paragem não transforma uma instalação incompleta num passe. Não se afirma resolvida a causa da demora na instalação.

`node --test apps/ios/Tests/SimulatorRunnerTests.mjs`:24PASS, incluindo recusa de paragem comEPERM e paragem bem sucedida após uma falha. `node scripts/ios-simulator.mjs --check`:STATIC_ONLY_PASSED. [Testes do host](host-tests.log) e [verificação estática](static.json). Estes resultados não são execuçãoApple nem validação do selector de navegação; a nova versão do runner ainda precisa deCIApple.
