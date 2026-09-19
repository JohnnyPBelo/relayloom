# Revisão local da criação de recursos — 18 de Setembro de 2026

Revisão pelo implementador; não satisfaz o gate de revisão independente. A recuperação sequencial continua a proibir criar/retomar agentes. O objectivo integral não está concluído.

## Fronteiras verificadas no código

- O domínio de armazenamento `resource:` e a derivação a partir da assinatura permanecem separados de sites e de leitura/seeding. Stage e registo são gravados na mesma transacção antes de a aplicação receber o resultado. Uma área privada ausente com dados existentes ou stage incoerente não é reinicializada.
- Node/Go reutilizam a mesma protecção de identidade, digest privado e encerramento por erro de integridade/SQLite dos catálogos de sites. A extracção desse adaptador não altera a política. Browser fixa a geração da sessão e invalida callbacks após lock/close.
- Repetições consultam a operação retida antes de resolver novamente cartões ou assinar. Payload/audiência/prazo diferentes com a mesma operação são recusados. Retenção finita e sequência impedem que pedidos retirados sejam tratados como criação nova.
- A expiração é tratada depois de autenticar o stage com o instante histórico da assinatura. Não mascara corrupção como expiração. Resume não reassina uma tentativa expirada.
- O runtime relê o ContentStore e o catálogo compara assinatura, autor, audiência, referência e hash do bundle exacto antes de apagar stage e gravar ready. Falha de quota/cópia/releitura mantém o resultado pendente. O estado ready é histórico, não garantia de disponibilidade futura.
- O bloqueio de um leitor é verificado antes da cópia. No browser é confirmado dentro da transacção de cópia, cobrindo alteração entre snapshot e commit; o teste injeta essa alteração através do armazenamento real. Um resultado já retido não é reescrito quando muda um cartão/bloqueio.
- O callback de cartões do browser é síncrono e não chama getValue dentro da transacção exclusiva. Os cartões são carregados antes. As operações de runtime e os ticks são serializados; nenhum task antigo pode completar após mudança de sessão.
- Não existe callback de publicação na criação de recursos. Inventários continuam a omitir estes IDs; pedidos explícitos e seeding consentido mantêm as verificações anteriores. A cópia fica fixada pelo criador e está sujeita à quota. Leitores/relays não ganham entrada no catálogo de autoria.

## Provas e limites

O gate consolidado passou 450 testes Node, Go sites/app com race, 19 de interoperabilidade e 19 por browser (57). A regressão UI adicional passou 23 percursos e 20 auditorias Axe. Os hashes de 628 ficheiros de fonte correspondem ao commit 96e35c1. As provas estão em docs/evidence/site-optional-resources/creation. O contrato tem também controlos de autoria, payload, MIME, audiência, canonicalização e limites. Esta é a revisão do implementador; a revisão independente continua pendente.

A leitura por referência de snapshot assinado, documento v3, biblioteca/editor/reader e testes UI de recursos ainda não estão implementados. Não prometer esses fluxos com base nos testes da API. A paridade de downloads na shell iOS, hardware e revisão independente continuam pendentes. Bloqueio não retira cópias nem chaves já recebidas por outros pares.

## Revisão durante a regressão integral — pendentes concretos

As fontes estão congeladas pelo gate52729. A revisão de código identificou dois pontos para reproduzir e corrigir depois do término; não são passes nem testes já executados:

1. `resource-view.tsx`, função check: a geração só distingue destinos. Um pedido substituído para o mesmo destino ainda pode chegar ao finally e limpar busy do pedido seguinte; a aplicação de respostas não confirma que controller.current continua a ser o AbortController dessa chamada. Reproduzir ordenação tardia/abort na UI e guardar a evidência. A correcção deve vincular resultado, erro e finally à chamada activa, além da geração do destino; não dispensar o teste de obtenção após polling.
2. `resources.css` usa --site-surface, que SiteSurface não define, e recua para --surface da aplicação. SiteSurface define --site-paper, --site-ink e --site-soft. Em site ink com app clara, ou site sand/forest com app escura, a cor herdada pode contrastar mal com o fundo do cartão. Reproduzir o leitor real nas combinações de tema do site/app, com capturas e Axe. Não chamar verificado com base apenas no diálogo da biblioteca dark que já passou.

O gate integral em execução é útil para regressão, mas não encerra estes pontos por si. Se houver alterações depois dele, conservar os resultados anteriores e repetir o âmbito afectado com comparação explícita de hashes. Não declarar revisão independente: esta é a revisão do implementador.

3. `ResourcePayload` mantém apenas a string URL no state. Na mudança de preview entre ficheiros, o novo nome/MIME pode ser renderizado antes de o effect substituir o URL anterior. Reproduzir a troca de preview e vincular cada URL ao objecto de conteúdo que o gerou (ou remontar por identidade), mantendo a revogação no cleanup. Não considerar confirmado apenas pela leitura do código; o teste deve verificar bytes/nome coerentes durante a troca, não só depois de estabilizar.

