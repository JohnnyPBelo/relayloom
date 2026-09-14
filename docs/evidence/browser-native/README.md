# Browser ↔ nativo — integração verificada, produto incompleto

Base526d75a; trabalho local não commitado. `scope.json` delimita os resultados e lista fontes/auditorias. Não há publicação, assinatura móvel ou declaração de prontidão para catástrofes.

O comando `node scripts/verify-browser-native.mjs` verificou385fontes e passou compilação, **271testes Node em444.857s** e **89testes Go de topo comrace em534.200s** (125incluindo subtestes;2auxiliares de processos omitidos semfixture). O gate parou na etapa seguinte:15testes browser passaram e2auditoriasAxe falharam porque a fixture tinha usado browser.newPage em vez de um contexto explícito. `native-prefix` conserva essa execução, sem a converter em passe global.

A revisão encontrou uma falha de ACK tardio e reproduziu-a: após início observado do retry, o emissor foi colocado em modo económico e enviou um marcadorSos na mesma ligação; só então o armazenamento foi libertado. Ficava1reassemblagem órfã. A correcção no browser recorda IDs já verificados/aceites, com limites de prazo/quantidade e ACK repetido espaçado. O mesmo teste passou4.2s sem mudar o prazo. `failures` e `corrected` conservam os resultados; o primeiro ensaio sem controlo de parcialidade também está identificado.

`node scripts/verify-browser-native.mjs --remaining` confirmou que as fontes nativas não mudaram e retomou os restantes gates. Só packet.ts/rtc.ts, a fixture browser e o runner mudaram desde o passe nativo. A retoma passou com fontes estáveis:

- Typecheck5.821s; UI2.067s; CLI0.310s.
- **18testes browser54.874s**, incluindo Node/Go reais, UI dos novos peers e ACK tardio.
- **21E2E da aplicação por motor**: Node167.983s eGo148.074s.
- DesktopLinux: build0.175s, execução2.443s, pacote13.185s e execução empacotada1.000s.
- **66auditorias Axe arquivadas, zero violações**. Root reviu as capturas de rede Node/Go; não é revisão independente nem teste manual de leitor de ecrã.

Os percursos incluem WebRTC→WebSocket→daemonNode/Go e resposta; quatro adaptadores com Go/TCP→Node/serialPTY→Node comTCP desligado; intermediários sem leitura, partição/heal62.400bytes, relay-off, autorfechado, browserleitor recarregado, intermediárioGo novo/vazio e seeding com autoria conservada. O convite de transporte não acede à API de controlo. Casos de origem/capacidade/expiração e limite8passaram; o erro de dupla contagem do5.ºclienteGo foi reproduzido e corrigido comrace.

Os testes são do hostLinux/Chromium. WebSocket foi exercitado emloopback; não se verificaram WSS comconfiança real no browser, LAN/NAT, novos pacotes móveis, rádios ou todos osSO. O primeiro problema de abertura RTC em15s continua sem causa demonstrada; passes posteriores não apagam esse histórico. A aplicação web autónoma, grupos/outbox no browser, restanteparidade e adversariais/gates completosC2/C3 continuam pendentes.

Os relatórios desktop preservam a distinção entre sandbox pedido e a informação disponibilizada pelo runtime, além dos controlos positivos/negativos de acessoAPI/rede. Não foi alterada uma configuração de segurança para obter o passe. Cofres, chaves de fixtures e convites não foram copiados para esta evidência.
