# Correcção de atribuição de runtime nas verificações locais

A auditoria de 17 de Setembro detectou que `.cache/site-api-final/run.mjs` e `.cache/go-site-final/run.mjs` lançaram a etapa chamada ui-go com `RELAYLOOM_TEST_BACKEND=go`. Nessa versão, tests/helpers.ts só seleccionava o executável Go para o valor native; qualquer outro valor escolhia Node. Assim, as duas passagens locais de31UI de cada um desses gates executaram Node. A etiqueta Go estava errada e não constitui prova de UI Go.

Os relatórios/logs originais foram preservados. Os testes de domínio/race Go, SQLite, vectores e processos de interoperabilidade desses gates continuam a ser provas dos casos efectivamente executados. O job native-ui dos CI35226875160/3f63f19 e35252072691/dc57316 usa explicitamente RELAYLOOM_TEST_BACKEND=native e passou; isso é evidência separada, não uma alteração retroactiva dos resultados locais. scripts/verify-ui.mjs também usa native correctamente.

O runner e o helper passam a rejeitar valores desconhecidos, em vez de escolher Node silenciosamente. Um novo controlo negativo recusa go e o controlo positivo arranca ambos os motores, consulta a API e confirma nativeRuntime=Go no processo nativo. A repetição da UI Go para a candidata actual será registada com o valor native e verificação do motor no cliente. Ainda está pendente nesta nota.


A repetição corrente terminou com **32 testes UI passados** usando envnative. O teste do estúdio consultou a API e confirmou nativeRuntime=Go, com processos independentes, publicação privada, recuperação e leitura após paragem do autor. [Prova, argumentos, estatísticas e hashes das fontes](verified-go-ui.json). Este passe é da UI Go; o restante gate integral ainda continua e os relatórios históricos mantêm os resultados originais.
