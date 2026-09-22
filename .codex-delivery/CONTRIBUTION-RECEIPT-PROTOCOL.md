# Recibo de recepção — protocolo implementado, runtime pendente

**bf12d51** implementa o certificado/envelope nos três adaptadores, com52 vectores(7 aceites/45 recusados),Go/sites-race e1 teste real por browser PASS. Provas docs/evidence/site-contributions/receipt-protocol. O journal, admissão/entrega e UI continuam pendentes. O desenho abaixo mantém-se para essa integração; o gate de descarte/correcção terminou antes de integrar este protocolo.

## Facto assinado

Certificado dedicado `relayloom/site-contribution-receipt/1`: dono (PublicIdentity autenticada), contributorId, certificateId, operationId, target completo, proposalCreated/proposalExpires, verifiedAt, created e expires. Não inclui valores, assinatura da proposta completa, audiência de publicação ou resultado de aprovação. Não reutiliza recibos de chat.

O dono tem de corresponder ao endereço target.site. ID é hash do corpo canónico e assinatura usa o adaptador mantido existente. O recebedor verifica a assinatura e compara certificado/UUID/contribuidor/destino/prazos com a operação privada persistida. Só uma operação que tenha tido transporte autorizado e cópia relida pode ser confirmada. Preparação/assinatura isoladas não são intenção de transmissão. O estado cancelled/expired não apaga a possibilidade de uma recepção histórica de uma operação anteriormente enviada; apenas a confirmação factual é anexada.

verifiedAt é um instante autenticado pelo dono anterior ao prazo original, respeitando a tolerância de relógio já existente. created fica fixo na intenção durável; retry não volta a usar Date.now para criar outro prazo. O prazo próprio do recibo é finito (no máximo 30 dias desde a intenção), independente do restante prazo da proposta. Chegar depois da expiração não concede nova autorização para publicar valores. A assinatura é a declaração do dono, não uma prova externa da precisão do seu relógio.

## Intenção e retenção

Na transacção que autentica a origem: guardar a referência da proposta, instante de verificação, dados públicos do contribuidor necessários à selagem e intenção do recibo. A transacção não publica. Uma etapa posterior assina, outra guarda envelope exacto e outra relê a cópia antes de emitir. Tudo deve ser recuperável sem contactos, cache normal ou payload já expulso.

Descartar a prova privada posteriormente não elimina a intenção/recibo já comprometido. Registos anteriores sem metadados suficientes não recebem recibos inventados; a UI indica apenas o histórico realmente disponível. A fila do recibo tem namespace/limites privados, AAD/HKDF separados e chave de autoridade de assinatura, nos três motores. Os catálogos nunca confiam num objecto de intenção/autor fornecido pelo RPC.

Envelope dedicado `site-contribution-receipt`, privado exactamente para dono+contribuidor, autor e card completos ligados ao certificado, created/expires iguais aos do corpo. Relay opaco com orçamento limitado é permitido sem capacidade de assinar ou ler. A resposta não transporta nem amplia a concessão de publicação. Bloqueio, retirada e sessão suspendem transmissões futuras; não apagam factos já recebidos.

## Transições do visitante

Receber e autenticar recibo + encerrar retries da operação + libertar o payload privado devem ter uma transição persistida coerente. Conservar o certificado de recibo ou referência autenticada suficiente para mostrar o facto após reabertura. Duplicados idênticos não escrevem outra confirmação; vínculos cruzados ou conteúdo adulterado são recusados. Uma operação cancelada mantém o seu estado local e passa a ter histórico de recepção; não volta a queued. Expiração não é renovada.

## Gates antes de ligar à interface

1. Vectores Node/portátil/Go: chave/dono, UUID/certificado/destino, leitores extra/em falta, domínios extra, corrupção, assinatura não canónica, tolerância de relógio e recibo tardio.
2. Catálogos reais: antes/depois de cada commit, resposta perdida, sessões fechadas, guarda da mesma assinatura/envelope/nonce/TTL; reabertura cruzada em SQLite e IndexedDB.
3. Processos e rede mista: ambos os sentidos browser↔Node/Go através de relay sem chave, partição/heal e cache ausente; controlos positivos durante recusas. Confirmar paragem de retries sem confundir ACK físico com certificado.
4. Worker compilado sem exportar assinatura/chaves; só depois caixa completa de revisão e três contas reais PT/EN/ES. Aceitação/reconciliação/publicação e proveniência continuam necessárias para activar a paleta de formulários.


## Rascunho de implementação separado do gate

Há quatro rascunhos em `.cache/receipt-staging/`: protocolo TypeScript/Go e vectores partilhados. Ainda não foram copiados para as fontes, compilados ou executados. Servem para continuar trabalho independente enquanto o gate de descarte mantém fontes congeladas. Depois de recolher o gate e guardar o código de descarte, integrar/rever/testar estes rascunhos. Não atribuir-lhes os resultados do descarte. A validação do recibo puro não substitui a autorização de transporte e journal no runtime.


Os cinco rascunhos de .cache/receipt-staging foram integrados e testados em bf12d51; as cópias nessa pasta são históricas, não a fonte de próximas edições. Editar packages/sites/src/contribution-receipt.ts, native/sites/contribution_receipt.go e os testes correspondentes.
