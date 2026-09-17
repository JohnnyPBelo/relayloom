# RelayLoom — estado verificável

## Estúdio de versões — implementado e verificado localmente

O estúdio partilhado publica versões pela UI, escolhe leitores e prazo, conserva a versão de partida e o UUID do pedido no rascunho cifrado, consulta histórico, fixa uma versão para leitura e recupera conteúdo com a audiência original. A recuperação exige pré-visualização verificada e confirmação antes de substituir o rascunho; publicar continua a exigir uma acção separada. A leitura normal acompanha versões recebidas, sem promover um payload antigo quando faltam os bytes da cabeça conhecida. Há PT-PT, inglês e espanhol, controlo por teclado, toque, mensagens de falha e tratamento de resultados incertos.

A regressão consolidada cobre 410 casos Node, Go com race, 69 testes de interoperabilidade, SQLite C, **32 UI Node + 32 UI Go**, **73 cenários por browser (219)**, nove percursos UI através de RNS, 24 testes host iOS/estática e Linux build/run/package/run. Os resultados Go efectivamente executados estão separados das passagens vindas da cache. [Relatórios, fontes, falhas e correcções](evidence/site-editor-versions).

A primeira execução Node tinha uma tradução em falta; foi corrigida e i18n/typecheck/build passaram. A fixture de um rascunho antigo sem audiência passou a escolher «Público» explicitamente e a verificar entrega/autoria, preservando o comportamento privado inicial. A contenção do WebLock no reload e a perda de foco após guardar foram reproduzidas e corrigidas, mantendo a exclusão de outro perfil vivo e os prazos dos testes. O campo de endereço demasiado estreito foi corrigido e testado em diálogo e viewport compacto.

**Fiabilidade ainda por esclarecer:** uma execução Firefox fechou a ligação após pausar o relay, embora tivesse preservado o SOS próprio e impedido a entrega do conteúdo cancelado. Cinco repetições dirigidas, o ficheiro completo e a nova matriz passaram com diagnóstico, sem alterações no transporte. A causa continua desconhecida; não marcar esta ocorrência como corrigida. A revisão independente também continua pendente.

O HTML público mantém a fonte 0c6b58a / distribuição 45ecacdf até passar o gate dos novos artefactos. Apps físicas, Apple/signing, rádios e restante contrato não são demonstrados por este gate local. Em particular, o CI 35252072691 / dc57316 falhou no reload da imagem grande (reproduzido e corrigido localmente neste marco) e na importação da fotografia iOS; os restantes nove jobs passaram. O CI anterior 35226875160 chegou ao picker e falhou a consulta AX. A nova captura XCUIScreen preparada para o picker tem validação host/static, mas ainda não execução Apple.

## Rascunhos web grandes — publicados e verificados

Corrigida a gravação de imagens válidas que excediam o índice privado de 1 MiB. Os valores cifrados passam a ter armazenamento separado, leitura legada e transacções conjuntas, sem entrar no inventário P2P. Passaram 236 execuções de testes de browser/UI, dois oráculos de endereçamento, 36 verificações Axe e build/run/package/run Linux. Incluem recuperação exacta da imagem, corrupção/ausência/troca de blobs, partição/reconexão e seeding. [Comandos, fontes e âmbito](evidence/private-values). A fonte `0c6b58a` foi publicada na distribuição `45ecacdf`: Pages passou e foram verificados 17 hashes HTTP e 13 percursos no URL público. O limite de imagens do editor não mudou.

Os certificados de revisões e o catálogo persistente Node têm código/testes locais, incluindo interrupção de processos e recuperação. [Evidência e limites](evidence/site-revisions). As APIs Node, Go e browser foram integradas nos marcos abaixo; os controlos de revisões na UI continuam pendentes. Contribuições assinadas e ficheiros opcionais continuam pendentes; o produto completo mantém-se em implementação.

## Revisões de sites — APIs Node e Go integradas

