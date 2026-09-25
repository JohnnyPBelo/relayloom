# Progresso de transporte sob tráfego de controlo

Esta correcção trata dois bloqueios de progresso, sem alterar o formato dos pacotes, a cifra, os limites de memória, os prazos ou o consentimento para retransmissão.

A cache de retenção podia ficar cheia de pacotes normais já enviados e recusar um novo conteúdo pedido por um par. Um teste TCP reproduziu o caso com 63 entradas normais e uma SOS: a ligação funcionava, mas o conteúdo não era admitido. Node, Go e browser podem agora substituir entradas não SOS ociosas, sem trabalho numa ligação actual. O tráfego ordinário não expulsa transferências já em envio; SOS mantém precedência. Uma admissão impossível é planeada antes de remover entradas, e a readmissão do mesmo pacote preserva o objecto e a contabilidade. A cache de encaminhamento continua limitada e não substitui os journals persistentes da aplicação.

No canal RTC/WS do browser, confirmações legítimas de transferências pendentes consumiam o mesmo orçamento dos controlos não solicitados e podiam fechar uma ligação saudável. Um ACK válido retira agora um trabalho pendente já limitado antes desse orçamento. Confirmações repetidas ou sem transferência correspondente continuam sujeitas ao limite de 64 controlos por segundo. ACKs precoces para conteúdo já recebido por outro caminho continuam válidos. Este ACK de transporte não substitui o recibo assinado de entrega/leitura da aplicação.

## Verificação da candidata

Verificação isolada passada sobre a base `b9bc4f6` e os oito ficheiros do fix: build web/nativo, 32 testes Node/integração, Go transport/app com race, 8 casos Reticulum, 16 casos de browser e três percursos UI-RNS em cada Chromium/Firefox/WebKit. As fontes ficaram iguais entre início e fim. [Comandos, hashes, resultados e limites](evidence/transport-progress/verification.json). A verificação inclui caminhos TCP/PTY, partição/heal, seeder com autor offline, autorização/corrupção e os controlos de cache/ACK.

O teste de 96 ACKs usa uma janela lógica fixa do relógio JavaScript para verificar a contabilidade; não é uma medição de throughput. Uma inundação de 65 ACKs desconhecidos tem de continuar a fechar o canal. Os testes de rádio por PTY ou GATT simulado não representam hardware físico.

A aplicação permanece experimental. Esta correcção não declara paridade completa, validação de todos os SO, prontidão para catástrofes ou revisão independente de segurança.
