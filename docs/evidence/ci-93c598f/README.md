# CI93c598f — limite global do job Go

Run34750795247. Node passou em Linux/Windows/macOS. O job Go começou às10:09:19Z e terminou cancelled às10:24:21Z. Build, testes/race, C SQLite, interoperabilidade e UI constam como success; desktop/iOS foram skipped por dependência.

A anotação exacta confirma: “The job has exceeded the maximum execution time of 15m0s”. O log termina depois do upload de artefactos e teardown. Não é HTTP408 do Copilot nem um timeout de fotografia/WebView. Não existe resultado Apple novo neste run.

A alteração de projecto aumenta só timeout-minutes de native-go para25. Conserva todos os comandos, matrizes, encadeamento e limites internos dos testes, iOS e recursos. Não muda modelos, bridges, autenticação, permissões ou serviços. A validade YAML foi verificada localmente; o próximo CI confirma a execução completa sob este orçamento.

A primeira asserção auxiliar contou12 passos do runner, mas o YAML contém11 (o setup implícito não é um passo declarado). A verificação corrigida comparou a árvore YAML inteira com HEAD e confirmou que só o orçamento mudou; budget-check.json regista o resultado.
