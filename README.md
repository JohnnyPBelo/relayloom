# RelayLoom

**Reticulum real, verificado no host Linux:** o adaptador usa RNS1.5.4 sem alterações e transporta envelopes RelayLoom por TCP e série por PTY, com origens Node e Go. Passaram partição/heal, pausa, seeder reiniciado com autora offline, corrupção/autorização e envio pela UI sem escolha do meio. A regressão inclui279 Node,177 Go de topo com race detector,58 interoperabilidade,46 UI gerais,70 auditorias Axe e execução do pacote Linux; o percurso UI RNS acrescenta duas auditorias. [Implementação, comandos e limites](docs/RETICULUM.md). PTY não é rádio físico; embalagem RNS e paridade web continuam pendentes.

**Estado actual:** WebSocket Node/Go publicado em `b15b6e6` após regressão de transporte, interoperabilidade, UI e desktop Linux. A integração real do Reticulum1.5.4 já passou testes dirigidos com TCP/série por PTY, partição/heal, seeder reiniciado e falhas de autorização/corrupção; o gate integral ainda decorre. [Reticulum e limites](docs/RETICULUM.md). O último CI completo passou Node nos três SO e Go/desktop, mas falhou a UI no simulador iOS ao fechar o teclado. Rádios físicos e distribuição nativa RNS continuam por validar.

**Versão web autónoma em desenvolvimento:** a árvore local inclui `/browser/index.html`, com UI Liquid Glass, identidade e armazenamento cifrado no navegador, mensagens e recarga offline testadas sem daemon nem instalação PWA. Comunica por WebRTC e WebSocket com Node/Go; uma rota pode atravessar TCP e série por PTY. Estes módulos estão a ser consolidados em commits verificados. **A paridade funcional completa com as aplicações nativas é obrigatória e ainda está incompleta**, incluindo grupos dinâmicos no worker. [Execução e limites](docs/WEB-APPLICATION.md) · [Evidência](docs/evidence/browser-application) · [Interoperabilidade](docs/WEB-NATIVE.md).

Sincronização automática de provas de grupo verificada em Node/Go: headers e snapshots privados percorrem TCP/série por PTY, recuperam partições e podem vir de um seeder com o autor desligado. [Provas e limites](docs/GROUP-CARRIERS.md). Convites, consentimentos e saídas pelo transporte estão em consolidação, com inbox e aceitação explícita, replay e recuperação transaccional. [Runtime de avisos](docs/GROUP-NOTICE-RUNTIME.md). A gestão visual de grupos dinâmicos já foi exercitada localmente e tem testes adicionais em preparação; não está concluída.

Interface Liquid Glass implementada e verificada em Chromium com os dois motores e no desktop Linux: navegação flutuante, temas claro/escuro e pesquisa por Ctrl/Cmd+K ligada às conversas e mensagens autorizadas já carregadas. Efeitos reduzidos por baixo consumo, contraste e preferências do sistema. [38 testes E2E,62 auditorias Axe, capturas e limites](docs/LIQUID-GLASS.md).

Envio de grupos dinâmicos nas APIs Node/Go: mensagens, anexos e respostas com audiências autenticadas; reacções, comentários, edições do autor e eliminação histórica, com seeding e recuperação verificados. [Envio](docs/GROUP-SEND.md), [eventos](docs/GROUP-EVENTS.md) e [estado global](docs/STATUS.md) distinguem implementação, testes e lacunas da interface.

Confirmações automáticas de grupo passaram o gate completo de host/interoperabilidade/UI/desktop; [comportamento e limites](docs/GROUP-CONFIRMATIONS.md). Mantêm a audiência original e factos de leitura após encerramento, sem concluir a UI dinâmica ou o restante contrato.

Conversas, comunidade e páginas pessoais numa rede entre pares. **Aplicação experimental em implementação. Não é infraestrutura validada para catástrofes e não substitui serviços de emergência.** O contrato completo continua em [PROJECT-BRIEF.md](PROJECT-BRIEF.md); o estado real, incluindo lacunas, está em [docs/STATUS.md](docs/STATUS.md).

O código executa nós persistentes nas aplicações instaladas e um motor autónomo no navegador, com a mesma interface Liquid Glass. Os pares usam TCP, série, WebRTC, WebSocket e o adaptador Reticulum real conforme as capacidades disponíveis. Não há serviço central obrigatório, telemetria, fontes remotas ou CDN de execução. A interface começa vazia: mensagens, pares e contadores vêm de operações reais.

## Usar sem instalar

A entrada estática `/browser/index.html` gera a identidade no navegador e usa um worker, IndexedDB cifrado, WebRTC/WebSocket e cache offline. Para a abrir localmente:

```sh
npm run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort
```

Abra `http://127.0.0.1:4174/browser/index.html`. O servidor só distribui código; mensagens, chaves e armazenamento pertencem ao navegador. Não foi publicado um endereço de produção. [Funções, testes e limites](docs/WEB-APPLICATION.md): identidade, mensagens/outbox, social e sites têm percursos reais; grupos dinâmicos e a restante paridade continuam obrigatórios e pendentes. A instalação PWA é opcional.

