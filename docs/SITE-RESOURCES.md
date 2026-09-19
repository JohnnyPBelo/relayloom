# Recursos opcionais de sites — implementação em curso

**Implementado localmente, ainda sem publicação:** biblioteca, leitura por referência e documento v3 estão ligados à UI. Passaram os percursos dirigidos nos três browsers e na UI Node/Go, incluindo ficheiro, tabela, privacidade, perda de pedido/resposta, autor desligado e seeder reiniciado. Idiomas EN/ES, ecrã compacto, tema escuro, movimento reduzido e foco foram exercitados. A regressão local consolidada passou:306browser,68 UI Node/Go,unitários,backend correspondente,desktopLinux eRNS. Integração/distribuição e revisão independente continuam pendentes. O HTML público não mudou.

Este incremento está na árvore `codex/site-optional-resources`. Não está integrado na versão pública. O estúdio publicado ainda não permite anexar estes recursos. O produto completo e a revisão independente continuam pendentes.

Um recurso contém um ficheiro até 2 MiB ou uma tabela declarativa (64 KiB, 256 linhas e 12 colunas). O envelope é assinado pelo criador e pode ter leitores privados ou ser público. A referência fixa o ID do envelope, autor, nome, tipo, tamanho e hash do payload canónico completo. Não é uma URL executável. HTML, SVG, JavaScript, SQL e módulos remotos não são executados pelo site.

## Criação local nos motores Node, Go e browser

O comando `resource-command` usa a mesma forma nos três motores. No daemon é um POST autenticado a `/api/resource-command`; no browser autónomo passa pelo motor local, sem pedir essa rota a um daemon.

- `{action: "state"}` devolve o registo de criação do proprietário: contador seguinte e até 128 resultados retidos, sem os bytes dos ficheiros/tabelas.
- `{action: "operation", sequence, operationId}` consulta um resultado. `retired: true` significa que já saiu da janela retida; não autoriza nova assinatura.
- `{action: "create", sequence, operationId, content, recipients, ttlMs}` valida e guarda uma intenção e a assinatura numa transacção privada antes de copiar para o armazenamento de conteúdo. `operationId` é um UUID; uma audiência privada é a lista ordenada, sem duplicados e incluindo o proprietário. Os cartões têm de existir e os leitores não podem estar bloqueados. A audiência pública usa `"public"`.
- `{action: "resume", sequence, operationId}` retoma apenas a intenção já guardada. Nunca substitui um recurso expirado por outro ID.

Todos os campos são validados. Não se aceitam propriedades adicionais. Repetir o mesmo pedido recupera o resultado; alterar payload, audiência ou prazo mantendo a operação é recusado. Um pedido novo só pode usar a sequência seguinte. Há no máximo uma cópia pendente.

A fase `copy-pending` conserva o envelope na área privada cifrada cuja chave depende da posse da chave de assinatura. Falta de espaço ou falha na cópia não perde essa assinatura. A fase `ready` só é gravada depois de reler e verificar a cópia efectivamente guardada. É o resultado histórico da criação: não promete que o recurso ainda esteja disponível após expiração, remoção ou perda do armazenamento. A fase `expired` conserva a identificação da tentativa, sem reassinar. Uma nova criação exige uma decisão explícita e outro UUID/sequência.

O motor tenta concluir uma cópia pendente no máximo uma vez a cada cinco segundos. Bloqueio de sessão invalida o runtime anterior. Bloquear um leitor suspende a cópia privada pendente; o browser verifica esse bloqueio dentro da própria transacção de cópia. O criador fixa a cópia local, dentro da quota configurada. Não há garantia de conservação por outros pares.

## Distribuição

Criar não envia o recurso. Os inventários automáticos excluem `site-resource`, e a publicação genérica/announce recusam estes envelopes. Uma consulta periódica devolve apenas metadados. Um pedido explícito por ID pode ser encaminhado através dos adaptadores e servido por um par consentido que conserve os bytes. Ler/servir uma cópia não transfere autoria. Um relay sem chave pode conservar cifra opaca; um leitor verifica assinatura, integridade, audiência e payload antes de a apresentar.

## Referências de páginas assinadas

O documento v3 acrescenta blocos `resource`, com até 32 IDs de recursos distintos, dentro do orçamento de 128 KiB e 128 blocos. O mesmo ID pode aparecer em mais de um bloco, mas os descritores têm de concordar. Tabelas v2 embutidas continuam válidas em v3; v1/v2 permanecem aceites. Clientes anteriores a v3 não interpretam estes novos documentos.

