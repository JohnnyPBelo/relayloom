# Limite acumulado do job Node/Linux

Execução [35753597485](https://github.com/JohnnyPBelo/relayloom/actions/runs/35753597485), fonte **2948284c8795d2504234ea7433a12333e298ecc7**. Resultado global CANCELLED, sem validação dos jobs posteriores. A inbox durável local posterior não pertence a esta execução.

O job Ubuntu 106833696520 começou às 16:21:48 UTC e terminou às 16:36:50 UTC. O log confirma **505 testes Node e 34 percursos UI aprovados**, incluindo upload do artefacto. A anotação de falha confirma: `The job has exceeded the maximum execution time of 15m0s`. Não é uma falha HTTP408 do modelo e não há evidência para atribuir a concorrência como causa.

Windows/macOS terminaram com sucesso, segundo a observação da API. Go/race, interoperabilidade, UI Go, pacotes desktop, Reticulum, iOS e browser autónomo ficaram skipped nesta execução. Não apresentar esses skips como passes.

A alteração local em `.github/workflows/ci.yml` mantém a matriz Node, os comandos de teste e o Chrome do runner. Move os mesmos testes UI Linux para `node-ui`, depois da matriz e antes de `native-go`, com 15 minutos próprios. Os limites dos jobs existentes e os deadlines dos testes foram preservados; o tempo total permitido pelo grafo aumenta pela separação. Permissões e concorrência existentes não foram alteradas.

`workflow-validation.json` regista a validação local por parser YAML e comparação do grafo/comandos. **A nova organização ainda precisa de execução remota.** Não foi alterada a configuração de modelos, bridges ou serviços externos.

Recolha: `gh api repos/JohnnyPBelo/relayloom/actions/jobs/106833696520/logs` e `gh api repos/JohnnyPBelo/relayloom/check-runs/106833696520/annotations`. O artefacto completo de 147 348 293 bytes não foi descarregado; não se afirma conferência dos seus conteúdos. Os quatro ficheiros recolhidos têm hashes/tamanhos em `artifact-hashes.json`.
