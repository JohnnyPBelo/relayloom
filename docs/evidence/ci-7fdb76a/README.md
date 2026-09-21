# CI35618030583 /7fdb76a — 21 de Setembro de 2026

Node Windows/macOS/Linux, Go/race, interoperabilidade, UI nativa, referência Reticulum e os três pacotes desktop passaram. A separação sequencial dos jobs Go/interoperabilidade executou com sucesso. O resultado global foi FAILURE por duas fases:

- Browser:101/102 percursos aprovados. A página válida no limite chegou a116/123 referências disponíveis no prazo de15segundos. O log mostra progresso, sem erro de autorização; esta falha de desempenho continua a requerer correcção e novo CI. Não alargar o prazo nem retirar o cenário.
- iOS: compilação, instalação e XCTest de startup passaram no simulador26.4.1/Xcode26.6. `simctl addmedia` ficou sem terminar durante60segundos e foi interrompido pelo runner. O percurso funcional não arrancou, logo não há prova de mensagem/fotografia/recuperação nesta execução. O diagnóstico de Photos mostra o pedido de inserção recebido, mas não estabelece conclusão nem causa do bloqueio. O runner eliminou apenas o simulador que criou. Não alterar permissões/serviços nem afirmar que o teste de startup concluiu o produto.

Todos os20ficheiros declarados no manifesto do artefacto iOS existiam e coincidiam por tamanho/hash. Aqui guardam-se relatório, resumo, captura e logs relevantes; o ZIP completo permanece no cache do projecto. Os nomes.log foram exportados para.txt conservando os bytes. O manifesto desta pasta descreve a curadoria. Os resultados de empacotamento/CI não equivalem a aparelhos físicos ou signing de distribuição.
