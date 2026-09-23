# Recusa assinada — protocolo verificado

Fonte `da2d174d820a6dff1b9e199ab61c1b998fa2a5b2`. Recusa privada assinada pelo dono, ligada à proposta original (certificado, visitante, UUID, endereço, snapshot, revisão, formulário e prazos). O motivo é texto limitado a 512 unidades UTF-16; não executa HTML nem transporta automaticamente os valores da proposta. Uma recusa histórica não estende a concessão, não afirma verificação da origem e não aprova publicação.

Execução: `node docs/evidence/site-contributions/rejection-protocol/run-gate.mjs` num checkout desta fonte com dependências do projecto e reserva de15GiB. O driver recusa substituir o relatório anterior e executa uma fase pesada de cada vez.

Typecheck PASS; dois testes Node (64 vectores de recusa:15aceites/49recusados, mais52vectores de regressão do recibo), com resultados canónicos iguais em Node/portátil/Go. Go/sites com race e count1 PASS; os workers condicionais são realmente executados pelos drivers Node, não pelos skips isolados. Dois testes de protocolo reais por Chromium/Firefox/WebKit PASS, zero falhas/skips/flaky. 762 hashes iguais antes/depois e verificados no commit.

Controlos: assinatura errada/chave de leitura sem autoria, domínio/campos/UUID/destino alterados, razão/timestamps fora dos limites, Unicode, getters/símbolos, proposta falsificada, envelope público/leitores extra/destinatário ausente/autor substituído, prazo exterior alterado e ciphertext corrompido. A assinatura do browser é validada em Node e reciprocamente. O seeder sem chave não lê o motivo.

**Âmbito limitado ao protocolo.** Ainda sem journal de decisão, envio/recepção no runtime ou UI de recusa. O HTML público permanece inalterado. Persistência, CAS, reconciliação, incorporação/proveniência e UI de três contas mantêm-se obrigatórias. Revisão própria não substitui revisão independente; não é teste de dispositivos físicos.