POSTsite-command cria a revisão e a preparação numa transacção real, autoriza antes de copiar/enviar, recupera pedidos e resolve endereços a partir de certificados e bytes verificados. Conflitos conhecidos exigem confirmação explícita das cabeças. Uma cabeça sem payload não promove a versão antiga. Passaram397testesNode,duas passagens de31UI Node, uma indevidamente rotulada Go ([correcção](evidence/site-ui-runtime-correction)),2percursos legados de interoperabilidade eLinuxbuild/run/package/run. [Evidência](evidence/site-api) e [guia](SITE-REVISIONS.md). A paridade Go passou o gate completo descrito abaixo. A UI de revisões foi integrada posteriormente, no marco acima; a API/persistência browser passou o marco descrito a seguir. Contribuições e ficheiros opcionais continuam pendentes.

## Revisões de sites — browser integrado e verificado localmente

O perfil browser guarda preparação e catálogo em transacções IndexedDB cifradas, com limites, autenticação, bloqueio de sessão, recuperação exacta e CAS. A API no worker publica, resolve endereço/versão e conserva histórico; a mesh recusa sites públicos inválidos e a aplicação recusa sites privados legíveis adulterados antes de aceitar/transmitir. Um relay sem chave pode continuar a servir envelopes opacos, sem obter autoria.

Passaram 17 casos dirigidos por motor (51). A regressão completa executou 65 cenários por motor; em WebKit, um teste antigo encontrou dois role=status legítimos. O selector foi limitado ao landmark do estúdio, sem mudar prazo/assertivas; esse percurso voltou a passar nos três motores. Um novo percurso com o worker compilado também passou nos três. Resultado consolidado: **66 cenários por motor, 198 distintos por motor/cenário**, com fontes de produto e assets iguais na repetição. [Relatórios, hashes, falha e comandos](evidence/browser-site-api).

Os percursos reais ligaram Browser→Browser→Node→Go e Browser→Browser→Go→Node com WebRTC/WebSocket/TCP, pausa/retoma, histórico, conteúdo privado opaco, resposta nativa e seeder único reiniciado depois de o autor sair. A identidade e os bytes foram preservados. O código público continua em 0c6b58a / distribuição45ecacdf; esta API e os futuros controlos de revisões não foram publicados no HTML. O editor com base persistente/histórico/recuperação passou a verificação local descrita no início deste documento. Hardware, revisão independente e restante contrato continuam pendentes.

## CI e camada Go mais recentes

O CI35217405129 (e4b82be) passou Node Linux/macOS/Windows, Go, UI, RNS, web autónoma e os três pacotes desktop. Apenas iOS falhou em seed-synthetic-photo, antes de validar o selector corrigido. O erro antigo de exitCode no Windows está ultrapassado nessa execução. A fonte Go 3f63f19 foi enviada; CI35226875160 terminou: apenas iOS falhou na consulta AX do picker; os restantes jobs passaram. Não é validação das alterações browser locais deste marco.

O catálogo e a API Go já retomam publicações Node e vice-versa, preservando revisão, leitores, conflitos e expiração. Passaram os pacotesGo comrace,69interop,SQLiteC,duas passagens locais de31UI Node, uma indevidamente rotulada Go ([correcção](evidence/site-ui-runtime-correction)) eLinuxbuild/run/package/run. [Provas actuais](evidence/go-site-api). A API browser está verificada no marco acima; os controlos no estúdio continuam em desenvolvimento.

## iOS — fotografia visível, selecção ainda sem passe

O CI35182599156 (fontea1b896f) passou nos outros dezjobs. Em iOS26.4.1, build/install/startup e importação da fotografia passaram; a UI navegou e guardou a mensagem privada. O selector collectionViews.cells não encontrou a fotografia, embora esteja visível. A candidata consulta células visíveis directamente e acrescenta diagnóstico limitado, sem mudar prazos/gestos/permissões.24testes dohost e estáticaPASS; execuçãoApple da candidata pendente. [Evidência actual](evidence/ios-photo-cells). As falhas anteriores de instalação/fotografia foram preservadas.

## Android ARM64 — compilado, não executado em dispositivo

APK812339a7… para arm64-v8a,16841791bytes, com ABI/ELF/alinhamento/assinatura verificados e assets iguais à variantex86_64 testada. Os artefactosx86_64 foram preservados. Não houve execuçãoARM64, acesso a rádios físicos ou mudança de protecções doSO. [Artefacto e reprodução](ANDROID-ARM64.md).

