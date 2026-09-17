# Estúdio de sites

Incremento de 16 de Setembro de 2026 validado no host. O produto completo e a paridade física de plataformas continuam abertos em [STATUS](STATUS.md). Já está disponível em https://johnnypbelo.github.io/relayloom/ ; 17 ficheiros verificados por hash e 4 testes no URL real passaram. [Evidência](evidence/site-studio/live).

## Criar e publicar

Em **A minha página**, escolha **Modelos** para começar com um caderno editorial, portefólio visual ou espaço de comunidade. Cada modelo tem duas páginas editáveis. Em **Páginas**, acrescente páginas, altere o nome/endereço e escolha a inicial. Uma página ligada a partir de outra não pode ser eliminada enquanto mantiver essas referências.

A paleta dispõe de 13 blocos: capa, texto, ligação, destaque, título, citação, botão, imagem, galeria, separador, espaço, colunas e publicações. Pode aninhar composições, arrastar blocos, duplicá-los e movê-los com as setas. Nas propriedades do bloco, **Mover para composição** também permite alterar a hierarquia por teclado/toque. Os separadores de ferramentas aceitam as setas esquerda/direita, Home e End.

**Estilo** permite escolher tipografia, largura, cantos e cor de detalhe; cada bloco tem alinhamento, espaçamento e fundo. **Pré-visualizar** apresenta o mesmo renderer usado pelos leitores, com navegação interna e largura móvel. As imagens são incluídas no site e podem ser reutilizadas em várias páginas, com descrições alternativas.

**Guardar rascunho** conserva o projecto cifrado neste dispositivo. **Publicar página** usa os leitores e o prazo escolhidos nas opções, guarda a intenção e cria uma revisão assinada. O endereço permanece estável. **Ver histórico** permite ler uma versão fixa ou voltar à versão actual conhecida. **Usar como rascunho** recupera uma versão após pré-visualização verificada e confirmação; conserva os leitores originais e não publica automaticamente. Alterações concorrentes exigem comparação e escolha explícita. O fluxo está [publicado e verificado no HTTPS](evidence/site-editor-versions/live).

**Avançado** exporta/importa um projecto declarativo JSON, incluindo páginas, estilos e imagens. A importação é validada antes de substituir a composição. Não importa um site HTML/JavaScript arbitrário. Desfazer/refazer funciona enquanto o estúdio permanece montado, com até 40 estados e orçamento de 8 MiB de JSON UTF-8 para o histórico passado (a memória real inclui estruturas e imagens descodificadas); o projecto guardado não inclui esse histórico.

## Liberdade e limites efectivos

| Recurso | Limite/semântica actual |
| --- | --- |
| Páginas | 1–12; IDs e endereços internos únicos |
| Blocos | 128 no site, 24 por lista, 3 níveis de profundidade |
| Documento | 128 KiB de JSON canónico, além dos anexos |
| Imagens | 4, até 2 MiB de bytes descodificados no total; PNG/JPEG/WebP/GIF |
| Texto | 120 caracteres por título de bloco e 4 000 por corpo; texto simples ou subconjunto Markdown |
| Ligações | Páginas internas existentes ou HTTPS; sem credenciais embutidas |
| Estilos | Opções enumeradas e cor hexadecimal; nenhum CSS livre |
| Publicações | Até 12 entradas do próprio autor, já verificadas e autorizadas neste dispositivo; edições respeitadas, eliminadas omitidas |
| Execução | Sem scripts, HTML executável, SQL livre, imagens remotas Markdown ou módulos carregados pelos sites |

Os endereços de página (`slug`) são metadados para organização; a navegação actual usa IDs internos. Não há ainda deep links externos para páginas, directório global ou abertura automática de sites por hash. A exportação JSON transporta um projecto editável; republicá-lo com outra identidade cria uma obra assinada por essa identidade, não altera a assinatura original.

## O que foi aproveitado do ZeroNet

