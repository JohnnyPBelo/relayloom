# Browser kernel — execução real, produto incompleto

`node scripts/verify-browser.mjs` passou com366fontes estáveis: typecheck4.665s, build da UI existente1.720s,16testes Node3.420s e6testes Chromium15.215s. Base526d75a, árvore local NÃO COMMITADA. Não é gate de paridade web nem regressão integralC2/C3. Os testes browser incluem execução separada do programa Go para vectores nos dois sentidos, IndexedDB real e WebRTC SCTP/DTLS/ICE em3contextos. Não se afirma que cada contexto equivale a um processo OS separado.

Relatório com comandos/hashes em report.json; scope.json limita as conclusões. Ficheiros de fixtures que contêm chaves sintéticas não foram copiados. A falha original de liveness e a correcção mantêm-se em rtc-before/after-heartbeat.log, com o mesmo prazo do teste. typecheck-before.log conserva a inferência Promise<Promise<T>> resolvida sem alterar tipos globais/configurações.

Nenhuma captura da fixture é apresentada como UI de produto. Os fluxos da UI partilhada, aplicação autónoma, encaminhamento/grupos/outbox e plataformas ainda requerem integração e validação.
