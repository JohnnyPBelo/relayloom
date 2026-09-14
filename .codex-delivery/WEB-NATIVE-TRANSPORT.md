# Adaptador browser ↔ nativo — implementação em curso

W2 continua após os14testes Chromium e38Node verificados. Usar WebSocket como portador adicional, sem servidor central obrigatório: o browser conserva identidade/armazenamento e mantém WebRTC directo; um par nativo consentido pode ligar WebSocket a TCP/serial. Não alterar bridges/providers/serviços externos ou a API de controlo local.

## Fronteiras

- Subprotocolo `relayloom-stream-v1`: mesmos pacotes e fragmentos NDJSON2048bytes dos routers nativos; ping/pong/drop consumidos só no adaptador WS. Drop cancela reassemblagem parcial sem retirar outros envios. Cap/control budget bounded; controlos usam uma fila finita e nunca bloqueiam sob o mutex do router Go.
- Listener opcional, porta separada da API, convite temporário de256bits em subprotocolo adicional (não query string), origem HTTP(S) exacta, sessão revogável, máximo8ligações WS e24ligações globais. Convite não é identidade nem autorização de controlo/edição/leitura. API local conserva capability e Origin/CSP actuais.
- WS sem TLS apenas em loopback para desenvolvimento/mesmo dispositivo; WSS fora de loopback requer certificado válido fornecido explicitamente. Não instalar certificados de raiz nem ignorar errosTLS. Arranque LAN/Internet real continua bloqueado sem o caminho/certificado apropriado.
- Dependências mantidas e fixadas: ws8.21.3(MIT), tipos8.18.1, coder/websocketv1.8.15(ISC). Caches apenas no projecto. Sem scripts remotos de instalação.
- Separar abstração de ligação do BrowserRouter para permitir RTC/WS e futuro broker de bytes cifrados no Window com motor em worker; não assumir RTC no worker.

## Prova exigida

NavegadorA → navegadorB(WebRTC) → Node(WebSocket) → Go(TCP e variante serialPTY), processos/clientes reais, sem backend a executar o motor do browser. Confirmar caminhos por controlos negativos/positivos, conteúdo privado/autoria, partição/heal, autor offline/leitorseeder e retoma; consentimento, origem/token/expiração/revogação, limites/frame/bytes/corrupção e cancelamento com SOS próprio. Validar Node/Go e UI existente após alterações; nunca equivaler PTY a rádio nem loopback a Internet/mais browsers. Grupos/outbox/worker/UI/PWA autónomos e C2/C3 anteriores continuam pendentes.


## Validação dirigida e gate activo

Dois percursos browser↔Node/Go passaram7.4s. Rota privada com4adaptadores e processos reais passou12.3s: controlo negativo da partição e relay-off,62.400bytes apósheal, autor fechado, leitor recarregado, bridge nova vazia, autoria conservada;2intermediários não decifram. Dados em .cache/browser-native. Go2testes/race2.021s após corrigir dupla contagem de pending, Node2testes1.313s. O controlo do5.ºcliente falhou antes da correcção; limite de8mantido. Teste de ciclo de vida API e antiga regressão TestApplicationMessagesGroupsReceiptsAndPrivacy passaramrace3.259s.

`node scripts/verify-browser-native.mjs` está na sessão55051 com385fontes congeladas. Não editar fontes até recolher resultado. Não é gate completo do produto, dispositivos/radios nem equivalência dos testesdeUI com aplicação autónoma. Os controlos UI do novo estado e o executável empacotado ainda estão por executar neste gate.

## Revisão durante o gate — hipótese a reproduzir antes de fechar

NativeLink retransmite em2s; se o browser demora a confirmar a primeira recepção, a nova tentativa pode já ter começado quando o ACK chega. O emissor retira a tentativa após esse ACK. Node/Go evitam uma reassemblagem órfã porque reconhecem o ID recebido logo em cada fragmento. RtcMessageChannel no browser ainda só delega duplicados no router após reunir o pacote todo: os poucos fragmentos da tentativa interrompida podem expirar15s e fechar uma ligação válida.

Isto é uma hipótese sustentada na leitura, ainda NÃO reproduzida. Deixar55051 acabar sem editar fontes. Depois acrescentar um teste real de WS com callback de armazenamento atrasado até ao início observado da retransmissão, mantendo deadlines e verificando ligação/utilidade após15s. Se reproduzir, introduzir memória limitada de IDs já verificados/concluídos para o framing nativo, com prazo/ACK limitados; nunca marcar como concluído antes de validação e aceitação. Repetir browser/interop afectado antes de publicar, sem alterar os prazos para ocultar o caso.


## Integração nativa e gate concluídos — 2026-09-14

WebSocket Node/Go real e ponteRTC/WS/TCP/serialPTY executados com autorização, origem, expiração, revogação, relaysopacos, partição/heal e seeder reiniciado.271Node/89Go de topo-race passaram (2helpers omitidos). Após fixtureAxe e correcção reproduzida de ACKtardio,18browser/21UI por motor/desktopLinux passaram com385fontes estáveis e66Axe sem violações. Prefixo nativo e delta browser provados porhashes, sem repetir testes nativos cujas fontes não mudaram. Comandos/tempos/falhas em docs/evidence/browser-native. Nenhum commit/push, fonteglobal continua incompleta.

Pendente: UIweb seminstalação/facade/worker/domínio completo, peering durável e caminhosforaLoopback, orçamento global/admissão sob carga, C2/C3 adversarial/SQLite/interoperabilidade/Windows, plataformas/hardware/revisão. ISC do coder/websocket confirmada na licença real.