Foi consultado o projecto original [HelloZeroNet/ZeroNet](https://github.com/HelloZeroNet/ZeroNet/tree/py3): README, `src/Content/ContentManager.py` e `src/Site/SiteStorage.py`. Referência observada: árvore `454c0b2e7e000fda7000cba49027541fbf327b96`; blobs README `d8e36a717add9a1bd95bed719a02d48e9b419708`, ContentManager `27da402b02a58ea7d71360a194b96a15f6b5c43b`, SiteStorage `c12a80b0a8b0e523940cd4445c884dddd10db1f2`.

| Princípio observado | Adaptação RelayLoom |
| --- | --- |
| Manifesto assinado e ficheiros verificados | O documento e as imagens entram no bundle RelayLoom, com manifesto assinado, chunks cifrados e hashes verificados |
| Visitantes distribuem conteúdo | Abrir um site invoca a leitura verificada; um leitor capaz e consentido pode servir a mesma publicação a novos pares |
| Dados sincronizados com índices locais | O bloco de publicações usa a projecção local dos posts autorizados; não executa consultas fornecidas pelo autor do site |
| Regras para contribuidores | Não implementadas nos sites desta etapa. Só a chave de assinatura original confere autoria; leitura/seeding não conferem edição |
| Sites com várias páginas | Documento declarativo versionado com navegação e composições; não executa aplicações ZeroNet |

Não foi instalado nem copiado o daemon ZeroNet. Não há interoperabilidade de protocolo/formato com ZeroNet, nem se adoptaram promessas absolutas de disponibilidade ou anonimato. As imagens seguem actualmente no mesmo bundle do site: não existem ficheiros opcionais P2P descarregados individualmente. A API de anexos evita repetir bytes nos resumos da UI, mas não é uma implementação de transferência parcial do site.

## Armazenamento e autoridade

Node, Go e web validam o mesmo contrato. Node/Go partilham vectores positivos/negativos, incluindo campos executáveis, ligações inválidas, ciclos/referências, profundidade, contagens e tamanhos. O renderer valida novamente o documento que recebe da operação de leitura verificada. Os clientes antigos conservam um excerto declarativo da página inicial; não conseguem editar a composição completa.

O rascunho e os seus anexos usam a persistência cifrada existente: SQLite nos nós e IndexedDB na web. O estado periódico contém metadados de imagens sem bytes; `site-draft-load` devolve o projecto completo apenas com a identidade desbloqueada e controlo local autorizado. Bloquear retira o documento da UI; sair e regressar à área preserva alterações ainda em memória enquanto a identidade continuar aberta.

Um leitor não pode falsificar o autor, editar ou eliminar a publicação original. Disponibilidade depende dos pares e das políticas de quota/expulsão; abrir não garante conservação indefinida. A réplica pública continua pública. Não é possível recolher cópias que outros pares já guardaram.

## Verificação reproduzível

Gate sequencial completo desta etapa: `node scripts/verify-site-studio.mjs`. Estado corrente, comandos, tempos e hashes ficam em `.cache/site-studio/final/report.json`; não converter RUNNING em PASS. O gate verifica fontes estáveis e a reserva de 15 GiB livres.

Gate final local concluído: 338 testes Node; 16 pacotes Go com race (app executada, restantes cacheados); 5 pacotes SQLite C do host; 60 testes de interoperabilidade; 37 casos por motor Chromium/Firefox/WebKit (111); 26 UI Node e 26 UI Go; build/execução/pacote/execução Linux; 85 casos do gate web público e 2 oráculos; 9 percursos UI-RNS. [Relatórios e proveniência](evidence/site-studio). As tentativas falhadas foram preservadas; o follow-up final começa por build e verifica hashes dos assets durante a matriz. Os testes de domínio só foram conservados porque os respectivos inputs não mudaram.

Controlos dirigidos já concluídos: esquema TypeScript/Go; dois percursos Node→Go→Node e Go→Node→Go; estúdio autónomo com três identidades e RTC; drag/drop aninhado e teclado; interface sobre Node/Go com publicação editada e imagem descodificada. O teste entre processos prova origem terminada e porta recusada, ausência sem caminho, pausa do seeder, recuperação do consentimento, corrupção no armazenamento e bytes idênticos recebidos por um novo leitor.

Na sincronização automática por inventário, tanto o seeder como o novo nó receptor autorizam a participação em A rede. O teste de três browsers mantém o seeder em pausa, comprova ausência, activa-o e só então obtém o site com a autora já fechada.

As capturas e verificações Axe são testes automatizados no Linux. WebKit/Linux não é Safari/iOS; viewport móvel não é toque físico. Revisão independente deste incremento permanece pendente durante a recuperação sequencial pedida pelo proprietário. Rádios físicos, apps assinadas e o relato nos dois dispositivos pessoais continuam fora da evidência destes testes.


## Duplicar e ordenar páginas

Os controlos na página seleccionada permitem duplicar a composição completa e mover a página na navegação. A cópia recebe IDs e slug próprios; adapta ligações a si mesma e conserva ligações às outras páginas e referências às imagens. O início permanece na página escolhida, independentemente da ordem. Desfazer/refazer e gravação cifrada continuam disponíveis; os botões respeitam os limites e têm alternativa por teclado/toque.

Publicação64363cf da fontebfcb5fc verificada em17assets e12percursosHTTPS, além de135browsers,62UI Node/Go e Android. [Provas](evidence/page-organisation). Endereços estáveis/revisões, contribuições e ficheiros opcionais continuam pendentes.


## Correcção de rascunhos grandes publicada

O limite de 2 MiB de imagens do editor não mudou. A versão web anterior guardava o rascunho dentro de um índice privado de 1 MiB; uma imagem permitida pelo editor podia por isso falhar ao guardar. A candidata usa valores privados cifrados separados, até 8 MiB por valor e 32 MiB no total cifrado, mantém leitura de perfis anteriores e grava índice/valor numa só transacção. Os blobs privados não entram no inventário nem podem ser pedidos como bundles. O teste UI recarrega/desbloqueia o perfil e compara a imagem e o projecto exactos. A recuperação de erros não repõe valores vazios silenciosamente. Passaram 236 testes de browser/UI, dois oráculos de endereçamento e os gates Linux; [evidência e âmbito](evidence/private-values). Publicação da fonte `0c6b58a` verificada em 17 hashes HTTP e 13 percursos no URL público.


A aplicação Node dispõe agora de uma [API de revisões](SITE-REVISIONS.md), ainda sem controlos no estúdio partilhado. Os testes de API/transporte não substituem a UI de revisões nem as APIs Go/browser pendentes.
