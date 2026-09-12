# RelayLoom — retoma activa, 2026-09-12

Trabalhar exclusivamente em `/home/absint0o/projects/relayloom`, segundo todo o `PROJECT-BRIEF.md`. Produto incompleto. PT-PT; manter Astra/Copilot Ultra e providers/autenticação/bridge/serviços/permissões/segurança. Recuperação sequencial: nenhum agente novo ou retomado. Não criar checkpoint adicional de manutenção nem aguardar manutenção. Caches no projecto, uma compilação pesada de cada vez, pelo menos15GiB livres (última medição122GiB). Commits/pushes normais autorizados; nunca force-push ou merge sem aprovação. Preservar trabalho local.

## Estado verificado desta retoma

- HEAD publicado `90cb6499cb6ae6b281a39ca772f3c093845b4957`.
- O teste Go já lançado foi recolhido sem repetição: `node scripts/go.mjs test -json -race -count=1 -p=1 ./app`, exit0,196.134s no pacote/199.031s no supervisor. Node anterior25 casos/15.194s. Artefactos `.cache/private-runtime-first/{node,go}-command.json` e logs. Não tratar handles desaparecidos como testes por iniciar.
- CI34687481472: Node passou Linux/macOS/Windows, Go completo passou, três pacotes desktop passaram. iOS falhou em `seed-synthetic-photo` após60.651s, antes de executar XCUITest. Simulador arrancou114.354s, build-for-testing17.643s, instalação11.153s. Diagnóstico2.947s recolhido; só o simulador criado foi apagado. Os logs completos foram obtidos via API após o comando agregado gh exceder o prazo. `.cache/ci-90cb649/{run.json,ios-job.txt,ios-evidence.zip}`. Não repetir preparação iOS inalterada ou aumentar prazos em ciclo.

## Implementação local não commitada

`PROFILE-STATE-IMPLEMENTATION.md` descreve bibliotecas e integração Node/Go reais de estado privado cifrado no SQLite comum, ligação assinada por instalação e migração recuperável do JSON antigo. Estão importadas por ambos os núcleos; não confundir com a autoridade de grupos ainda sem integração na aplicação/API/UI.

Revisão desta retoma reproduziu Node aceitar `mutations: []` antes de criar a migração. Agora valida estrutura/mutações/colecções/rascunhos antes do intent, com o mesmo validador declarativo usado na publicação (`content-validation.ts`, extraído sem alterar regras). Leitura legada Node limitada antes da alocação. Red/green em `.cache/private-migration-review/semantic-{before,after}.txt`; build passou após corrigir overload TypeScript do próprio assert do teste. Não é revisão independente.

Gates dirigidos terminaram: supervisor `.cache/private-integration/run.py targeted`, sessão87438. CLI Go reconstruído,1.038s;4 testes de API de migração/propriedade Node↔Go passaram4.359s. Primeira execução full (sessão7822) terminou151/152 Node: colecções ainda inspeccionava o JSON removido; log preservado em `.cache/private-integration/first-full`. A asserção passou a inspeccionar SQLite. O verificador iOS tinha a mesma referência antiga: agora exige binding committed, abre a base autenticada com lease, fecha-a e verifica bytes/receipts;15 casos host mais o caso de colecções passaram (16 total/4.627s), incluindo corrupção/DB ausente sem fallback. Isto não executa iOS nem resolve addmedia.

Gate completo concluído: build/typecheck,152 Node/77.381s,105 testes Go de topo com race/379.168s (cinco helpers omitidos em unitários e executados pelos drivers),15 interoperabilidade/145.127s,15 UI Node/107.327s e15 UI Go/101.522s. Desktop Linux: preparação0.239s, execução0.982s, pacote5.161s, execução empacotada0.766s.22 relatórios Axe actualizados, zero violações. As fontes registadas não mudaram durante o gate. Evidência pública em `docs/evidence/private-profile`; produto, grupos dinâmicos e plataformas móveis continuam incompletos.

