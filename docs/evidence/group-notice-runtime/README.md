# Runtime C2 — execução isolada em Linux

Base: `94c355f`. O relatório conserva a cópia candidata, os comandos exactos, a duração e os 360 hashes de fontes verificados. `inputs.json` conserva os 27 hashes comparados após recuperar a sessão Node 43196, que terminou com código 0. A continuação 48888 também terminou com código 0.

- Build e CLI Go: código 0.
- Node: 269 casos incluindo subtestes (266 de topo), zero falhas/skips, 485,074 s.
- Go/race: 3 testes da aplicação e 4 de carriers; o helper `TestControlInteropFixture` foi omitido nesta invocação e não é contado como sucesso.
- Processos Node/Go: 18 casos, zero falhas/skips, 135,677 s.
- UI nativa: 19 casos Node (145,928 s) e 19 Go (127,595 s), sem falhas/skips. Estes casos precedem a UI dinâmica C3.

Para repetir num checkout deste marco com as dependências do projecto disponíveis: `npm run build`, `node scripts/native-build.mjs`, `npm test`, seguidos pelos comandos em `report.json.steps` no directório do checkout. A UI usa Chromium com sandbox e caches locais ao projecto; a segunda execução define `RELAYLOOM_TEST_BACKEND=native`.

O gate é local, não comprova Windows, Apple, rádio físico ou a paridade web. Não substitui o gate integral Go/SQLite/interop nem os adversariais adicionais. Nenhum resultado antecipado, helper omitido ou criação de agente foi contado como passe.
