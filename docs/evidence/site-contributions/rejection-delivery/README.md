# Entrega privada da recusa — incremento verificado

Fonte `ac772242145135894da0d97b1712bc7e9db64c92`. Node, Go e browser entregam a decisão assinada e o visitante autentica o vínculo à operação previamente copiada. Guardar a recusa e retirar o payload privado partilham o commit. Recibos anteriores permanecem; queued/received passam a rejected e cancelled/expired conservam a decisão local com facto histórico separado. Recibo tardio não reabre nem sobrepõe a recusa.

## Reprodução e resultados

`node docs/evidence/site-contributions/rejection-delivery/run-gate.mjs`, nesta fonte, com dependências do projecto e reserva mínima15GiB. O driver recusa substituir relatórios, confere hashes e corre uma fase pesada de cada vez.

539 testes Node,17 pacotes Go/race (ver logs para cache e helpers),185 casos entre processos e140 Chromium/140 Firefox/140 WebKit. Typecheck/builds PASS. 780 hashes iguais antes/depois e conferidos no commit. Relatórios Node/processos/browsers sem falhas ou skips; browsers sem flaky.

Os controlos incluem46 vectores Node/portátil/Go, ordem recibo/recusa, operação não copiada/histórico retirado, quotas e orçamento conjunto8→9, bloqueio/sessão/deadlines,12 entradas adversariais por motor com positivos no mesmo canal, corrupção, crashes antes/depois e dois escritores reais na mesmaSQLite. TransporteTCP Node↔Go, RTC→WS browser↔Node/Go com intermediário sem chave, partição/retoma e seeder com dono offline/socketrecusado. Worker de produção com setup e ligação pelaUI, offline/reload e preservação de outra proposta cancelada; assinatura/selagem privadas não expostas pelaRPC.

## Falhas e revisão

O browser revokeInvalid percorria só os recibos. O controlo reteve uma resposta de política, bloqueou e voltou a permitir; a autorização antiga continuoutrue. O teste falhou antes e passou após percorrer ambos os mapas, junto de retryinalterado e consulta nova positiva. A falha, trace e captura ficam emcontrols/rejection-revocation-before. Não éHTTP408.

Uma tentativa inicial dos novos testes de atomicidade parou no typecheck por um campocreated antigo e kind duplicado nas fixtures; foi corrigida antes de executar. Os testes dirigidos anteriores não registaram freeze completo, pelo que não se lhes atribui o commitfinal. A regressão integral acima fornece essa ligação.

## Limites

Ainda faltam incorporação/aprovação, reconciliação, proveniência e a UI completa de propostas com três contas e PT/EN/ES. Paleta e HTML público permanecem anteriores. Revisão própria não satisfaz revisão independente. Nenhum destes passes prova rádios/dispositivos físicos, iOS/Safari ou disaster-readiness. O CI d6d4ddb e a investigação de desempenho canónico conservam os seus resultados separados; não são reclassificados por este gate.
