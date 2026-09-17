# Catálogo e API de revisões Go

**Correcção de runtime:** a passagem local rotulada UI Go usou `RELAYLOOM_TEST_BACKEND=go` e executou Node. Não a contar como UI Go. Os restantes testes e logs são preservados. [Âmbito, causa e nova verificação](../site-ui-runtime-correction/README.md).


O nóGo implementa o mesmo catálogo e a mesma APIsite-command doNode: pedidos lógicos, revisão estável, base observada, confirmação explícita de conflitos, fases de autorização/cópia, expiração, histórico e resolução sem fallback para conteúdo antigo quando falta a cabeça conhecida. O acesso ao perfil é serializado; validação de rede e recepção preservam autoria/leitores. O bloqueio limpa a referência usada pela validação concorrente. Ainda não há API de sites integrada no browser nem controlos de revisões no editor partilhado.

Passaram66vectores de transiçãoNode/Go, com10controlos negativos; um processoGo retomou a operação criada porNode na mesmaSQLite e a sequência inversa também passou; três percursos de APIs reais trocaram sites públicos/privados, histórico, seeder com autor desligado e conflito entre os dois motores.

O gate final passou todos os pacotesGo listados, comrace;69testes de interoperabilidade; fronteiraSQLiteC;31UI Node+31UI Go; compilação e execução normal/empacotada doLinux. [Relatório completo](report.json) e [hashes](manifest.json). Os testes de UI cobrem os fluxos existentes e a ausência de regressões, não os controlos de revisões ainda por construir. As fontes ficaram inalteradas durante o gate.

Reprodução principal: `npm run build`; `npm run test:native`; `npm run native:build`; `npm run test:interop`; `npm run test:native:cgo-storage`; `RELAYLOOM_TEST_BACKEND=node node scripts/e2e.mjs`; `RELAYLOOM_TEST_BACKEND=native node scripts/e2e.mjs`. O relatório conserva os argumentos exactos, incluindo o -p=1 usado no gate e os comandos do pacoteLinux.

A extracção do validador do documento detectou uma substituição indevida do literaltext; foi corrigida e os mesmos vectores voltaram a passar. O caso com dados grandes passou em95s comrace e6,46s semrace; o perfil mostrou custo de regex/validações repetidas. A validação ASCII equivalente de base64, a remoção de validações redundantes e o reaproveitamento da revisão já verificada reduziram o mesmo caso normal para5,31s, sem aumentar prazos. Dez mil entradas determinísticas e casos de padding conservaram a aceitação do regex original. A aplicação continua a recusar conteúdo expirado na admissão e transmissão; a leitura histórica é apenas para recuperação de preparação autenticada.

Não há prova de corte de energia físico, rádios, execução de todas as versões deSO ou prontidão para catástrofes. Permanecem browser, controlos no editor, contribuições, ficheiros opcionais, migração/rotação/backup e restante contrato. A revisão independente continua pendente durante a execução sequencial pedida pelo proprietário.
