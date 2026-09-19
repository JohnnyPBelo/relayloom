# Recursos opcionais — incremento isolado, ainda não integrado

Base59c9bd1, branch codex/site-optional-resources. A candidata das tabelas e o seu gate público correm no principal; não alterar essa candidata a partir desta árvore. Sem agentes novos, sem alterações a modelos/bridges/serviços. Não executar testes ou builds pesados em paralelo com o gate público. Tudo continua dentro de RelayLoom.

Objectivo: um site pode anunciar tabelas e ficheiros por referências cobertas pela assinatura da página; o leitor obtém apenas o que escolhe e pode servir a cópia verificada a outro leitor. Ausência, falta de acesso e corrupção são estados distintos. Abrir um manifesto não faz automaticamente download de recursos grandes. Disponibilidade exige pares que conservem os bytes. Não acrescentar scripts, HTML activo, SQL ou módulos remotos.

Primeiro passo nesta árvore: contrato portátil de payload/referência, limites e comparação com metadados de um envelope já autenticado. A referência prende ID de bundle, autor, tipo, nome, MIME, tamanho e hash canónico. A comparação é posterior à verificação de assinatura/chunks e desencriptação; o parser nunca concede autoridade. O hash refere-se ao payload canónico completo, não ao ficheiro binário isolado. Audiência privada não pode tornar-se pública só porque se acrescenta uma referência. A política aceita uma audiência igual ou mais estreita do site do que a do recurso.

Limites iniciais: ficheiro até2MiB descodificados, tabela mantém64KiB/256linhas/12colunas, nome até150unidadesUTF-16, tiposMIME enumerados. Os ficheiros são downloads; HTML/SVG/JavaScript não são renderizados. Mantém-se o orçamento do bundle4MiB e o documento128KiB. MIME/nome não são um caminho nem uma URL. Nenhum parser escreve no sistema de ficheiros ou faz pedidos de rede.

Passos seguintes obrigatórios antes de entrega: portGo e vectores negativos/positivos; tipo site-resource na validação e nos runtimes, criação idempotente/armazenamento/quota; documento v3 e referências limitadas, compatibilidade explícita; API que lê a referência de um snapshot verificado (sem aceitar metadados arbitrários do chamador), pede oID exacto e valida autor/hash/audiência; UI de anexar/descarregar/abrir tabela e estado de disponibilidade; transferência opcional com fonteoffline, corrupção/autorização/partição-heal/restart e testesUI emNode/Go/3browsers. Contribuições/formulários assinados permanecem previstos depois desta camada, com assinatura do visitante e aprovação separada pelo dono.

Estado inicial: contratos TS/Go, cinco casos de domínio e um oráculo TS→processoGo preparados. O oráculo compara recursos/referências e audiências, incluindo nomesUnicode/surrogates, limites exactos, base64não-canónico e tipos executáveis. Não ligado à aplicação, não testado, não commitado nem publicado. Não confundir esta fundação com funcionalidade disponível.

## Dependência de transporte a resolver

O inventário actual pode provocar obtenção automática dos IDs que um par anuncia. Não basta acrescentar um botão «descarregar» na UI: isso não tornaria o recurso opcional. A criação de recursos deve guardar localmente sem transmitir todos os bytes e anunciar uma disponibilidade limitada; inventário/sincronização não devem pedir recursos opcionais sem interesse explícito ou política de cache/relay consentida. Um novo leitor que só abre o site tem de demonstrar ausência dos bytes antes da escolha. Peers que encaminham um pedido de outro leitor podem continuar a retransmitir/cachear os pacotes segundo a política consentida. Não confundir esse tráfego de trânsito com um download iniciado pela página.

Os anúncios são pistas de disponibilidade, nunca prova de autoria ou acesso. A referência deve vir do snapshot assinado e a resposta passar verificação integral. Um par já pode omitir um ID; não confiar em hints para autorizar conteúdo, mudar audiência, promover uma versão ou concluir entrega. Qualquer evolução de inventário requer limites, compatibilidade clara e portNode/Go/browser com controlos positivos/negativos. Não adaptar apenas um dos motores nem fingir opcionalidade com conteúdos já descarregados pela sincronização antiga.

Expiração também deve ser explícita: referenciar um bundle que expira não lhe estende o prazo. O estúdio deve informar/validar a disponibilidade e oferecer republicação pelo dono quando necessário; não substituir silenciosamente umID expirado por outro payload, mesmo que tenha o mesmo nome. Retenção/pinning nunca promete conservação por terceiros.


## Primeiro gate executado

Em18/09, o typecheck passou e `node --import /home/absint0o/projects/relayloom/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 tests/site-resource.test.ts tests/site-resource-interop.test.ts` passou6casos em15,02s. O oráculo executou Go real e concordou nos42recursos (13aceites/29recusados), referências/hashes e13vectores de audiência. Inclui fronteira2MiB, Unicode/surrogates e falhas de integridade/autor/base64. Logs `.cache/site-resource-typecheck.log`, `.cache/site-resource-first.log` e `.cache/site-resource-vectors.json`. Sessão79565 terminada/recolhida. Isto verifica a fundação, não a aplicação, rede ouUI.

