# Próxima fase: submissão, transporte e revisão

Este documento conserva o desenho da integração e o estado local. Fila e API de submissão já estão ligadas em Node/Go/browser; inbox ainda enumera candidatos e não decisões duráveis. Aprovação e UI continuam pendentes. Manter todo o PROJECT-BRIEF.md e a execução sequencial. As secções de desenho abaixo distinguem requisitos da implementação; consultar as notas finais e CONTRIBUTION-INBOX-NEXT.md.

## Fronteira autorizada do cliente

A UI fornece locator (snapshotId/pageId/formId), valores, concessão de publicação, prazo, UUID e sequência. Não fornece snapshot, contexto, ACL, destinatários de transporte ou assinatura. Cada motor resolve a cópia autenticada e aplica a política, usando os catálogos existentes. `prepare` guarda a intenção; `sign` e `seal` são commits posteriores recuperáveis. Se uma etapa falhar ou a resposta se perder, o UUID/resultado mantém-se. Nada deve aparecer como entregue apenas por estar assinado/selado.

## Handoff durável para transporte

Guardar a ligação entre certificado, envelope e intenção de envio antes de copiar para a store que participa na sincronização. A existência de um bundle nessa store pode permitir inventário/gossip mesmo antes de uma chamada explícita a publish. O consentimento de envio tem de estar durável nessa altura. Pausa/bloqueio/retirada/prazo e geração de sessão devem ser revalidados ao copiar, não apenas antes de uma operação assíncrona.

No browser, `putBundle` actualmente aceita uma mutação privada; `commit` já aceita várias. A cópia de propostas exige que política (mesh-settings + application mutations) e intenção de outbox partilhem a revisão transaccional. Estender a API interna de forma compatível e capturar os callbacks/chaves antes dos awaits; não reentrar em profile.getValue/data durante a transacção exclusiva. Exigir teste de bloqueio/retirada/lock durante a cópia, com rollback real do IndexedDB.

A preparação só pode libertar o seu único slot activo depois de existir uma intenção de transporte recuperável. Um estado queued/copiado deve ser um facto provado pelo armazenamento, não um rótulo escolhido pelo cliente. Manter a tabela actual de estados legível ao migrar registos antigos; não apagar stage/resultado para abrir espaço. Preservar o ID do envelope para poder cancelar pacotes retidos mesmo depois da expiração/cancelamento da preparação. A assinatura/cifra exacta já está guardada no stage, portanto não criar outra numa retoma.

Manter uma fonte verificável para o dono resolver o formulário histórico mesmo se a sua store tiver expulso o snapshot. O snapshot de origem tem de permanecer disponível na área privada/outbox ou como cópia reservada com contagem de referências até ao fim da operação. Aplicar limites globais e contrapressão sem expulsar trabalho pendente. Documentar quotas e a janela finita de retenção; não prometer UUIDs lembrados para sempre.

## Admissão e inbox

A espécie `site-contribution` não está ainda admitida pela aplicação. Acrescentar um payload fechado `{type, proposal}` e validar corpo/certificado em cada motor, com `MatchContributionEnvelope`/equivalente depois de autenticar/desencriptar. O envelope tem de ser privado para visitante+dono, com autor/tempos exactos. Public grant não autoriza envelope público. Um relay sem chaves conserva apenas bytes opacos.

Inbox do dono exige contexto original autenticado, permissão de contribuidor, prazo, esquema, bloqueio e replay. Não confirmar admissão de uma proposta cujo snapshot está em falta: conservar estado limitado e pedir/obter a prova por um caminho explícito. Dedupe por certificado e identidade/operação; reempacotar os mesmos dados noutro envelope aleatório não deve criar outra linha nem outra decisão. Recusar excesso sem apagar decisões pendentes. Mensagens/recibos novos devem passar pelos adaptadores existentes, mantendo o meio fora do fluxo de composição.

Distinguir recepção física de bytes, admissão na inbox e aprovação. Os recibos devem ser assinados pelo dono e ligados à proposta; um ACK do transporte ou uma etiqueta local não prova revisão humana.

## Aprovação e publicação

O dono compara a proposta com a base e o esquema actuais. Reconciliar explicitamente quando mudarem; uma validação com um contexto falsificado para a nova audiência não substitui a prova original. A audiência da publicação tem de estar coberta pela concessão assinada. Uma proposta com concessão privada para um site público pode ser revista privadamente, mas não incorporada na versão pública sem nova concessão adequada.

Persistir a decisão do dono antes de publicar, com uma operação de site recuperável e CAS. Definir/testar exactamente o ponto em que uma aprovação unexpired fica durável e pode terminar uma cópia depois de uma interrupção; não renovar a concessão nem inventar uma aprovação retroactiva. Antes de marcar publicada, reler a revisão realmente guardada. Recibo e proveniência conservam a assinatura original; alterações posteriores feitas pelo dono não são atribuídas ao visitante.

## UI e gates de entrega

Só activar a paleta quando os percursos reais funcionarem: compor formulário, pré-visualizar, escolher consentimento, enviar, retomar, ver estado, rever/aceitar/rejeitar, reconciliar e publicar. PT/EN/ES, texto autoral intacto, Liquid Glass, foco/teclado/toque e estados honestos. Três contas reais pela UI, processos mistos, autor offline/seeder, partition/heal, duplicação/concorrência, perda de resposta, quotas, corrupção, expiração e bloqueio são obrigatórios. Hardware, Apple, grupos web, recuperação/rotação/keystore e revisão independente continuam no objectivo integral.