## Organização de páginas — publicada

Duplicação e ordenação implementadas no estúdio, com IDs independentes, ligações próprias remapeadas, anexos partilhados e início preservado. 64 testes de domínio, UI dirigida Node/Go/3browsers, 25asserções Android e regressão31Node+31Go/Linux passaram. A matriz completa passou 45 casos por browser (135), e o Android final passou páginas, mensagens, ficheiros, prazo, relay e perfil privado no APK exacto. A publicação64363cf da fontebfcb5fc passou17hashesHTTP e12percursosUI. A nova execução Apple permanece pendente. [Comandos e âmbito](evidence/page-organisation). A verificação publicada está em [evidência HTTPS](evidence/page-organisation/live).

## Setup e idiomas — publicação verificada

A interface inclui apresentação inicial, configuração guiada, PT-PT/en-GB/es-ES e preferências persistentes no perfil Node/Go ou no browser. Nomes, mensagens e sites conservam o conteúdo do autor. No Android, arranque/avisos nativos também seguem a língua escolhida. **Publicaçãoeff7e9b9 da fonte02188da concluída; verificação finalHTTPS concluída. iOS da fonte02188da compilou e executou startup; etapa funcional falhou na navegação. A correcção local ainda aguarda nova execuçãoApple.**

Gate geral PASS:345Node,Go/race/SQLiteC,62interop,129browser,60UI Node/Go,Linux executado/empacotado,121casos da candidata pública+2oráculos e9UI-RNS. Android APKd2dd1ab1…:57asserções de mensagens/idiomas,38SAF,15prazo,13relay e inspecção privada PASS. O autor offline e a retransmissão por terceiro foram exercitados; não é hardware de rádio. [Provas e comandos exactos](evidence/onboarding-languages) · [Guia de arranque](SETUP-LANGUAGES.md).

iOS: o CI35138345398 passouSwift/políticas/build/startup e importou a fotografia em4270ms, mas falhou na navegação para ligar o par. Selector do landmark e diagnóstico de geometria preparados;22testes do runner/static noLinux passaram, sem executar a correcção emApple. As falhas anteriores da fototeca ficam no histórico. Não há dispensa de cobertura ou declaração de produto concluído. A nova distribuição passou17hashesHTTP e os3testes existentes do estúdio no URL. A tentativa de idiomas estava parcialmente apontada a localhost; foi corrigida. Depois dos timeouts conservados, a execução final passou9UI e1percurso entre processos noHTTPS, com as fontes dos verificadores estáveis. [Falhas, âmbito corrigido e próximos controlos](evidence/onboarding-languages/live). Os marcos abaixo são históricos.

Actualizado em 2026-09-16 (Lisboa). **Produto experimental em implementação; o contrato completo não está concluído.** Não é infraestrutura validada para catástrofes. O âmbito autorizado continua em [PROJECT-BRIEF.md](../PROJECT-BRIEF.md).

## Código e verificação actual

O novo estúdio multipágina está **publicado na web**: 13 tipos de bloco, navegação entre páginas, colunas aninhadas, estilos, Markdown seguro, imagens, publicações do autor, desfazer/refazer e importação/exportação declarativa. O rascunho completo é cifrado em Node, Go e browser; os resumos não repetem os bytes das imagens. [Guia, referência ZeroNet e limites](SITE-STUDIO.md).

Fonte `11d52be`, distribuição `86cb0c3` e Pages `35087757274`, concluído com sucesso e HTTPS obrigatório. Os 17 ficheiros de execução publicados coincidem por hash e tamanho. O painel de ligação passou a confirmar o sucesso a partir do mesmo diagnóstico que apresenta.

