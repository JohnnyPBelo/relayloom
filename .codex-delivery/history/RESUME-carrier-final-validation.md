# RelayLoom — retoma activa, 2026-09-13

## Checkpoint activo — gate C1, 2026-09-13 18:32 UTC

**Esta secção sobrepõe o estado de testes descrito nas secções anteriores preservadas abaixo.** Sem agentes novos/retomados, sem alterações a configurações/modelos/bridges. HEAD continua adfd52a e toda a implementação C1 está NÃO COMMITADA.95GiB livres. Produto incompleto.

O gate integral está em execução: **sessão83929**, runner `.cache/group-carriers-final/run.py`, estado exacto em `report.json`, fontes congeladas em `source-hashes.json` no mesmo directório. Build6.056s,22 testes host do runner iOS1.670s e estática0.031s passaram; Node está em curso. Seguem Go/race (incluindo groupcontrol), CLI, toda a interoperabilidade, fronteira SQLite C (inclui TestGroupControl), UI Node e Go. Não editar fontes nem relançar enquanto corre. Recolher com write_stdin83929 e ler relatório/logs. Depois do passe host, executar `.cache/group-carriers-final/desktop.py` (preparação/execução/pacote/execução empacotada), recolher e rever as capturas/Axe e arquivar provas. Nenhum preview conhecido activo.

Progresso real deste turno: Go requests+TCP/serial passaram2 casos22.538s;18 vectores de codec/envelopes criados em `tests/native/group-carriers.test.ts`/`native/groupcontrol/interop_test.go` passaram em ambos os motores. Novos testes de quota provaram que output contornava a quota auxiliar; `retain` comum agora protege respostas e cache. Outra falha reproduzida de retirada de prova antes de recusar uma substituição sem espaço foi corrigida; plano completo e gravação precedem a limpeza. Controlo Node de falha de escrita e throughput real3–4MiB/min passou; Go/race4 casos42.101s passou antes da última política de envelopes.

A regressão intermédia Node terminou **251 passaram381.944s** (sessão19734, log `.cache/group-carriers/node-regression-first.log`). Posteriormente os sockets provaram que controlos públicos eram recusados no armazenamento mas ainda encaminhados: **falhou Node e Go**, corrigido em validateWire/ValidateWire com validador comum do envelope. Agora private/tamanho/duração são verificados também no relay opaco, antes de encaminhar; ciphertext<=1MiB, bundle<=2MiB, duração1h+10ms. `maySeed` usa a mesma política de metadados. Testes verificam ausência no seeder e no destinatário, com controlo válido entre recusas; cancelam cada retry negativo antes de medir o seguinte. Expiração do carrier não apaga checkpoint. **9 testes dirigidos posteriores passaram9.314s**, sessão10797 terminou0; incluem6 codec Node,1 driver18vectores e2 relays reais Node/Go. Nova expiração Go é abrangida no gate actual.

Logs de reprodução/correcção em `.cache/group-carriers`: response-quota-*, eviction-plan-*, producer-limits-*, opaque-envelope-*, envelope-complete-directed.log. Nenhum teste anterior em curso:85186,31668,61476,83008,8812,34497,10872,31191,19734,12530,89846,13060,52938,97541,2563,10797 terminaram. CLI actual compilado depois da política de envelopes; o gate recompila-o após Go.

Novos ficheiros adicionais: `tests/fixtures/group-control-envelope.ts`, `tests/group-control-envelope.test.ts`, `tests/native/group-control-envelope.test.ts`, worker/vectores referidos acima. `README`, `docs/STATUS.md`, `docs/GROUP-CARRIERS.md` e learning-log foram actualizados com falhas/resultados/limites. `.codex-delivery/GROUP-NOTICES-IMPLEMENTATION.md` é a nota C2 derivada do código, **não implementação**.

Depois de fechar C1, continuar C2 transporte durável de convites/consentimentos/saídas e inbox sem auto-adesão; C3 gestão/composição na UI Liquid Glass, restantes requisitos e gates. Não activar messaging/outbound só por existir sincronização de provas. CI adfd52a/macOS HTTP continua sem causa demonstrada; o passe local não prova correcção Apple. Hardware, assinatura Apple, leitor de ecrã e revisão independente recente continuam pendentes. O objectivo integral permanece activo; nenhum novo408 observado.

## Objectivo e restrições

Continuar todo o PROJECT-BRIEF.md, exclusivamente em /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra e recuperação sequencial: sem novos/retomados agentes, sem alterar providers, autenticação, bridges, serviços, permissões ou segurança. Commits/pushes normais autorizados; sem force-push nem merge. Usar caches/dependências do projecto, uma compilação pesada de cada vez e pelo menos15GiB livres (96GiB observados). Não aceder a outros projectos/dados pessoais, comprar serviços nem usar root. Produto incompleto; sem disaster-ready/all-OS. O checkpoint adicional de manutenção foi cancelado.

## Estado corrente: carriers NÃO COMMITADOS

HEAD/origin publicados: adfd52a (XCTest), 5d24a16 (eventos) e93f24f1 (Glass). A árvore tem alterações locais de carriers, integração e testes: preservar tudo. Não houve commit/push desta fase. O último turno foi progresso real.

Bibliotecas: packages/groups/src/carriers.ts e native/groupcontrol. Bundles privados group-control, páginas de headers, snapshots por roster ou resposta dirigida, ACL por cartão comprometido, enumeração limitada à remoção e provas de fork. Certificados internos continuam assinados pelo criador; re-encriptação por leitor não dá autoridade. GroupRegistry.syncState/Go SyncState fornece apenas material de agendamento.

