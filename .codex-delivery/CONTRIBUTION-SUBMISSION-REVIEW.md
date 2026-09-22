# Auto-revisão da integração de propostas

Revisão do implementador, não independente. A restrição do proprietário a novos/retomados agentes mantém-se. As conclusões abaixo referem-se ao WIP sobre f69eb24; o gate da fonte exacta é `.cache/contribution-submission-final-1/report.json`.

## Fronteiras conferidas

- `contribution-command` é fechado: a UI não fornece source/context/ACL/chaves. O browser captura valores antes de enfileirar trabalho assíncrono. A consulta descritiva não funciona como capacidade de assinatura.
- Intenção, assinatura, selagem, handoff privado e cópia são fronteiras separadas e recuperáveis. A fila conserva32 operações/32 MiB no máximo, liberta o slot de preparação na mesma transacção e não expulsa queued da janela de 128. Cópia relida e hash ligados à operação; `copied` não é ACK/recibo.
- O namespace privado deriva da chave de assinatura, mantendo AAD e interoperabilidade existentes. Cancelamento/expiração conservam descriptor para retirar pacotes, mas removem o payload privado verificado. A correcção de cancelamento antigo impede apagar o novo stage.
- Node distingue recusa operacional de corrupção persistida. A falha da primeira suite da fila foi preservada e a suite corrigida passou16casos. Não enfraquecer a invalidação da sessão por corrupção.
- Admissão legível verifica envelope e certificado; trânsito sem chave valida envelope sem fingir autorização para ler. O kind não passa pela publicação genérica. O estado periódico resume metadados e não expõe valores.
- No browser, a cópia revalida bloqueio/retirada na mesma transacção IndexedDB e valida sessão depois dos awaits; os callbacks/chaves das mutações são capturados antes do primeiro await. Os controlos bloquearam a cópia emcurso e confirmaram rollback/retoma.
- Política de envio e cancelamento integram-se nos routers existentes, sem renovar envelope ou cancelar transmissões saudáveis a cada tick. Tráfego próprio funciona com relay para terceiros pausado. Os testes reais de RTC/TCP/serial PTY incluem positivos depois de negativos.

## Questões que impedem afirmar a funcionalidade completa

Inbox actual é uma lista reconstruída de candidatos e não um registo durável. Falta replay por autor/UUID, conservação de decisões/provas sob quota, recuperação automática da fonte, recibos do dono, aprovação/rejeição/CAS/reconciliação/proveniência. Valores não podem entrar numa revisão sem consentimento e vínculo de autoria original. A UI permanece oculta até fechar estes pontos.

A auto-revisão levantou uma fronteira ainda por ensaiar: cancelamento enquanto `bundleForTransport/canServe` já espera pela consulta de política. O negativo existente suspende a publicação antes de começar essa consulta. Acrescentar um controlo que retenha uma consulta realmente iniciada, conclua o cancelamento e só então a liberte; distinguir de bytes já entregues ao transporte, que não são recolhíveis. Não tratar esta hipótese como falha reproduzida antes do ensaio.

Não inferir serial directo Go do teste de rota heterogénea, rádio de PTY, aparelhos físicos dos browsers de ensaio, assinatura Apple do build de simulador, nem revisão independente desta leitura de fonte. CI f69eb24 e publicação7fdb76a/0fdbd1b têm proveniências separadas.


## Resultado final deste marco

Fonte5a1921c/07b509e guardada: gate amplo505Node/17pacotesGo-race/35processos/49casos porengine PASS. A hipótese de autorização retida foi reproduzida (cancelamento/expiração2FAIL, close1PASS), corrigida noBrowserContributionRuntime e seguida de3controlosPASS e gate finaltypecheck/build/16casos porenginePASS.720hashes finais conferem; só runtimebrowser/harness/testerace mudaram entre gates. Provas em docs/evidence/site-contributions/submission. Nenhum teste local permanece emcurso; todososhandles foramrecolhidos. Continuar inbox/recibos/decisão/CAS/UI deCONTRIBUTION-INBOX-NEXT.md, preservando todoocontrato. Não afirmar produto concluído nem publicarHTML semgateexacto.
