# W2: encaminhamento autónomo — implementação em curso

O gate W1 da base366fontes está preservado. A próxima alteração generaliza a ligação RTC para transportar pacotes com o MESMO corpo canónico/ID/hops/TTL/prioridade do Router nativo; não introduzir um segundo formato de identidade/conteúdo incompatível. O framing da ligação é negociado por nome/protocolo RTC próprio e permanece separado do TCP/serial.

Implementar BrowserRouter com validação antes de admissão/encaminhamento, callbacks async limitados, duplicados4096, saltos12, TTL1h, retenção64/16MiB, ligações24, prioridades SOS/normal/bulk e fairness. Desactivar relay retira futuras transmissões de terceiros em TODAS as ligações e não pára mensagens próprias; bytes já entregues ao SO não podem ser retirados. Reavaliar política antes de cada fragmento e após awaits. A recepção não pode esperar pelo ACK de outro salto antes de confirmar armazenamento local, sob risco de ciclos/deadlock.

Camada BrowserMesh/Profile: armazenamento real cifrado, inventário/pedidos bounded, descoberta periódica e após ligação/restart; seeding conserva bytes/autor e exige consentimento local. A identidade e a base de dados permanecem no browser. Rotas de mensagens de grupo não ficam autorizadas pela simples posse de um bundle: a fronteira de domínio/épocas/grupos/outbox ainda tem de ser ligada em W3. Nunca activar a UI de grupo ou alegar paridade com este passo de transporte.

Controlos obrigatórios:3contextos reais A-B-C sem ligação A-C, relay B desligado impede entrega e ligado permite; partição/heal, autor fechado, leitor reiniciado/novo leitor, payload exacto/autor, TTL/hops/duplicados/recusa/corrupção, quotas de fila/armazenamento e prioridades/fairness. Testar pacotes canónicos cruzados com o router de sockets nativo; esse teste isolado não prova um adaptador WebRTC nativo. Implementar depois ponte realmente suportada entre browser e Node/Go e repetir heterogeneidade. Sem subagentes novos/retomados ou alterações a bridges/configuração externa.


## Gate de routing concluído — produto incompleto

`node scripts/verify-browser.mjs --routing` passou22Node transporte/16núcleo/12Chromium e build/typecheck,372fontes estáveis.2novos adversariais e o caminho do reporter foram depois integrados:14Chromium passaram29.652s, fontes de produção inalteradas. Ver docs/evidence/browser-routing. Rede automática entre browsers, consentimento, partição/heal e seeder reiniciado são reais; os2routers TCP provam formato wire comum, não ponte de transporte. A aplicação autónoma/UI/grupos/outbox e toda a matriz de paridade continuam em implementação. Uma falha de abertura RTC em15s não tem causa confirmada apesar dos passes posteriores.


## Integração nativa e gate concluídos — 2026-09-14

WebSocket Node/Go real e ponteRTC/WS/TCP/serialPTY executados com autorização, origem, expiração, revogação, relaysopacos, partição/heal e seeder reiniciado.271Node/89Go de topo-race passaram (2helpers omitidos). Após fixtureAxe e correcção reproduzida de ACKtardio,18browser/21UI por motor/desktopLinux passaram com385fontes estáveis e66Axe sem violações. Prefixo nativo e delta browser provados porhashes, sem repetir testes nativos cujas fontes não mudaram. Comandos/tempos/falhas em docs/evidence/browser-native. Nenhum commit/push, fonteglobal continua incompleta.

Pendente: UIweb seminstalação/facade/worker/domínio completo, peering durável e caminhosforaLoopback, orçamento global/admissão sob carga, C2/C3 adversarial/SQLite/interoperabilidade/Windows, plataformas/hardware/revisão. ISC do coder/websocket confirmada na licença real.
