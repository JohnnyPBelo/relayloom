# Leituras de autoridade Go por transacção

O CI `34809654103` passou Node em Windows, Linux e macOS, mas `native/app` excedeu o limite total de 600 segundos do pacote Go. O teste então activo estava a verificar a reserva de 32 MiB da outbox. Não se retiraram payloads, casos ou race detection, nem se aumentou esse limite.

Um perfil do cenário `TestGroupEventQueuedFences` identificou trabalho repetido em `record`, `validateRecord`, snapshots e assinaturas dentro da mesma transacção. A implementação Go passa a conservar até oito checkpoints já verificados, ligados à geração da transacção, tal como a implementação Node. Cada escrita invalida as leituras anteriores. Não há reutilização entre transacções.

As cópias isolam ponteiros e slices. A clonagem preserva strings do protocolo, incluindo a representação de surrogates UTF-16 isolados, e distingue listas vazias de listas nulas. O cache conserva no máximo 416 KiB codificados e é eliminado ao terminar o âmbito, inclusive em falhas. Os formatos, assinaturas e permissões não mudam.

Cinco testes de topo (oito com subtestes) passaram com race detection: vida do âmbito, isolamento dos resultados, corrupção de checkpoint, remoção de provas, encerramento, limite de entradas e clonagem. Uma primeira fixture usou incorrectamente dois resultados de `Tx.Delete`; foi corrigida para a API real antes de executar os testes.

O mesmo cenário instrumentado passou em 37,881 s antes e 26,780 s depois. São observações locais, não uma garantia estatística. A suite Go integral, com o mesmo `-p=2` do CI, já passou os 15 pacotes; `native/app` terminou em 413,181 s, dentro dos mesmos 600 s.

O gate completo na cópia `.cache/g` terminou com sucesso: 173 testes Go de topo (225 com subtestes, 13 helpers omitidos), 45 de SQLite C (61 com subtestes, cinco helpers omitidos), 57 de interoperabilidade e 23 de UI Go. Os helpers omitidos não foram contados como passes. Todas as fontes verificadas permaneceram inalteradas. [Comandos, perfis resumidos e logs](evidence/go-scoped-authority-reads).

Ainda é necessário executar o CI com esta alteração. A optimização não conclui os restantes requisitos do RelayLoom, incluindo a paridade de grupos no browser, plataformas/hardware e revisão independente.