## Implementação da fila iniciada

Adicionar fase queued ao registo, com descritor de transporte imutável (bundleId, bundleHash, bytes de staging e copied). A fase representa intenção durável de transporte, não entrega. Guardar o stage completo sob chave privada derivada do certificado e libertar o único slot de preparação na mesma transacção. Limites iniciais:32operações queued e32MiB de payload privado, além do limite global real do armazenamento. Se a janela de128resultados fosse retirar uma operação ainda queued, aplicar contrapressão em vez de a apagar.

Expiração/cancelamento conservam o descritor para retirar pacotes retidos, mas eliminam payload privado quando a integridade tiver sido verificada. `copied` só avança depois de reler e validar a cópia do ContentStore, e não é recibo do dono. A consulta de estado mantém apenas metadados; recuperar o payload exige a chave de assinatura e as políticas actuais. Preservar o formato anterior e testar transições/quotas/crash nos três motores antes de ligar o envio.

## Envio ligado nos três motores — por consolidar em testes

A API aceita state/form/submit/operation/resume/cancel/inbox com pedidos fechados. Node/Go já passaram dois percursos TCP reais nos dois sentidos; Chromium passou um percurso RTC entre duas identidades autónomas, incluindo envio próprio com relay pausado, valores exactos, concessão privada e cancelamento que deixa de permitir servir o envelope local. A fila queued precede a cópia para ContentStore; copied significa apenas cópia verificada. Os motores retomam periodicamente e conservam o mesmo envelope. Há validação de manifestos privados mesmo em trânsito opaco e vínculo completo de certificado quando legível; publicação genérica recusa o novo tipo.

A acção inbox actual devolve **candidatos verificáveis**, resolvendo o snapshot original e sem aprovar/publicar ou emitir recibo do dono. Ainda não é o journal durável de decisões/replay/recibos e não deve ser apresentada como fluxo concluído. O estado periódico não leva os valores da proposta. Continuar com controlos de corrupção/autor errado/audiência pública/inbox sem prova, falha de cópia, restart e cancelamento atrasado; depois inbox/decisão/CAS/proveniência e UI.

No browser, putBundle passou a aceitar várias mutações privadas capturadas antes do await; política de bloqueio/retirada é conferida na mesma transacção da cópia. O RPC de transporte verifica elegibilidade de contribuições próprias, e maySend volta a ler essa elegibilidade antes de iniciar transmissão. Os helpers de assinatura/selagem continuam fora do RPC. Falhas de reserva não devem ser tratadas como corrupção: o Node catalog foi ajustado para erros normais em pedidos inválidos/pendentes, preservando erros de integridade para bytes persistidos inválidos.


## Gate da submissão em curso, depois de controlos de produção e heterogéneos

Firefox e WebKit passaram5casos cada (mesmos controlos antes passados emChromium), com JSON preservado imediatamente. O novo teste de worker de produção passou2casosChromium: setup/ligação pelaUI, submissão porRPC fechado, worker/IndexedDB reais, reabertura pela shell offline, envelope exacto, cancelamento conservado e recepção RTC. Não é ainda UI de compor/rever formulários.

Dois percursos novos de propostas TCP→serialPTY passaram com senderNode/Go, relayNode sem chave e ownerNode serial-only. Provaram hops2/rota, bytes exactos, recusa de leitura/decriptação pelo relay, partição, remetente realmente parado/socketECONNREFUSED, canal positivo com relay pausado, ausência de proposta durante pausa e takeover ao consentir novamente. A primeira fixture falhou por tentar serial directoGo, que continua indisponível; não confundir caminho heterogéneo com suporte directo desse adaptador nemPTY comrádio.

Gate `.cache/contribution-submission-gate.mjs`, relatório `.cache/contribution-submission-final-1/report.json`, conserva hashes antes/depois, comandos, estados e logs e pára na primeira falha. Sequencial: typecheck, Node integral,17pacotesGo/race, buildnative, testes de processos contribuições+rede mista, buildweb,16ficheirosbrowser afectados emcadaengine. Não repetir ou modificar fontes enquanto corre. Ainda sem commit/push. Próximo incremento funcional detalhado em CONTRIBUTION-INBOX-NEXT.md.


## Resultado final deste marco

Fonte5a1921c/07b509e guardada: gate amplo505Node/17pacotesGo-race/35processos/49casos porengine PASS. A hipótese de autorização retida foi reproduzida (cancelamento/expiração2FAIL, close1PASS), corrigida noBrowserContributionRuntime e seguida de3controlosPASS e gate finaltypecheck/build/16casos porenginePASS.720hashes finais conferem; só runtimebrowser/harness/testerace mudaram entre gates. Provas em docs/evidence/site-contributions/submission. Nenhum teste local permanece emcurso; todososhandles foramrecolhidos. Continuar inbox/recibos/decisão/CAS/UI deCONTRIBUTION-INBOX-NEXT.md, preservando todoocontrato. Não afirmar produto concluído nem publicarHTML semgateexacto.
