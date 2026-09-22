# Recibos e decisões — próximo incremento

Este documento é desenho, não implementação. O gate da recuperação da origem está em `.cache/contribution-source-final/report.json`; não editar fontes enquanto estiver vivo. Manter todo o PROJECT-BRIEF e a execução sequencial.

## Semântica a preservar

- ACK do transporte, recepção autenticada e publicação são factos diferentes. A inbox só pode confirmar recepção verificada depois de guardar a proposta e autenticar a origem. `missing-source` nunca se apresenta como recebida/verificada pelo dono.
- O recibo é assinado pelo dono identificado em `proposal.target.site`, privado para dono+contribuidor e ligado ao certificado, autor, UUID e destino originais. Não contém valores da proposta nem concede autoridade para editar o site.
- O remetente autentica o dono e o vínculo à sua intenção persistida. Recibos cruzados, adulterados, de outro actor ou para uma operação nunca autorizada para transporte são recusados. A repetição não cria outro resultado.
- Recepção não permite aprovação depois de expirar a concessão. Um recibo tardio pode documentar uma recepção anterior sem renovar prazo, valores ou audiência. A UI tem de distinguir esse histórico do estado actual da proposta.
- Cancelamento local não apaga uma recepção real já confirmada. O histórico não deve fingir que o dono deixou de ter uma cópia.

## Persistência e integração

1. Conservar nos metadados privados os dados públicos mínimos do destinatário e a prova de verificação necessários para concluir um recibo após crash/expiração, sem depender de contactos ou de um payload já expulso. Manter registos anteriores legíveis; não inventar metadados que nunca foram guardados.
2. Intenção do recibo antes de assinar; assinatura e envelope exacto em commits recuperáveis separados; cópia relida antes de emitir. Preparação, assinatura e selagem ficam fora do RPC. Não criar outro nonce/prazo numa retoma depois de commit.
3. Admitir o tipo dedicado nos três motores e permitir relay opaco sem chaves. Aplicar bloqueio/retirada/sessão/quota e cancelamento dos pacotes próprios. Não reutilizar os recibos de chat como autorização de publicação de páginas.
4. Ao validar confirmação, parar os retries da proposta e libertar o payload privado segundo a transição persistida. Conservar a identidade do certificado/resultado e os limites finitos da janela; não confundir fonte obtida com recibo recebido.
5. Recusa e publicação são resultados posteriores distintos. Recusa deve funcionar para candidatas bloqueadas/não verificáveis por decisão explícita do dono, sem obrigá-lo a publicar ou aprovar dados para libertar quota. Não classificar falha técnica como decisão humana.
6. Publicação exige CAS da base actual, reconciliação explícita e concessão compatível com a audiência. Verificar a cópia publicada antes de confirmar. Proveniência identifica a assinatura original e distingue alterações feitas pelo dono.

## Verificações obrigatórias

Vectores canónicos Node/portátil/Go, leitores/autores/UUIDs trocados, corrupção, replay, prazo e recibo tardio. Falhas antes/depois de cada commit, perda de resposta, concorrência real e reabertura entre motores. Transporte misto com relay sem chave, partição/heal e emissor original offline. Produção worker/RPC e UI completa de três contas em PT/EN/ES, com acessibilidade, toque/teclado e revisão visual. Só activar formulários quando compor/enviar/rever/recusar/aceitar/reconciliar/publicar funcionarem.

Continuam obrigatórios os outros requisitos de grupos web, recuperação/rotação/keystore, plataformas, rádios e revisão independente. Nada neste plano conclui o produto.


## Ordem de migração após descarte local

O incremento dismiss é gestão privada de armazenamento, não um recibo ou uma recusa enviada. Entradas já descartadas sem material para selagem não ganham retroactivamente um recibo: não inventar chave pública de destinatário nem assinatura de visitante. Ao integrar recibos, guardar a intenção e os metadados públicos necessários no mesmo commit que verifica a candidata, antes de permitir apagar a prova. O journal do recibo deve sobreviver ao descarte da inbox e à expiração dos valores, com prazo próprio finito e sem renovar a concessão original. Repetir um certificado descartado nunca reabre valores nem fornece autoridade nova.

Descarte não elimina envelopes cifrados da cache comum nem cópias de outros pares. Liberta quota lógica de provas privadas, não garante apagamento físico de páginas SQLite/WAL. Metadados retidos continuam sujeitos ao limite global de 256 entradas e janela após maior prazo observado; isto não é uma solução universal contra spam/sybil.
