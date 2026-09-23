# CI Node: mesma cobertura em jobs delimitados

Run35888318827, código44e759c, terminou cancelled. Ubuntu e macOS passaram540/540; Windows completou até ao caso de topo522 e esgotou os15min acumulados do job. Os jobs dependentes ficaram skipped. Logs oficiais, anotações e hashes: `docs/evidence/ci-44e759`.

A matriz passa a executar `foundation` e `sites` em cada um dos mesmos três SO. Mantém max-parallel2, fail-fastfalse, timeout15min e test-concurrency1. A partição é exaustiva: ficheiros `tests/site-*.test.ts` pertencem a sites; todos os outros `tests/*.test.ts` pertencem a foundation. Ficheiros futuros entram automaticamente; grupos desconhecidos, inventário inválido ou conjunto vazio falham. Os artefactos têm nomes separados para evitar colisões.

`node --import tsx --test --test-concurrency=1 tests/node-partition.test.ts` passou. Verifica união sem omissões/duplicados, inclusão de nomes futuros, recusa de grupos/nomes inválidos e a listagem real do comando. Typecheck passou. O efeito no orçamento dos runners precisa de nova execução remota; não se infere sucessoWindows,Go,iOS,Reticulum ou pacotes.

Este commit limita-se ao driver, à matriz e às provas do CI anterior. O trabalho de incorporação/proveniênciav5 continua na worktree, sem publicação doHTML e sem declaração de produto concluído.
