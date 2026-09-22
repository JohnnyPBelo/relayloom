# Formulários e contribuições assinadas — implementação iniciada em 21 de Setembro de 2026

O v3 já está publicado. Este incremento continua o objectivo de sites distribuídos expressivos: visitantes propõem dados com a sua assinatura, e o dono decide se entram numa nova versão. Não é uma funcionalidade entregue ainda. A recuperação sequencial mantém-se; não foram criados/retomados agentes, nem alterados modelos, bridges ou serviços.

## Contrato a implementar e testar

1. Formulário declarativo limitado, ligado a uma tabela do mesmo snapshot: campos tipados, obrigatório/opcional, contribuidores explícitos ou leitores autorizados. O hash do esquema cobre campos, tipos, destino e regras. Sem scripts, HTML executável, SQL ou regras arbitrárias. Compatibilidade das páginas anteriores preservada. Regras por grupo serão ligadas à autoridade de grupos verificada; não simular essa autorização com uma lista enviada pela UI.
2. Proposta imutável assinada pelo visitante: endereço do site, bundle/revisão observada, página/formulário, esquema, UUID, valores e audiência máxima que o visitante consente publicar. A assinatura da proposta não permite editar o site. O transporte da proposta deve ser privado para visitante+dono; a audiência consentida para a eventual publicação é um campo separado, nunca inferido da chave de leitura.
3. Validação por Node/Go/browser: estrutura, assinatura, domínio, autor, esquema, tipos, prazos, vínculo ao snapshot e política. A primeira etapa é um contrato portátil independente; não expor uma API de assinatura a partir de metadados fornecidos pelo cliente antes de resolver o snapshot autenticado.
4. Criação/retoma e caixa de propostas com persistência privada, idempotência, limites de número/bytes/prazo e contrapressão. Aprovar/rejeitar exige o dono e contexto de publicação actual; guardar a decisão antes de publicar, conservando a proposta/origem e evitando duplicação após replay/restart. Mudança de base/esquema exige reconciliação explícita. Bloqueio/retirada e expiração impedem novas acções; não prometem recolha de cópias existentes.
5. UI completa: compor formulário, escolher destinatários/regras, pré-visualizar dados e consentimento, enviar, acompanhar pendente, rever/aceitar/rejeitar e publicar versão com proveniência. PT/en/es, Liquid Glass, teclado/toque, contraste e estados reais. Não mostrar controlos sem implementação.
6. Gates: parser/cross-runtime, assinatura errada/chave de leitura, payload/audiência adulterados, obsoletos/replay, perda de resposta/restart, quotas e concorrência. Três contas reais via UI, proposta → revisão → aprovação → publicação → leitura/seeding com autor desligado, incluindo controlos negativos. Regressão existente e revisão independente continuam obrigatórias.

## Etapa actual

Começar por `packages/content/src/site-form.ts` e `packages/sites/src/contribution-protocol.ts`, com equivalentes Go e testes que usam as bibliotecas criptográficas mantidas existentes. Validar certificados sem lhes atribuir implicitamente aprovação, transporte ou persistência. A publicação v3 não será alterada por esta etapa. Não marcar formulários/contribuições como implementados na aplicação até ligar os motores, armazenamento, transporte e UI e executar os percursos completos.

Limites iniciais propostos: 12 campos, 1000 unidades UTF-16 por texto, 16 KiB por proposta assinada, 64 identidades por regra/audiência, validade máxima de 30 dias dentro do snapshot. Estes limites não diminuem os limites actuais do editor. A aprovação só pode escolher leitores cobertos pela concessão assinada do visitante; tornar uma proposta privada pública exige nova autorização explícita compatível, não uma checkbox administrativa que reescreva o consentimento.


## Contrato criptográfico implementado localmente

Adicionados o esquema/valores de formulário e certificado de contribuição em TS e Go, sem alterar o documento v3 ou expor endpoints/controlo UI ainda. O certificado fixa visitante, site/snapshot/revisão/formulário, esquema, UUID, valores, tempos e concessão de publicação. A verificação histórica é separada da admissão; bloqueio, CAS de base, persistência/replay e aprovação ainda pertencem à futura integração de runtime.

