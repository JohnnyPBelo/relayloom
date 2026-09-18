# Criação persistente de recursos — gate local concluído

Fonte de implementação: **96e35c1**; catálogo: **78cc38c**, sobre f672eaf. Todos os ficheiros de fonte registados nos gates foram comparados por SHA256 com o commit; ver committed-source.json. Node/Go/browser têm criação local e retoma. **Documento v3, referências no snapshot e UI de recursos ainda pendentes; nada deste incremento foi publicado no HTML.**

## Resultado

- 450 testes Node completos, sem falhas ou skips.
- Go `./sites` e `./app` com `-race -p=1`: PASS (13,545s e 495,542s). Os workers Go de vectores/processos são exercidos pelos respectivos testes Node; o passe do pacote sozinho não demonstra a execução desses workers.
- 19 testes de interoperabilidade: PASS. Incluem retoma da mesma SQLite de Node para Go e vice-versa, mortes reais antes/depois do commit/cópia/ready, quota, bloqueio, expiração e seeder reiniciado com autora desligada.
- 19 casos por Chromium/Firefox/WebKit: 57 PASS. Catálogo/API, corrupção/autorização, criação sem broadcast, pedido explícito, RTC/WebSocket e regressão de sites v1/v2 com partição/heal.
- UI existente: um percurso Node, um Go e sete por browser, 23 PASS. Publicação privada/histórico, autoria offline, conflitos, perda de resposta, lease, foco e PT/en/es. **São regressão do editor existente, não interface de recursos entregue.**
- 20 relatórios Axe sem violações. Capturas reais em ui/. O implementador inspeccionou o editor e o leitor Chromium; não é revisão independente nem ensaio com leitor de ecrã físico. O input de título longo desloca o texto horizontalmente no modo de edição; rever essa apresentação na evolução visual do editor.

`report.json` conserva os comandos exactos e hashes antes/depois. `ui/gate-report.json` conserva o gate visual. `summary.json`, `build-hashes.json` e `environment.json` delimitam fontes, executáveis e âmbito. Os scripts locais de orquestração são conservados como `.txt`, não instaladores remotos. Os `.log` foram copiados byte a byte como `.txt` para não serem omitidos pelo ignore global.

## Reprodução

Com Node/Go e dependências/browsers instalados no projecto, executar uma etapa de cada vez e manter pelo menos15GiB livres:

```sh
npm run build
npm run native:build
npm test
node scripts/go.mjs test -race -p=1 ./sites ./app
node --import tsx --test --test-concurrency=1 tests/native/site-resource-api.test.ts tests/native/site-resource-catalog.test.ts tests/native/site-application.test.ts tests/native/site-catalog.test.ts tests/native/site-private-storage.test.ts
```

Por cada `RELAYLOOM_MATRIX_ENGINE=chromium`, `firefox` e `webkit`, executar sequencialmente:

```sh
node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/site-resource-catalog.spec.ts tests/browser/site-resource-api.spec.ts tests/browser/site-resource-network.spec.ts tests/browser/site-api.spec.ts tests/browser/site-network.spec.ts tests/browser/site-revisions.spec.ts tests/browser/application-api.spec.ts
node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/site-publication.spec.ts
```

Para UI nativa, repetir sequencialmente com `RELAYLOOM_TEST_BACKEND=node` e `RELAYLOOM_TEST_BACKEND=native`:

```sh
node scripts/e2e.mjs --config playwright.config.ts tests/e2e/site-publication.spec.ts
```

O valor `native` selecciona Go. A worktree de origem usou os CLIs absolutos do node_modules do mesmo projecto e o seu cache de browsers; os comandos exactos e caminhos estão nos relatórios. Não copiar perfis/cache de testes para a distribuição.

## Limites

São processos e browsers desktop reais no Linux. Não há novas provas de dispositivo físico, Safari/iOS, Android, rádio, assinatura Apple ou prontidão para catástrofes. API de recursos não equivale a documento v3, library UI, downloads pela referência assinada ou contribuições/formulários. O contrato completo continua activo.