A leitura da sincronização identificou uma opção mais simples a avaliar: excluir `site-resource` do inventário automático e usar a referência assinada na página como anúncio. O pedido explícito porID já pode percorrer a rede e ser servido por um cache consentido; pode não ser necessário inventário novo. Confirmar em todos os runtimes, impedindo também broadcast automático na criação. Não implementar botões de opcionalidade sem provar ausência de pedidos/bytes antes do clique e presença depois, com origem desligada e seeder reiniciado.


## Integração de transporte e registo local — 18 de Setembro

O controlo real inicial falhou como esperado: um processoNode anunciava osrecursos no inventário. Node,Go eBrowser passam a excluí-los da sincronização automática, mantendo pedidos explícitos e seeding consentido. Recursos legíveis são validados antes de admitir/encaminhar; cópias privadas sem chave continuam opacas. Resumos periódicos contêm metadados, sem bytes/tabelas. Publicação genérica e announce não podem difundir recursos; a criação dedicada ainda não está ligada.

`tests/native/site-resource-routing.test.ts` passou2percursos com processos reais, assinatura inicial numa fixture separada, origem terminada/porta recusada, seeder reiniciado, witness normal automático, recurso ausente até pedido, pausa negativa e bytes/cifra/autoria exactos. A primeira repetição falhou apenas porque a árvore não tinha dist/web; depois do build os mesmos controlos passaram. Logs antes/after/built preservados.

Admissão/contrato/interop passou8casos: inválidos públicos e privados legíveis recusados, opaco sem leitura, bloqueio e corrupção após reinício. O motorBrowser passou as rotas RTC/WS paraNode eGo; a primeira matriz falhou no helper que só encaminhava request e não block. O helper agora chama o setBlocked real, sem contornar o controlo. A matriz actual (sessão18286) corre11casos porengine, incluindo transportes existentes/sitesv1v2. Chromium11 eFirefox11PASS; WebKit emcurso. Recolher handle e `.cache/site-resource-matrix-fixed/*.json` antes de repetir.

`packages/sites/src/resource-operations.ts` acrescenta a máquina de estados local para criação: sequência monotónica,128resultados retidos,umacópia pendente, UUID/fingerprint, conclusão comhash exacto e expiração sem reassinatura automática. Seis testes desse registo passaram; conjunto recursos/admissão/registo14PASS. Ainda não tem catálogo persistente, portGo nem API.

O armazenamento privado existente ganhou wrappers separados runResource/RunResourcePrivate e prefixo resource, com derivação/AAD própria, sem alterar o domínio/keyformat site. Node/Go trocaram2MiB na mesmaSQLite, recusaram transplante entrestores e a chave deleitura não desencripta assinaturas preparadas. Nove testes de armazenamento passaram, mantendo os controlos antigos. Falta testar troca de namespace e ligar catálogo/commit/cópia/recuperação com morte real deprocessos.

Todoeste código posterior ad3b7cad é WIP apenas nesta árvore. Nada foi integrado/publicado. A versão principal1e83db2/web59c9bd1 mantém-se separada. Próximo: terminar matriz,curar provas,implementar portGo do registo e catálogo persistente/criação idempotente,documentov3,API de referência verificada e UI. Não reduzir o contrato a uma biblioteca ou a um teste de transporte.


## Gate de transporte concluído

Sessão18286 terminada e recolhida:11PASS emChromium,11emFirefox,11emWebKit. Inclui novosrecursos e regressão dos caminhosWS/RTC/TCP/sériePTY e sitesv1/v2. Sessão88391 terminada:6casos expandidos de interoperabilidade de armazenamentoPASS, incluindo transplante entre namespaces; Go./sites comracePASS em13,959s. Nenhuma delas é UIdecriação ou catálogo de operações persistente. Provas curadas emdocs/evidence/site-optional-resources.

Próximo: implementar o catálogo decriação sobre o espaço resource protegido, com operação/fingerprint/counter antes decopiar para oContentStore; exact-copy/ready só depois deverificar osbytes copiados. PortGo da máquina deestados ainda falta. Perfisweb já derivam achave dosvalores privados da chavedeassinatura; usartransactValues, geração desessão e um único stagependente. Não misturar osíndices resource/site. A API deve devolver resultadosretidos para pedidosantigos, nunca gerar novoid silenciosamente após perda deresposta ou expiração. Depois documento3/referências/API ligadaao snapshotverificado eUI; testar quotas, morte deprocessos, reinício,privacidade, autoroffline e pedidos explícitos pelaUI.


## Catálogos persistentes concluídos e próxima integração — 18 de Setembro

WIP preservado: port Go do registo com 35 vectores Node→Go (14 aceites/21 recusados), 7 casos PASS; catálogos Node/Go/browser sobre transacções privadas de assinatura. Node: 9 PASS, incluindo morte real antes/depois de commit, cópia e ready. Interop: 5 PASS, SQLite comum, retomada Node↔Go e morte Go nos quatro pontos. Browser: 2 Chromium PASS, armazenamento cifrado/reopen e lock durante assinatura com rollback. Typechecks PASS. Logs .cache/resource-operations-port-first.log, resource-catalog-node-first.log, resource-catalog-mixed-first.log, resource-catalog-browser-first.log. Ainda falta matriz Firefox/WebKit e integração de aplicação/UI. Não somar os vectores como percursos UI.