Oito testes Node passaram, incluindo sete de contrato/cripto e um driver com46vectores TS/Go (9aceites/37recusados). O Go criou uma assinatura própria validada nos adaptadores Node e portátil, e recusou adulteração/chave privada alheia/tempo int64 fora do intervalo JSON seguro. Typecheck inicial passou antes do acréscimo dos vectores Go; repetir a verificação do conjunto. Provas locais .cache/site-contribution-node-first.log, .cache/site-contribution-cross-first.log e .cache/site-contribution-vectors.json. Não são testes de browser real, transporte da aplicação, base de dados, owner approval ou UI. Estes continuam obrigatórios.

A integração dos formulários foi temporariamente precedida pela correcção do desempenho do inspector revelada pelo CI da versão publicada. Não apagar estes ficheiros novos nem incluir este contrato ainda não ligado numa alegação de formulários prontos.


## Revisão de fronteiras do contrato (implementador, não revisão independente)

A forma aceita apenas tabelas/colunas tipadas e regras enumeradas de identidades/leitores. O hash cobre o destino, obrigatoriedade, tipos/rótulos e regra; as linhas existentes pertencem ao snapshot e não são incluídas no hash do esquema. A proposta fixa também os IDs do snapshot e da revisão, impedindo usar essa separação para adoptar silenciosamente numa base diferente.

O certificado contém a concessão de publicação, mas o envelope pode continuar privado para visitante+dono. Os testes demonstram essa separação: consentir divulgação pública futura não cria um envelope público, e o leitor sem chave não desencripta. O dono ainda tem de assinar a nova revisão; o protocolo rejeita a proposta como certificado de revisão e não fornece função de aprovação implícita.

`verify` serve autenticidade histórica; `verifyForForm` acrescenta prazo, schema, identidade autorizada e concessão de audiência a um contexto que terá de ser derivado pelo runtime de um snapshot autenticado. Não expor esse contexto como um objecto de autorização enviado pelo cliente. Bloqueio, assinatura do snapshot, estado actual/reconciliação, contrapressão, journal/replay e decisão do dono continuam pendentes da integração. A API pública actual não aceita estes módulos como proposta pronta.

Verificação adicional: o conjunto local passou33testes de contratos relacionados e `go test -race -p=1 ./sites -count=1` no gate actual. O teste real de assinatura/cifra no browser passou Chromium e WebKit, com emissão/verificação Go nos dois sentidos; a matriz integral emcurso verificará tambémFirefox. Nenhum resultado de transporte, persistência de propostas ou interface de formulários é inferido.

## Fronteira da integração seguinte (decisões a aplicar depois do gate)

O pedido da UI deverá conter apenas o snapshot/página/formulário e valores, a concessão escolhida, UUID e sequência de criação. O motor resolve o snapshot e o formulário autenticados antes de assinar; nunca recebe `ContributionFormContext` como autorização externa. A validação do corpo de documento v4 tem de existir em TS e Go no mesmo incremento, preservando v1/v2/v3. Um formulário só aponta a uma tabela embutida da mesma versão, com campos coerentes; recursos opcionais de terceiros não ganham edição por essa referência.

O journal do visitante terá domínio privado distinto e derivado da posse da chave de assinatura, com intenção durável antes de assinar/copiar/enviar. A mensagem vai cifrada apenas para visitante+dono, independentemente da concessão de publicação. Uma tentativa incerta recupera o mesmo certificado/bundle; repetir o UUID com dados, base ou concessão diferentes é recusado. As janelas de retenção e limites de propostas têm de impedir recriar silenciosamente uma tentativa retirada. A caixa de entrada do dono guarda o envelope verificado e conserva a autoria do visitante; um relay opaco não obtém uma entrada de aprovação.

