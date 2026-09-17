# Revisões e catálogo de sites — implementação local

Este marco contém protocolo e persistência, **sem ligação às APIs, transportes ou UI de revisões da aplicação**. Não oferece ainda endereços permanentes no editor. O contrato completo continua aberto.

Os certificados autorizam snapshots completos e ligam dono, nome, sequência, antecessores e hash do documento. Os adaptadores Node, Go e browser têm testes de interoperabilidade. O catálogo persistente existe apenas em Node: prepara dados privados, grava a autorização antes de devolver o bundle para cópia, preserva cabeças/contadores, reconhece conflitos de base e recupera resultados retidos após expiração. Os estados intermédios não são anunciados como conteúdo disponível.

As preparações são cifradas a partir da chave de assinatura, dentro da base transaccional existente. A chave de leitura, por si só, não permite extrair a assinatura preparada. Os handles locais expiram no fim do callback. Os helpers de leitura histórica autenticam preparações para recuperação; os receptores e o ContentStore continuam a recusar conteúdo expirado pelo relógio actual. Os pedidos privados desta API inferior exigem repetição do mesmo envelope, para não confundir uma alteração da chave de leitura com os mesmos IDs de leitores.

| Gate executado | Resultado |
| --- | --- |
| `node .cache/site-revisions/full-regression/run.mjs` | Typecheck; 384 testes Node; Go sites/core com race, todos PASS |
| `node --import tsx --test --test-concurrency=1 tests/site-catalog.test.ts tests/site-catalog-profile.test.ts tests/site-catalog-process.test.ts` | 12 PASS depois da correcção de escritas repetidas e da fixture de perfil |
| `npm run typecheck` | PASS na fonte final |

Reprodução da parte principal: `npm test` e `node scripts/go.mjs test -race -p=1 ./sites ./core`. [Relatório completo](full-report.json), [fontes finais e diferença depois do gate](final-sources.json), [testes finais](final-catalog-12.log). O único código de produto alterado depois do gate completo foi a condição que evita voltar a gravar uma observação idêntica; os testes afectados e o typecheck foram repetidos. O rótulo build no runner corresponde a `tsc --noEmit`, não a uma nova compilação de artefactos de UI.

Os cinco ensaios de processos terminam deliberadamente um processo real com uma transacção aberta, depois do commit sem resposta, ou depois de gravar a cópia pública sem marcar ready. A retoma conserva exactamente o mesmo bundle/revisão. Isto não é corte de energia físico, transporte de revisões pela rede ou validação de outra plataforma.

Falhas conservadas: expiração confundida com corrupção; repetição de um pedido expirado recusada; oito observações idênticas causavam oito escritas; a primeira fixture do perfil omitia a estrutura obrigatória de mutations/rascunho e falhou antes de abrir o catálogo. As duas primeiras e as escritas foram corrigidas no produto; a última foi corrigida apenas na fixture. Nenhum erro foi convertido em passe sem repetir o teste afectado.

Pendentes: escritores realmente concorrentes, limites globais/retirada do catálogo, integração serializada do perfil e APIs, paridade persistente Go/browser, resolução por endereço com hints não autoritativos, multi-hop/partição/seeder para revisões, interface completa, contribuições assinadas, ficheiros opcionais e revisão independente. Não anunciar prontidão para catástrofes ou execução em todos os sistemas operativos.
