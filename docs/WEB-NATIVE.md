# Ligação entre browsers e nós nativos

O adaptador de dados é real. A interface web autónoma já tem entrada/browser/index.html ligada ao worker; a paridadecompleta e umURLpúblico ainda não estãoentregues. Ver WEB-APPLICATION.md.

`BrowserRouter` pode entrar por WebRTC e sair por WebSocket. Node e Go recebem esse WebSocket num listener separado da API de controlo e encaminham os mesmos pacotes para TCP; Node pode continuar por serial. Os manifestos/chunks cifrados e assinados não mudam de autor quando outro dispositivo os serve.

## Convites e consentimento

A API local autenticada disponibiliza:

```http
POST /api/web-peer
Authorization: Bearer <capacidade de controlo local>
Content-Type: application/json

{"origin":"https://origem-da-aplicacao-web.example"}
```

É necessário ter a identidade desbloqueada para criar o convite. A origem é exacta, sem caminho, query ou wildcard. Um pedido inválido conserva o listener anterior. Um novo convite válido substitui/revoga o anterior. A resposta contém `version`, `endpoint`, `token`, `origin` e `expires`; o token é uma capacidade temporária de transporte, não é a chave da identidade nem a capacidade de controlo local.

```http
POST /api/web-peer-stop
Authorization: Bearer <capacidade de controlo local>
Content-Type: application/json

{}
```

A revogação encerra o listener e as ligações que lhe pertencem. Os convites duram10minutos no caminho da aplicação; expirar também encerra as sessões. Ainda não há uma relação persistente de peering nem renovação automática de credenciais. O estado normal da API mostra endereço/origem/prazo/contagem, sem revelar o token.

A aplicação cria o listener em loopback. A biblioteca de transporte aceita TLS fornecido pelo operador para WSS; WS sem TLS fora de loopback é recusado. A validação num browser real com um certificado de produção, configuração LAN/Internet e a UX de peering continuam pendentes. Nenhum certificado de raiz foi instalado e nenhum erroTLS/sandbox foi ignorado. WebRTC entre browsers continua disponível sem este listener; não há servidor central de conteúdo obrigatório.

## Framing, limites e cancelamento

O subprotocolo é `relayloom-stream-v1`; a capacidade é enviada num subprotocolo adicional `invite-<token>`, evitando colocá-la na query do URL. Origem, Host, caminho, método, prazo e capacidade são verificados antes da ligação. Há8sessões WebSocket por listener,32sockets anteriores à autenticação e quotas limitadas de tentativas. O router mantém o limite global existente de24ligações.

O adaptador leva os fragmentos NDJSON nativos:2048bytes de dados,4096caracteres por frame e uma newline de separação. Reassemblagens, filas e controlo de presença têm limites. Ping/pong/drop são consumidos no adaptador, sem virar mensagens da aplicação. Um drop retira só a reassemblagem daquele par/ID. Cancelar um envio não retira um fragmento já entregue ao SO. Em Go, o cancelamento agenda um controlo numa fila limitada; nunca faz I/O de rede sob o mutex do router.

Foi reproduzido e corrigido um caso de ACK tardio: o emissor iniciava uma retransmissão, recebia o ACK da primeira entrega e parava, deixando uma reassemblagem parcial no navegador. O browser agora recorda no máximo4096IDs aceites para o framing com repetição, até ao prazo do pacote e nunca mais de1h. Só os recorda depois de verificar e aceitar o pacote; ACKs repetidos para cada ID são espaçados em1s. Não trata esse ACK como prova criptográfica de leitura ou retenção eterna. O teste usa modo económico e um marcador na mesma ligação para demonstrar que a segunda tentativa ficou parcial, sem aumentar prazos.

## Evidência e reprodução

```sh
npm run test:browser
node scripts/verify-browser-native.mjs
```

São necessários Node22, o Go do projecto e Chromium Playwright. Os comandos compilam a UI/CLI antes dos testes que os usam; as dependências/caches ficam no projecto. O gate regista comandos, tempos, exit codes e hashes das fontes.

Já foram executados os percursos browser→WebRTC→browser→WebSocket→Node/Go e a resposta inversa. O percurso com quatro adaptadores é WebRTC→WebSocket→Go/TCP→Node/serialPTY→Node com TCP desligado. Testou conteúdo privado, recusa de leitura nos dois intermediários, partição/heal, relay desligado, autor fechado, leitor de browser recarregado e um novo intermediário Go vazio. O seeder conservou autoria e conteúdo.

WebRTC, WebSocket e TCP usam IP neste teste; não são três rádios físicos distintos. PTY é um byte stream real do SO, não um rádio. Não há prova de radiofrequência, Windows/macOS GUI, Android/iOS actuais, WSS público, Safari/Firefox ou infraestrutura de emergência validada. O relatório final do gate e as falhas anteriores devem ser consultados em `docs/evidence/browser-native` quando arquivados; os relatórios em curso ficam em `.cache/browser-native`.

A aplicação autónoma, worker/facade, domínio de grupos/outbox, media/social/sites, recarga offline/PWA e todos os restantes requisitos de paridade permanecem obrigatórios. Os limites de browser/background e a disponibilidade de hardware não desaparecem por este adaptador funcionar no host Linux.
