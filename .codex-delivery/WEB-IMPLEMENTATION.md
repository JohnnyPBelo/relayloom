# Aplicação web autónoma — extensão autorizada em 2026-09-13

Objectivo adicional, sem substituir C2/C3 nem os restantes requisitos: abrir um URL sem instalar nada e ter todas as funcionalidades de produto das aplicações nativas. A actual apps/web é cliente de um daemon e não satisfaz este requisito. Não há aprovação implícita para retirar funcionalidades por serem difíceis no browser.

## Sequência de implementação

- W1: contrato, protocolo comum independente de Node, Ed25519/X25519/HKDF/AES-GCM Web Crypto, cofre v1 compatível via scrypt mantido, IndexedDB cifrado transaccional e limitado. Testar num Chromium real e cruzar identidades/cofres/bundles com Node/Go, com negativos de corrupção, autoria, leitura e persistência.
- W2: ligações WebRTC DataChannel com sinalização explícita sem servidor obrigatório; fragmentação, backpressure, limites/TTL e recepção verificada. Testes de dois/três contextos realmente separados, partição/heal, seeder offline e consentimento. Adaptador equivalente Node/Go e ponte heterogénea continuam gates obrigatórios.
- W3: motor no worker, facade de operações partilhada com a interface Liquid Glass, outbox/admissão/grupos/carriers completos, social/media/sites, import/export e recuperação. Sem falsa API de sucesso, sem controlos activos sem implementação.
- W4: arranque estático por HTTPS, assets locais e service worker para recarga offline, actualização segura/versionada, PWA opcional. Uma visita inicial ainda requer acesso à distribuição do código; replicação de conteúdo nunca exige esse host.
- W5: paridade por funcionalidade em Chromium/Firefox/WebKit e dispositivos disponíveis, E2E/UI/a11y/negativos/revisão independente, quotas/expulsão/aba concorrente/crash, interoperabilidade e plataformas. Não equiparar WebKit Playwright a Safari/iOS testado.

## Fronteiras de confiança

O modo daemon conserva chaves no núcleo nativo. O modo autónomo gera/utiliza chaves no navegador, persiste apenas cofre cifrado e dados privados cifrados, e perde referências às chaves quando bloqueado. Um worker reduz exposição acidental e trabalho na UI, mas não isola de código malicioso da mesma origem. Código servido, extensões, XSS e actualizações da origem são parte do modelo de ameaça. Não prometer apagamento verificável da memória JS nem protecção contra origem comprometida.

Não há TCP/UDP bruto em páginas web normais. WebRTC não é acesso directo a BLE/Wi-Fi Direct/LoRa; um par consentido que disponha de adaptadores nativos pode ligar media, sem ser obrigatório para mensagens entre browsers num caminho permitido. NAT pode exigir STUN/TURN escolhido pelo utilizador; sem serviço escondido ou obrigatório. O separador pode ser suspenso e um service worker não é um daemon perpétuo. Web Serial/Bluetooth não são uniformes. A matriz tem de conservar estes bloqueios até existir alternativa comprovada.

## Validação e estado

Núcleo W1 e ligação W2 implementados e gate concluído: `node scripts/verify-browser.mjs` passou typecheck4.665s/build1.720s/16Node3.420s/6Chromium15.215s,366fontes estáveis. Evidência em docs/evidence/browser-foundation. Isto não entrega a aplicação autónoma nem routing/grupos/UI: W2–W5 continuam por integrar. C2/C3 e replay continuam locais sobre526d75a. Último gate herdado:21 E2E por daemon e desktop Linux, não browser autónomo. Recuperação sequencial: sem agentes novos/retomados, sem alterar modelos/bridges/serviços. Manter15GiB livres e fontes estáveis durante gates.


## Gate de routing concluído — produto incompleto

`node scripts/verify-browser.mjs --routing` passou22Node transporte/16núcleo/12Chromium e build/typecheck,372fontes estáveis.2novos adversariais e o caminho do reporter foram depois integrados:14Chromium passaram29.652s, fontes de produção inalteradas. Ver docs/evidence/browser-routing. Rede automática entre browsers, consentimento, partição/heal e seeder reiniciado são reais; os2routers TCP provam formato wire comum, não ponte de transporte. A aplicação autónoma/UI/grupos/outbox e toda a matriz de paridade continuam em implementação. Uma falha de abertura RTC em15s não tem causa confirmada apesar dos passes posteriores.


## Integração nativa e gate concluídos — 2026-09-14

WebSocket Node/Go real e ponteRTC/WS/TCP/serialPTY executados com autorização, origem, expiração, revogação, relaysopacos, partição/heal e seeder reiniciado.271Node/89Go de topo-race passaram (2helpers omitidos). Após fixtureAxe e correcção reproduzida de ACKtardio,18browser/21UI por motor/desktopLinux passaram com385fontes estáveis e66Axe sem violações. Prefixo nativo e delta browser provados porhashes, sem repetir testes nativos cujas fontes não mudaram. Comandos/tempos/falhas em docs/evidence/browser-native. Nenhum commit/push, fonteglobal continua incompleta.

Pendente: UIweb seminstalação/facade/worker/domínio completo, peering durável e caminhosforaLoopback, orçamento global/admissão sob carga, C2/C3 adversarial/SQLite/interoperabilidade/Windows, plataformas/hardware/revisão. ISC do coder/websocket confirmada na licença real.


## Marco da aplicação autónoma verificado

`node scripts/verify-autonomous.mjs` terminou0:271Node/26browser/21UI pormotor/desktopLinuxbuild+run+package+run,403fontesestáveis,72Axe semviolações. Evidência docs/evidence/browser-application. SemAPIde daemon no cliente/browser/index.html; worker/IndexedDB/RTC/WS/SW reais. FonteGo não mudou desdepasse89race anterior. Gruposdinâmicos e toda arestanteparidade/gates dehardware/revisão continuam obrigatórios. Previewestáticolocal4174activosessão49020; nenhumcommit/pushnovo.
