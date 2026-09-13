# Arranque antes da fotografia — validação no host Linux

Após fde529e, o runner verifica testStartupBeforeMedia antes de addmedia. O teste lança a app real, espera45s pela WKWebView e pelo formulário de identidade, e captura a tela antes de terminar a app. O runner exporta até2 PNG desta etapa separadamente; o teste funcional completo continua a exigir fotografia, mensagens/reply por um peer real, recuperação e4 screenshots próprios.

Comandos: `node --test apps/ios/Tests/SimulatorRunnerTests.mjs` —22/22 passaram1.842s no gate final; `node scripts/ios-simulator.mjs --check` —STATIC_ONLY_PASSED em0.032s. Os controlos impedem importar fotografia após falha/zero testes e impedem chamar passe funcional a um passe de arranque. Uma falha da fotografia preserva a evidência de arranque que já existir.

Swift não compilado nem simulador executado nesta alteração. Não muda bridge, isolamento, permissões, serviços, prazo da WKWebView ou deadline global. Não resolve por suposição a causa de addmedia. Evidência anterior em ../fde529e.
