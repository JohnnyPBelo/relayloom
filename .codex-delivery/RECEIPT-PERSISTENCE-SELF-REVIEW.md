# Revisão própria da persistência de recibos — 23 de Setembro

Esta revisão é do autor da implementação, não cumpre o gate de revisão independente. Recuperação sequencial sem novos/retomados agentes mantida. Fonte em gate com 745 ficheiros; confirmar resultado terminal antes de atribuir passe.

## Fronteiras revistas

- AttachSource verifica assinatura/envelope/contexto da proposta e fonte antes de persistir verifiedAt+receipt. PrepareReceipt vincula todos os campos históricos e cards; não é uma RPC. Read migra uma entrada antiga apenas quando consegue autenticar a prova retida e a política actual permite a leitura. Entradas descartadas antigas sem prova não são completadas a partir de metadados.
- Prepared não tem stage, assinatura ou envelope. SignReceipt relê a intenção, valida política e grava certificado+descritor na mesma transacção. SealReceipt não volta a assinar, guarda bytes exactos e vínculo ao envelope. CopyReceipt compara a cópia real com a preparação e só muda o indicador copied. Nenhum método deste incremento emite pacotes.
- Referência da proposta e prazo do recibo são imutáveis; updatedReceipt só permite prepared→signed→queued→copied, além do caminho de expiração separado. Nem descarte nem expiração dos valores criam outra autorização. Certificado de recepção não altera a concessão de publicação.
- Índice da inbox e stage de recibo partilham uma transacção; namespaces são cifrados com domínios/AAD/HKDF separados e chave derivada da posse de assinatura. Node/Go leem a mesma SQLite. A ausência/alteração de stage ou troca de ciphertext falha como integridade; não se repara com outro nonce.
- Browser verifica sessão depois dos awaits e antes de commits. Métodos de assinatura/selagem novos não entram na allowlist do worker. O gate inclui recusa explícita dessas duas operações na RPC e não só procura de chaves nas respostas.
- A nova cache limitada só retém validação criptográfica de cards públicos imutáveis. exactShape antecede a chave canónica/cache, impedindo getter/símbolo adicional num objecto equivalente a uma identidade anteriormente validada. Nunca guarda estado de bloqueio, prazo, sessão ou aprovação.

## Ajustes derivados da revisão

Até256 preparações de recibo e64 provas podem vencer no mesmo instante, acima do limite192 chaves por transacção no browser. A limpeza agora limita a128 provas por commit e reabre uma transacção para o lote seguinte; o limite global não foi aumentado. O controlo real com129 assinaturas guardadas interrompe após o primeiro commit e recupera exactamente a última prova. Estados expirados intermédios ficam íntegros, sem reactivação de envio.

Preservar o card original do dono na intenção evita que mudança do nome reescreva o recibo numa retoma. Mudança da chave de leitura histórica sem chave disponível é recusada na selagem; rotação/keystore continua requisito aberto, não inferir implementação a partir deste guard.

## Testes que devem acompanhar o marco

50 vectores(18 aceites/32 recusados) de fases/quotas/vínculos, controlos de cache de card getter/símbolo, Node inbox com expiração/descarte/migração, processosNode/Go comcrash antes/depois de cadafronteira, concorrência real de dois writers e igualdade de bytes, namespace/read-secret/transplante de contexto, browserlock/rollback/lostreply/corruptstage/batchcleanup e worker. Regressores integrais conforme receipt-persistence-gate.mjs.

## Ainda não implementado

Entrega automática do recibo ao visitante, admissão e fecho atómico da fila do visitante, recusa assinada, decisões de publicação/CAS/reconciliação/proveniência e UI completa. Não existe confirmação de que o visitante recebeu o recibo; copied será apenas facto local. HTML público/plataformas/rádios e revisão independente continuam com os limites anteriores. Rascunhos em .cache/receipt-delivery-draft não fazem parte do gate actual.