O resolver de cartões do catálogo browser consome um snapshot carregado antes da transacção. Nunca chamar profile.getValue/data dentro desse callback: reentraria no lock exclusivo. O runtime deve guardar no ContentStore, reler e confirmar os bytes antes de ready; nunca confirmar apenas com o stage. Recuperação deve conservar ID/fingerprint mesmo quando a resposta se perde ou o leitor entretanto é bloqueado. Bloqueio impede nova cópia/partilha pendente.

Próximo incremento: comandos resource-command state/operation/create/resume nos três motores; criação local sem broadcast/inventário; retoma limitada após falha/quota/reinício; validação exacta da entrada e sessão/identidade. Depois documento v3 e API de referência extraída do snapshot verificado, UI e gates completos. O contrato integral permanece activo.

CI35321298679 (1e83db2) terminou: Node nos três hosts, Go, UI nativa, Reticulum, três pacotes desktop e browser autónomo PASS; iOS UI no simulador FAIL. Recolher diagnóstico pelo manifesto, não repetir o gate sem investigar. Não há CI activo a cancelar. Disco verificado: 21GiB livres. Sem novos agentes ou alterações a bridge/modelo/serviços.

## Runtime de criação e desenho do próximo incremento

As APIs resource-command state/operation/create/resume estão ligadas a Node, Go e BrowserApplication. Cópia verificada, retoma limitada, bloqueio de leitores, sessão, expiração e invariantes sem broadcast foram implementados. Node/Go passaram os dois percursos reais, retomando a mesma SQLite/cifra de um motor no outro, quota e bloqueio, pedido explícito, autor desligado e seeder reiniciado. Chromium passou sete casos iniciais; foi acrescentado depois o caso de expiração. Build web/Go e typecheck passaram. O gate consolidado sequencial `.cache/resource-runtime-gate.mjs` está em execução (handle80445); não alterar as fontes durante esse gate nem chamar-lhe PASS antes da conclusão. Comandos, saídas e hashes estão em `.cache/resource-runtime-gate`.

Próxima decisão de desenho: documento v3 com bloco `resource` e referência explícita, limitado pelo orçamento geral128KiB/128blocos e por um limite próprio de referências. Tabelas v2 embutidas continuam válidas em v3. A API de consulta recebe snapshotID+blockID (não uma referência solta), verifica envelope, revisão, autor, payload e audiência e extrai a referência. Um modo apenaslocal devolve ausência sem pedido; obter explicitamente pode pedir o ID exacto. Não seguir automaticamente a cabeça actual durante uma consulta iniciada num snapshot histórico. Distinguir falta de acesso, ausência, expiração e corrupção. Publicação de sites deve confirmar que as referências do dono correspondem a recursos verificados e não estreitam os leitores em relação ao site; recuperação de uma versão antiga não amplia a audiência.

UI seguinte: biblioteca de recursos com quota/retoma, ficheiro ou tabela, escolher recurso pronto para inserir no rascunho, disponibilidade e pedido explícito no leitor. Guardar a intenção do controlo antes da chamada e recuperar por UUID/sequência após resposta perdida. Ao mudar de proprietário/lock, invalidar resultados assíncronos. Recursos antigos só são substituídos pelo dono mediante nova criação/revisão. TraduçõesPT/en/es, teclado/toque, estado de erro local e design Liquid Glass consistente. Testes UI com três contas, recurso ausente antes do clique e cópia exacta depois, autoroffline e seeder reiniciado. Não satisfazer o requisito só com uma biblioteca ou API.

Leitura/revisão para v3 durante o gate (ainda sem código): uma referência pode conservar a autoria de um recurso de terceiro; nunca inferir que o dono da página passou a ser o dono do ficheiro. O runtime compara autor do envelope com authorId da referência, e verifica que a audiência efectiva do recurso cobre a do site. A publicação pública não pode incluir uma referência privada só porque o autor consegue desencriptá-la. Evitar validar disponibilidade antes de recuperar uma operação de publicação já retida: perda/expiração posterior de um recurso não deve transformar a repetição do mesmo UUID numa nova assinatura. Para criações novas, validar referências antes da assinatura; na leitura, verificar novamente o conteúdo efectivo. Sem bytes locais, não afirmar expiração a partir de uma referência que não contém prazo: devolver por-obter até existir um envelope autenticado.

Casos negativos adicionais obrigatórios para v3: blockID de outra página/snapshot, ID inexistente, referência adulterada, autor divergente, MIME/tamanho/hash divergentes, recurso privado com site público, chave de leitura que tenta publicar, snapshot histórico substituído durante um pedido, cancelamento/navegação/lock durante obtenção, recurso expirado sem reassinatura automática. Catálogos privados e ContentStore não devem reentrar no lock exclusivo de valores do browser; resolver de contactos usa snapshot prévio. O download tem de conservar filename seguro e objectURL com libertação; ZIP/PDF/etc não ganham execução no site. Actualizar matriz iOS porque a exportação nativa de ficheiros continua explicitamente indisponível nessa shell.


## Gate da criação concluído