| Verificação deste incremento | Resultado |
| --- | --- |
| Domínios Node e Go | 338 testes Node; 16 pacotes Go com race (app executada, restantes cacheados); 5 pacotes SQLite C do host |
| Interoperabilidade | 60 testes, incluindo site entre Node/Go, seeder reiniciado, autorização e corrupção |
| Matriz autónoma final | 37 casos por motor Chromium, Firefox e WebKit: 111, com build explícito e hashes dos assets estáveis |
| UI partilhada e Linux | 26 casos Node e 26 Go; build, execução, pacote e execução do pacote Linux |
| Candidata pública e Reticulum | 85 casos web e 2 oráculos; 9 percursos UI-RNS |
| URL publicado | 3 testes do estúdio e 1 entre processos Chromium/Firefox, incluindo 63 488 bytes de anexo e recuperação offline |

[Comandos, hashes e falhas corrigidas](evidence/site-studio) · [Evidência HTTPS](evidence/site-studio/live). Os resultados de domínio foram conservados apenas após comparar as fontes; os gates de UI afectados foram repetidos. A confirmação nos dois dispositivos físicos do proprietário, a revisão independente e o CI multiplataforma desta fonte continuam pendentes. Não há interoperabilidade de protocolo com ZeroNet; restantes limites mantêm-se abaixo.

## Marcos anteriores

Correcção web em `359d652`: os papéis Criar/Receber mantêm campos separados, ambas as pontas acompanham o estado real, o diagnóstico omite SDP/chaves/IP/conteúdo e convites pendentes são libertados ao fechar o diálogo, incluindo resultados tardios. Canais abertos são preservados. O código para partilhar aparece antes da resposta no ecrã compacto. Gate final: **67 casos web + 2 oráculos**, fontes/artefactos estáveis, e **9 UI-RNS** nos três motores. [Evidência e reproducer antes/depois](evidence/connectivity-media/web).

O relato dos dois dispositivos físicos ainda não foi confirmado: o IAB observado estava numa versão anterior e sem pares/contactos. Actualizar a página preservou o perfil. Publicação `eafa109…`, Pages `35033701343` concluído com sucesso e HTTPS obrigatório: 13 ficheiros de execução verificados por hash. No URL publicado passaram o percurso entre processos e os dois testes de ligação (3 casos). No IAB, recarregar manteve a versão antiga da cache offline; navegar pela página inicial activou a nova e o perfil continuou inicializado. Para actualizar, feche os separadores antigos e reabra a página inicial, conforme o guia. Não atribuir a causa física dos dois dispositivos apenas aos testes do host.

Incremento de meios no host: o catálogo RNS reconhece todas as 14 interfaces internas da referência 1.5.4, com isolamento e opt-in local adicional para Pipe. UDP/Backbone passaram integração real; KISS/AX25 passaram com PTY; Bluetooth Nordic UART Linux passou com GATT simulado e PTY. Configuração de Auto/I2P/RNode/Weave aceite não equivale a teste de hardware. A integração directa é no nó Node; RNS ainda não está embebido em todas as apps. [Matriz e uso](RETICULUM-MEDIA.md) · [Gate, fontes e falhas](evidence/connectivity-media/reticulum). Uma ocorrência BLE excedeu o prazo de heal e não se repetiu nas duas execuções seguintes; investigação ainda aberta. Bluetooth directo web e rádios físicos continuam pendentes.

Actualização de contactos/relay em `9abbf20`: os contactos verificados aparecem imediatamente nas conversas, usando o endereço DM definitivo antes do primeiro envio. A ordenação dos destinatários mantém a repetição idempotente quando se perde a resposta. **A rede → Permitir retransmissão** grava o consentimento, permite pausar e distingue autorização de ligações disponíveis. Bluetooth directo e descoberta automática continuam por implementar; a interface indica-o.

Gate desta alteração: 2 oráculos do endereço, 55 testes de browser (24 no build existente, 30 no build público e 1 entre processos), 25 UI Node e 25 Go, execução/empacotamento/execução Linux e 3 UI-RNS por engine (9), todos passados com fontes estáveis. [Evidência e falhas corrigidas](evidence/contact-relay). Não é execução em dispositivos físicos ou todos os SO.

Publicação estática `5bc5895…`, Pages `35025782233` concluído com sucesso. Os três testes no URL actualizado passaram: mensagens/anexo/recuperação entre processos, contacto persistente na lista e autorização/pausa do relay A–B–C. Os ficheiros de execução foram novamente conferidos por hash e tamanho através de HTTPS. Os parágrafos seguintes registam o lançamento anterior e não substituem os resultados desta alteração.

