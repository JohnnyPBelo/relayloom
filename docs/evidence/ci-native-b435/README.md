# CI b435608 — timeout acumulado do pacote Go app

CI35331029446: Node passou em Windows/macOS/Linux. O pacote Go app atingiu o limite total de10min; outros pacotes Go terminaram. UI nativa, RNS, pacotes desktop, iOS e browsers seguintes foram skipped, não aprovados.

O dump mostra TestWebPeerInvalidInputPreservesListenerAndCloseRetiresCapability iniciado havia0s, em scrypt durante ExportVault/setup. Não comprova deadlock ou falha de uma asserção. A execução local de app com race passou em495,542s; a anterior passou em515,3s. Concorrência com outros pacotes é uma hipótese, não uma causa demonstrada.

A alteração de controlo limita test:native a um pacote de cada vez (-p=1 em vez de2). Preserva integralmente a lista de pacotes, race, os prazos internos e o limite total de cada pacote. Não muda scrypt, segurança, modelos, bridge ou serviços. O novo CI ainda tem de provar o resultado.