Handle80445 concluído e recolhido, exit0. Passaram450testesNode completos, Go ./sites e ./app comrace (13,545s e495,542s),19casos deinteroperabilidade e19porbrowser (Chromium/Firefox/WebKit,57). Os hashes das fontes antes/depois são idênticos. A duração Go é consistente com o gate anterior515,3s; não foi timeout nem se interrompeu o processo. Inclui quotas/bloqueio/expiração, store reread failure, assinatura exacta, mortos antes/depois decommit/cópia/ready, origemoffline,seeder reiniciado e percursosRTC/WS. Osgates não equivalem a UI dosrecursos.

Catálogo persistente commitado localmente em78cc38c (13ficheiros). A ligação deAPI continua WIP nesta árvore e aguarda a regressãoUIemexecução (handle67142, `.cache/resource-runtime-ui.mjs`, saída `.cache/resource-runtime-ui`). Já passaram os dois percursosUI nativosNode/Go; seguem os cinco percursos depublicação porbrowser. O UIrunner conserva os relatóriosJSON dos19casos anteriores antes de reusar os nomes de saída. Não republicar web ainda.


## API e regressão UI concluídas

96e35c1 guarda o runtime/API e 12 ficheiros de integração/teste. Handle 67142 concluído e recolhido, exit 0: um percurso UI Node, um Go e sete por browser, 23 no total; 20 relatórios Axe sem violações. Foram comparados 628 ficheiros de fonte com o commit. Os catálogos estão em 78cc38c. Provas em docs/evidence/site-optional-resources/creation. As capturas do editor e leitor Chromium foram inspeccionadas pelo implementador; a revisão independente permanece pendente. Nenhum processo local deste incremento continua em curso. A publicação HTML não foi alterada.

Próximo incremento: concretizar o documento v3, a referência obtida de um snapshot verificado e os controlos UI. Seguir os casos de autoria e audiência já descritos. Não reduzir a entrega a esta API. Continuar o contrato completo, mantendo a recuperação sequencial sem novos agentes.


## Continuação v3 — WIP, ainda não commitada/publicada

O turno anterior foi progresso: três commits enviados (78cc38c/96e35c1/b435608), gates e provas curadas. O CI35331029446 de b435608 continua activo na última consulta; não cancelar com novo push documental. O objectivo completo permanece activo.

Implementação nova nesta árvore: documento v3 com bloco resource e referência, limite de32recursos distintos/128KiB, duplicação preserva o autor original, tabelas v2 continuam válidas. A publicação por catálogo chama verificação de recursos só para pedidos novos, depois da recuperação de resultados retidos: bytes/hash/autor/MIME/audiência verificados, site público com recurso privado recusado. Publicação genérica não aceita v3; admissão exige snapshot assinado.

Resource-command ganhou inspect/obtain com **snapshotId (ID do bundle/object.id), pageId e blockId**. pageId foi acrescentado para rejeitar combinações de bloco/página diferentes; não se aceita referência arbitrária do cliente. Inspect não pede rede nem devolve ficheiros/tabelas. Obtain só pede oID derivado do snapshot autenticado. Disponível, ausente, pedido, sem acesso, bloqueado, expirado e inválido são distintos. A leitura histórica de storage autentica bytes sem popular o cache de manifests vivos; verifica-se a expiração antes de devolver dados.

Gates iniciais:73testes de documento/modelo/snapshot passaram, incluindo29vectores Node→Go(9aceites/20recusados). Uma falha inicial era a fixture usar copy.site em vez de copy.value.site; original e correcção preservados nos logs. Core/histórico/documento15PASS e Go/race TestHistoricalReadDoesNotPrimeLiveCache PASS. Native references: inicialmente2PASS/2FAIL; foi encontrado e corrigido erro real do helperGo que aceitava []any do JSON mas recusava []string de metadados autenticados. Ambos passam agora pelos mesmos limites/ordenação/IDs. Repetição4PASS em15,1s, sem aumentar prazos nem retirar controlos. Chromium5PASS em46,5s: referência do snapshot, autoria de terceiros, privacidade, IndexedDB adulterado/expiração, alteração de bloqueio durante leitura e RTC/WS viaNode/Go com autoroffline/seederreiniciado.

Logs: .cache/site-resource-document-{first,fixed}.log; .cache/site-resource-document-vectors.json; .cache/resource-historical-tests.log; .cache/resource-historical-go-race.log; .cache/resource-reference-api-{first,fixed}.log; .cache/resource-reference-browser-first.log. O novo teste de títuloUnicode ainda precisa de typecheck/execução. MatrizFirefox/WebKit e regressão completa desta fonte ainda faltam.

A UI de recursos ainda não está ligada. A paleta não oferece um controlo incompleto; a biblioteca activará a inserção quando tiver callbacks reais. Próximo: intenção de criação durável para aUI (remember/intent/commit-intent/forget com handle e fingerprint), guardada no espaço resource cifrado antes do pedido de assinatura; commit-intent deve revalidar a intenção dentro da transacção de prepare para impedir uma criação tardia depois de a descartar. Ler só o resumo da intenção naUI; conservar o payload privado para retoma após reload. Copiar/ready já estão implementados e testados. Depois biblioteca/renderer/obter/tabelas/download, idiomas, teclado/toque, capturas e testes UI reais.