**Web experimental publicada:** https://johnnypbelo.github.io/relayloom/browser/index.html · [Testar em dois dispositivos](WEB-TWO-DEVICES.md). Marco de código `ff2fb60`, distribuição `ec3a3baa…` em `codex/web-pages`, Pages `34940021714` concluído com sucesso e HTTPS obrigatório. Treze ficheiros de execução verificados byte a byte depois da publicação; `.nojekyll` é apenas um marcador de build. GitHub Pages distribui código, sem backend RelayLoom para conteúdo, chaves ou sinalização.

Este incremento passou 18 UI autónomos no build existente,24 no build público e um percurso entre processos Chromium/Firefox. A regressão adicional passou25 UI Node+25 Go e build/run/package/run Linux. O mesmo percurso no URL publicado também passou: mensagens nos dois sentidos,63 488 bytes exactos de anexo,recibo de leitura e recarga offline após fechar o emissor. **Dois dispositivos físicos ainda não foram testados.** [Comandos,hashes,capturas e falhas intermédias](evidence/web-launch). O restante contrato não foi reduzido.

A versão actual inclui a web autónoma, convites de rede, Reticulum real, grupos nativos e o perfil de admissão de chaves. O incremento `f378e13` troca as operações Ed25519/X25519 do browser por `@noble/curves` 2.4.0, após reproduzir falhas intermitentes da implementação Web Crypto do WebKit deste host. Mantém os formatos de chaves, cofres e envelopes v1. AES-GCM, HKDF e SHA-256 continuam em Web Crypto.

| Gate executado | Resultado e alcance | Evidência |
| --- | --- | --- |
| Regressão integral sobre `2d4d12c`, incorporada em `335324d` | 281 Node; 16 pacotes Go com race detector; 5 pacotes SQLite C; 58 interoperabilidade; 28 Chromium; 25 UI por motor; pacote Linux executado. 457 fontes estáveis; Go/app 416,988 s dentro de 600 s | [Relatórios](evidence/group-certificate-profile) |
| Matriz f378e13: Chromium 153.0.8010.12 | 30/30 testes autónomos + 3/3 percursos UI com Reticulum, Linux | [Chromium](evidence/browser-matrix/chromium) |
| Matriz f378e13: Firefox 155.0 | 30/30 testes autónomos + 3/3 percursos UI com Reticulum, Linux | [Firefox](evidence/browser-matrix/firefox) |
| Matriz f378e13: WebKit 26.6 WPE | 30/30 testes autónomos + 3/3 percursos UI com Reticulum, Linux; existe uma observação RTC anterior ainda aberta | [WebKit](evidence/browser-matrix/webkit) |
| Regressão da interface e desktop após o incremento | 25 UI Node + 25 UI Go; build/run/package/run Linux. 42 auditorias Axe novas da matriz browser/RNS sem violações; não são revisão independente | [UI e pacote](evidence/browser-matrix/native-ui) · [Auditorias](evidence/browser-matrix/axe-manifest.json) |

Os testes de browser incluem identidade/cofre, IndexedDB cifrado, recuperação, worker, service worker sem instalar PWA, host indisponível, outbox/idempotência, seeding com autora offline, social/sites, falhas de autorização/corrupção e transportes reais. O incremento acrescenta 512 ciclos de geração/reimportação de identidades por engine, oráculos Node, o vector público RFC 7748 e operações nativas de curvas deliberadamente indisponíveis. **Certificados de grupos não equivalem à gestão completa de grupos na aplicação web.**

## Funções de produto

