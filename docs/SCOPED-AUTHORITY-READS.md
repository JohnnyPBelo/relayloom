# Leituras verificadas de autoridade na mesma transacção

O perfil do cenário real de seeding mostrou trabalho repetido a verificar o mesmo checkpoint de grupo durante uma transacção. Em Node, `GroupRegistry.inTransaction` conserva agora até oito checkpoints já verificados, com um máximo de 416 KiB de dados codificados. A instância normal do registo continua a ler e verificar de novo em cada transacção.

A reutilização depende da geração da transacção autenticada. Qualquer escrita ou remoção invalida todas as entradas, incluindo alterações às provas referidas pelo checkpoint. Os resultados são cópias, para uma alteração feita pelo chamador não modificar a autoridade conservada. O cache é retirado quando o âmbito termina, incluindo falhas. Não se alteram assinaturas, formato de armazenamento, permissões, outbox ou protocolo de rede.

## Controlos executados

O teste de trabalho verificou cinco leituras do mesmo checkpoint para cinco consultas de estado antes da alteração. Depois exige uma leitura nessa transacção e uma nova leitura na seguinte. Os seis casos também verificam mutações do objecto devolvido, corrupção de checkpoint, remoção de header e snapshot, encerramento imediato, expiração do âmbito e limite de entradas. Corrupção continua a abortar a transacção e a bloquear o store; o teste reabre com o mesmo identificador para confirmar o rollback.

```sh
node --import tsx --test --test-concurrency=1 tests/group-registry-read-scope.test.ts
node --import tsx --test --test-concurrency=1 tests/group-event-seeding.test.ts
```

O cenário completo, com um profiler interno nos processos da fixture, passou em 38,261 s antes e 21,171 s depois. Não foi aberto um listener de debug. Estas são duas medições locais instrumentadas, não uma garantia de desempenho nem um resultado Windows. Mantiveram-se todas as fases, controlos e o prazo de 65 segundos.

## Gate e limites

Na cópia isolada sobre `54d298a`, o build passou, tal como os 275 testes Node (393,015 s) e todos os 57 testes de interoperabilidade (508,800 s), sem falhas ou omissões. Passaram também 23 E2E Node (177,158 s), 23 Go (151,083 s), arranque Linux (1,613 s), pacote (13,159 s) e execução empacotada (1,198 s). As 366 fontes verificadas pelo gate externo permaneceram inalteradas. [Comandos, hashes e relatórios](evidence/scoped-authority-reads).

As fontes Go não mudaram nesta optimização; a interoperabilidade usa processos e ficheiros reais dos dois motores. A regressão global adicional Go/race e SQLite C foi iniciada separadamente e ainda está em curso; não é contada como passe deste marco.

O CI anterior `34805308160` passou Linux/macOS e falhou Windows: o cenário excedeu 65 segundos e duas fixtures tentaram remover ficheiros SQLite antes de fechar os handles. A ordem de fecho foi corrigida separadamente em `54d298a`, com seis testes locais passados. Ainda é necessário executar o CI com a optimização e confirmar Windows. Não aumentar o prazo ou substituir esse resultado por um passe Linux.

Esta alteração não conclui grupos dinâmicos no browser, os adversariais adicionais, os gates de plataformas/hardware, a revisão independente ou o contrato completo do RelayLoom.