### Reproduções propostas, mantendo a fonte congelada

Para a chamada substituída, usar o percurso real A→B da UI de recursos. Deixar a primeira obtain devolver requested; quando o polling encontra available, reter só a resposta do obtain seguinte na fronteira Worker. O botão deve manter-se disabled enquanto essa resposta estiver retida. O finally do inspect anterior é o caminho concreto a testar. Depois libertar o resultado e comparar bytes/autor. Não alterar o conteúdo do resultado nem conceder acesso por API privada.

Para cores, criar o recurso pela UI e variar a paleta do site (sand/forest/ink) e o tema da aplicação (claro/escuro), abrindo a versão assinada pelo leitor. SiteSurface fornece --site-paper, --site-ink e --site-soft; o cartão deve usar esses valores dentro da página, mantendo os materiais da aplicação na biblioteca. Inspeccionar títulos, estado, crédito, botões e download, além de Axe e foco. As capturas actuais da biblioteca dark não cobrem estas combinações do leitor.

Para URLs de preview, alternar dois ficheiros com nomes, MIME e bytes distintos no arquivo local, mantendo a mesma instância do componente. O href só pode aparecer quando corresponde ao conteúdo actual; deve ser retirado durante a mudança e revogado no cleanup. Um teste de estado estabilizado sozinho não prova essa fronteira.


### Revisão visual adicional durante WebKit

Inspeccionadas as capturas reais `.cache/resource-ui-languages/webkit/es-ES-dark.png` e `.cache/resource-native-ui/native/reader-mobile.png`. Na biblioteca escura, o texto do estúdio por trás continua legível através do material. Tornar a superfície do diálogo mais opaca, conservando brilho, contorno e blur, e rever novamente os percursos compactos EN/ES nos três motores. É um ajuste de legibilidade identificado pelo implementador, não revisão independente nem medição já executada do CSS. A alteração está apenas no rascunho `.cache/resources-revised.css`; fontes do gate permanecem intactas.


## Reproduções reais após o gate integral

O gate52729 terminou PASS, com659hashes estáveis; logs curados em docs/evidence/site-optional-resources/v3-ui/pre-review. O novo teste tests/browser/site-resource-review.spec.ts passou typecheck e foi executado em Chromium contra o build anterior, sem aplicar as correcções: três casos falharam pelos problemas previstos.

- Overlap: controlo Worker confirmou requested=true, inspect available=true, resposta obtain retida=true e dois obtains. O botão estava enabled enquanto a resposta mais recente estava retida. Depois de libertar, bytes/autoria passaram.
- Preview: MutationObserver e cleanup observaram o novo nome associado ao URL do ficheiro anterior. Os downloads estabilizados tinham os bytes correctos; a falha é a fronteira transitória.
- Paletas: quatro combinações foram observadas antes de a fixture encontrar uma remontagem durante scrollIntoViewIfNeeded. Fundo do cartão seguia a app; Axe confirmou contraste insuficiente em light/forest após obter, light/ink após obter e dark/sand antes/depois. Preservado o primeiro relatório; a fixture repete apenas a observação de scroll, limitada a15s, sem repetir publicação/obtenção nem alargar prazos do produto. As seis combinações estão a ser repetidas antes da correcção.

Provas locais: .cache/resource-review-before.log, .cache/resource-review-before-report.json, .cache/resource-review-before/; a repetição de paletas usa .cache/resource-palettes-before.log. Ainda não são passes pós-correcção nem revisão independente.


## Primeiro gate corrigido e diagnóstico de precedência

O handle72735 desapareceu após a interrupção, tal como o driver e PID3132664; relatório marcado INTERRUPTED_WITH_OBSERVED_FAILURE, mantendo original. Typecheck/build passaram; o log contém sete passes e uma falha de paletas, com o último percurso sem conclusão. Overlap e associação de URL passaram. As seis paletas ficaram com o fundo correcto, mas os botões/links dos sites claros sobre app escura mantinham cores erradas.

Uma reprodução dirigida recolheu as regras correspondentes no browser: `:root[data-theme="dark"] .secondary {color:var(--ink)}` tinha precedência sobre o selector do cartão, e a regra global de ligações escuras sobrepunha o download. Axe mediu1,08/1,42 nas combinações em causa. O selector local passa agora a incluir a superfície do site e o tipo do elemento, preservando a paleta assinada sem !important ou exclusão Axe. As regras do erro foram igualmente delimitadas. Provas: .cache/resource-palette-diagnosis* e .cache/resource-review-first-fix; código da primeira tentativa em .cache/resources-post-review/tested-*. Gate novo .cache/resources-post-review-fixed/report.json, handle72034, em execução; não marcar aprovado antes do término.


