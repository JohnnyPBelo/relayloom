# Um instante único para criação e expiração

CI35335837063 (72e03a7) passou Node Linux/macOS e falhou Node Windows; Go e os jobs seguintes não chegaram a executar. Não há ainda resultado para a hipótese de executar os pacotes Go sequencialmente.

A falha Windows revelou um defeito de produção: createBundle em Node chamava Date.now separadamente para created e expires. Se o relógio avançasse entre as chamadas, o prazo assinado diferia do pedido e o registo estrito de criação recusava-o. Go e browser já derivam ambos os tempos de um único instante.

O teste determinístico avança17ms a cada leitura. Antes da correcção produziu3600017ms em vez de3600000ms. Depois passou com leitores públicos e privados, verificando também a assinatura. A validação de prazo não foi relaxada e os parâmetros criptográficos não mudaram.

Passaram33testes: bundle-created-time, core, site-resource-operations, site-resource-catalog e site-catalog. Comando: node --import tsx --test --test-concurrency=1 tests/bundle-created-time.test.ts tests/core.test.ts tests/site-resource-operations.test.ts tests/site-resource-catalog.test.ts tests/site-catalog.test.ts . A execução remota da correcção permanece pendente. Os logs originais foram conservados byte a byte, incluindo espaços finais.