## Continuação mais recente — v3 e leitura por referência (WIP)

HEAD/origin da branch de recursos: **56e105e07eec76e5783cf9ff5b24d9633583d161**. A base principal continua1e83db2 e o HTML continua59c9bd1/f6758222. Depois de b435608 foram enviados apenas dois marcos isolados:72e03a7 (pacotes Go sequenciais, sem remover testes/race nem alterar prazos/KDF) e56e105e (um único instante na criação Node). A restante implementação v3 continua não commitada nesta worktree. Preservar todas as alterações.

CI35331029446/b435608 falhou em Go app ao atingir10min acumulados, quando começava um teste WebPeer (0s) dentro de scrypt/setup. Não foi demonstrado deadlock. CI35335837063/72e03a7 passou Node Linux/macOS mas falhou Node Windows; Go e os jobs dependentes foram skipped. Portanto a hipótese de pacotes sequenciais ainda não foi medida remotamente. **CI actual35338021371, fonte56e105e, queued na última consulta.** Não cancelar com novo push documental.

A falha Windows era defeito de produção, não da fixture: Node createBundle lia Date.now duas vezes. Uma mudança do relógio produzia expires-created diferente do TTL pedido. A reprodução determinística avançou17ms por leitura:3600017 em vez de3600000ms. A correcção usa created uma vez; validação estrita não foi relaxada. Go/browser já usavam um instante.33testes dirigidos PASS. Provas commitadas emdocs/evidence/bundle-created-time. O hunk do relógio foi staged isoladamente; as novas leituras históricas no mesmoficheiro core continuam WIP, preservadas.

Implementação v3 WIP:
- SiteDocument.version3, bloco resource com referência,32IDs de recursos distintos e128KiB; referências repetidas ao mesmoID têm de concordar. Tabelas v2 são válidas emv3; inserir tabela não rebaixa a versão. Duplica páginas conservando a autoria do recurso. Cabeçalho de nome longo Unicode é limitado a120unidades sem partir pares; nome do ficheiro mantém-se até150.
- Catálogos de publicação têm callback para validar recursos novos, depois do lookup de resultados retidos. Verifica bytes/hash/autor/MIME/audiência; público não pode apontar para privado. O replay de uma publicação já retida não volta a exigir bytes do recurso. A publicação genérica recusa v3 e a admissão exige snapshot assinado.
- `resource-command inspect|obtain` recebe exactamente **action,snapshotId,pageId,blockId**. snapshotId é object.id/ID do bundle, não revisionId. Extrai a referência do snapshot autenticado, vincula página/bloco, recusa metadados arbitrários do cliente. Inspect não pede rede/devolve payload; obtain pede oID exacto se faltar e só devolve dados após verificação.
- Estados:available,missing,requested,blocked,unreadable,expired,invalid. Leitura histórica de storage autentica sem popular cache vivo; expiração impede devolver dados. Obter actualiza acesso local. Browser revalida bloqueio após verificação assíncrona.
- Erro real encontrado nos testes privados: helper Go aceitava []any do JSON mas recusava []string gerado pelo runtime. Corrigido para submeter ambos aos mesmos limites/ordenação/IDs. O primeiro gate2PASS/2FAIL foi conservado; repetição4PASS sem relaxar testes/prazos.

Gates WIP já concluídos/recolhidos:
-73casos documento/modelo/snapshot PASS após corrigir uma fixture que usava copy.site em vez de copy.value.site.29vectores Node→Go,9aceites/20recusados.
-15core/histórico/documento PASS e Go/race TestHistoricalReadDoesNotPrimeLiveCache PASS; controlo com hintdeexpiração adulterado prova que leitura histórica não activa manifesto expirado.
-4percursos API Node/Go PASS: privado/público, metadados adulterados, página/bloco, pedido explícito, bytes exactos, corrupção real do ficheiro, replay com recurso ausente e expiração.
-5porbrowser(15) PASS emChromium/Firefox/WebKit. Incluem autoria de terceiros, audiências, IndexedDB adulterado, expiração, bloqueio durante leitura e referências v3 através deRTC/WS paraNode/Go com autor desligado e seeder reiniciado. A fixture de API é motor real com rede substituída; os percursos de rede separados usam transportes reais. Não são UIde recursos.
-4casos de documento adicionais/repetidos PASS, incluindo o títuloUnicode. Não somar gates sobrepostos como testes únicos.

Logs: .cache/site-resource-document-{first,fixed}.log, .cache/site-resource-document-vectors.json, .cache/resource-historical-tests.log, .cache/resource-historical-go-race.log, .cache/resource-reference-api-{first,fixed}.log, .cache/resource-reference-browser-first.log, .cache/resource-reference-{firefox,webkit}.log, .cache/resource-heading-test.log. Build/typecheck corrente lançados em .cache/site-resource-v3-current-{typecheck,build}.log; confirmar handle antes de repetir. Os outros handles foram recolhidos, incluindo39451 e77170.