`{action: "inspect" | "obtain", snapshotId, pageId, blockId}` recebe o **ID do bundle de site (`object.id`), não o `revisionId`**. O motor autentica e desencripta esse snapshot, verifica a página/bloco e extrai a referência. Não aceita uma referência ou autor arbitrário enviado pelo cliente. `inspect` consulta a cópia local, sem pedir bytes à rede nem devolver o payload. `obtain` pode pedir o ID exacto e devolver o conteúdo depois de verificar assinatura, autor, hash, MIME, tamanho, audiência e prazo.

Estados: `available`, `missing`, `requested`, `blocked`, `unreadable`, `expired`, `invalid` e `withdrawn`. As leituras históricas usadas para diagnosticar expiração autenticam os bytes e não alimentam o cache de manifests vivos. Não devolvem dados expirados pelo comando de obtenção. Uma retirada assinada conhecida impede obter dados ou publicar uma nova referência a esse recurso. Isso não apaga cópias que outras pessoas já tenham recebido.

Uma nova publicação exige que a audiência real dos recursos cubra a audiência do site; um site público não torna público um recurso privado. A verificação acontece antes de uma nova assinatura. A repetição de uma operação já retida recupera o mesmo resultado, mesmo se os bytes do recurso se perderem entretanto. Uma página pode citar um recurso de terceiro, conservando o autor desse recurso.

## Biblioteca e leitor

Em **A minha página → Recursos**, o utilizador consulta o histórico local validado, incluindo cópias de outros autores. A biblioteca usa paginação do histórico e não se limita à janela de 128 resultados de criação. Permite criar um ficheiro ou tabela, importar CSV/JSON, pesquisar, abrir e inserir a referência no rascunho. Publicar o site continua a ser uma acção separada. O rascunho conserva referências, não inclui automaticamente os bytes opcionais.

O leitor vê o estado local e escolhe **Obter ficheiro** ou **Obter e abrir tabela**. A espera verifica a disponibilidade durante um período limitado; não provoca obtenção automática de todos os recursos. Tabelas são pesquisadas/ordenadas localmente, sem alterar a assinatura. Ficheiros usam downloads e pré-visualizações limitadas a tipos de imagem/áudio/vídeo suportados; HTML/SVG/scripts não ganham execução no site. URLs temporários são libertados ao fechar ou mudar de recurso.

As verificações automáticas de disponibilidade usam uma fila limitada, com quatro pedidos em execução, preservando capacidade para navegação e acções explícitas. Fechar ou mudar de página remove o trabalho ainda não iniciado. Um pedido já enviado conserva o seu lugar até à resposta ou ao prazo da API, mesmo se o leitor tiver fechado; cancelar apenas a promessa da interface não prova que o motor parou. Não há cache de autorização nesta fila. O limite de 128 blocos continua válido, respeitando 24 irmãos por composição e a profundidade máxima; foi verificada uma página com 123 referências em 128 blocos. [Reprodução negativa, cancelamento e dados recebidos](evidence/site-optional-resources/v3-ui/inspection-budget).

Depois de uma resposta perdida, o controlador consulta o resultado guardado. Uma repetição explícita conserva UUID, sequência e payload; não cria silenciosamente uma assinatura diferente. Reabrir a biblioteca carrega resultados reais. Se o pedido nunca chegou ao motor e o cliente foi encerrado, não existe um resultado durável a recuperar: o ficheiro deve ser seleccionado novamente por decisão do utilizador.

A UI faz uma verificação prévia antes de registar uma publicação nova, para apresentar erros de disponibilidade/privacidade sem congelar o rascunho. O backend repete as verificações de conteúdo e audiência. A recuperação de publicações já aceites não é convertida numa criação nova.

## Verificação e pendentes

A criação inicial em 96e35c1 passou o gate descrito em `evidence/site-optional-resources/creation`. O novo v3/UI tem a regressão consolidada em `evidence/site-optional-resources/v3-ui/final`, com hashes e proveniência dos gates. O primeiro arranqueElectron falhou pelo caminho de socket; a correcção e o suplemento aprovados estão separados do resultado original. Não confundir os passes da criação inicial com aprovação de toda a extensão actual.

Continuam obrigatórios os gates finais, revisão independente, integração/publicação, versões móveis actuais e validação física dos meios/plataformas. A shell iOS ainda tem limitações de exportação de ficheiros, além da falha de UI da fototeca em investigação. Estes bloqueios não retiram a paridade do contrato.

Formulários e contribuições de visitantes serão operações assinadas pelo visitante e aprovadas separadamente pelo dono. Não fazem parte da criação local de recursos agora implementada. A inspiração ZeroNet não implica compatibilidade de protocolo, scripts remotos ou alterações por quem apenas possui chaves de leitura.


Fonte deste marco local: `8faad725925149db24bae331691d691a8e7a4f1a`; hashes verificados em `docs/evidence/site-optional-resources/v3-ui/final/source-commit.json`. Ainda sem publicação do v3.
