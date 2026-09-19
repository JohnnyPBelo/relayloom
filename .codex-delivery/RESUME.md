# RelayLoom — retoma, 18 de Setembro de 2026

O produto completo não está concluído. Manter todo o PROJECT-BRIEF.md e o objectivo activo: Windows, Android, macOS, iOS, Linux e web autónoma com paridade; comunicação cifrada e agnóstica de meios; sites expressivos inspirados no ZeroNet; setup, idiomas e UI Liquid Glass. Só este projecto. Astra/Copilot Ultra intacto. Recuperação sequencial, sem criar ou retomar agentes. Não alterar providers, bridges, permissões, autenticação ou serviços externos. O checkpoint adicional de manutenção foi cancelado.

## Principal e publicação

- Principal: `/home/absint0o/projects/relayloom`, branch `codex/setup-languages`, HEAD/origin **1e83db22ff9b7b9a65a400601b891312a3188960**.
- Web publicada: https://johnnypbelo.github.io/relayloom/ . Fonte **59c9bd1a4b8aa2efa03d37c8758ef943e0de37ee**, distribuição **f6758222a5e7b993ebb5970b8653a4090596941c**. Tabelas v2/histórico/privacidade/recuperação estão publicadas. Recursos opcionais novos ainda não estão no HTML.
- Gates anteriores: 427 Node, 33 UI Node + 33 UI Go, Linux build/run/package/run; publicação 102 percursos normais + 108 públicos + 1 entre processos; HTTPS 19 hashes + 15 percursos de páginas + 1 entre processos. Provas em `docs/evidence/site-data/{live,integrated,integration-fixes,ci-59c9bd1}`.
- WIP antigo do principal preservado, incluindo docs, capturas e worktrees. Não usar `git add -A`, reset, force-push nem copiar árvores antigas sobre o principal. Não fazer merge de PRs. Commits/pushes normais e publicação web estão autorizados.
- Última leitura: **21 GiB livres**, mínimo obrigatório 15 GiB. Dependências/caches no projecto e uma execução pesada local de cada vez.

## Árvore de trabalho activa — continuar aqui