A revisão de proposta deve comparar a versão observada e o esquema com a versão que o dono está a editar. Se mudarem, exigir escolha explícita sobre a nova base. Aceitar prepara uma intenção do dono com a proposta e a linha de destino, reutilizando o mecanismo de publicação recuperável; uma resposta perdida ou duas aprovações concorrentes não podem adicionar a mesma linha duas vezes. Nenhum endpoint deve marcar a proposta como publicada antes de reler a versão realmente guardada. Rejeitar não publica conteúdo e não apaga cópias remotas. O visitante recebe estado verificável, sem confiar apenas numa etiqueta da interface.

A proveniência da linha deve conservar a proposta original assinada. Uma edição posterior pelo dono não se apresenta como assinatura do visitante sobre valores novos. A publicação de uma contribuição deve respeitar a sua concessão assinada; escolher Público na página não reescreve o consentimento do visitante. Tal como os recursos privados, isso impede divulgação involuntária pelo fluxo autorizado, mas não promete impedir cópias manuais por quem já conhece o texto.

A implementação seguinte precisa de testes de processo/armazenamento e UI, não só destes contratos: morte entre intenção e cópia, rollback/ausência/corrupção da área privada, bloqueio durante a acção, recusa de chave de leitura como assinatura, mudanças de base/esquema, saturação com resultados ainda pendentes e seeding depois do dono sair. Estes requisitos continuam por executar; nenhuma linha desta secção é evidência de implementação concluída.

## Pendência confirmada: tolerância de relógio

O controlo `.cache/contribution-clock-control.ts` executou assinaturas e envelope reais com relógios sintéticos apenas no processo de teste. Com o relógio do receptor atrasado60segundos, a verificação do envelope passou (tolerância existente de300000ms em Node/browser/Go), mas `verifyForForm` recusou a proposta por exigir `created <= now`. Resultado em `.cache/contribution-clock-control.json`. As fontes congeladas do gate não foram alteradas.

Depois do gate actual, alinhar a admissão da proposta com a tolerância já existente dos envelopes, nos dois protocolos, e testar exactamente a fronteira de300000ms e o primeiro milissegundo a mais, sem aumentar a validade máxima, tolerar expiração ou alterar o relógio do sistema. Usar um snapshot com prazo suficiente nos controlos para que a condição de relógio seja a causa observada, separada da expiração do snapshot. Actualizar os vectores antigos de proposta futura: os dados assinados têm de continuar estruturalmente válidos e a expiração não deve mascarar a fronteira testada. Repetir contratos, vectores Go, race e browsers afectados; documentar os hashes diferentes na consolidação. Esta proposta ainda não é usada pelo runtime público, mas não deve ser integrada com a incompatibilidade conhecida.


## Relógio alinhado e próximo ponto de integração — 21 de Setembro

A pendência de relógio acima está corrigida nas fontes actuais: tolerância de 300000 ms, igual ao envelope, com expiração e validade máxima inalteradas. Oito testes Node e 48 vectores (11 aceites, 37 recusados) concordam entre Node, portátil e Go; Go sites/race passou. Os percursos de assinatura/cifra em browsers reais passaram em Chromium, Firefox e WebKit, incluídos nos 12 casos dirigidos por motor. Não são percursos de envio ou aprovação de formulários pela aplicação. Provas locais: `.cache/contribution-clock-contracts.log`, `.cache/contribution-clock-control-fixed.json`, `.cache/relay-clock-*-report.json`.

A integração do documento v4 exige actualizar conjuntamente o parser TS/Go e todas as fronteiras que hoje exigem revisão assinada apenas para v3. Recursos v3 devem continuar aceites nas versões posteriores. Um formulário deve resolver a tabela no mesmo documento autenticado, inclusive entre páginas e em composições; IDs globais, esquema e tipos devem coincidir. Duplicar uma página/composição deve remapear referências internas para as novas identidades sem alterar referências externas. Não expor o bloco na paleta até existir o fluxo funcional de envio/revisão. Não rebaixar v4 para v3 ao inserir um recurso. Estes pontos foram identificados por leitura de código, não por testes já executados de v4.

A revisão das capturas reais publicadas (biblioteca e leitor compacto após takeover de seeder) confirmou que a camada Liquid Glass e a autoria separada estão visíveis. É uma revisão do implementador sobre artefactos existentes, não uma revisão independente nem um novo teste de dispositivo. Formulários, vistas de directório/cartões e proveniência assinada de linhas continuam pendentes.


