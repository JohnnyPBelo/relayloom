# Descarte local de contribuições — gate concluído

Fonte **6e1f530864f0e0894a63b1a0a9c7df21a56c2bbf**, partindo de f3f32fc. O objectivo integral continua activo; isto não é o fluxo completo de formulários nem uma recusa assinada entregue ao visitante.

`dismiss(id, revision)` elimina a prova privada e guarda o estado `dismissed` no mesmo commit. A revisão protege contra uma vista desactualizada. Repetições são idempotentes e envelopes alternativos não reabrem a candidata. `verifiedAt` conserva o facto histórico; descartar não significa que a recepção nunca aconteceu. Expiração posterior não altera esse facto. A janela finita de metadados e todos os limites globais continuam aplicados.

`inbox.management` devolve revisão e metadados mínimos para gerir candidatas bloqueadas ou não verificáveis, sem valores nem provas. O comando exige a sessão do dono e não necessita desbloquear o visitante. A corrupção da prova impede o descarte e não é ocultada pela limpeza. Registos antigos são aceites pelos motores novos; motores antigos não conhecem a fase nova e não são uma forma suportada de abrir um perfil actualizado.

## Execução e âmbito

O gate amplo `before-review/gate.json` terminou FAIL apenas em três testes WebKit. Depois da correcção, o driver `run-gate.mjs` conserva os passes inalterados Node/Go/processos com proveniência, confere os dois ficheiros alterados e repete a regressão browser. Contém os comandos exactos e a reserva mínima de 15 GiB. Para repetir todos os testes num checkout limpo com as dependências/caches do projecto: `node docs/evidence/site-contributions/dismissal/before-review/run-gate.mjs`. O driver `run-gate.mjs` documenta a retoma desta revisão e requer o primeiro relatório/cache e o binário nativo já compilado; não é uma repetição integral dos testes herdados. Recusa substituir um relatório existente. `gate.json` inclui tempos, saídas, PIDs e 736 hashes antes/depois, iguais e conferidos contra o commit.

- 46 testes Node de contribuições/armazenamento PASS, incluindo 88 vectores canónicos (34 aceites, 54 recusados) Node/portátil/Go.
- Seis pacotes Go/race PASS: app e sites executados; groupstore, profilestate, profiledb e sqlitedriver reutilizaram cache de pacotes inalterados. Não é uma nova execução integral dos 17 pacotes do gate anterior.
- 87 testes entre processos PASS, incluindo 16 de inbox partilhada Node/Go e quatro novos percursos TCP de descarte. Mortes reais antes/depois do commit nos dois motores, perda de resposta, leitura cruzada, corrupção, replay e canal positivo foram verificados.
- Typecheck, compilação nativa e web PASS. 89 testes por Chromium, Firefox e WebKit PASS na revisão; zero falhas/skips/flaky nos relatórios finais. Incluem sete novos controlos IndexedDB, o worker compilado e UI existente, RTC/WS/TCP/serial, partição/heal, leitor persistente com autor offline e limites de relay. Serial usa PTY; não são rádios físicos nem Safari/iOS real.

## Defeito de autorização de retry corrigido

O WebKit detectou três falhas na obtenção de origens privadas. Dois controlos determinísticos reproduziram a causa: uma repetição idêntica da operação substituía o objecto usado como autorização, invalidando consultas que estavam em curso. A referência passa a ser mantida apenas quando o estado persistido é canonicamente igual. Uma revogação remove-a; voltar a autorizar cria outra referência. Os quatro controlos positivos/negativos provam que um retry normal permite concluir a consulta e que bloquear/desbloquear nunca ressuscita uma resposta antiga, embora uma consulta nova possa passar. Os 17 testes WebKit dirigidos e a matriz revista passaram, sem aumentar timeouts.

Os únicos ficheiros de fonte alterados depois do gate amplo são `packages/browser/src/contribution-runtime.ts` e `tests/browser/site-contribution-serve-race.spec.ts`; os resultados Node/Go/processos pertencem à execução anterior, com fontes relevantes iguais. O relatório original continua FAIL e não foi reescrito como sucesso.

## Falha de fixture preservada

A primeira corrida de concorrência assumia que anexar a origem entrava primeiro na transacção, mas esse caminho faz validação assíncrona antes da fila. O descarte ganhou correctamente e a origem foi recusada. A fixture corrigida retém explicitamente a transacção e testa ambas as ordens. Não se alteraram prazos ou código do produto para obter o passe. Logs antes/depois em `controls/`. Os testes host/storage dirigidos anteriores têm o seu próprio âmbito; os dois novos crashes Node estão no gate final de 87 casos.

## Limites

Descarte liberta quota lógica das provas na inbox, não apaga cópias cifradas da cache comum/pares nem garante apagamento físico SQLite/WAL. Metadados retidos ainda contam para 256 entradas; não há promessa de resistência universal contra spam/sybil. Não há novo recibo, aprovação, publicação ou nova paleta UI neste incremento. O HTML público e as plataformas/rádios físicos não foram publicados ou validados por este gate. Revisão própria não cumpre a revisão independente, ainda pendente na recuperação sequencial.
