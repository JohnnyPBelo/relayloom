# CI adfd52a — resultado observado

Run34765195200 terminou: Node Linux/Windows e UI Linux passaram; npm test em macOS falhou1 caso (grupo com novo leitor/seeder/reinício), em26.257s. Erro fetch failed em group-event-seeding.ts285, no commit de remoção depois do reinício. Go, desktop e iOS foram skipped por dependência; o novo XCTest não foi compilado/executado neste run.

`gh run view --log-failed` devolveu vazio; o log exacto foi obtido pelo endpoint do job103744808644. Não se atribui causa ao 408 do upstream ou à bridge. A causa interna da desconexão ainda não está provada. Na árvore seguinte em implementação, o teste foi repetido com pool HTTP próprio por processo e diagnóstico: observou ECONNRESET com processo ainda sem exit/signal; uma execução posterior passou38.683s. Isso não prova uma correcção macOS.

O helper mantém uma tentativa por pedido e guarda diagnóstico limitado/privado de falhas sem corpo nem capacidade. Serão preservadas as operações/as mesmas asserções e a recuperação por UUID retido; não se vai mascarar um erro de autorização/armazenamento com retries gerais. Novo CI necessário após alterações verificadas.
