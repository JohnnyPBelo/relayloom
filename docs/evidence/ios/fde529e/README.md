# CI observado — fde529e, run34728934069

Node em Linux/Windows/macOS, Go e os três pacotes desktop passaram. Os pacotes Windows/macOS não são prova de execução gráfica nesses sistemas.

Xcode26.6 e o runtime iOS26.4.1 compilaram para teste, arrancaram o simulador em148.054s e instalaram a app. A importação da fotografia excedeu o prazo em60.836s; os diagnósticos terminaram em5.754s. XCUITest não executou neste run e a nova captura da WKWebView não foi alcançada. Só o simulador criado foi apagado.

É um resultado diferente de274004e, onde a fotografia passou e o XCUITest lançou a app, mas falhou à espera da WKWebView. Não apaga essa evidência anterior. Nenhum dos dois runs passou um fluxo funcional iOS.

O log de assetsd indica estado prep-accessible e uma falha de registo de uma extensão de sistema; não demonstra a causa do bloqueio de addmedia. Não atribuir este timeout ao upstream Copilot. Logs .log foram copiados como .txt para ficarem versionados; simulator-report.json aponta para esses nomes. artifact-hashes.json é o original do runner e conserva os nomes originais.

A alteração local seguinte verifica separadamente o arranque da app antes da importação, exporta até duas capturas nativas dessa etapa e conserva o gate funcional completo.22 testes host e verificação estática passaram; essa alteração ainda não tem compilação Swift nem execução Apple.