Runtime: apps/node/src/group-sync.ts e native/app/group_sync.go, ligados aos nós, recepção, inventário, replay após unlock e barreira antes de novos envios dinâmicos. Carriers não aparecem como conteúdo UI. Há cache de cada alteração local, avisos dirigidos de remoção, pedidos paginados, respostas privadas e recuperação limitada de cache histórica. Convites/consentimentos/saídas ainda não são transportados automaticamente (C2); a UI dinâmica falta (C3). Não activar messaging/outbound só por existir C1.

Limites configurados:1MiB de plaintext/2MiB por bundle, páginas até16 headers/256KiB, TTL de carrier1h, saída64/min e4MiB/min, cache auxiliar do produtor até8MiB ou1/4 da quota, colecções de replay/deferred/holders limitadas. Falta validar todos os limites e falhas adversariais. Ver docs/GROUP-CARRIERS.md e .codex-delivery/GROUP-CARRIERS.md.

## Testes e processos

**Nenhum teste/build/preview conhecido está activo.** A sessão44224 terminou0: typecheck5.902s,10 testes Node34.546s,3 testes do codec Go/race7.065s e2 testes do runtime Go/race7.936s. As314 fontes registadas foram verificadas inalteradas no fim. Evidência: docs/evidence/group-carriers/directed e .cache/group-carriers/checkpoint. Isto NÃO é o gate integral.

Outros resultados dirigidos:3 percursos mistos básicos15.341s e5 percursos mistos com cache/seeder19.151s; partição/seeder Node9.289s; replay de mais de16 controlos após lock9.404s. O teste TCP com snapshots fora de ordem passou sem mudar o registo; não inventar a falha do título inicialmente suspeitada. Logs em .cache/group-carriers. O CLI Go foi compilado em .cache/native-app.

Fontes novas: group-sync.ts, group_sync.go, group_sync_test.go, carriers.ts, native/groupcontrol/*, tests/group-carriers.test.ts, tests/group-sync*.test.ts, tests/fixtures/group-sync-seeding.ts e tests/native/group-sync*.test.ts. Foram também alterados os pontos de integração Node/Go, GroupRegistry, package.json (inclui ./groupcontrol nos testes Go) e tests/helpers.ts.

## Falha macOS no CI publicado

Run34765195200/adfd52a terminou: Node Windows/Linux e UI Linux passaram; npm test macOS falhou no commit de remoção após reiniciar o autor, em group-event-seeding.ts285, com fetch failed (26.257s). Go/desktop/iOS foram skipped; o novo XCTest não foi executado. gh --log-failed veio vazio; o log real foi obtido por `gh api repos/JohnnyPBelo/relayloom/actions/jobs/103744808644/logs`. Evidência em docs/evidence/ci-adfd52a. Não é um408 do upstream.

O helper HTTP agora usa Agent próprio por processo/incarnação e diagnóstico sem retries automáticos de mutações. Uma execução local observou ECONNRESET com processo ainda vivo; outra passou38.683s. **A causa macOS não foi demonstrada nem corrigida por esse passe.** Falhas futuras guardam diagnóstico privado em .cache/fixture-http-failures/*.json: socket reutilizado, headers, duração, exit/signal, caller e stderr com capacidade/frase de teste removidas. Inspeccionar antes de alterar portas, prazos ou asserções; não esconder falhas com retries gerais.

## Próxima execução

1. Ler git status, este ficheiro, PROJECT-BRIEF.md e GROUP-CARRIERS.md. Não repetir testes por perda de handles: todos os indicados acima terminaram.
2. Fechar C1 adversarial: vectores/codec Node↔Go; leitores em excesso, flood/rate/TTL; repetição de pedidos após resposta perdida; fairness/deferred; corrupção e falhas de commit/cache; replay após unlock; forks/caudas inválidas; remoção/reentrada e múltiplos adaptadores suportados. Investigar o reset HTTP macOS com evidência, mantendo as operações.
3. Rever os testes legados: agora há carriers legítimos nos observers. Não remover asserções de ausência de dados. Se um teste esperava zero pacotes, validar os controlos legítimos e continuar a exigir zero mensagens/eventos não autorizados. Não desactivar funcionalidades para passar.
4. Executar o gate integral com fontes congeladas: build, Node, Go/race incluindo groupcontrol, SQLite C, interoperabilidade, UI nos dois motores e desktop Linux. Não publicar como verificado antes do passe. A evidência anterior de eventos está em docs/evidence/group-events/final.
5. C2: transporte durável de convites, consentimentos e saídas; inbox sem auto-adesão. Persistir o cartão/material necessário junto da operação e impedir que quota de rede reverta close/leave. C3: UI Liquid Glass de grupos com head/audiência actuais. Continuar depois pesquisa integral, keystore/rotação, restantes media/social/templates, notificações reais, plataformas e revisão independente. O contrato inteiro mantém-se.

## Plataformas e histórico

Android anterior APK136a5103/AAR9e2fb77f passou82 asserções, mas não contém as alterações actuais; AVD/adb próprios parados e preservados. iOS93f24f1 falhou no helper de teclado antes de submit, com fotografia importada. O ajuste adfd52a tem22 testes host/estática passados, mas o CI Apple foi skipped por causa de macOS. Hardware/rádios, assinatura Apple, leitor de ecrã e revisão independente recente continuam pendentes.

Histórico integral em history/RESUME-carrier-first-iterations.md, history/RESUME-group-event-iterations.md e history/RESUME-liquid-glass-iterations.md. Goal activo. Não foi observado novo408 nesta fase.