A sessão97778 terminou com saída0. Não há gate desta fase em curso. A preparação posterior da facade está apenas na cache e não foi aplicada. O próximo passo é o commit coerente da migração, seguido da facade/testes e investigação concreta da preparação iOS antes de novo push que repetisse addmedia inalterado.

## Próximos passos

1. Recolher gate dirigido; rever/fixar falhas. Executar gate completo Node, Go/race, interop, UI dos dois núcleos e desktop sobre fontes congeladas. Publicar evidência exacta, actualizar README/STATUS/traceability e criar marco coerente quando verificado.
2. Ligar autoridade/admissão/outbox à mesma transacção. Ainda falta facade de autoridade transaccional: prefixos de prova válidos devem persistir apesar de cauda inválida; só transmitir/expor receipts depois do commit exterior. Ver `GROUP-RUNTIME-BOUNDARY.md`.
3. Sync/carriers, IDs aceites/quarentena, audiências original/actual e superseded imutável; depois API/UI de grupos dinâmicos. Grupos do produto continuam fixos.
4. Investigar evidência concreta de preparação iOS; não assumir execução da app a partir de build/boot. Reconstruir Android para fontes novas e repetir gates no AVD existente. APK anterior não herda resultados. Hardware Apple/Android/radios/assinatura permanecem não verificados/bloqueados.
5. Continuar keystore/rotação, pesquisa integral, social/media/templates/notificações, revisão independente quando autorizada e todos os critérios. Polimento pendente: “1 publicações em cache”.

Histórico e gates publicados em `.codex-delivery/history/RESUME-before-private-runtime-validation.md`, `docs/GROUP-AUTHORITY.md`, `docs/STATUS.md`, `docs/AGENTS.md`. Restaurar backup completo válido antigo continua indetectável sem testemunha monotónica confiável; não alegar resistência a esse replay. Nunca declarar prontidão para catástrofes ou todos os OS testados.

Durante o gate congelado, código e3 testes por núcleo para a futura facade foram **preparados apenas** em `.cache/authority-scope` (`stage.py`, `registry.ts`, `types.go`, `observe.go`, `transaction.go`, `group-transaction.test.ts`, `transaction_test.go`, `base-hashes.json`). Não estão importados/compilados/testados. Não os descrever como entrega. Aplicar só depois de recolher e preservar o gate da migração; comparar os hashes base antes de copiar e testar a atomicidade/rollback/rejeição diferida. A sessão97778 já terminou com todos os gates locais passados. A facade preparada inclui4 testes por núcleo e os métodos de abortar transacção em `storage.ts`/`store.go`, ainda não aplicados/testados.

## Fase de autoridade transaccional em curso após os commits locais

Commits locais criados:9c322a9 (foundation) e3fd9a33 (migração+gates). Ainda não enviados; origin permanece90cb649. A facade foi aplicada ao código: `GroupRegistry.inTransaction` / `groupauthority.InTransaction`, abort explícito/sticky do tx e rejeição de cauda inválida devolvida como dados.5 testes Node e5 Go/race passaram; a interoperabilidade de mortes reais Node↔Go antes/depois de commit e retry idempotente passou5.539s. A classificação Node de cancelamento como corrupção foi reproduzida/corrigida: leitura do tx fora do catch de parsing do marker. Não é ainda integração da autoridade na aplicação/API/UI.

Gate dirigido completo da facade em sessão43542: `.cache/authority-scope/final/run.py scope` e `*-command.json`/`*-output.txt`. Não editar produção/testes/scripts até terminar. Build passou8.157s; recolher restantes resultados. A cache anterior `.cache/authority-scope` contém versões preparadas agora desactualizadas: **não voltar a copiá-las sobre o código corrigido**.