## Foco do leitor — quarta falha reproduzida

O gate72034 terminou FAIL emFirefox: Chromium9PASS, Firefox8PASS/1FAIL por foco. O diagnóstico não sustentava culpar novamente o contraste: as paletas medidas não tinham violações. A navegação da fixture foi limitada ao interior do diálogo (Shift+Tab seguido deTab), pois Tab a partir do último controlo pode entrar no chrome do browser.

Separadamente, houve uma falha real do produto: um segundo resolve retornava exactamente o mesmo snapshot já aberto, mas a chegada tardia do inventário desmontava o leitor. Um controlo novo com dois utilizadores/RTC reteve apenas respostas state do Worker, abriu a versão2 real, focou o botão e libertou o inventário. Os IDs dos dois resolves coincidiram; o elemento original ficou disconnected e perdeu foco. Esse teste falhou antes da correcção. O controlo adicional de perda da resposta do resolve seguinte terminou com erro real do cliente e remoção da vista anterior, como exigido. Provas .cache/resource-reader-before*; diagnóstico natural .cache/resource-focus-diagnosis*.

Correcção actual em visit.tsx: actualizações automáticas mantêm o leitor durante a verificação; navegação explícita continua a limpar de imediato. Resultado indisponível ou erro limpa a vista, evitando fallback silencioso. O componente só muda de identidade se o snapshot mudar. Testes dirigidos Firefox de paletas e inventário/falha emexecução no handle11541, logs .cache/resource-reader-fixed*. Nenhum novo passe foi inferido antes de recolher o resultado. Esta mudança afecta o leitor partilhado, portanto é necessária regressão UI mais ampla do que os nove percursos de recursos.


A primeira matriz integral depois do leitor estável teve100PASS/1FAIL Chromium: o ajuste tipográfico aplicou também --muted da app a metadados. A correcção mantém fonte/tamanho, mas faz nome/tamanho/crédito/nota herdar a cor do site. As seis combinações passaram depois nos3browsers (três testes dirigidos,36auditoriasAxe ao todo); comandos/capturas em .cache/resource-metadata-passed. O gate99912 é a nova regressão integral e ainda não está concluído. Não somar os resultados sobrepostos como casosúnicos nem apagar os failsanteriores.


## Fronteira adicional a verificar antes de entregar

Revisão estática durante99912: o documento permite128blocos e32IDs distintos; referências repetidas ao mesmoID são válidas. Cada SiteResourceView dispara inspect na montagem, enquanto browser/client.ts admite no máximo64pedidos pendentes. Um site válido com128referências pode exceder esse orçamento antes de chegarem respostas. **Ainda não reproduzido**, não chamar falha confirmada nem corrigida. Foi preparado .cache/resource-inspection-budget.spec.ts fora das fontes congeladas: cria umrecurso pelaUI, importa documento válido com128referências, publica/abre pelaUI e exige128estadosdisponíveis sem erros, incluindo a obtenção do último recurso. Executar apenas depois de99912terminar, preservando o gate actual. Se confirmado, limitar trabalho automático e cancelar trabalho não iniciado sem aumentar o limiteglobal ou baixar o limite de128blocos; verificar também a troca/fecho enquanto há trabalho. Este controlo é relevante para os limites aceites do editor, não alargamento arbitrário do produto.


## Orçamento confirmado e resolvido localmente — 19 de Setembro

A primeira fixture plana foi correctamente recusada pelo limite de24irmãos. A composição válida com5grupos+123referências (128blocos,56742bytes) reproduziu59erros de orçamento, mantendo só64 disponíveis. Não se alterou o parser para aceitar a fixture inválida. Originais .cache/resource-budget-valid-before* e .cache/resource-inspection-budget-before.

ResourceInspector limita a4verificações automáticas, conserva alvos copiados, limita a fila e remove pedidos ainda não iniciados quando o leitor fecha. O cancelamento do consumidor não cancela/liberta ficticiamente a execução já enviada aoWorker; aguarda a resposta/timeout da API antes de ocupar outro slot. Obter explicitamente mantém o caminho anterior. Nenhumcache de autorização foi introduzido e cada verificação continua a passar pelo motor.

Quatro testesunitários PASS e primeiro UI Chromium123/123PASS. O testeUI ampliado fecha/reabre a página com4respostas reais retidas: nenhum novo pedido sai antes de as libertar; depois123verificações novas e obtenção final combytesexactos. Resultado Chromium: posted127,held4,peak4,zeroerros; os cinco percursos de orçamento/revisão passaram. Typecheck/buildpassaram. Firefox dirigido emexecução(handle26318), depoisWebKit; ainda sem aprovação integral. Helpersde revisão agora exigem inserção visível e versão publicada exacta; os dois casosWebKit anteriores passaram com estas confirmações, mantendo a causa histórica documentada sem atribuição injustificada àrede.
