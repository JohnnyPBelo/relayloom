# Revisões de sites — APIs Node e Go

As aplicações Node e Go dispõem de publicação versionada, com o mesmo catálogo e API. A API browser e os controlos do editor partilhado ainda não foram ligados. A versão web pública continua na fonte0c6b58a, com a correcção de rascunhos grandes; não anuncia esta API como funcionalidade do browser.

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

A rota é POST `/api/site-command`, com a mesma capacidade local de autorização das restantes APIs. Não é um endpoint público e não se deve partilhar o URL/token de controlo.

| Acção | Campos adicionais |
| --- | --- |
| state, history | address |
| resolve | address; revisionId opcional |
| publish | name, sequence, operationId, expectedBase, payload, recipients, ttlMs; confirmedHeads opcional para conflito |
| operation, cancel, resume | name, sequence, operationId |

`recipients` é public ou uma lista de IDs de contactos com cartões válidos. A publicação genérica `/api/publish` recusa conteúdo que já contenha siteRevision, para não contornar a fronteira de versão. Respostas de publicação incluem a fase real e qualquer erro de cópia; HTTP200 não é confirmação de entrega a outro dispositivo.

## Evidência corrente

Testes dirigidos passaram: API com nós independentes, versões públicas/privadas, autor desligado e novo seeder, envelope de outro assinante recusado, falha de gravação/cópia, reinício real da app no meio da publicação, conflito entre duas instalações da mesma identidade e cabeça sem payload. Um percurso real TCP→sériePTY passou partição/heal e retomada por seeder com o autor desligado, com controlos de ausência e consentimento. PTY não é rádio físico.

A regressão passou397testesNode,31UI por núcleoNode/Go,2percursos legados de interoperabilidade eLinuxbuild/run/package/run; [evidência](evidence/site-api). não há ainda evidência de UI de revisões, paridade persistente Go/browser ou validação física. Comandos dirigidos: `node --import tsx --test --test-concurrency=1 tests/site-application.test.ts tests/site-application-recovery.test.ts tests/site-request.test.ts` e `node --import tsx --test tests/site-heterogeneous.test.ts`.


## Paridade Go verificada

O portGo passou66vectores de transição contraNode e retomada de publicações na mesmaSQLite nos dois sentidos. Passaram os pacotesGo completos comrace,69testes de interoperabilidade,SQLiteC,31UI por núcleoNode/Go eLinuxbuild/run/package/run. [Evidência](evidence/go-site-api). A validação partilhada preserva o formato do estúdio existente. Estes testes não são a UI de revisões nem validação de todos os dispositivos físicos.
