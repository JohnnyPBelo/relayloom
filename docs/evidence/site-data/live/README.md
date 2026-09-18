# Tabelas publicadas — 18 de Setembro de 2026

**URL:** https://johnnypbelo.github.io/relayloom/

- Fonte: `59c9bd1a4b8aa2efa03d37c8758ef943e0de37ee`.
- Distribuição: `f6758222a5e7b993ebb5970b8653a4090596941c`.
- Pages: execução35317766195 concluída com sucesso; HTTPS obrigatório já configurado, sem alteração de serviço.

O gate público passou102 percursos na compilação normal,108 na distribuição sob `/relayloom/` e um percurso entre processos independentes. Só esses artefactos foram publicados. Depois,19 ficheiros de execução coincidiram exactamente por hash e tamanho no HTTPS; `release.json` também corresponde à fonte e ao digest do manifesto. `.nojekyll` é um marcador de build, não um ficheiro de execução.

No endereço real passaram15 percursos: quatro do editor de tabelas e um de versões/seeding em cada motor Chromium, Firefox e WebKit. Incluem importação CSV/JSON e falhas, valores tipados, undo, tema escuro, campos inválidos, privacidade, histórico, publicação entre contas e reabertura com autora desligada. Os testes de versões incluem terceiro leitor servido por um leitor consentido. Um percurso adicional com processos Chromium e Firefox independentes passou mensagens nos dois sentidos, anexo exacto de63488 bytes, recibo e recuperação offline.

[Relatório](report.json) · [Manifesto dos52 artefactos](manifest.json) · [Verificação HTTP](http.json) · [Gate público](public-gate.json). Os ficheiros `gate-*.txt`, `site-ui.txt` e `two-processes.txt` conservam as saídas dos comandos. `site-ui.config.txt` e `verify-http-source.txt` conservam os verificadores locais usados; para repetir, repor essas cópias em `.cache/site-data-integrated/live/site-ui.config.ts` e `verify-http.mjs`, respectivamente, a partir da raiz do projecto. Os argumentos exactos e variáveis de ambiente estão no relatório. Não usar `--list` como evidência de execução.

É execução de browsers no Linux, incluindo processos independentes, não dois dispositivos físicos, Safari/iOS, Bluetooth ou rádios. A tentativa pública anterior interrompida teve duas falhas de UI; os passes seguintes não demonstram a sua causa original. A observação RTCFirefox histórica continua aberta. [Falhas e retoma](../integration-fixes/report.json).

O produto integral não está concluído. Recursos opcionais e contribuições multiutilizador ainda não estão na aplicação publicada; hardware/signing, paridade completa e revisão independente continuam por verificar ou implementar. As novas provas da regressão427Node/66UI/Linux estão em [integração](../integrated).
