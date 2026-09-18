# Tabelas assinadas — validação local de 18 de Setembro de 2026

Este incremento acrescenta tabelas ao documento v2 e ao estúdio partilhado. **Ainda não é uma publicação web nem aceitação do produto completo.** [Guia e limites](../../SITE-DATA.md). Os resultados são do Linux, com processos reais Node/Go e browsers; não equivalem a aparelhos, rádios ou revisão independente.

| Gate efectivo | Resultado final |
| --- | --- |
| TypeScript e builds web/Go | PASS |
| Testes Node de sites/i18n | 138 PASS |
| Validação de tabelas entre TS/processo Go | 40 vectores, 17 aceites e 23 recusados |
| Go sites/app com race | PASS; fontes Go e vectores partilhados inalterados na correcção UI |
| Interoperabilidade de sites | 11 PASS, repetidos na fonte actual do protocolo |
| UI de páginas sobre Node / Go | 4 / 4 PASS, motor real confirmado |
| UI/API/transportes de páginas por browser | Chromium36 + Firefox36 + WebKit36 =108 PASS |
| Repetições dirigidas da correcção de foco | 5 cenários ×3 emFirefox =15 PASS; não são cenários adicionais |

O comando reproduzível é `node scripts/verify-site-data.mjs`. Os relatórios por fase conservam os argumentos exactos, os overrides de ambiente, PIDs, códigos de saída, duração, hashes dos logs e hashes das fontes. A opção de retoma só executa as fases explicitamente seleccionadas. [Relatório consolidado](report.json) e [manifesto dos artefactos](manifest.json). Todos os relatórios de gate desta pasta terminam e têm fontes estáveis; um relatório FAIL permanece FAIL.

O gate `first` passou Node/Go/interop/UI e teve duas falhas Chromium porque a fixture procurava nomes de navegação diferentes do catálogo. `refined` passou a matriz de108. Um suplemento revelou a reposição adiada de foco após guardar; o controlo determinístico falhou antes da correcção e as15repetições passaram depois. `after-focus` passou8UI/36Chromium/36Firefox, mas WebKit teve35PASS/1FAIL de contraste no botão principal. A cor base do degradê era transparente; a base opaca mantém o aspecto e o contraste. `contrast-final` repetiu8UI e108browsers, todosPASS. Os controlos e falhas estão em `failures`, sem substituir as provas anteriores.

Os testes incluem importaçãoUTF-8/JSON/CSV recusada antes da substituição, valores tipados/null, protecção de fórmulas na exportação, desfazer/eliminar, pesquisa/ordenação/paginação, precisão numérica, anoISO0000, idiomas, móvel/escuro/Axe, reinício cifrado, assinatura/audiência, alteração de célula sem certificado, corrupção armazenada e limites por tabela/documento. RTC→WebSocket→TCP tem controlo de pausa e restabelecimento, transferência inversa e seeder único reiniciado depois do encerramento dos autores. Não é rádio físico.

A observação RTCFirefox anterior continua sem causa comprovada; estes passes não provam a sua correcção. O CI35276560255 anterior passou todos os jobs excepto iOS; o relatório sanitizado recolhido está em `prior-ci/ios-report.json`: startup e preparação de fotoPASS, UIexit65. Não atribuir essa falha ao picker sem provas. Contribuições multiutilizador, datasets/ficheiros opcionais, plataformas físicas e o restante contrato continuam pendentes.
