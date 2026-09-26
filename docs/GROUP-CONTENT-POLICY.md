# Observação partilhada de conteúdo dos grupos

O runtime Node usa `packages/groups/src/content-model.ts` para aplicar a mesma política de admissão, alterações do autor e confirmações. A extracção preserva as condições anteriores e permite reutilizá-las no motor web. A verificação criptográfica e do esquema completo precede esta função interna; nenhum endpoint aceita um contexto histórico fornecido pelo cliente como autoridade.

A política mantém a correspondência entre confirmação e intenção original (autor, grupo, época, expiração e leitores), a autoria de edit/delete, a irreversibilidade local da eliminação e a separação entre admissão e quarentena. Armazenamento, cifragem, transacções e transporte continuam a pertencer aos runtimes.

## Verificação deste marco

Uma árvore isolada de `90e98a9` recebeu apenas os dois ficheiros de produção acima: o novo módulo e o seu uso em `apps/node/src/group-content.ts`. As versões das dependências foram conferidas contra o lockfile. Passaram build/typecheck, 34 testes Node e dois percursos UI reais com duas contas, incluindo quatro auditorias Axe sem violações. Os 749 inputs mantiveram-se entre os gates.

Com as dependências e o Chromium preparados segundo o README, os comandos de reprodução são:

```sh
npm run build
node --import tsx --test --test-concurrency=1 tests/group-confirmations.test.ts tests/group-confirmation-failures.test.ts tests/group-events.test.ts tests/group-event-failures.test.ts tests/group-event-seeding.test.ts tests/group-outbox.test.ts
node scripts/e2e.mjs tests/e2e/dynamic-groups.spec.ts --browser=chromium
```

[Manifesto de verificação](evidence/group-content-policy.json) contém hashes, resultados e comandos; os destinos de relatório são variáveis locais explícitas. Os testes usam temporários e caches do projecto. Não foram usados GitHub Actions.

A recepção, o agendamento e a activação dos grupos na aplicação web continuam numa integração separada. Este marco não conclui o produto, não actualiza o HTML público e não valida rádio físico, outros SO ou prontidão para catástrofes. Todo o contrato de PROJECT-BRIEF.md permanece activo.
