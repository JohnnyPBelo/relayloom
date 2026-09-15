# RelayLoom

Um mensageiro cifrado entre pares, uma rede social e páginas pessoais feitas com blocos declarativos. A mesma interface Liquid Glass serve as aplicações instaladas e a versão web autónoma.

**Experimental, em implementação. O produto não está concluído nem validado para catástrofes.** O contrato integral está em [PROJECT-BRIEF.md](PROJECT-BRIEF.md); funções, plataformas, falhas e pendentes estão em [STATUS](docs/STATUS.md).

![Conversa real na versão web, através de pares e Reticulum](docs/evidence/browser-matrix/webkit/rns/through-browser/web-sender.png)

A captura vem de um teste real: a autora tinha apenas outro navegador como par; a rota continuava por WebSocket, Reticulum TCP e série PTY. O intermediário não conseguia ler a mensagem. PTY não é rádio físico.

## Usar a web sem instalar a aplicação

A entrada `/browser/index.html` possui identidade, cofre, worker e armazenamento IndexedDB cifrado próprios. Não usa a API de um daemon para guardar dados ou assinar mensagens. A instalação PWA é opcional e não desbloqueia funcionalidades exclusivas.

Para servir os ficheiros localmente:

```sh
npm ci --ignore-scripts --cache .cache/npm
npm run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort
```

Abra `http://127.0.0.1:4174/browser/index.html`. O processo distribui apenas o código. Ainda não foi publicado um URL de produção; uma distribuição por URL precisa de servir os ficheiros estáticos por HTTPS.

Em **A rede → Ligar um par**, troque os códigos de ligação com outro navegador. Também pode obter um convite em **A rede → Ligar um par → Usar a versão web neste dispositivo** na app instalada. Depois escolhe a pessoa e envia normalmente; o meio não é escolhido em cada mensagem.

Mensagens/outbox, leitores fixos, social, colecções, páginas e recuperação têm percursos funcionais. **A autoridade, persistência/outbox e UI dos grupos dinâmicos ainda não estão integradas no browser.** Toda a paridade nativa continua obrigatória. [Uso e limites da web](docs/WEB-APPLICATION.md).

## Executar um nó Node

Requer Node.js 22.13+; os testes actuais usam Node 22 e Go 1.26.8.

```sh
npm run build
npm run dev -- --data .runtime/alice --http-port 4173
```

Abra o URL completo impresso. O fragmento contém a capacidade privada de controlo da interface local; **não partilhe esse URL**. A API escuta apenas em `127.0.0.1` e os dados de execução ficam privados no projecto.

Para outro par:

```sh
npm run dev -- --data .runtime/bruno --http-port 4175
```

Crie as identidades. Copie os cartões públicos em **Definições** e adicione os contactos. Em **A rede → Ligar um par**, use o endereço e a porta de transporte do outro nó. Numa LAN, o listener pode ser configurado explicitamente com `--tcp-host 0.0.0.0 --tcp-port 4242`; a API de controlo permanece local e autenticada. Sem um caminho alcançável, a entrega fica pendente.

## Aplicações instaladas

O desktop executa o seu próprio nó, sem serviço externo obrigatório. Neste Linux, o percurso X11 foi executado:

```sh
ELECTRON_CACHE="$PWD/.cache/electron" node node_modules/electron/install.js
npm run desktop:build
npm run desktop -- --x11
```

[Desktop e pacotes](docs/DESKTOP.md) · [Android](docs/ANDROID.md) · [iOS](docs/IOS.md) · [Núcleo Go](docs/NATIVE-INTEGRATION.md).

Para executar o nó Go no host:

```sh
npm run native:build
.cache/native-app/relayloom --data .runtime/go-alice --http-port 4176 --assets dist/web
```

O arranque imprime a origem e o token de controlo local. Os pacotes Windows/macOS passaram em CI, mas isso não prova execução da GUI, assinatura ou dispositivos. O APK Android anterior tem testes num emulador; não herda automaticamente as alterações seguintes. O iOS ainda tem um bloqueio no percurso funcional do teclado; existe uma correcção em ramo WIP, sem passe funcional antecipado. [Matriz exacta](docs/STATUS.md#plataformas).

## Transportes e propriedade

TCP, série, WebRTC, WebSocket e o adaptador da implementação real Reticulum/RNS transportam envelopes verificados. As rotas podem atravessar vários adaptadores. Foram exercitados partição/heal, pausa consentida, cópias servidas após desligar a autora, reinício do seeder, corrupção e acesso indevido.

O leitor pode guardar e semear a cópia; editar exige a chave de assinatura da autora. Chaves de leitura e convites de transporte não concedem autoria ou controlo da aplicação. Não há servidor central obrigatório de conteúdo, fontes remotas ou telemetria de execução. Apagar não recolhe as cópias detidas por outros pares.

[Reticulum, licença e limites](docs/RETICULUM.md) · [Prova RTC → browser → WS → RNS → PTY](docs/evidence/rtc-reticulum). Rádios físicos, peering durável, WSS/WAN/NAT e embalagem RNS em todos os SO continuam pendentes.

## Verificar

```sh
npm run build
npm test
npm run test:browser
node scripts/verify-ui.mjs
```

As dependências dos browsers ficam no projecto:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" node node_modules/playwright/cli.js install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" node node_modules/playwright/cli.js install firefox
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" node node_modules/playwright/cli.js install webkit
node scripts/verify-browser-matrix.mjs chromium
node scripts/verify-browser-matrix.mjs firefox
node scripts/verify-browser-matrix.mjs webkit
```

O WebKit deste host precisou de bibliotecas de teste locais verificadas. `python3 scripts/webkit-host-deps.py` prepara-as sem instalar pacotes no SO; o lock é específico de Ubuntu resolute/glibc 2.43. Noutro ambiente, os requisitos têm de ser verificados. Preserve pelo menos 15 GiB livres e execute os builds/gates pesados em sequência.

O incremento actual passou **30 testes por engine (90), três UI-RNS por engine (nove), 25 UI Node e 25 UI Go, e execução do pacote Linux**. O gate integral anterior passou 281 Node, Go/race, SQLite C e 58 testes de interoperabilidade. [Comandos, hashes, capturas e limites](docs/evidence/browser-matrix).

Uma observação de fecho RTC no WebKit ainda não tem causa estabelecida; os gates seguintes passaram, mas não se afirma correcção. [Observações abertas](docs/evidence/browser-matrix/known-observations.json).

## Segurança e continuidade

Ed25519 assina cartões e manifestos; X25519/HKDF/AES-GCM protege as chaves de leitura e conteúdos. O browser usa bibliotecas Noble mantidas para as curvas e Web Crypto para AES/HKDF/SHA; preserva os formatos Node/Go. Cofres usam scrypt/AES-GCM. A recusa de chaves degeneradas tem controlos nos três núcleos. Não há ratchet/forward secrecy, anonimato perfeito ou auditoria criptográfica externa declarada.

Estado e chaves desbloqueadas existem em memória; armazenamento pode ser expulso pelo browser. Notificações, segundo plano, hardware, rotação e keystores têm limitações explícitas. Os sites executam apenas blocos seguros, sem HTML ou scripts arbitrários.

[Arquitectura e ameaças](docs/ARCHITECTURE.md) · [Dependências/licenças](docs/DEPENDENCIES.md) · [Agentes e revisões reais](docs/AGENTS.md) · [Retoma e tarefas pendentes](.codex-delivery/RESUME.md).
