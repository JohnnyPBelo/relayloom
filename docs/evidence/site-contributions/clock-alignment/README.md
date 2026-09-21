# Alinhamento de relógio do contrato de contribuições

Validação local de 21 de Setembro de 2026. O envelope já aceitava um desvio de 300000 ms; o certificado de contribuição recusava qualquer criação futura. O controlo de 60 segundos e os resultados antes/depois estão preservados. Não foi alterado o relógio do sistema.

Node/portátil/Go concordam em 48 vectores (11 aceites, 37 recusados), incluindo exactamente 300000 ms aceite e 300001 ms recusado. Expiração e validade máxima de 30 dias mantêm-se. Os oito testes Node e Go sites/race passaram. Os três relatórios de browser incluem um teste real de assinatura/cifra da contribuição, além de onze casos de routing/relay; não os contar como doze testes de formulários.

Reprodução: `node --import tsx --test --test-concurrency=1 tests/site-contribution.test.ts tests/site-contribution-interop.test.ts`; `node scripts/go.mjs test -race -p=1 ./sites -count=1`. Para cada engine (`chromium`, `firefox`, `webkit`): `RELAYLOOM_MATRIX_ENGINE=<engine> node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/site-contribution.spec.ts`.

O contrato não está ligado à aplicação. Documento v4, armazenamento privado, replay, transporte/inbox, aprovação/reconciliação e UI continuam obrigatórios. O relatório inicial de 46 vectores é histórico e não foi reescrito. Os hashes em report.json identificam as fontes desta etapa.