## Fundação v4 implementada e validada localmente

O documento TS/Go aceita um bloco form com esquema fechado e ligação a uma tabela do mesmo snapshot. Resolve destinos depois de validar todas as páginas/composições, recusa tabela inexistente/página errada/tipo errado/campos divergentes e permite recursos v3 em v4. A duplicação de página/composição remapeia referências internas; referências a outras páginas conservam o destino. Inserir um recurso preserva a versão v4. O bloco está oculto na paleta enquanto o fluxo não existe.

Todas as fronteiras de publicação/admissão foram alargadas de v3 para v3 ou posterior. A revisão encontrou um guard adicional em BrowserApplication.prepare: a admissão posterior já recusava o documento sem revisão, mas só depois de assinar. O controlo negativo confirmou uma assinatura e nenhuma publicação; depois da correcção, zero assinaturas, com a publicação válida do catálogo e repetição idempotente a passar. Os primeiros erros do fixture (ownerId/owner.id e copied/ready) foram corrigidos antes da reprodução negativa definitiva e conservados separadamente.

Gates locais: 79 Node, 24 vectores de documento TS/Go (8 aceites/16 recusados), typecheck, Go sites/race e três testes Go app de admissão/compatibilidade com race, build e dois casos por browser (Chromium/Firefox/WebKit). O caso de catálogo usa assinatura/cifra e IndexedDB reais; o outro usa a UI existente de copiar páginas. Provas: docs/evidence/site-contributions/document-v4. Não são testes UI de envio/aprovação de contribuições.

Ainda obrigatórios: resolver o contexto de formulário a partir do snapshot autenticado na API, journal privado e replay, transporte/inbox, bloqueio/prazos/quotas, aprovação/rejeição/reconciliação CAS, proveniência das linhas e UI PT/EN/ES. O CI35661349213 está a testar 0a85d7d, anterior a este incremento; não fazer push que o cancele sem necessidade. A distribuição HTTPS permanece 7fdb76a/0fdbd1b9.

## Integração actual: contexto autenticado e preparação privada

O turno anterior constituiu progresso: commits, execução de gates e fundação v4 verificável. Nesta continuação a fonte de verdade é a worktree d20d4ce e o CI35661349213, ainda em curso para0a85d7d. Nenhum agente foi criado/retomado; manter execução sequencial e a reserva de15GiB.

Primeiro ligar `contribution-command` com uma consulta de formulário por snapshotId/pageId/formId. O motor autentica/desencripta a cópia local, extrai tabela/formulário/revisão/audiência do mesmo snapshot e verifica as regras do visitante; o cliente não fornece contexto de autoridade. Revalidar bloqueio, retirada, prazo e geração de sessão nas fronteiras assíncronas. A resposta de metadados não é uma autorização reutilizável: criar/retomar deverá resolver de novo o contexto pelo motor. Não assinar, pedir à rede nem publicar durante a consulta.

Depois ligar o journal privado de intenção, com UUID/sequência/fingerprint, estados e resultados limitados e persistentes, assinatura preservada após perda de resposta, contrapressão e domínio próprio derivado da posse da chave de assinatura. Transporte, inbox, aprovação e UI continuam a seguir, sem activar uma paleta sem fluxo funcional.


## Consulta autenticada integrada — 22 de Setembro

`contribution-command/form` já está ligado a Node HTTP, Go HTTP e BrowserApplication/worker. Extrai o contexto do snapshot cifrado local, sem aceitar esquema/ACL do cliente. Consulta não assina, envia ou pede à rede; devolve metadados sem as linhas da tabela. Node/Go confirmam bloqueio/retirada em estado local; browser revalida a geração, prazo e política, lendo bloqueio+mutations na mesma transacção privada. A resposta descritiva não será aceite como autorização de submissão.

