# Convites privados de grupo nos runtimes Node e Go

Os convites, consentimentos e pedidos de saída circulam como objectos cifrados `group-notice`. A API guarda o cartão exacto do convidado e o certificado na mesma transacção que emite o convite. O destinatário vê um aviso pendente; abrir, aceitar e aprovar a entrada são operações distintas. Receber ou retransmitir o aviso não concede autoria nem adiciona membros.

Os certificados e a inbox limitada usam os [codecs e o journal](GROUP-NOTICE-CODEC.md) partilhados entre motores. O transporte reutiliza as filas, quotas e orçamentos dos [controlos de grupo](GROUP-CARRIERS.md). Consentimentos e saídas são reconstruídos a partir dos checkpoints autenticados. A repetição de uma abertura não apaga o consentimento já guardado. Um convite da época inicial permite responder com o criador desligado; épocas posteriores continuam a exigir a cadeia de provas.

O desbloqueio processa os controlos e avisos guardados antes de permitir novos envios. Um aviso de uma origem bloqueada pode conter uma prova válida de remoção ou encerramento: essa prova de segurança continua a ser aplicada, sem aceitar o convite ou o conteúdo bloqueado. Filas e seeding locais revalidam o estado actual. Em Go, a decisão de cancelamento é calculada antes de entrar no mutex do router, incluindo recuperação de estado privado desactualizado.

O replay de um snapshot já incorporado só omite a reaplicação se a participação, o cursor autenticado, o header, os destinatários e os bytes do snapshot coincidirem. Um header novo de encerramento continua a ser aplicado mesmo quando o snapshot que o acompanha é inválido. O limite temporal de 65 segundos do cenário de seeding permanece inalterado; um passe Linux não prova a correcção em Windows.

## Validação do conjunto isolado

O candidato foi aplicado sobre `94c355f` em `.cache/milestone-group-runtime`, sem importar a aplicação autónoma de navegador ou os adaptadores WebSocket ainda por consolidar. Build e CLI Go passaram; 269 testes Node passaram em 485,074 s. Os três testes Go dirigidos passaram com race detection (pacote 16,137 s; comando com compilação 49,741 s), tal como os quatro testes de carriers (pacote 8,075 s). Um helper de interoperabilidade foi omitido nessa invocação e não é contado como teste passado. Os 18 percursos reais entre motores passaram em 135,677 s; toda a UI existente passou com Node (19 casos, 145,928 s) e Go (19 casos, 127,595 s).

Os 27 inputs alterados coincidiram com o registo anterior ao teste Node; as 360 fontes verificadas mantiveram-se inalteradas durante a continuação. [Relatório, comandos e logs](evidence/group-notice-runtime) preservam esta execução. Os testes usam processos reais e TCP; o percurso série usa PTYs do sistema, não rádios físicos. Não foram repetidos os gates integrais Go/SQLite neste conjunto; a próxima execução CI e a regressão integral continuam necessárias.

## Trabalho que permanece no contrato

Continuam pendentes os casos adversariais adicionais de avisos antigos após saída/encerramento, contenção e saturação, a integração de grupos dinâmicos no worker web, a revisão independente, os gates actuais de todas as plataformas e a execução em hardware/radios. A gestão visual de grupos é consolidada num marco separado. Estes resultados não tornam o RelayLoom um produto concluído ou infraestrutura validada para catástrofes.