O marco actual passou 279 testes Node, 26 browser, 23 percursos UI por motor e execução/empacotamento desktop Linux, com 442 fontes estáveis. [Evidência](docs/evidence/browser-application/milestone). O CI da base `5e049f1` passou Node nos três SO, Go, Reticulum e pacotes desktop; iOS falhou no fecho do teclado. Os passes locais não provam Safari, dispositivos ou rádios físicos.

## Arrancar em Linux (Node.js 22.13+)

```sh
npm ci --ignore-scripts
npm run build
npm run dev -- --data .runtime/alice --http-port 4173
```

Abra o URL completo impresso no arranque. O fragmento contém uma capacidade aleatória que autentica a interface local; não partilhe este URL. A API escuta exclusivamente em `127.0.0.1`. O ficheiro `.runtime/alice/runtime.json` contém os dados do processo e tem permissões privadas. Dados de execução, cofres e caches são ignorados pelo Git.

Crie a identidade com uma frase-passe de pelo menos 12 caracteres. Abra outro terminal:

```sh
npm run dev -- --data .runtime/bruno --http-port 4174
```

Crie a segunda identidade. Em **Definições**, copie o cartão público de cada pessoa; no outro cliente escolha **Adicionar contacto**. Em **A rede → Ligar um par**, use `127.0.0.1` e a **porta TCP de transporte** impressa pelo outro nó (não a porta HTTP). Crie uma conversa e envie uma mensagem. O conteúdo fica cifrado em disco e é transportado por sockets reais.

Para uma rede local entre máquinas, escolha explicitamente `--tcp-host 0.0.0.0 --tcp-port 4242` e troque o endereço IP por um canal de confiança. Só o transporte de objectos assinados é exposto; a API continua local e autenticada. Não altere firewalls nem encaminhamento de portas automaticamente. Sem um caminho alcançável, não há entrega. O arranque recusa executar se houver menos de 15 GiB livres neste ambiente.

## Verificar

```sh
npm run build
npm test
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium
npm run test:e2e
# Gate sequencial de toda a UI nos dois motores e do desktop Linux:
node scripts/verify-ui.mjs
```

`npm test` inclui criptografia/armazenamento, API, processos TCP e três processos TCP → série através de dois PTYs reais do sistema. Os testes PTY são omitidos no Windows. **PTY não equivale a rádio físico.** O teste de isolamento desactiva o ouvinte TCP de C, verifica as ligações configuradas e prova que C não recebe durante uma partição nem com B sem retransmissão. Ao recuperar, C recebe os bytes exactos; com A terminado, B serve um objecto que C ainda não tinha.

A pasta `docs/evidence` guarda relatórios e imagens de execuções reais; os dados de teste são fictícios, criados pelas fixtures. Uma configuração CI não prova que um job correu: resultados efectivamente observados constam de STATUS.

No checkpoint `fde529e`, o CI34728934069 passou Node3OS, Go e os três pacotes desktop. A fotografia voltou a falhar no simulador iOS26.4.1 antes do XCUITest; [STATUS](docs/STATUS.md) conserva esta evidência e as limitações.

No checkpoint anterior `274004e`, o CI34721962376 passou Node/Go e os três pacotes desktop. No simulador iOS26.4.1, a fotografia foi importada e o XCUITest lançou a aplicação; o teste falhou ao esperar pela WKWebView. Nenhum fluxo funcional iOS passou; ver [STATUS](docs/STATUS.md).

A gestão de membros por épocas tem bibliotecas Node/Go e uma API local autenticada, com convite, consentimento, saída/remoção/reentrada e persistência transaccional cifrada. Os testes usam processos e ficheiros reais, incluindo troca de núcleo no reinício. A admissão usa transacções e reservas físicas. A outbox dinâmica tem paragens transaccionais e guardas de retransmissão/partilha verificadas; [GROUP-OUTBOX](docs/GROUP-OUTBOX.md) separa código e evidência. A interface nativa em integração mantém listas de leitores fixos e acrescenta grupos dinâmicos com revisão da audiência do rascunho. O browser autónomo ainda oferece apenas as listas fixas. [GROUP-RUNTIME](docs/GROUP-RUNTIME.md) e [STATUS](docs/STATUS.md) delimitam os resultados.

O estado privado da aplicação está agora integrado no SQLite cifrado com ligação assinada por instalação e migração recuperável do JSON anterior. Passaram os testes de troca Node↔Go, morte de processo e corrupção, o gate completo dos dois núcleos, os percursos de interface e o desktop Linux. [Persistência privada](docs/PROFILE-PERSISTENCE.md) descreve limites, recuperação e a fronteira transaccional da aplicação. Os artefactos móveis anteriores não herdam esta evidência. O APK Android136a5103 já passou 82 asserções no emulador existente e a verificação da migração cifrada; [compatibilidade SQLite Android](docs/ANDROID-SQLITE.md) regista a falha encontrada e os gates correctivos. iOS e hardware físico mantêm os limites em STATUS.


