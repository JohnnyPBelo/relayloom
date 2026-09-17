# Revisões de sites — APIs Node, Go e browser

As aplicações Node, Go e browser dispõem localmente de publicação versionada, com o mesmo protocolo e superfície de comandos. No browser, a API corre no worker e a persistência cifrada usa IndexedDB, sem daemon de controlo. O editor partilhado está ligado a estes comandos, com controlos de privacidade, histórico, conflito e recuperação. A versão web pública continua na fonte 0c6b58a, com a correcção de rascunhos grandes; esta nova API ainda não foi publicada no HTML.

Cada site tem um endereço `relayloom:site:<id-da-assinatura>/<nome>`. A revisão assina um documento completo e liga proprietário, nome, sequência, antecessores e hash do conteúdo. Um leitor pode servir o mesmo bundle, mantendo o autor original. Reassinar o envelope com outra identidade não dá autoridade sobre o endereço original.

## Publicação e recuperação

O pedido lógico contém sequência, UUID, base observada, documento, leitores e prazo. O catálogo grava a preparação e o fingerprint numa transacção do perfil antes de autorizar a cópia. Só depois dessa autorização é gravado o bundle no ContentStore e enviado pelo router existente. Uma repetição devolve o resultado retido; não cria outra revisão nem outra cifra.

Uma falha da cópia pública conserva uma operação committed, recuperável por pedido explícito ou após reinício. Os dados preparados permanecem privados e cifrados com uma chave derivada da assinatura. Uma publicação ainda em preparação pode ser cancelada; uma autorização já gravada não é revogada retroactivamente. Bloquear um leitor suspende novas cópias de uma preparação privada. A expiração termina a operação, preservando contadores e qualquer cabeça já autorizada.

Dois dispositivos da mesma identidade podem produzir versões concorrentes. A API recusa uma publicação sobre esse conflito sem `confirmedHeads` contendo exactamente as cabeças conhecidas que o proprietário confirmou. Uma mudança da base entre preparação e autorização impede a transmissão da preparação antiga.

## Resolução e limites

`resolve` usa os certificados persistidos e os bytes realmente presentes. Não escolhe uma versão anterior quando falta o payload da cabeça conhecida. Uma revisão histórica pode ser pedida explicitamente. Os IDs de bundles guardados são pistas de obtenção, não garantias de disponibilidade.

A distribuição usa os inventários e pedidos de bundles já existentes. Endereços ainda desconhecidos ficam pendentes enquanto os pares alcançáveis não fornecerem conteúdo. Não foi criado um directório central nem um oráculo de «versão mais recente global». Descoberta selectiva de cabeçalhos e ficheiros opcionais continuam trabalho pendente.

Limites locais:64sites por catálogo,128cabeçalhos e32operações retidas por site, até4pistas de bundles por revisão. Os limites do editor (12páginas/128blocos/2MiB de imagens) mantêm-se. A retirada/limpeza de metadados e o orçamento global exigem revisão antes de concluir o produto.

## Superfície de API

Em Node/Go, a rota é POST `/api/site-command`, com a mesma capacidade local de autorização das restantes APIs. O browser encaminha `site-command` pela API interna do worker; não faz esse pedido HTTP a um daemon. Não é um endpoint público e não se deve partilhar o URL/token de controlo.

| Acção | Campos adicionais |
| --- | --- |
| state, history | address |
| resolve | address; revisionId opcional |
| publish | name, sequence, operationId, expectedBase, payload, recipients, ttlMs; confirmedHeads opcional para conflito |
| operation, cancel, resume | name, sequence, operationId |

`recipients` é public ou uma lista de IDs de contactos com cartões válidos. A publicação genérica `/api/publish` recusa conteúdo que já contenha siteRevision, para não contornar a fronteira de versão. Respostas de publicação incluem a fase real e qualquer erro de cópia; HTTP200 não é confirmação de entrega a outro dispositivo.

## Evidência corrente

Testes dirigidos passaram: API com nós independentes, versões públicas/privadas, autor desligado e novo seeder, envelope de outro assinante recusado, falha de gravação/cópia, reinício real da app no meio da publicação, conflito entre duas instalações da mesma identidade e cabeça sem payload. Um percurso real TCP→sériePTY passou partição/heal e retomada por seeder com o autor desligado, com controlos de ausência e consentimento. PTY não é rádio físico.