Dez testes Node, Go sites/race, três testes Go app/race, builds, dois percursos de processos TCP e contextos/worker nos três browsers passaram. Processos: prova de bytes privados presentes sem chave, falta de autorização, bloqueio real, retirada, versão histórica e seeder reiniciado com autor desligado/cópia antes ausente. Browser: intenção mutável, bloqueio/retirada/prazo/lock durante resposta retida, unlock e ausência sem pedido de rede. Provas: docs/evidence/site-contributions/authenticated-context.

A primeira execução parou por reserva de disco (<15GiB). Oito cópias ignored/linux-unpacked antigas foram removidas após lsof, preservando os AppImages e todos os hashes de WIP/source. Depois a fixture usava settings para bloquear; corrigida para action/block com estado assertado. Esses resultados estão preservados; os dois processos finais passaram. Último espaço: cerca de16GiB, margem pequena; revalidar antes de novo gate.

Segue journal/submissão: ler CONTRIBUTION-JOURNAL-NOTES.md. Resolver a diferença entre envio privado e consentimento de publicação antes de integrar; preservar a recusa de promoção privada→pública. Todo o envio/inbox/aprovação/proveniência/UI continua pendente.

## Preparação durável implementada parcialmente — 22 de Setembro

A candidata acrescenta o journal puro e os catálogos Node/browser. A primeira transacção guarda pedido/snapshot e metadados sem assinatura do visitante; a segunda assina, preservando UUID/valores/concessão/tempos. O resultado assinado só sai depois do commit. Há uma preparação activa,128resultados/1MiB, expiração/cancelamento e recusa de replay com sequência antiga. O namespace privado contribution tem codec Node/Go e testes reais entre SQLite/processos. **O catálogo/máquina de estados Go ainda não está portado. Os catálogos não estão ligados a um comando de submissão.**

`verifyForSubmission` e `verifyPublicationScope` separam envio privado e divulgação posterior;57vectores(14aceites/43recusados) TS/Go cobrem a distinção, além de controlos em browsers reais. `verifyForForm` mantém a composição compatível das duas. Verificar uma concessão não aprova, publica, renova prazo ou faz CAS.

Passaram inicialmente33testes Node relacionados,28testes de storage/catálogo/interop,10testes finais de catálogo e4casos dirigidos por browser, mais worker/contrato. Não somar repetições como testes únicos. Um erro de fixture reutilizava uma sessão de storage correctamente fechada por falha de integridade; outro comparava ordem textual de JSON em vez de estrutura. Originais preservados.

A primeira suite Node completa terminou **493PASS/1FAIL de494**, com tradução `Formulário` em falta. A revisão também encontrou aceitação de lacunas no parser do journal. Ambas corrigidas: EN/ES e sequência retida exactamente contígua. Catorze testes dirigidos e dois casos Chromium passaram; o controlo sintético mudou de aceitação para recusa da lacuna, conservando o positivo.

**Gate actual76653**, `.cache/contribution-journal-consolidated/report.json`: repete os102ficheiros da suite Node (comparados exactamente com o glob original), depois build e2casosFirefox/2WebKit afectados. Fonte congelada no report; não alterar apps/packages/native/tests/scripts até terminar. Não confundir a suite anterior com um passe global da fonte corrigida. O produto e envio/inbox/aprovação/UI continuam por concluir.


## Gate corrigido concluído

Handle76653 terminou/recolhido0: **494 testes Node PASS**, build PASS, dois casos Firefox e dois WebKit PASS. Os dois Chromium afectados já tinham passado; não houve falhas/skips no gate corrigido. Todos os693hashes de fonte antes/depois coincidem. A tradução e a lacuna do parser foram corrigidas antes desta repetição integral. Provas curadas em docs/evidence/site-contributions/preparation; o relatório conserva o FAIL anterior e os controlos, sem reescrever proveniência.

Commits: b8a8a9e separa submissão/concessão;6749483 guarda o journal Node/browser, domínio privado Node/Go, controlos e tradução. ac54af4 tinha ligado a consulta form aos três motores. Nenhum deles implementa ainda submit/outbox/inbox/approval/UI nem o catálogo Go. Continuar essa integração; não repetir os gates terminados sem novas alterações que o justifiquem.
