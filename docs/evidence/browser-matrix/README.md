# Matriz browser e curvas portáveis — resultados locais

Código base f25598d mais o incremento de crypto.ts e dos testes/runner. Os relatórios de cada engine incluem a versão efectivamente executada, comandos, resultados e hashes estáveis. As alterações posteriores de rótulos dos testes RNS são verificadas pelos nove percursos adicionais e pelo gateUI; não alteram produção.

| Engine no host Linux | Suite autónoma | UI com Reticulum |
| --- | --- | --- |
| Chromium153.0.8010.12 |30/30 |3/3 |
| Firefox155.0 |30/30 |3/3 |
| WebKit26.6 WPE |30/30 |3/3 |

A regressão da UI partilhada passou25casos Node e25Go, seguida de build/run/package/run desktopLinux. As 42 auditorias Axe do manifesto cobrem capturas novas por engine; não são revisão independente nem leitor de ecrã. Viewports móveis e o user-agent Safari do WPE não demonstram macOS/iOS/Safari reais.

Comandos: `node scripts/verify-browser-matrix.mjs <engine>`; `node scripts/e2e.mjs --config tests/reticulum/ui.config.ts --browser <engine>`; `node scripts/verify-ui.mjs`. Todos estes gates finais terminaram0. O código de produção Node/Go é o mesmo de f25598d; a evidência integral anterior está em ../group-certificate-profile.

Foram reproduzidas falhas intermitentes de geração/importação Ed25519/X25519 na implementação Web Crypto do WebKit deste host. O browser passa a usar@noble/curves2.4.0 para ambas as curvas, mantendo os formatos v1, RNGseguro do browser e WebCryptoAES/HKDF/SHA. Os512ciclos de identidades, oracleNode, vectorRFC7748, operações nativas de curvas deliberadamente indisponíveis, cofre/recovery e leitura/autoria têm controlos reais. Chaves de testes geradas não são publicadas na evidência; o escalarRFC é um vector público da especificação.

A primeira preparaçãoWebKit falhou por bibliotecas ausentes. Cinco arquivosDeb verificados foram extraídos apenas no projecto e usados pelo bundle local, preservando binários/wrappers e sem instalar pacotesOS. O lock de teste é específico de Ubuntu resolute/glibc2.43. Históricos e notices estão preservados.

**Observação aberta:** houve um fechoRTC depois doSOS num primeiro gateWebKit; a causa ainda não foi estabelecida. As repetições e gates seguintes passaram, mas não se afirma que o problema foi corrigido. Ver known-observations.json. O produto, a paridade completa de grupos web, a revisão independente e a matriz de dispositivos continuam pendentes.