| Área | Implementado e exercitado | Ainda obrigatório / limites |
| --- | --- | --- |
| Identidade e privacidade | Chaves locais, cartões assinados, cofres cifrados, recuperação/exportação, verificação de autoria e recusa de chaves degeneradas. Chaves da web no worker; plaintext autorizado chega à UI | Keystore/Keychain de todos os SO, rotação/revogação completas, backup integral dos dados, ratchet/forward secrecy e auditoria independente |
| Conversas | DM, leitores fixos, texto/anexos, respostas, reacções, pesquisa local, edição/eliminação assinadas, outbox e estados de entrega/leitura/expiração | Paridade completa na web; pesquisa mais avançada e todos os percursos em dispositivos reais |
| Grupos dinâmicos Node/Go | Autoridade por épocas, convites/consentimento, saída/remoção/reentrada, detecção de forks, barreiras de admissão/outbox, replay e UI; testes de processos, reinício e falhas transaccionais | **Registo de autoridade, armazenamento reservado, CAS/fences, carriers/outbox/replay e UI dinâmica no browser ainda por integrar** |
| Grupos no browser | Leitores fixos operacionais; protocolo de certificados partilhado e verificado contra Node/Go | O verificador não activa grupos dinâmicos nem reduz o requisito de paridade |
| Anexos e voz | Bytes cifrados, ficheiros, renderização imagem/áudio/vídeo; gravação com MediaRecorder e entrada sintética nos testes | Microfones/câmaras reais, codecs/dispositivos e integração completa dos pickers/exportação de todos os SO. UI até 2 MB/anexo; conteúdo até 4 MiB |
| Social | Posts públicos/privados, seguir como preferência local, feed local verificado, comentários/reacções, guardados e colecções cifradas | Relações/followers públicos assinados, colecções partilhadas, gestão mais rica de comentários, descoberta e moderação distribuída |
| Páginas pessoais | Estúdio local multipágina com 13 blocos, composições, imagens e Markdown; rascunho cifrado, publicação assinada e leitura/seeding verificados. Gate local e verificação HTTPS concluídos | Revisão independente, toque físico, deep links externos, ficheiros opcionais e contribuições multiutilizador; não há interoperabilidade ZeroNet |
| Armazenamento | Conteúdo endereçado por hash, verificado antes de guardar/mostrar, pin/unpin, quota, TTL/evicção; leitor não adquire autoria | Orçamento global incluindo todos os metadados, escala/churn prolongado, políticas de energia/banda e cópias de segurança completas |
| Emergência | Estado da rede real, pares, alertas assinados com distinção entre autoria e exactidão, prioridade SOS e baixo consumo | Rádio/alcance/consumo reais, avaliação em campo e validação independente; sem promessa de prontidão para catástrofes |
| Notificações e moderação | Adesão explícita, avisos genéricos, bloqueio e denúncias locais, tombstones assinados | Notificações OS reais e em segundo plano, federação de denúncias; não é possível recolher todas as cópias remotas |
| Interface e acessibilidade | Liquid Glass claro/escuro, reduced-motion, responsividade, teclado, verificações Axe e revisão de capturas reais | Leitores de ecrã, dispositivos tácteis e revisão independente completa; Axe não é certificação |

O browser usa uma cache de conteúdo de 128 MiB por defeito, até 1 024 objectos e metadados privados actualmente limitados a 1 MiB. A autoridade nativa reserva 4 MiB dentro do seu orçamento próprio; o port web tem de preservar essa garantia e integrar a contabilidade, não apenas aumentar um limite. Quotas e disponibilidade não são garantias absolutas contra exaustão ou expulsão de armazenamento pelo navegador.

## Transportes

| Caminho | Estado real |
| --- | --- |
| TCP | Sockets entre processos Node/Go; controlos de partição, reinício, corrupção e acesso. LAN/WAN/NAT de produção ainda incompletos |
| Série | Adaptador e PTYs reais do sistema. **PTY não é rádio físico** |
| Reticulum | RNS 1.5.4 inalterado, com processos/identidades de transporte próprios, TCP e série PTY por router de referência. Seeding, autorização, replay e envio pela UI testados. [Detalhes/licença](RETICULUM.md) |
| WebRTC / WebSocket | Browsers reais, convites por origem/prazo/revogação, Node/Go. A autora pode ter só um par RTC; outro browser faz a passagem WS → RNS TCP → série PTY. Ambos os intermediários recusam ler a mensagem privada. [Prova](evidence/rtc-reticulum) e matriz actual acima |
| BLE, Wi-Fi Direct, LoRa/radios | Adaptação/embalagem, permissões e hardware continuam pendentes. Uma interface RNS configurável não prova execução de qualquer rádio em qualquer SO |
| WSS / descoberta / NAT | Peering durável, conectividade WAN, descoberta e caminhos equivalentes por plataforma ainda incompletos. Não existe serviço central obrigatório de conteúdo |
| Simulação | Motor separado com sementes/limites/controlos. Os seus resultados não contam como execução de transportes ou dispositivos |