Próximo trabalho: **ligar biblioteca e leitor à UI**, com ficheiro/tabela, criação/retoma, inserção, obtenção/preview/download, autoria clara, idiomas e acessibilidade. A paleta ainda filtra resource para não oferecer um controlo incompleto. Reavaliar a necessidade de um journal unsigned adicional: a API actual já guarda intenção+assinatura antes de copiar e a biblioteca pode recuperar a lista autoritativa de operações. Nunca voltar a assinar automaticamente quando uma resposta é desconhecida; retomar por UUID/sequência ou mostrar o resultado já guardado. Uma eventual estratégia remember/commit-intent tem de revalidar atomicamente a intenção depois de descartes concorrentes; não acrescentar mais roundtrips sem necessidade demonstrada.

Antes de entregar a UI, testar também a semântica de retirada: os APIs genéricos suportam tombstones de conteúdo, mas a nova leitura directa de recurso ainda não consulta a projecção deleted. Não afirmar comportamento correcto de retirada sem teste. A biblioteca pode reutilizar a paginação de history (metadados validados) em vez de inventar um inventário de rede; precisa de conservar autores de terceiros e não se limitar silenciosamente aos128resultados do journal.

Continuam pendentes a regressão integral desta fonte, UI e publicação. Nemv3 nem recursos opcionais estão no HTML. Manter ocontrato completo, recuperação sequencial semagentes novos, Astra/Copilot Ultra e15GiB livres (última leitura20GiB). Não alterar bridges, modelos, autenticação, permissões ou serviços.

Build/typecheck v3 concluídos: handle59100 recolhido, exit0; Vite2,98s. Nenhum processo local de teste/build deste turno ficou em execução. CI35338021371 continua pendente na última consulta. A implementação v3/leituras históricas/referências permanece WIP; apenas a correcção isolada do relógio e o controlo sequencial de pacotes foram enviados.


## Continuação actual — biblioteca e leitor ligados à UI (WIP)

O turno anterior foi progresso real: v3/API de referências, correcções, testes e commits isolados de CI. Este turno acrescentou UI funcional, ainda não commitada nem publicada. Preservar todo o WIP. HEAD/origin continua56e105e; principal1e83db2, HTML59c9bd1/f6758222. CI35338021371 está in_progress: Node Linux/Windows/macOS PASS, Go em execução na última consulta. Não inferir resultado Go nem cancelar o CI com push documental.

Código novo:
- apps/web/src/site/resources.ts: biblioteca por paginação do history local validado (não inventário da rede), conserva autores de terceiros e não se limita aos128resultados do journal. ResourceCreator recupera resposta perdida consultando a operação; retry explícito conserva UUID/sequência/payload. Fecho/troca de sessão invalida resultados. Não há nova assinatura automática ao reabrir a biblioteca.
- resource-library.tsx/resources.css: diálogo real com recursos guardados/pesquisa, criação de ficheiros até2MiB e tabelas pelo editor existente (CSV/JSON), audiência do site e prazo, criação/retoma, preview, inserção no rascunho. Dados e assinaturas continuam no motor protegido. A paleta Resource e o botão Recursos estão ligados no SiteStudio/SiteEditor. Inserção valida limites/version3 e conserva o autor do recurso.
- resource-view.tsx + renderer: cartão de recurso, consulta local sem download, obtenção explícita, espera/poll limitado, tabela pesquisável e download/preview de MIME suportado. URLsblob são libertados. Geração/abort impede resultados de outra página. Resposta tem de corresponder à referência apresentada. Nome do autor é mostrado quando conhecido; ID completo fica no title. Sem scripts remotos/HTML executável.
- Publicação UI faz preflight de metadados/audiência/retirada antes de guardar a intenção de publicação. Backend continua a verificar antes da assinatura. No browser o callback lê bloqueio/retiradas da mesma transacção de valores, evitando getValue reentrante.
- Retiradas: Node/Go materializam a projecção antes da consulta/publicação; browser usa alterações autenticadas. inspect/obtain devolvem withdrawn sem conteúdo após retirada assinada. Bibliotecas não permitem inserir recursos conhecidos como retirados. Callback de publicação também foi ligado; falta acrescentar controlo directo de publicação após retirada ao teste.
- Dicionário PT/en/es em apps/web/src/i18n/site-resources.ts. Ainda faltam percursos UI novos emEN/ES e dark/reduced-motion completos.

Gates deste turno:
-8testes controller+i18n PASS. Usam LoomNode/storage reais para resposta perdida antes/depois decommit, mesmoUUID, sessão fechada e137recursos assinados de outro autor no histórico (duas páginas), com journaldecriação vazio.
-4API Node/Go com retirada/tamper/privacidade/expiração PASS em .cache/resource-ui-matrix-native-references.log. BinárioGo recompilado.
-Chromium:2API de referências/IndexedDB PASS; ficheiroUI com3contas PASS; tabelaUI passou numa repetição dirigida. Ambos os percursosUI são reais no worker compilado, sem injecção deAPI daapp. Ficheiroausente antes doclique, bytesexactos14,5KiB, autora fechada, seeder reiniciado, terceiro leitor, controlo negativo de relaypausado. TabelaCSV/numérica privada, tamanho>2MiB recusado, publicação pública indevida recusada semcongelar rascunho, publicação privada e pesquisa no leitor.
-Firefox4PASS em49,4s eWebKit4PASS em44,9s:2API+2UI porengine. Logs .cache/resource-ui-firefox.log/.cache/resource-ui-webkit.log. Handle1228 concluído/recolhido. Capturas/Axe/resultados em .cache/resource-ui/{chromium,firefox,webkit}. Os relatórios correspondem à fonte WIP actual, não ao HTML público.
-Typecheck/build passaram. gitdiff--check só de fontes passou.21GiB livres. Nenhum processo local de teste/build deste turno ficou emcurso.

