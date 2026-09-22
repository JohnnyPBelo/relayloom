# RelayLoom — retoma após recuperação da origem privada

**Objectivo integral activo; produto não concluído.** PROJECT-BRIEF.md mantém messenger/social cifrado, sites expressivos inspirados no ZeroNet, cinco plataformas e web autónoma com paridade, meios agnósticos/Reticulum, setup PT-PT/EN/ES e Liquid Glass. Manter Astra/Copilot Ultra e execução sequencial: não criar nem retomar agentes. Não alterar providers/bridges/autenticação/permissões/serviços. Checkpoint adicional de manutenção cancelado.

## Estado confirmado

Worktree activa `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal permanece em `codex/setup-languages` / `1e83db22`, com WIP histórico preservado. Fontes locais: `593459a` cancelamento por IDs/prazos absolutos, `16c5963` recuperação de origem privada e `3ac8faf` observação iOS. Origin confirmado em `d0c3b55` antes do próximo push normal. Nunca usar git add -A, reset, force-push ou merge sem aprovação. Capturas/JSON históricos e symlink node_modules não pertencem automaticamente ao incremento.

Disco revalidado: cerca de 23 GiB livres; mínimo 15 GiB. Uma execução pesada local de cada vez, caches/dependências no projecto. Nenhum teste local conhecido deste incremento continua vivo; os handles antigos foram recolhidos. Não relançar suites por perda do handle.

## Implementado e verificado

Fila privada e inbox durável nos motores Node, Go e browser. Recuperação explícita (`contribution-command/obtain-source`) da origem que só existe na fila activa do visitante, mesmo com relay de terceiros pausado. Preserva bytes, ID, assinatura, autoria e audiência do snapshot. Cancelamento local por ID preserva pacotes independentes e de outros originadores; prazo absoluto não renova a concessão. Worker fornece uma autorização interna limitada, sem chaves privadas.

Gate terminal PASS `.cache/contribution-source-final/report.json`: 516 Node, 17 pacotes Go/race (cache de pacotes inalterados identificada nos logs), 74 casos entre processos, typecheck, builds nativo/web, 78 casos em cada Chromium/Firefox/WebKit. 733 hashes iguais antes/depois e reconferidos contra `16c5963`. Não atribuir esse gate à alteração iOS posterior. Provas curadas em `docs/evidence/site-contributions/source-recovery/`.

CI `35772935519` / `d0c3b55`: FAILURE apenas em iOS; todos os outros jobs PASS. O watcher do par Node sofreu TimeoutError; nenhuma mensagem confirmada (`senderID:null`, `messages:[]`). XCTest terminou antes da fototeca. Artefacto 10717234174 e 22 ficheiros dos seus manifestos verificados. É distinto da falha anterior do selector de fotografia. Provas em `docs/evidence/ci-d0c3b55/`.

`3ac8faf` limita a duas repetições apenas leituras de estado com TimeoutError, com processo vivo/deadline original; não repete mutações. 27 testes host-only `node --test apps/ios/Tests/SimulatorRunnerTests.mjs` e sintaxe PASS. Ainda sem repetição em Apple; não afirmar iOS corrigido. Fotografia, anexo, resposta e recuperação continuam por validar nesse ambiente.

## Continuar implementação

Ler `CONTRIBUTION-RECEIPTS-NEXT.md`, `CONTRIBUTION-SOURCE-RECOVERY.md`, docs/SITE-CONTRIBUTIONS.md. O gate de origem está concluído: não repetir essa implementação. Continuar recibos privados assinados do dono, recusa/purga que liberte quota, decisões com CAS/base/esquema/audiência e proveniência. ACK físico, recepção verificada e aprovação/publicação são factos diferentes. Recibo tardio não renova prazo; cancelamento não apaga recepção histórica. Persistir intenção, assinatura e envelope exacto antes de emissão; recuperação e replays finitos.

A paleta de formulários permanece oculta até compor/enviar/rever/recusar/aceitar/reconciliar/publicar funcionarem com UI PT/EN/ES e três contas reais. Continuam grupos web dinâmicos, backup/rotação/keystore, plataformas, rádios e revisão independente. A revisão própria não cumpre a revisão independente; não há novos agentes nesta recuperação sequencial.

HTML público inalterado: runtime `7fdb76a5de5869efa6ebdd721bc7e8f5efac68af`, distribuição `0fdbd1b9563540a5bc28c74d669668e948aa7667`, https://johnnypbelo.github.io/relayloom/. Só publicar após gate da distribuição exacta/HTTPS. Nenhuma alegação de disaster-ready, rádios físicos ou todas as plataformas testadas.