`/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch **codex/site-optional-resources**, base59c9bd1. HEAD/origin **b4356088cc9aacc3113738e70ddae3100464992c**. Push confirmado. Não integrada no principal nem publicada no HTML.

Commits:
- d3b7cad: contrato portátil de recursos/referências.
- f672eaf: recursos fora da sincronização automática, validação/admissão, resumos e armazenamento privado separado.
- 78cc38c: registo e catálogos persistentes Node/Go/browser.
- 96e35c1: criação/retoma ligadas às três aplicações e testes.
- b435608: provas, revisão local, README/STATUS/traceability e pendentes.

Fonte limpa. O único WIP nessa árvore é `docs/evidence/heterogeneous.json`, gerado pela regressão; não foi incluído no commit. O WIP do principal permanece separado. Dependências são resolvidas pelo node_modules do principal, sem novo node_modules nesta worktree. CLIs absolutos foram usados nos gates. Cache Go é do mesmo projecto. O binário `.cache/native-app/relayloom` e dist/web foram compilados para esta fonte.

## Implementado e verificado neste incremento

- Payload site-resource: ficheiro até2MiB ou tabela64KiB/256linhas/12colunas. Referência fixa bundleID/autor/nome/MIME/tamanho/hash canónico. Sem scripts, HTML activo ou SQL.
- Inventários Node/Go/browser omitem recursos; publicação genérica/announce recusam-nos. Pedido explícito pode atravessar os transportes e seeders consentidos. Resumos periódicos sem ficheiros/tabelas. Conteúdo legível inválido é recusado antes da admissão; privado sem chave permanece opaco.
- Store privado `resource:` com derivação/AAD próprios a partir da assinatura. Leitura/seeding não concedem autoria nem acesso ao stage de assinaturas.
- Registo portátil: sequência, UUID/fingerprint,128resultados retidos, uma cópia pendente, ready por hash exacto e expiração sem novo ID silencioso. Limite1MiB do registo.
- Catálogos persistentes Node/Go/browser: intenção e stage na mesma transacção; recuperação após morte antes/depois de commit/cópia/ready; Node↔Go na mesma SQLite protegida.
- `resource-command`: state/operation/create/resume. Copia localmente sem broadcast, relê a cópia e verifica antes de ready. Quota/falha deixam pendente; retoma limitada a cada5s. Bloqueio de leitor suspende a cópia. Browser confirma bloqueio dentro da transacção de cópia e fixa a geração da sessão.
- O resolver de contactos do browser consome snapshot pré-carregado. Não chamar profile.getValue/data dentro da transacção exclusiva do catálogo; causaria reentrada/deadlock.
- Ready é resultado histórico de criação; não promete disponibilidade depois de expiração/remoção/perda de armazenamento.

Provas curadas: `docs/evidence/site-optional-resources/creation` na worktree.83ficheiros com manifestos/tamanhos/hashes;628ficheiros de fonte comparados com96e35c1. Gates concluídos:

- **450 testes Node completos** (sem falhas/skips).
- Go **./sites e ./app com race**,13,545s/495,542s. O gate anterior app levava515,3s; não foi timeout.
- **19 testes de interoperabilidade**: criação através da API, quota/bloqueio, expiração, morte de processos, retoma entre motores, autor offline e seeder reiniciado.
- **19 por browser (57)** em Chromium/Firefox/WebKit: API/catálogo e transportes reais, autorização/corrupção, partição/heal e regressão de sitesv1/v2.
- **23 percursos UI de regressão**:1Node,1Go,7porbrowser;20relatórios Axe sem violações. Editor existente, histórico/privacidade/conflitos/perda de resposta/idiomas. As capturas editor/leitor Chromium foram inspeccionadas pelo implementador. Não é UI de recursos nem revisão independente.

Comandos exactos nos report.json e ui/gate-report.json; reprodução em README.md da pasta de provas. Drivers locais: `.cache/resource-runtime-gate.mjs` e `.cache/resource-runtime-ui.mjs`. **Handles80445,67142 e99233 (push) concluídos/recolhidos; nenhum teste/processo local deste incremento em curso.** Não repetir as suites por já terem terminado.

## CI actual e iOS

**CI35331029446**, fonte **b435608**, branch de recursos opcionais, estava queued na última consulta. Confirmar antes de novo push que o cancele. Aguardar resultado real; não inferir passe multiplataforma dos gates Linux.

CI35321298679 (1e83db2) terminou: Node nos três hosts, Go, UI nativa, Reticulum, browsers autónomos e três pacotes desktop PASS; iOS UI no simulador FAIL. Provas novas no principal `docs/evidence/site-data/ci-1e83db2` (ainda WIP) e cache `.cache/ios-1e83db2-execution`. Artefactos conferidos por manifesto/hash.

O relatório confirma identidade, publicação, ligação e mensagem privada recebida/verificada pelo Node. Fase finalphoto-picker-requested. FalhaAX na fototeca, PID30354, NativeSimulatorTests.swift:318. Avisos CoreData PLInternalResource sem nexo causal demonstrado. ui-01 mostra mensagem recebida antes de o picker ficar visível; ui-02 pendente; ui-03 onboarding. A numeração de screenshots não é ordem cronológica. Não atribuir causa a partir de uma captura nem aumentar prazos, saltar fotografia ou conceder permissões.

Mantêm-se ocorrências anteriores de UI/RTC sem causa comprovada; passes posteriores não demonstram correcção. Hardware, assinatura Apple, rádios, paridade completa e revisão independente continuam pendentes/bloqueados conforme a matriz; não declarar prontidão para catástrofes.

## Próximo trabalho concreto

1. Continuar nesta worktree. Ler `.codex-delivery/SITE-OPTIONAL-RESOURCES.md`, `.codex-delivery/SITE-RESOURCE-REVIEW.md` e `docs/SITE-RESOURCES.md`.
2. **Documento v3 e referências limitadas**. Compatibilidade v1/v2 preservada. API recebe snapshotID+blockID, autentica/desencripta o snapshot e extrai a referência; nunca aceita metadados arbitrários do chamador. Disponibilidade local não faz pedidos; obter explicitamente pede o ID exacto. Confirmar autor/hash/MIME/tamanho/audiência. Não substituir snapshot histórico pela cabeça actual durante o pedido.
3. Validar novas publicações: audiência do recurso cobre a do site; um recurso privado não acompanha um site público. Referência pode conservar autor de terceiro sem transferir autoria. Repetir publicação já retida não deve exigir disponibilidade actual nem gerar nova assinatura. Recursos expirados exigem nova decisão explícita do dono.
4. **UI**: biblioteca de recursos, criação/retoma/expiração, ficheiros/tabelas, anexar referência pronta, obter/abrir/descarregar e estados distintos de ausência/acesso/corrupção/expiração. Controlador conserva UUID/sequência/intenção antes de enviar, invalida resultados após lock/troca de proprietário. Preservar Liquid Glass, teclado/toque e PT/en/es. Rever apresentação de títulos longos no editor.
5. Gates UI com múltiplas contas, ausência dos bytes antes da escolha, presença exacta depois, autor offline, seeder reiniciado, partição/heal, quotas e falhas de autorização/corrupção. UI/downloads iOS continuam especialmente pendentes. Não confundir bibliotecas/APIs com entrega do estúdio.
6. Integrar/push/publicar só depois de validar a implementação completa do incremento. Não cancelar CI com pushes documentais desnecessários.
7. Continuar restante contrato: contribuições/formulários assinados pelo visitante e aprovados pelo dono, grupos web dinâmicos, recuperação/rotação/keystore, plataformas/meios/hardware e revisão independente. Não declarar o produto concluído.

O histórico completo anterior deste ponto foi preservado byte a byte em `history/RESUME-before-resource-creation-b435608.md`. O objectivo integral permanece activo.


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


## Revisão pendente antes de entregar v3

Com o gate52729 ainda activo, uma revisão só de leitura encontrou duas preocupações concretas, registadas em `.codex-delivery/SITE-RESOURCE-REVIEW.md`: identidade da chamada activa em resource-view.check (finally de chamada substituída pode limpar busy) e cores do cartão de recurso (usa --site-surface inexistente, recua para cores daapp dentro da paleta do site). Depois do gate, reproduzir resposta atrasada/abort e combinações siteink/appclara e sitesand/forest/appescura; corrigir e repetir testes afectados. Não considerar passados por inspecção de código, nem entregar apenas porque o gate genérico passe. Não houve alteração de fontes durante esta revisão.


## Gate integral — Go concluído, interoperabilidade activa

Handle52729 revalidado vivo, sem reinício. **Todos os17pacotes Go comrace/p=1 PASS**; app531,212s, groupauthority177,822s. Driver passou para native-interop, PID2638740 na consulta de12:27UTC, primeiros4casosPASS. Node461 permanecePASS. Depois vêmSQLiteC, UI Node/Go e matrizbrowsercompleta. Fontes continuamcongeladas; não tratar o gate como concluído.

CI56e105e terminou: todos os jobs concluídosPASS excepto iOSFAIL (startupPASS, UI timeout ao procurar fototeca; provas e limites járegistados). EsseCI não contém oWIPv3. Não inferir validação dos dispositivosfísicos ou da UIv3 a partirdele. A etapa actual éesperaverificada/novosresultados; não ébloqueio nem tarefa concluída.

A revisão acrescentou um terceiro ponto em SITE-RESOURCE-REVIEW.md: ResourcePayload conserva URL sem identidade do conteúdo; reproduzir troca depreview para excluir associação transitória de novo nome/MIME com URL antigo. Gate52729 permanece vivo e as fontes intactas; interoperabilidade já passou67casos na última consulta, sem falha observada, mas ainda não terminou. Último espaço livre20GiB.


## Gate integral — interoperabilidade concluída

Handle52729 continua activo, sem reinício nem alterações de fontes. **92testes de interoperabilidade PASS**, sem falhas/skips,683595ms. Node461 e Go17pacotes/race permanecem aprovados. Fase actualsqlite-cgo; depoisUI Node/Go e browser completoChromium/Firefox/WebKit. Relatório `.cache/site-resources-full/report.json`; contrololog `.cache/site-resources-full-driver.log`. Ainda não éPASS integral nem publicação autorizada como pronta. Continuar depois com as3reproduções de revisão registadas, gates afectados e integração.


## Gate integral — UI Node concluída

Handle52729 continua vivo. SQLiteC5pacotesPASS e **UI Node34PASS (4,2min)**. UI Go (envnative, não node) emexecução, primeiros9percursosPASS na consulta. Node461/Go17race/interop92 continuam aprovados. As fontes permanecem congeladas. A revisão ganhou passos concretos de reprodução para chamada sobreposta, paletas do leitor e URLdepreview; não são testes já executados. Depois da UI Go seguem os3browsers completos. Não relançar gates concluídos nem tratar a suite activa como terminada.


## Gate integral — ambas as interfaces nativas aprovadas

Handle52729 activo, fontes inalteradas. **UI Node34PASS e UI Go34PASS** (4,2min/3,6min). Começou browser-chromium, primeiros9percursosPASS na última consulta; seguemFirefox eWebKit. Node461,Go17race,interop92 eSQLiteC5 mantêm os passes. Não confundir a suite actual com entrega concluída: as3reproduções de revisão continuam obrigatórias depois do gate e não houve publicação doHTMLv3.


## Retoma actual — Firefox concluído e revisões preparadas

O handle52729 foi revalidado vivo. Chromium97PASS e Firefox97PASS(11,9min); WebKit em execução, ainda não concluído. Os659hashes das fontes permaneciam exactos na última comparação. Não reiniciar o gate nem aplicar fontes enquanto estiver vivo. Disco19GiB livres.

Esta continuação preparou testes e correcções fora das fontes congeladas: `.cache/resource-review-ui.spec.ts` (três percursos UI: obtain atrasado no Worker sobre RTC real, seis paletas num leitor distinto, fronteiras DOM/cleanup ao alternar ficheiros); `.cache/resource-view-revised.tsx` (chamada activa e URL associado ao conteúdo); `.cache/resources-revised.css` (paleta do site e biblioteca mais opaca). Só sintaxe foi verificada com transpileModule; **não são testes executados nem correcções aplicadas**. Depois do gate, copiar primeiro apenas o teste para `tests/browser/site-resource-review.spec.ts`, correr em Chromium contra build actual e conservar as reproduções antes de aplicar as duas fontes. Verificar se os controlos foram atingidos, corrigir fixtures sem mascarar o produto, depois aplicar e repetir o âmbito afectado. Scripts/cache de testes são rascunhos revistos, não resultados.

Curador preparado `.cache/curate-resource-full.mjs`: só corre depois de report.status deixar RUNNING, não sobrescreve destino. Copia relatório/logs e extrai estatísticas para docs/evidence/site-optional-resources/v3-ui/pre-review. Não inclui traces/perfis privados. Testar e rever antes de declarar entrega; comparar hashes pré/pós para delimitar reruns. README/STATUS/plano foram actualizados para distinguir a UIv3 existente da versão pública v2. Nenhum agente/configuração/bridge/serviço foi alterado. Caches Reticulum/Electron existentes no próprio projecto foram partilhadas por symlink nesta worktree, sem instalar dependências novas.


## Gate integral concluído; revisão v3 em correcção

A continuação anterior foi **progresso**: gate52729 terminou PASS (461Node,17pacotesGo/race,92interop,5SQLiteC,34UI Node+34UI Go,97Chromium+97Firefox+97WebKit),659hashes estáveis. Provas curadas em docs/evidence/site-optional-resources/v3-ui/pre-review. Os três testes novos reproduziram falhas reais de busy sobreposto, cores e URL/ficheiro transitório antes de aplicar correcções. A primeira fixture de paletas encontrou uma remontagem no scroll; repetida apenas a observação, as seis combinações ficaram cobertas e confirmaram contraste insuficiente. Originais preservados em .cache/resource-review-before* e .cache/resource-palettes-before*.

Correcções já aplicadas a apps/web/src/site/resource-view.tsx e resources.css; teste novo tests/browser/site-resource-review.spec.ts. Gate .cache/resources-review-gate.mjs, handle72735, passou typecheck/build, mas a execução foi interrompida. Na retoma o handle, driver e PID3132664 estavam ausentes. O relatório .cache/resources-post-review/report.json foi marcado INTERRUPTED_WITH_OBSERVED_FAILURE, com cópia intacta report-before-interruption-observation.json. O log Chromium registou7PASS/1FAIL e o nono caso sem conclusão. A correcção de overlap e preview passou; as seis paletas ficaram com o fundo correcto mas botões/links nas paletas claras sob app escura ainda tinham contraste insuficiente. Não repetir esse gate como se tivesse sido concluído.

Diagnóstico actual: teste dirigido de paletas (handle47373), log .cache/resource-palette-diagnosis.log, contra build da primeira correcção; teste regista regras CSS correspondentes para encontrar a precedência. Fontes de produto ainda iguais às dessa correcção. .cache/resource-review-first-fix guarda as capturas/JSON; .cache/resources-post-review/tested-resource-view.tsx e tested-resources.css guardam o código testado. Próximo: corrigir a precedência CSS demonstrada, repetir paletas, retomar gate novo com logs únicos e todos os9percursos porbrowser,UI Node/Go,desktop eRNS. Não reiniciar a regressão backend inteira sem alterações que o justifiquem; comparar hashes. Sem agentes/configurações/serviços alterados;19GiB livres. O produto e a publicação v3 continuam pendentes.


## Correcção de precedência aplicada — gate72034 activo

O diagnóstico dirigido confirmou no browser que regras globais do tema escuro tinham precedência sobre os botões/links do recurso. resources.css agora delimita as regras pela superfície do site e elemento; sem !important, sem reduzir Axe. Primeiro código e falhas preservados. Build/typecheck do novo gate passaram;9percursos Chromium em execução, seguindoFirefox/WebKit,UI Node/Go,desktop eRNS. Handle72034, driver .cache/resources-review-fixed-driver.log, relatório .cache/resources-post-review-fixed/report.json. O relatório antigo .cache/resources-post-review/report.json descreve a interrupção/falha anterior e não é o gate actual.

O teste novo inclui diagnóstico de regras CSS correspondentes; fontes congeladas enquanto72034 corre. A captura compacta Chromium/es-ES mostra agora biblioteca opaca/legível; isso não substitui os gates dos3motores. Não reiniciar nada apenas por interrupção da observação: revalidarhandle/PID. Root principal1e83db2 continua intacto salvo docs de retoma; toda a implementação está em .cache/site-optional-resources, branch56e105e+WIP.


## Leitor estável corrigido — regressão UI integral activa12600

A continuação anterior e esta produziram progresso: o controlo com inventário atrasado demonstrou desmontagem/foco perdido com o mesmo snapshot. A correcção em visit.tsx preserva o leitor durante verificações automáticas; navegação explícita, erro e head indisponível continuam a limpar a vista. Dois testes dirigidosFirefox passaram: seis paletas/Axe/teclado e dois paresRTC com inventário retido, foco/nó preservados e resposta seguinte perdida sem fallback antigo. Logs .cache/resource-reader-fixed*, provas curadas docs/evidence/site-optional-resources/v3-ui/reader-focus. O primeiro controlador de teclado saiu para o chrome ao tabular do último controlo; agora verifica a travessia dentro do diálogo, e o controlo separado prova a falha/correcção do produto.

Revisão visual acrescentou apenas tipografia local dos metadados e white-space para manter número/unidade juntos. GateFINALactual: handle12600, .cache/resources-final-ui-driver.log, .cache/resources-final-ui/report.json. Typecheck/build passaram e a matriz Chromium completa está activa. Agora101casos porbrowser (original97+4novos), seguemFirefox/WebKit, todaUI Node/Go(34cada),desktopbuild/run/package/run eRNSreal/UI. O código está congelado. Diferenças em relação ao gate inicialPASS: resource-view.tsx, resources.css, visit.tsx e o novo teste site-resource-review.spec.ts. Backend tem os mesmos hashes do461Node/17Go-race/92interop/SQLiteC jápassados; não repetir sem mudança que o justifique.

Os gates72034 e72735 são históricos FAIL/interrompido e não devem ser retomados como activos. No início desta nota,12600 foi revalidado vivo. Sem novosagentes/configurações/serviços e com19GiBlivres. Seguemcuradoria, commit/push, integração de1e83db2(iOSdiagnósticos/docs), distribuição pública exacta/HTTPS e orestante contrato. Não declararproduto concluído nempublicação v3 feita.


## Ajuste final de metadados — gates históricos preservados

O gate12600 terminou FAIL: Chromium100PASS/1FAIL; fases seguintes não arrancaram. A falha era de contraste nos metadados, introduzida pelo ajuste tipográfico: os selectores mais específicos passaram também a aplicar --muted da aplicação. Corrigidos nome/tamanho, crédito e nota para herdar a cor do site. O build passou e a reprodução das seis paletas/Axe/teclado passou emChromium(20,8s). Firefox dirigido emexecução no handle87345, log .cache/resource-metadata-firefox.log; seguirWebKit e só depois retomar matriz integral. NÃO retomar12600/72034/72735 como vivos.

Fontes/provas anteriores preservadas em .cache/resources-final-ui/report.json, browser-chromium.json e tested-resources.css; capturas/JSON em .cache/resource-review-metadata-failure. Logs do ajuste: .cache/resource-metadata-build.log e .cache/resource-metadata-chromium.log. Novo gate deve ter directório único. O backend continua inalterado em relação ao gate inicialPASS659hashes; a UI corrente diverge nos mesmos4ficheiros jáidentificados. Sem commits/publicação v3 ainda. Não acrescentar mais polish antes de estabilizar este gate.

Depois dos passes: curar/rever, commit e integração do principal1e83db2 preservandoWIP/iOS. Rascunhos para incluir recursos no gate público e no HTTPS estão em .cache/resource-public.config.ts, .cache/verify-resource-public-web.mjs e .cache/site-resources-live-ui.spec.ts (ainda não aplicados/testados). DepoisHTMLexacto/HTTPS e contrato integral continuam.


## Três paletas dirigidas PASS — gate actual99912

Chromium/Firefox/WebKit passaram o teste dirigido completo das seis combinações, comAxe antes/depois, foco e metadados legíveis. Artefactos/hashes/comandos preservados em .cache/resource-metadata-passed/report.json e subdirectórios. Ocorreu correcção real de herança de cor, não alteração dos limiares nem exclusõesAxe. Buildpassou; nenhum outro polish será acrescentado durante a matriz.

**Único gate actual:** handle99912, driver .cache/resources-final-regression-driver.log, relatório .cache/resources-final-regression/report.json. Executa typecheck/build,101Chromium/101Firefox/101WebKit,34UI Node/34UI Go,desktopbuild/run/package/run e RNS/UI. Os gates12600,72034,72735 são históricos FAIL/interrompido. Os testes dirigidos3474/87345/37621 e11541 já foram recolhidos, exit0. Não relançar os mesmos por ausência de output; confirmar99912/PID actual antes de agir.

As660fontes ficam congeladas; backend exacto do gate inicialPASS, diferenças deUI em4ficheiros. Seguem curadoria e commit/push coerente, integração do1e83db2preservandoiOS/WIP, aplicação/verificação dos rascunhos do gate público, publicação exacta e testeHTTPS. Contrato completo, meios/hardware/plataformas, contribuições e revisão independente continuam activos. Sem novosagentes nem configurações alteradas; reserva19GiB.


Verificação de espera nesta continuação: handle99912 confirmado vivo por write_stdin; Chromium já ultrapassou os percursos de tabelas/multilingue/heterogeneidade sem falhas observadas. Não é aprovação do gate completo. As fontes permanecem congeladas e a próxima acção é consultar este mesmohandle/relatório e integrar apenas depois da conclusão. Esta continuação foi progresso (correcção e controlos de metadados) seguido de espera verificada, não bloqueio.


## Matriz actual — Chromium101PASS, Firefox activo

Handle99912 novamente confirmado vivo. A matrizChromium completa terminou101PASS, sem falhas/skips,10,0min, na fonte actual com todas as correcções. Relatório .cache/resources-final-regression/browser-chromium.json e log correspondente. Firefox está agora activo; seguemWebKit,UI Node/Go,desktop eRNS. Não confundir este gate com os anteriores que falharam. As660fontes continuamcongeladas. Última medição52GiBlivres.

FR-038/039/040 continuampartial no JSON de requisitos, agora comlinks paraimplementação v3/provas/revisão ependentes reais. Esta continuação gerou evidência nova (ChromiumcompletoPASS) e espera verificada. Não é bloqueio nemconclusãodoproduto.


Última espera verificada:99912 continua vivo; Chromium101PASS eFirefoxactivo, jádepois dos casos de catálogo/persistência. Nenhuma fonte alterada. Esta continuação actualizou a rastreabilidadeFR-038/039/040 e confirmou resultados novos, mantendo o objectivointegral. Retomar este mesmogate, semreinícios ou agentesnovos; apósPASS seguircuradoria/integração/publicação e restantes fases.


## Matriz actual — dois browsers completos aprovados

Chromium101PASS eFirefox101PASS(12,5min), sem falhas/skips, na candidataactual. Gate99912 confirmado vivo; WebKit está agora emexecução, depois seguem34UI Node/34UI Go,desktop eRNS. Não alterar fontes nem reiniciar por ausência deoutput. As36auditoriasAxe dirigidas foram curadas com hashes/capturas/comandos em docs/evidence/site-optional-resources/v3-ui/palette-controls. Esta continuação produziu prova nova (FirefoxcompletoPASS) e espera verificada; não ébloqueio.


## Gate99912 terminou FAIL — investigação WebKit em curso

Chromium101PASS eFirefox101PASS mantêm-se. WebKit terminou99PASS/2FAIL; driver parou, e99912foirecolhidocomexit1. As fases UI Node/Go,desktop eRNS NÃO correram neste gate. Falharam os dois testes novos de paletas e inventário atrasado: recurso não apareceu na primeira página do leitor e a versão2 não apareceu no estado retido. A captura da autora mostra apenas2blocosiniciais depois depublicar. Não tratar como falha de rádio/rede semprova.

Os helpers novos clicavam Inserir e imediatamente alteravam a paleta, embora a inserção faça api(view) assíncrono. selectOption pode alterar um select de fundo enquanto um diálogo ainda está activo. O helper agora confirma fecho da biblioteca e presença real do bloco antes decontinuar, e publish exige a versão esperada além da mensagem/controlo activo. São confirmações maisfortes, sem sleeps, prazos maiores ou alterações no produto. A causa ainda deve ser confirmada pela execução. Teste dirigido actual: handle52377, dois casosWebKit, .cache/resource-webkit-sequence.log/.cache/resource-webkit-sequence-artifacts. Fontesdeproduto inalteradas desdeos101PASSdosdoisbrowsers; sóotestede revisão mudou. Guardada a fonte testada em .cache/resources-final-regression/tested-resource-review.spec.ts e dadosWebKit em .cache/resource-review-webkit-final-failures.

Revisão estática adicional (aindaNÃOexecutada):128blocos legítimos podem disparar128inspect contra limite64pedidos do Worker. Draft de reproduçãoUI em .cache/resource-inspection-budget.spec.ts; actualizar oshelpers a partirdo actual e executar depois deste diagnóstico, antes deentregar. Não aumentar o limiteglobal nem reduzir128blocos para ocultar um problema,seforconfirmado. Conservar todos os resultadosanteriores;próximogateemdirectóriounico. Semcommits/publicaçãov3ainda;52GiBlivres.


## Orçamento de inspecção — falha reproduzida e correcção implementada

Os dois casosWebKit passaram com confirmações explícitas de inserção/versão (handle52377recolhido0; .cache/resource-webkit-sequence-report.json). Não houve alteração de produto nesse diagnóstico. O teste de limite inicial tinha128irmãos e foi correctamente recusado pelo limite24; preservado em .cache/resource-budget-before* /resource-budget-invalid-fixture-report.json. Corrigida a fixture para5composições+123referências=128blocos válidos,56742bytes. Essa versão reproduziu59erros 'Há demasiadas operações em curso'; só64referências ficaramdisponíveis. Provas .cache/resource-budget-valid-before* e .cache/resource-inspection-budget-before.

Implementado apps/web/src/site/resource-inspection.ts: quatro inspecções automáticas de cada vez, fila limitada, campos explícitos, cancelamento de trabalho ainda não iniciado; abortar o consumidor não liberta prematuramente um slot de pedido já enviado aoWorker. Limite64do cliente e limites do documento mantidos. resource-view usa a fila apenas eminspect; obtenção explícita continua disponível. Quatro testesunitários de concorrência/alvos/cancelamento/falhas/limite PASS, typecheck/buildPASS. Primeiro testeUI corrigido mais quatro de revisão Chromium:5PASS(1,5min);123disponíveis,zeroerros e obtenção doúltimo recurso. Artefactos .cache/resource-inspection-budget-first-pass e .cache/resource-inspection-chromium-first-report.json.

Foi removido umcampo interno semuso e acrescentado ao testeUI o fecho/reabertura com respostas reais deinspect retidas, sem libertação prematura de slots, descarte de pedidos nãoiniciados ebytesexactos doúltimo recurso. Execuçãoactual handle43976: unitários/typecheck/build e5Chromium, logs .cache/resource-inspection-*-final*. Revalidar essehandle antes de agir. Não hágateintegral activo:99912terminouFAILWebKit, futurosNode/Go/desktop/RNSaindanãoexecutados. Depois seguemcontrolosFirefox/WebKit, nova regressãocompleta102porbrowser+4novosunitários e gatespendentes. Fontesactualmente incluem quatroficheiros novos relativamente aoinicial: resource-inspection.ts, resource-budget.spec.ts, resource-review.spec.ts e site-resource-inspection.test.ts; verificarlistaexactano próximo driver.


## WebKit dirigido — corrigida retenção prematura da fixture

Chromium5PASS eFirefox5PASS com a fila, incluindo128blocos/123recursos, fecho/reabertura,127pedidos totais epeak4. O primeiro WebKitrepeat3 teve13PASS/2FAIL, ambos antes do controlo de foco: aguardava versão2 enquanto a fixture podia reter a resposta de estado1. main.tsx impede outra actualização enquanto refreshInFlight>0; assim a fixture podia bloquear a observação que aguardava. Não é evidência de falha de entrega. Preservados .cache/resource-inspection-webkit-repeat-first-report.json e -first-data.

A fixture agora transmite estados anteriores e retém apenas a resposta real contendo versão2; exige heldReplies>0, o mesmo snapshot na reconsulta, foco/nó preservados e falha real da resposta seguinte semfallback. Resultados porrepetição têm directórios separados. Execuçãoactual handle79163,15casos WebKit(5×3), .cache/resource-inspection-webkit-confirmed.log/artifacts. Não alterar fontes atéterminar. Nenhum gateintegralactivo;99912/12600/72034 terminaramFAIL. Novo driverpreparado .cache/resources-inspection-final-gate.mjs reconhece7diferenças explícitas, executa4unitários,102casosporbrowser,UI Node/Go,desktop eRNS. Só lançar depois de validar oWebKit dirigido.


## Novo gate integral activo4347 — inspecção limitada incluída

WebKit confirmado terminou15PASS(5percursos×3repetições), com a fixture a reter só a resposta da versão2. Chromium5PASS,Firefox5PASS,unitários4PASS. Os controlos incluem a página válida no limite(123recursos/128blocos), fecho/reabertura com quatro respostasretidas, descarte de119pedidos nãoiniciados,peak4 ebytesexactos. Provas dirigidas preservadas em .cache/resource-inspection-directed; não somar execuções repetidas como casosúnicos.

**Única execução integral actual:** handle4347, driver .cache/resources-bounded-final-driver.log, relatório .cache/resources-bounded-final/report.json. Driver .cache/resources-inspection-final-gate.mjs. Executa4unitários,typecheck/build,102porbrowser,34UI Node/34UI Go,desktop build/run/package/run eRNS/UI. Sete diferenças explícitas relativamente às659fontes iniciais; agora663fontes. Produtos/backend Node/Go anteriores têm os mesmoshashes fora dos ficheiros UI identificados. Não alterar fontes enquanto corre nem relançar gates históricos.

Handles52377,74452,44211,32670,77199,43976,26318,94659,79163 foram recolhidos. Os resultados negativos/fixturesincorrectas estão preservados, não foram transformados emPASS. Próximo: acompanhar4347, corrigir qualquer falha, curar provas, commit/push, integrar1e83db2preservandoiOS/WIP, validar/publicarHTMLexacto/HTTPS econtinuarcontrato integral. Ainda não houve commit/publicação do v3; rádiohardware/plataformas/contribuições/revisãoindependente continuamabertos. Sem modelos/bridges/configurações alterados;recuperação sequencialsemagentesmantida.


## Gate4347 — Chromium102PASS; Firefox activo

Confirmado handle4347 vivo e relatórioChromium completo102PASS, sem falhas/skips,10,5min. Inclui o controlo de128blocos/123recursos e as fixtures corrigidas, na mesma candidata com a fila automática. Firefox já arrancou; depoisWebKit,34UI Node/34UI Go,desktop eRNS. Fonte congelada663hashes; não relançar o gate nem alterar código.

Provas de orçamento/cancelamento jácuradas em docs/evidence/site-optional-resources/v3-ui/inspection-budget, incluindo59falhas antes,123disponíveis depois ebytesexactos. Guia SITE-RESOURCES actualizado com semântica de cancelamento/fila. Esta continuação produziu resultado completo novo e espera verificada; o objectivo integral continua activo.


## Gate4347 — Chromium102PASS eFirefox102PASS

Firefox concluiu102PASS, sem falhas/skips(13,2min). Chromium102PASS permaneceválido;4unitários/typecheck/buildPASS. Handle4347 confirmado vivo, agoraWebKitactivo. Seguem34UI Node/34UI Go,desktop eRNS. Fontescongeladas663hashes; as fasesque não começaram não podem ser reportadas comoexecutadas. Esta continuação completou a observação de uma fase e éprogresso/esperaverificada, não bloqueio. Não reiniciar odriver nem dispararoutros builds emparalelo.


## Gate4347 — matriz dos três browsers completaPASS

Chromium102PASS,Firefox102PASS eWebKit102PASS(12,9min), semfalhas/skips:306execuções, não306cenáriosdistintos. O handle4347 permanece vivo e iniciouui-node. Seguemui-native,desktopbuild/run/package/run eRNS/UI. Os4unitários/typecheck/buildtambémpassaram. Fontescongeladas663hashes; nenhumgatefoireiniciado. Ainda não éPASSintegral nempublicação.

Curador final preparado .cache/curate-resources-final.mjs: recusa gate semPASS/fontesalteradas/destinoexistente e verifica indicadores de segredos noslogs antes decopiar. Executar e rever só depois de terminar. Provas anteriores/negativas permanecem preservadas. Esta continuação completouWebKit e confirmouesperaviva; objectivointegralactivo.


## Gates UI completos; suplemento desktop/RNS activo19374

4347terminouFAIL no arranqueElectron, depois dePASS4unitários/typecheck/build,306browser(102cada),34UI Node,34UI Go e desktop-build. Falha real de ambiente: caminho de socketUnix116bytes em .cache/desktop/tmp; mesmo .cache/tmp teria108. scripts/desktop-run.mjs e desktop-packaged-smoke.mjs passaram a usar .cache/t, dentrodo projecto. Nenhum sandbox/serviço/permissão foi alterado. Arranque dirigido handle79948PASS(exit0), relatório .cache/desktop/smoke.json: API401/200, processo separado, renderersemNode, controloexterno main1/control1/protected0; sandboxrequested=true, reported=unavailable (não inferir prova de kernel). NSS emitiu aviso sobre a base persistente; não foi alterada.

Novo suplemento **handle19374**, driver .cache/resource-desktop-rns-driver.log, relatório .cache/resource-desktop-rns/report.json. Confirma apenas as duas diferenças de launcher em relaçãoàs fontes do4347; reaproveita o app/desktop-build e os testesUI que não mudaram. Desktop-packagePASS e desktop-packaged-runPASS. Faseactual reference-rns; depoisrns-ui. Não relançar as matrices completas por esta mudança exclusiva de caminhos temporários. Não marcar o report4347 comoPASS; conservar falhaoriginal e consolidar com o suplemento, incluindo a proveniência de cada fase.

Apósconclusão: curadorfinal temde aceitar a consolidação com2scriptsdiferentes (actual .cache/curate-resources-final.mjs ainda aponta ao4347FAIL e deve recusar). Reverprovas/segredos,commit/push,integrar1e83db2preservandoiOS eWIP,aplicarrascunhosgatepúblico/HTTPS econtinuarcontrato. Candidatav3aindanãopublicada. Reticulum sériePTY ésoftware, não rádiofísico. Semagentes/modelos/configuraçõesalterados.


## Marco de código local verificado — 8faad725925149db24bae331691d691a8e7a4f1a

Código v3/UI e correcções committed em8faad72(57ficheiros). Todos os663hashes do relatório consolidado coincidem com os ficheiros e gitdiffHEADnos caminhos de fonte estávazio. Ainda nãofoi feito push. Gates locais consolidadosPASS em .cache/resources-verified/report.json e docs/evidence/site-optional-resources/v3-ui/final, com falha original de socketpreservada e suplemento19374PASS. Sem testesactivos; handles4347FAIL e19374PASS/79948PASS foram recolhidos.

Próximoimediato: commit separado das notas/guias/provascuradas (excluir capturasgeradas antigas fora dos directórios escolhidos), integrar1e83db2do principal no ramode recursos preservandoas3fontesiOS/diagnósticos e todososWIP, verificarâmbitoafectado, pushnormal. Depoisaplicar/verificarrascunhospublic/HTTPS e publicar exacto. OHTMLactualaindaé59c9bd1/f6758222. Contribuições/formulários, gruposweb,backup/rotação/keystore,plataformas/hardware e revisãoindependente continuamnoobjectivo. Esta continuação foi progressoconcreto,gates ecommit, não bloqueio nemprodutoconcluído.