Falhas preservadas e corrigidas na fixture: selector Desbloquear em vez de Entrar na minha rede; nome do diálogo de importação; CSV enviado quando formatoJSON estava seleccionado; lookup de status ambíguo (criação e carregamento); procurar o próprio site nos cartões sociais em vez do histórico. Não foram aumentados prazos/assertivas. Logs/traces primeiros em .cache/resource-ui-first-artifacts, resource-ui-table-artifacts, resource-ui-table-fixed-artifacts e resource-ui-table-format-artifacts. Foi dado nome acessível ao estado da criação. Duas traduções em falta foram acrescentadas. Não chamar estas falhas dafixture defeitos de transporte.

Revisão visual feita pelo implementador: biblioteca desktop e cartão de leitura móvel/desktop vistos. Screenshotde modal usaagora viewport, pois fullPage dava composições enganadoras comfundo fora do viewport. Nome doautor passou dehash visível para nome comID no title. Isto não é revisão independente nem leitor de ecrã físico.

Próximo:
1. Completar UI EN/ES, dark/mobile/reduced-motion e teste de falha de rede/resultado incerto pelaUI; controllerjátem testes reais. Rever os estados expired/copy-pending na biblioteca: a mensagem de feedback ainda trata todo resultado não-ready como retomável, devendo distinguir expired.
2. Testar UI partilhada contra Node e Go, incluindo criar/inserir/obter tabelas/ficheiros. A UI nova só foi executada como browser autónomo até agora.
3. Acrescentar controlo de publicação directa após retirada e repetir gates afectados; testar cursor/alteração de contexto, corrupção, privado/público e limites sem dispensar controlos. Biblioteca deve continuar a mostrar histórico real para além dos128resultados.
4. Regressão integral: Node, Go/race, interoperabilidade,3browsers, UI Node/Go, builds/pacotes e gates de plataforma adequados. AcompanharCI56e105e; iOSfototeca e dispositivos/rádios/assinaturas continuam abertos.
5. Curar provas/README/STATUS/traceability e integrar/push/publicar só após gates. O contrato completo mantém-se activo: contribuições/formulários, gruposwebdinâmicos, recuperação/rotação/keystore, plataformas/meios e revisãoindependente. Semagentes novos na recuperação sequencial; não alterar bridges/modelos/autenticação/permissões/serviços.


## Ponto actual — regressão integral em execução

Este turno foi progresso: UI nativa Node/Go, idiomas, recuperação, revisão visual e início de gate integral. Contrato completo activo; nada novo no HTML público. Todo o v3/biblioteca continua WIP, preservado. Não marcar produto completo ou bloqueado.

**Processo local activo:** handle52729, driver `.cache/site-resources-full-gate.mjs`, relatório `.cache/site-resources-full/report.json`, log de controlo `.cache/site-resources-full-driver.log`. Confirmado vivo na última consulta: typecheck/web-build/native-build PASS; `node-all` RUNNING, PID2401601. **Não alterar fontes nem repetir/reiniciar a suite enquanto este gate corre.** Seguem Go completo comrace/pacotes sequenciais, toda interop nativa,SQLiteC, todaUI Node/Go e todos os testesbrowser nos3engines. Reporta comandos/PIDs/hashes por fase e pára em falha. Mantém reserva15GiB (última leitura21GiB). Desktop/RNS/Android/iOS e publicação são gates separados, não cobertos automaticamente por este driver.

CI35338021371 (56e105e, anterior aoWIPv3): Node nos3hosts, Go, UI nativa, Reticulum e3pacotesdesktop PASS. iOS eautonomous-browser ainda emexecução na última consulta. A execução sequencial deGo chegou agora a passar, sem tirar pacotes/race ou mudar KDF/prazos; isso não demonstra uma causa única do timeout anterior. Não cancelarCI porpush documental.

