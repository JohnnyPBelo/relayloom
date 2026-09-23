# Persistência de recibos do dono — gate concluído

Fonte **f131652040190110c594445c43559e92dfa30bb8**. A verificação da origem e a intenção do recibo passam a partilhar o mesmo commit. O card público do destinatário, referências e prazos fixos sobrevivem a perda de cache, descarte e expiração da proposta. Uma assinatura posterior fica guardada antes da selagem; o envelope exacto fica guardado antes de se poder marcar a cópia. Não há neste incremento entrega automática do recibo ou encerramento da fila do visitante.

Os três motores implementam signReceipt/sealReceipt/receiptBundle/copyReceipt internamente. RPCs de assinatura/selagem são recusadas pelo worker compilado. O material preparado fica no namespace contribution-receipt, com domínio/AAD/HKDF próprios e chave derivada da assinatura em Node/Go; no browser, usa o armazém privado autenticado IndexedDB. A quota da inbox e do perfil continua aplicada. Metadados são limitados a256 entradas/1 MiB, preparações a64 KiB por item/4 MiB no total e retenção finita. A expiração elimina assinatura/envelope, conservando o histórico mínimo enquanto a entrada estiver retida.

## Testes e comandos

Reprodução: `node docs/evidence/site-contributions/receipt-persistence/run-gate.mjs` num checkout desta fonte, com dependências/caches do projecto e15 GiBlivres. O script preserva relatórios existentes, limita a uma fase pesada e recusa fontes alteradas. O gate confere 745 hashes antes/depois; committed-source.json confirma-os contra o commit.

- **526 testes Node**, zero falhas/skips. Inclui50 vectores de journal (18 aceites/32 recusados) equivalentes Node/portátil/Go e controlos de tipos fechados mesmo depois de cachear um card.
- **17 pacotes Go/race** passaram; os logs identificam os pacotes realmente executados e os que reutilizaram cache.
- **117 casos entre processos**: SQLite partilhada Node/Go, interrupções antes/depois de verificar/preparar/assinar/selar/copiar, concorrência com commitGo retido e escritorNode à espera, igualdade de envelope após retoma, recusa de corrupção/transplante de ciphertext/namespace e controles de política/rede existentes.
- Typecheck, build nativo/web e **97 Chromium / 97 Firefox / 97 WebKit** passaram sem falhas/skips/flaky. IndexedDB real, perda de resposta, lock durante assinatura/selagem, ficheiro adulterado, origem privada e transportes existentes. O controlo com129 assinaturas persistidas demonstra limpeza em dois commits (128 + 1), recuperação após perda de resposta e respeito pelo limite192 chaves/transacção sem o aumentar.

## Provas e limites

Os testes iniciais em controls têm âmbito próprio e não substituem o gate final. O primeiro comando Go dirigido com TestContribution inclui helpers cuja execução depende do driver; a interoperabilidade real está nos testes entre processos, não se infere desse comando curto. O gate final é separado dos anteriores descarte/protocolo.

Não houve novos agentes; a revisão em .codex-delivery/RECEIPT-PERSISTENCE-SELF-REVIEW.md é revisão própria. Não cumpre a revisão independente obrigatória. Certificado de recepção é distinto de aprovação/publicação e não renova a concessão do visitante. Registos antigos descartados sem prova não ganham recibos inventados. A migração de entradas ainda verificáveis usa a prova original e política actual. O conteúdo cifrado de outros pares não é apagado por este descarte.

**Pendentes:** runtime de envio/admissão dos recibos, fecho atómico da fila do visitante, recibos tardios através da rede, recusa assinada, decisão/CAS/reconciliação/proveniência, interface completa PT/EN/ES de três contas e restantes requisitos de plataformas/rádios/grupos/recuperação/revisão independente. HTML público inalterado. WebKit não é Safari/iOS físico;serial PTY não é rádio validado. Não declarar produto concluído.
