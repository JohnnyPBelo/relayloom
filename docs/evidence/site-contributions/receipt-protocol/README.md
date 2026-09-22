# Protocolo de recibo privado — certificado, não entrega

Fonte **bf12d517390d3b57997d32c4e5e8b99b18268cf7**. O dono assina uma declaração de recepção verificada, vinculada ao certificado/autor/UUID/destino e aos prazos originais. O envelope tem exactamente dono e contribuidor como leitores, mesmo que a futura publicação possa ser pública. Não contém os valores enviados nem concede autorização para alterar a página. created fica ligado a verifiedAt; o prazo finito próprio do recibo não renova a concessão original. Autenticidade histórica não demonstra a precisão do relógio de um dono malicioso.

Passaram typecheck, **52 vectores Node/portátil/Go (7 aceites/45 recusados)**, Go/sites com race e **um teste real por Chromium/Firefox/WebKit**. Os testes incluem troca de identidade/certificado/UUID/snapshot/revisão/formulário/prazos, corrupção, assinatura inválida, leitura por terceiro recusada, envelope público/leitores extra ou em falta recusados e contribuição para o próprio site. A assinatura do browser é verificada pelo Node; os leitores autorizados decifram o envelope, o terceiro falha. Nenhuma chave privada faz parte do recibo retornado.

Comandos e tempos exactos: `report.json`. Repetição no checkout desta fonte, com dependências do projecto e pelo menos 15 GiB livres:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --import tsx --test tests/site-contribution-receipt.test.ts`
- `node scripts/go.mjs test -race -p=1 ./sites`
- Para cada engine chromium/firefox/webkit: `RELAYLOOM_MATRIX_ENGINE=chromium node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/site-contribution-receipt.spec.ts` (substituir o engine).

**Não há ainda journal de recibos, admissão/entrega automática, encerramento durável de retries após confirmação, recusa assinada, aprovação ou UI completa.** O protocolo não é exposto como RPC de assinatura. Os 89 casos por browser e 87 testes entre processos pertencem ao incremento anterior de descarte/correcção de retry, não provam entrega de recibos. O HTML público mantém-se inalterado. O contrato integral e a revisão independente continuam abertos.
