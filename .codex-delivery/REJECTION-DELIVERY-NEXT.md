# Entrega da recusa — próxima integração

Desenho, ainda não implementação. Conservar a persistência e os resultados do incremento anterior; não publicar a paleta por existir apenas um protocolo/catálogo.

O comando fechado `reject` recebe apenas id, revisão da inbox e motivo limitado. Nunca aceita certificado, dono, destinatário, fonte, política ou contexto fornecidos pelo cliente. A intenção é derivada pelo catálogo da prova autenticada. Bloqueio/retirada/sessão/prazo são verificados antes da decisão e em cada emissão; o descarte local continua disponível sem notificar uma pessoa bloqueada.

Integrar o tipo privado site-contribution-rejection em validação/inspecção/histórico/seeding/recepção Node/Go/browser. Aplicar tamanho, leitores exactos dono+visitante, domínio, prazos e correspondência exterior/interior. O caminho genérico publish/prepare continua a recusar estes controlos. Os helpers de assinatura/selagem nunca são operações RPC.

No visitante, ligar o resultado assinado a uma operação cujo envelope tenha sido anteriormente copiado: mesmo certificado, visitante, UUID, destino e prazos. Guardar a prova da recusa e remover eventual preparação privada no mesmo commit. queued/received tornam-se rejected; cancelled/expired conservam a decisão local com recusa histórica separada. Um recibo de recepção que chegue depois nunca reverte a recusa nem recria a fila. Repetições conservam o primeiro resultado; histórico retirado não reaparece.

Um resultado autêntico sem história local é consumido sem fechar RTC e sem confirmar a operação. O erro específico só pode nascer depois de autenticar registo e assinatura; corrupção/erros comuns com texto igual continuam a propagar-se. Manter os controlos negativos e positivos no mesmo canal que expuseram esse defeito nos recibos.

A emissão pelo dono retoma as intenções existentes e conserva envelopes/IDs/prazos. Reutilizar orçamentos finitos com rotação, incluindo falhas de quota; não duplicar ilimitadamente o orçamento só por acrescentar outro tipo. Recuperar controlos que chegaram opacos antes de unlock, limitando candidatos e evitando ler media grandes. Política revogada invalida autorizações retidas; retry igual não as invalida.

Gates: vectores Node/portátil/Go para admissão e ordem recibo/recusa; armazenamento/crashes/concorrrência; Node↔Go TCP e browser↔nativo RTC→WS com relay sem chave; partição/heal, dono offline/seeder, receptor bloqueado/reaberto, controlos tardios e assinatura/audiência/corrupção; worker de produção e matriz dos três engines. A UI distingue decisão local preparada, cópia enviada e decisão recebida com prova. Nenhuma delas é aprovação/publicação.

Depois seguem incorporação com CAS da revisão actual, reconciliação de esquema/audiência, proveniência separando assinatura do visitante das alterações do dono e publicação recuperável. Três contas, PT/EN/ES, teclado/toque, temas/acessibilidade/revisão visual e restante contrato continuam obrigatórios.

## Rascunho de admissão, fora das fontes

.cache/rejection-admission-draft contém dois ficheiros propostos para journals do visitante (TS/Go), com hashes de base em manifest.json. Não estão instalados, compilados ou testados. Acrescentam recusa histórica, fase terminal e preservação da ordem recibo/recusa. Verificar cada hashantes de integrar; não copiar por cima de alterações posteriores. Faltam catálogos atómicos, runtime, parser/API, inspecção, fila limitada, vectores/negativos e UI. A revisão deve cobrir também quota do journal quando coexistem dois certificados por operação.