## Segurança e limites actuais

- Ed25519 assina identidades e manifestos; X25519/HKDF/AES-256-GCM embrulha chaves de leitura por destinatário. O leitor pode semear o objecto exacto, mas não mudar a autoria. Cofres usam scrypt + AES-GCM.
- Não é o protocolo Signal: ainda não há double ratchet nem forward secrecy. Não existe auditoria criptográfica externa. A revisão independente dos agentes é uma revisão de engenharia.
- Conteúdos públicos expõem explicitamente a chave de leitura. Privados continuam cifrados em nós retransmissores. Endereços, tamanhos, tempos e padrões de tráfego não são anónimos.
- Apagar publica uma decisão assinada e conserva a decisão local autenticada. Não pode apagar cópias detidas por outros pares. Disponibilidade depende de cache, quotas, expiração e seeders ligados.
- A [gestão por épocas](docs/GROUP-RUNTIME.md) está implementada nas APIs Node/Go; avisos pelo transporte e UI dinâmica estão em consolidação. A paridade destes grupos no browser, os casos adversariais restantes e a rotação/revogação de chaves continuam pendentes. Máximo 64 destinatários, 4 MiB por objecto, quatro anexos por mensagem e 2 MB por anexo na interface.
- O editor usa apenas blocos declarativos; links externos são HTTPS e não são incorporados. Rascunhos podem ser guardados localmente com cifra.
- Linux é o ambiente local executado. Shell/pacote Electron Linux executados; Node e pacotes Windows/macOS passaram em CI, sem prova da GUI nesses OS. O APK Android `136a5103…` passou 82 asserções no emulador API36x86_64 e a leitura Node do SQLite cifrado. O arranque nativo iOS com WebKit passou no CI de f37067f; a importação da fotografia excedeu o prazo antes do teste funcional. Nenhum fluxo funcional completo passou. Os artefactos móveis anteriores não incluem a API nova de grupos. Keychains, assinatura Apple e rádios físicos continuam por implementar ou verificar. Notificações têm lógica de adesão explícita testada com API substituída, sem prova de apresentação pelo OS.

Arquitectura e ameaças: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Tarefas reais e revisões: [docs/AGENTS.md](docs/AGENTS.md). Plano de continuidade: [.codex-delivery/implementation-plan.md](.codex-delivery/implementation-plan.md).

## Desktop e próximos alvos

O pacote desktop executa o nó no próprio processo de aplicação/utility process, sem exigir um serviço externo. Para este Linux, o backend X11 foi o que passou:

```sh
ELECTRON_CACHE="$PWD/.cache/electron" node node_modules/electron/install.js
npm run build
npm run desktop:build
npm run desktop -- --x11
```

`npm run desktop:smoke` e `npm run desktop:package -- --linux --x64 --dir` estão documentados em [DESKTOP.md](docs/DESKTOP.md). O binário gerado fica em `dist/desktop-installers/linux-unpacked/relayloom`. Não há actualizador, publicação automática nem assinatura de release configurados.

O núcleo Go executa armazenamento, cifra, TCP, aplicação e API dentro do APK Android. A interoperabilidade Node↔Go e as rotas Go→Node→Go e Go→Node→Node TCP/série foram testadas com processos reais. O único emulador Android já demonstrou encaminhamento, partição/recuperação e serviço de conteúdo quando o autor está desligado; o APK é reconstruído e os gates repetidos após alterações nativas. Isto não prova execução em hardware físico. O framework Go e a shell iOS já compilaram no runner Apple; os fluxos funcionais iOS continuam por validar. Ver [ANDROID.md](docs/ANDROID.md), [IOS.md](docs/IOS.md) e [NATIVE-INTEGRATION.md](docs/NATIVE-INTEGRATION.md).

Para executar a interface com o nó Go no host (Go 1.26.8 instalado; caches no projecto):

```sh
npm run build
npm run native:build
.cache/native-app/relayloom --data .runtime/go-alice --http-port 4175 --assets dist/web
```

O CLI Go imprime `origin` e `token` num registo JSON de arranque. Abra `origin/#token=token`, substituindo os dois valores; esse endereço dá acesso ao nó local e não deve ser partilhado. O estado periódico usa resumos paginados, e os anexos são obtidos através da API autenticada quando necessários. A cache é limitada e continua dependente da verificação dos bytes em disco; disponibilidade e expiração nunca são garantidas por um contador da interface.


### Verified WebSocket adapters — 2026-09-14

Native Node/Go data listeners now accept origin-bound, expiring transport capabilities, with bounded framing and explicit revocation. Gate on9866889 passed278 Node,89 top-level Go/race (125 including subtests),58 interoperability tests, UI for both engines and real Linux desktop. [Implementation and exact evidence](docs/WEBSOCKET-ADAPTERS.md). Browser application consolidation and real RNS integration remain in progress. Latest base CI passed Node on3OS and Go/desktop gates, but iOS simulator UI failed; no readiness or device claim.
