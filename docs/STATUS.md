# RelayLoom — estado verificável

Actualizado em 2026-09-15. **Produto experimental em implementação; o contrato completo não está concluído.** Não é infraestrutura validada para catástrofes. O âmbito autorizado continua em [PROJECT-BRIEF.md](../PROJECT-BRIEF.md).

## Código e verificação actual

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
| Páginas pessoais | Blocos declarativos assinados, temas, drag/drop e alternativas por teclado, rascunho cifrado, publicar/ler offline de outro seeder; sem scripts/HTML arbitrários | Mais templates/blocos/media e testes tácteis reais |
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
| Windows | Node e empacotamento Windows x64 passaram no CI34916793582 de `f378e13`; PTY omitido. GUI/instalador/rádios físicos e o incremento público ff2fb60 ainda exigem validação própria |
| macOS | Node e empacotamento arm64 passaram no runner Apple CI34916793582 de `f378e13`; não prova GUI/instalador, assinatura ou hardware/rádios locais nem o incremento público posterior |
| Android | APK `136a5103…` passou 82 asserções no emulador API 36 x86_64, incluindo SAF, lifecycle, mensagens, recuperação e relay/seeding. Não herda os incrementos posteriores, não é ARM64/dispositivo físico/radio |
| iOS main | CI34916793582 de f378e13 compilou/arrancou; o fluxo funcional conserva a falha de fecho do teclado. O código UIKit WIP continua separado |
| iOS WIP | `codex/ios-keyboard-verification`,496788b,CI34917778173 concluído: teclado/publicação/TCP/mensagem privada confirmados; Fototeca abriu e a fotografia sintética está visível na captura. O selector `app.collectionViews.cells` não a encontrou. Anexo/resposta/retoma/relaunch ainda sem passe integral. [Falha actual](evidence/ios-keyboard-ci/attempt3). A correcção UIKit não está integrada na main |
| Safari/dispositivos | O WebKit WPE/Linux anuncia um user-agent Safari/Mac, mas não é Safari/macOS/iOS real. Dispositivos Apple, assinatura e todos os radios físicos continuam bloqueados/não verificados |

O URL experimental acima funciona sem API de daemon para os dados/identidade do browser. A visita inicial requer acesso ao código; a cache offline e o armazenamento dependem do browser. [Executar e ligar pares](WEB-APPLICATION.md).

## Observações abertas e próximos gates

Houve um fecho RTC após entrega do SOS num primeiro gate WebKit. Dez repetições isoladas, uma suite de diagnóstico e os gates finais passaram; **a causa não está estabelecida e não se afirma correcção**. [Registo](evidence/browser-matrix/known-observations.json).

Os próximos marcos incluem autoridade/armazenamento/outbox/UI de grupos web, backup/rotação/keystore, peering/WSS/NAT, orçamento global e escala, embalagem RNS, todos os dispositivos e revisão independente. O trabalho continua sequencial por instrução do proprietário; a evidência histórica de agentes reais está em [AGENTS.md](AGENTS.md).

[Histórico integral dos estados e falhas anteriores](history/STATUS-before-browser-matrix-2026-09-15.md). Os resultados históricos identificam a sua própria versão e não substituem os gates actuais.