Novos resultados concluídos/recolhidos:
-UI partilhada Node eGo:1percurso cada, criação de ficheiro+tabela privados, preflight contra público indevido, obtenção entre processos independentes, bytes exactos, pesquisa, autoria/Axe/mobile. Logs `.cache/resource-native-ui-node-fixed.log` e `.cache/resource-native-ui-go-first.log`; provas `.cache/resource-native-ui/{node,native}`. A primeira fixture não voltava a seleccionar o leitor ao mudar Público→Privado; produto regressa a Só tu. Corrigida a fixture, sem alargar permissões.
-UI EN/ES com390px,dark,movimento reduzido,foco teclado e nomes Unicode preservados:2porengine PASS. Foi corrigida a apresentação de pequenos ficheiros que arredondava para0KiB; agoraB/KiB/MiB. Metadados alinhados e biblioteca usa materialglass/fallback existentes. Capturas anteriores preservadas em`.cache/resource-ui-languages-before-polish`; actuais em`.cache/resource-ui-languages`.
-UI de perda controlada de request e reply no limiteWorker:2porengine PASS. UmúnicoUUID, retryexplícito com mesmo pedido, uma cópia apósreload e nenhuma criação automática. Muda apenas a mensagem indicada; worker/API/storage são reais. Provas `.cache/resource-ui-recovery`.
-Controller/i18n/tamanho:9PASS. Inclui137recursos de outro autor através dehistory real, para além dos128resultados do journal.
-Retirada de recurso: APIread não devolve bytes e a nova publicação directa também é recusada.4Node/Go PASS e2API porbrowser PASS. BackendBrowser lê as políticas dentro da transacção de catálogo, sem getValue reentrante. Os prazos/validação estrita permanecem.
-Polish final: Chromium4PASS(2idiomas+2API),Firefox6PASS,WebKit6PASS(2idiomas+2recuperação+2API), em`.cache/resource-polish-{chromium,firefox,webkit}.log`. Handle66870 recolhido. Os gates anteriores sobrepostos não devem ser somados como casos únicos.

Mudança de produto: feedback de criação/retoma distingue agora expired de copy-pending, emvez de sugerir retoma de um recurso expirado. Dicionário PT/en/es actualizado. Fontes sem erros no diff--check.

Provas dirigidas preservadas antes de novas suites reusarem ficheiros: `.cache/resource-ui-targeted-evidence`, incluindo hashes actuais, logs e capturas. Ainda não curadas/commitadas como entrega final.

Próximo: recolher ohandle52729 e oCI, investigar qualquerfalha a partir de logs/traces seminventarcausa nem dispensa decontrolos; corrigir e repetir apenasoâmbito necessário, preservando os passes porhash. Depoisrevisão/curadoria deprovas, documentação, commitsverificados, integração no principal/pacotes e gates depublicaçãoHTTPS. Continuar contribuições/formulários, gruposwebdinâmicos, backups/rotação/keystore, plataformas/meios/hardware e revisãoindependente. Manter Astra/Copilot Ultra e recuperação sequencialsemagentes novos; sem alterações a bridges/modelos/autenticação/permissões/serviços.


## Verificação em curso — Node completo aprovado; diagnóstico iOS recolhido

Handle52729 continua activo e foi consultado, sem reinício. Gate `.cache/site-resources-full/report.json`: typecheck/web-build/native-build PASS; **461testesNode completos PASS**, sem falhas/skips (470449ms). Native-race emexecução; core/transport/webpeer já passaram, app ainda não emitiu resultado. Não alterar fontes durante o gate, nem relançar por ausência temporária de output. Nenhuma suite nova foi disparada nesta continuação.

O turno anterior foi progresso. Esta continuação confirmou processos vivos, concluiu observação doNode completo e recolheu evidência que muda o diagnóstico iOS. O documento docs/SITE-RESOURCES.md foi actualizado para descrever o v3/API/UI existentes, mantendo aprovação de entrega/publicação pendente; só documentação foi alterada durante o gate.

CI35338021371/56e105e: Node3hosts, Go, UI nativa, Reticulum,3pacotesdesktop PASS; iOSFAIL; autonomous-browser ainda emexecução na última consulta. **O iOS deste commit não contém o diagnóstico1e83db2 do principal**, pois a branch de recursos partiu de59c9bd1. Confirmado por gitdiff de3ficheiros iOS/runner; conservar a versão mais recente do principal ao integrar.

Artefacto iOS descarregado e todos os hashes/tamanhos conferidos. Provas curadas em `docs/evidence/ios-56e105e` (WIP). Startup PASS, fotografia sintética importada, comando execute-ui-test interrompido por timeout (exitnull,189284ms). Log chegou a private-message-saved, tocou Attachfile e ficou na procura da acção de fototeca. Não chegou aphoto-picker-requested/seleccionar fotografia. Exportação doxcresult incompleto falhou; não há capturas funcionais novas. Não afirmar a mesma causaAX anterior nem entrega aoNode: esse runner não conservou peerObservation nafalha. O simulador próprio foi removido pelo runner; nada físico/signing foi validado. Nenhum prazo/permissão foi alterado.

Continuar a aguardar/recolher o gate52729 e oCI, com as fontes congeladas. Restantes passos e objectivo integral inalterados. Sem agentes novos/modelos/bridge/autenticação/permissões/serviços. Última reserva21GiB.


## Matriz actual — Chromium101PASS, Firefox activo

Handle99912 novamente confirmado vivo. A matrizChromium completa terminou101PASS, sem falhas/skips,10,0min, na fonte actual com todas as correcções. Relatório .cache/resources-final-regression/browser-chromium.json e log correspondente. Firefox está agora activo; seguemWebKit,UI Node/Go,desktop eRNS. Não confundir este gate com os anteriores que falharam. As660fontes continuamcongeladas. Última medição52GiBlivres.

FR-038/039/040 continuampartial no JSON de requisitos, agora comlinks paraimplementação v3/provas/revisão ependentes reais. Esta continuação gerou evidência nova (ChromiumcompletoPASS) e espera verificada. Não é bloqueio nemconclusãodoproduto.
