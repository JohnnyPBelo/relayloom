# Persistência privada por instalação

Integrado nos núcleos Node/Go e verificado neste Linux. A aplicação experimental continua incompleta. Este mecanismo não implementa grupos dinâmicos nem resolve revogação de chaves já entregues.

## Dados e autoridade

Os núcleos Node e Go usam agora `profile-state.sqlite` para outbox, memória de alterações/eliminação, colecções e rascunho da página. O documento canónico tem limite16MiB, até32 blocos de512KiB e manifesto com conjunto, tamanho e hash exactos. Cada registo é cifrado e o índice é assinado pela identidade local. AAD liga a identidade, instalação, chave do registo e revisão. O digest anterior é exigido na gravação; a transacção SQLite confirma todos os blocos e o manifesto em conjunto.

`profile-binding.json` contém uma ligação assinada à identidade e a um store-ID aleatório por instalação. A fase preparada permite concluir uma importação interrompida; a fase committed exige a base já inicializada. O hash da origem é calculado sobre o ciphertext JSON legado, evitando expor um hash do documento privado em claro.

A abertura usa a exclusividade de perfil já partilhada por Node e Go. A chave de leitura não concede autoridade de assinatura; servir bytes não transfere autoria. Esta base é local e não constitui um serviço central.

## Migração e falhas

No primeiro setup/desbloqueio, o núcleo valida o antigo `private-state.json` antes de preparar a importação. Guarda a ligação preparada, importa documento e marcador numa transacção e confirma a ligação. O ciphertext antigo é preservado. Instalações novas começam com um documento vazio válido.

Depois de committed, o JSON antigo nunca substitui o documento protegido. Uma base inicializada ausente, trocada, corrompida ou sem ligação é recusada; não é reposta automaticamente. Quando uma gravação devolve erro, o núcleo fecha e reabre a base através da ligação assinada antes de decidir qual o estado durável. Se não conseguir lê-lo, bloqueia o estado privado. Uma resposta incerta não autoriza um novo envio silencioso.

O restauro de **todo um backup válido anterior**, incluindo a ligação e a ausência da base num momento preparado, continua indistinguível desse momento legítimo sem uma testemunha monotónica confiável. Assinaturas não resolvem esse rollback. As experiências de morte de processo também não constituem ensaios físicos de perda de energia.

## Limites e transacção futura de grupos

O documento usa o mesmo orçamento de metadados protegidos de64MiB, com4MiB reservados para checkpoints/barreiras. O índice tem o seu próprio limite4MiB e margem reservada. O ficheiro SQLite tem limite físico96MiB; journal e overhead temporário devem ser considerados na reserva de disco. A quota de conteúdo cifrado continua separada deste orçamento de metadados.

A autoridade dos grupos existe como biblioteca. A aplicação ainda não a usa para decidir admissões e envios. A próxima integração deve executar autoridade, IDs aceites e decisões de outbox na mesma transacção, conservar prefixos restritivos válidos quando a cauda de uma prova é inválida e só expor/enviar depois do commit. Ter um ficheiro SQLite comum não demonstra que esses fluxos já são atómicos.

## Evidência local desta alteração

Comandos completos, hashes e resultados em `docs/evidence/private-profile`. Os originais da execução permanecem em `.cache/private-integration`.

- Foundation state/binding:6 Node e17 casos Go de topo com race; factory8 Node e4 Go de topo; interoperabilidade real da factory6.729s, incluindo fronteiras de morte e Unicode/blocos.
- Primeiro gate de aplicação:25 Node/15.194s; Go app com race196.134s, recolhido dos artefactos sem repetição.
- `node_modules/.bin/tsx --test --test-concurrency=1 tests/native/private-migration.test.ts tests/native/profile-application.test.ts`:4 casos/4.359s, após reconstruir o CLI Go. Migração pela API, identidade/colecções/rascunho, morte e troca de núcleo, exacto ID pendente, ausência/corrupção recusadas e restauro positivo.
- Regressão de importação malformada Node falhou antes e passou depois. Build/typecheck passou. O validador declarativo de publicação e rascunho é partilhado.
- O primeiro gate completo Node passou151/152: uma inspecção de colecções ainda procurava JSON. Corrigida para SQLite sem retirar o controlo de texto privado. O verificador iOS também foi actualizado: exige migração já committed e autentica a base com exclusividade.16 testes dirigidos (15 host iOS+colecções) passaram4.627s; não executam iOS.
- Gate completo concluído: build/typecheck,152 Node/77.381s,105 testes Go de topo com race/379.168s (cinco helpers omitidos em unitários e executados pelos drivers),15 interoperabilidade/145.127s,15 UI Node/107.327s e15 UI Go/101.522s. Desktop Linux: preparação0.239s, execução0.982s, pacote5.161s, execução empacotada0.766s.22 relatórios Axe actualizados, zero violações. As fontes registadas não mudaram durante o gate. Evidência pública em `docs/evidence/private-profile`; produto, grupos dinâmicos e plataformas móveis continuam incompletos.

Android e iOS precisam de novos artefactos e execução correspondente. As compilações/testes antigos não cobrem os novos imports. Não há novo ensaio de hardware, rádio, leitor de ecrã físico ou assinatura de distribuição. Revisão independente desta alteração está pendente durante a recuperação sequencial sem agentes.