Reticulum ainda não está embebido em todos os pacotes. A integração da política de trânsito RNS por instalação e a persistência de destinos pretendidos continuam pendentes. A web pode ser suspensa pelo browser/OS; instalar a PWA não desbloqueia funcionalidades exclusivas nem garante relay contínuo.

## Plataformas

| Plataforma | Evidência e bloqueios |
| --- | --- |
| Linux | Node/Go, três engines de browser, UI e execução do pacote desktop no host; não é teste de todos os instaladores/distribuições |
| Windows | Node e empacotamento Windows x64 passaram no CI35034984024 de `e4a39f0`; PTY omitido. GUI/instalador/rádios físicos e o novo estúdio ainda exigem validação própria |
| macOS | Node e empacotamento arm64 passaram no runner Apple CI35034984024 de `e4a39f0`; não prova GUI/instalador, assinatura, hardware/rádios nem o novo estúdio |
| Android | APK `136a5103…` passou 82 asserções no emulador API 36 x86_64, incluindo SAF, lifecycle, mensagens, recuperação e relay/seeding. Não herda os incrementos posteriores, não é ARM64/dispositivo físico/radio |
| iOS main | CI35034984024 de e4a39f0 passou build unsigned e testes do host, mas falhou ao preparar a fotografia: `Owned command timed out: seed-synthetic-photo`. Não atribuir ao teclado/estúdio; não há passe funcional completo. UIKit/XCTest WIP continua separado |
| iOS WIP | `codex/ios-keyboard-verification`,496788b,CI34917778173 concluído: teclado/publicação/TCP/mensagem privada confirmados; Fototeca abriu e a fotografia sintética está visível na captura. O selector `app.collectionViews.cells` não a encontrou. Anexo/resposta/retoma/relaunch ainda sem passe integral. [Falha actual](evidence/ios-keyboard-ci/attempt3). A correcção UIKit não está integrada na main |
| Safari/dispositivos | O WebKit WPE/Linux anuncia um user-agent Safari/Mac, mas não é Safari/macOS/iOS real. Dispositivos Apple, assinatura e todos os radios físicos continuam bloqueados/não verificados |

O URL experimental acima funciona sem API de daemon para os dados/identidade do browser. A visita inicial requer acesso ao código; a cache offline e o armazenamento dependem do browser. [Executar e ligar pares](WEB-APPLICATION.md).

## Observações abertas e próximos gates

Houve um fecho RTC após entrega do SOS num primeiro gate WebKit. Dez repetições isoladas, uma suite de diagnóstico e os gates finais passaram; **a causa não está estabelecida e não se afirma correcção**. [Registo](evidence/browser-matrix/known-observations.json).

Os próximos marcos incluem autoridade/armazenamento/outbox/UI de grupos web, backup/rotação/keystore, peering/WSS/NAT, orçamento global e escala, embalagem RNS, todos os dispositivos e revisão independente. O trabalho continua sequencial por instrução do proprietário; a evidência histórica de agentes reais está em [AGENTS.md](AGENTS.md).

[Histórico integral dos estados e falhas anteriores](history/STATUS-before-browser-matrix-2026-09-15.md). Os resultados históricos identificam a sua própria versão e não substituem os gates actuais.


CI anterior `35026722736`, source `4e4fcc7`, terminou com falha apenas em iOS. Node nos três hosts, Go, pacotes desktop, RNS e browser passaram. Em iOS/Xcode 26.6, o simulador 26.4.1 arrancou, a app foi compilada/instalada e o teste de arranque passou; o percurso funcional saiu 65. Capturas mostram criação de identidade, sem asserção XCTest suficiente para diagnosticar a causa. O WIP UIKit/XCTest continua local e separado deste incremento. Não equivale a execução física ou produto iOS concluído.
