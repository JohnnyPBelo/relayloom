# Diagnóstico de arranque iOS — verificação no host Linux

A alteração em NativeSimulatorTests.swift captura a tela da app, se esta ainda está em primeiro plano, antes do teardown quando a WKWebView não aparece. Relança o erro original; conserva o prazo de45s e os restantes gates. Não altera a aplicação, isolamento, bridge, permissões ou serviços.

Comandos já executados em2026-09-13, sessão1467 terminada com código0:

- `node --test apps/ios/Tests/SimulatorRunnerTests.mjs`:19/19 passaram em1.632s; log host-tests.txt.
- `node scripts/ios-simulator.mjs --check`: STATIC_ONLY_PASSED; log static-check.txt.

Isto valida apenas os contratos host e a estrutura do projecto. Swift não compilado nesta verificação; simulador/dispositivo não executados. A captura tem de ser observada num próximo CI Apple. A falha anterior, após a fotografia ter passado, permanece documentada em ../274004e.
