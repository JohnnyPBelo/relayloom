# Próxima fase: submissão, transporte e revisão

Este documento não descreve funcionalidades entregues. Os catálogos Node/Go/browser já podem preparar, assinar e selar uma proposta privada; ainda não existe comando de submissão, outbox/inbox ou aprovação na UI. Manter todo o PROJECT-BRIEF.md e a execução sequencial.

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