A regressão passou397testesNode,duas passagens de31UI Node (a segunda estava mal rotulada Go; ver a [correcção](evidence/site-ui-runtime-correction)),2percursos legados de interoperabilidade eLinuxbuild/run/package/run; [evidência](evidence/site-api). este marco histórico não validou a UI de revisões nem dispositivos físicos; os ports Go/browser foram verificados posteriormente, como descrito abaixo. Comandos dirigidos: `node --import tsx --test --test-concurrency=1 tests/site-application.test.ts tests/site-application-recovery.test.ts tests/site-request.test.ts` e `node --import tsx --test tests/site-heterogeneous.test.ts`.


## Paridade Go verificada

O portGo passou66vectores de transição contraNode e retomada de publicações na mesmaSQLite nos dois sentidos. Passaram os pacotesGo completos comrace,69testes de interoperabilidade,SQLiteC,duas passagens de31UI Node (a segunda estava mal rotulada Go; ver a [correcção](evidence/site-ui-runtime-correction)) eLinuxbuild/run/package/run. [Evidência](evidence/go-site-api). A validação partilhada preserva o formato do estúdio existente. Estes testes não são a UI de revisões nem validação de todos os dispositivos físicos.


## Paridade browser verificada localmente

17 casos dirigidos passaram em cada engine. A matriz consolidada cobre 66 cenários em Chromium, Firefox e WebKit, com UI existente, worker compilado, adversários, persistência, quotas/abort, expiry/replay e resolução de conflitos. As fontes de produto não mudaram entre a regressão e a correcção de dois selectores de estado no teste antigo. [Evidência integral e correcções](evidence/browser-site-api).

Comandos: `node scripts/e2e.mjs --config tests/browser/matrix.config.ts`, com `RELAYLOOM_MATRIX_ENGINE=chromium`, `firefox` ou `webkit`; os argumentos exactos da repetição dirigida estão no relatório. `tests/browser/site-network.spec.ts` exerce processos Node/Go e browsers reais em três meios, retoma e novo leitor servido apenas por um seeder reiniciado, com o autor desligado. `tests/browser/site-worker.spec.ts` usa a aplicação compilada, reabre o perfil, verifica idempotência e recusa falsificação e métodos internos de assinatura. Não são rádios físicos, Safari/iOS real ou os futuros controlos do estúdio.


## Usar o estúdio com versões

Em **A minha página**, o campo de endereço identifica o site do proprietário. **Ver histórico** mostra as versões recebidas; escolher uma delas fixa a leitura. **Ver versão actual** volta a acompanhar a versão mais recente conhecida neste dispositivo. Indisponibilidade e versões concorrentes são estados explícitos, sem escolher automaticamente um payload antigo.

O botão de opções de publicação mostra a audiência. Pode escolher público, só o proprietário ou contactos, além do prazo. O rascunho é privado e conserva a versão de partida. Rascunhos antigos sem prova de audiência começam privados. Uma mudança concorrente exige comparar as versões; resolver um conflito exige confirmar todas as cabeças apresentadas. Se chegarem novas versões durante a revisão, a publicação é recusada até nova escolha.

**Usar como rascunho** apresenta uma cópia verificada. A confirmação substitui o rascunho e conserva os leitores da versão escolhida; ainda não publica nada. **Publicar página** cria uma nova revisão assinada. O UUID e o digest ficam guardados antes do envio, para recuperar o mesmo resultado após perda de resposta ou reinício. Não abandonar um pedido incerto enquanto ele ainda possa ser aceite; o catálogo deve demonstrar que terminou ou que a base/contador já impossibilita a admissão.

O incremento passou o gate local documentado em [site-editor-versions](evidence/site-editor-versions), com uma ocorrência intermitente de fecho de relay em Firefox ainda sem causa comprovada. A distribuição HTML pública ainda não inclui estes controlos nesta nota. Os limites de dados, contribuições, ficheiros opcionais, descoberta e dispositivos físicos permanecem abertos no contrato.