Próxima investigação iOS preparada, ainda não aplicada/testada: `.cache/ios-runtime-probe/{stage.py,ios-simulator.mjs,SimulatorRunnerTests.mjs,ci.yml,base-hashes.json}`. O inventário real de90cb649 contém iOS26.4.1 e26.5. A proposta é uma selecção explícita de26.4.1 já instalado para uma tentativa de compatibilidade, preservando fotografia/XCUITest/prazos e falhando se ausente, sem fallback/download.26.5 continua bloqueado; isto não prova a causa nem promete correcção. Aplicar só após comparar hashes base e terminar gate actual; testar os17 casos host e a verificação estática antes de commit/push. Não alterar serviços/permissões/modelos/bridge.

O polimento textual identificado nas capturas está preparado, não aplicado, em `.cache/ui-copy/main.tsx` com hash base `.cache/ui-copy/base.sha256`: singular de ligação/publicação, nomes dos blocos em PT e explicação do editor sem vocabulário de implementação. Aplicar apenas depois do gate congelado, se o hash base ainda corresponder; build e percursos existentes de UI precisam de recaptura. Não foram escritos testes redundantes de simples pluralização.


## Resultado actual da fase de autoridade

A facade transaccional Node/Go foi implementada e verificada:81 Node/36.565s,36 Go de topo com race/169.094s (quatro helpers executados pelos drivers),9 interoperabilidade/45.760s; build8.157s e CLI0.901s. Fontes registadas inalteradas durante o gate. Evidência em `docs/evidence/group-transaction`. A aplicação ainda não usa esta facade para grupos dinâmicos.

A sessão43542 terminou com saída0. Não há testes desta fase em curso. Os resultados completos estão publicados no directório de evidência local acima, ainda por commit/push juntamente com o código da facade. Não voltar a correr o gate por existir um handle antigo. Próximo: commit coerente desta alteração, aplicar/verificar a tentativa iOS26.4.1 e o pequeno polimento UI preparado, reconstruir/verificar artefactos e enviar marcos normais; depois continuar admissão/outbox/sync/API/UI dinâmica e restante contrato. As fontes da cache de staging são anteriores a algumas correcções: nunca as copiar cegamente.


## Plataforma/UI após facade

Facade commit local `fffbc57`; continua não enviada. O código da tentativa iOS26.4.1 foi aplicado e passou17 testes host em2.158s e verificação estática; nenhuma execução Apple local. `.cache/ios-runtime-probe/evidence.json` contém comandos/hashes. A CI preserva fotografia, XCUITest, prazos, falha se versão pedida não instalada e não faz fallback/download.26.5 continua bloqueado sem causa conclusiva.

Polimento aplicado em `apps/web/src/main.tsx`; a asserção existente de1 ligação foi corrigida em `tests/e2e/flows.spec.ts`. Build passou; novo JS `index-C9JlHp94.js`, CSS inalterado `index-DwCp7KCv.css`. Gate dos percursos existentes Node/Go e desktop empacotado em sessão84723, supervisor `.cache/ui-copy/final/run.py ui`. Consultar comandos/outputs antes de repetir. Não editar inputs enquanto correr. Depois preservar evidência, commit e push normal; observar CI pelo commit exacto. APK anterior ainda não inclui a migração; reconstruir AAR/APK e executar os quatro gates no mesmo AVD, preservando identidade e asserções.

Normalização pendente de commit: duas linhas com espaços finais no output negativo `docs/evidence/group-transaction/node-first.txt` foram removidas na cópia legível; original exacto em `.original.b64` e hashes separados em `normalization.json`. Nenhuma evidência de execução foi alterada semanticamente; não confundir hashes raw e legíveis.


A sessão84723 terminou com saída0:2 UI Node19.582s,2 UI Go19.209s, desktop build0.200s/pacote5.047s/execução0.841s. Capturas editor/feed móvel revistas por root confirmam as correcções de texto. Outputs/hashes em `docs/evidence/ui/copy-polish`; runner iOS17 host/static em `docs/evidence/ios/runtime-26-4-1-host`. Pronto para commits/push normais destas duas alterações e observação da CI exacta, antes de continuar o APK e restante integração. Não existem testes/desktop/emulador desta fase em curso.
