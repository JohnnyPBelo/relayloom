# Web autónoma e Reticulum — marco verificado

Base `a49e4a4`; nove inputs exactos em `inputs.json`. A cópia `.cache/wr` manteve as fontes durante os gates.

Comandos sequenciais, todos com saída 0:

- `node scripts/verify-reticulum.mjs`: typecheck/build/CLI, sete controlos de perfil, fairness Node/Go com race detector, três cenários RNS multiprocesso e dois percursos UI nativa/autónoma.
- `node scripts/e2e.mjs --config tests/browser/browser.config.ts`: 26 passaram.
- `node scripts/verify-ui.mjs`: 25 UI Node e 25 UI Go, desktop Linux compilado, executado, empacotado e novamente executado.

As oito auditorias Axe identificadas no manifesto não tiveram violações. A revisão visual observou os convites e a conversa RNS reais. Não é revisão independente ou teste de leitor de ecrã. As duas falhas iniciais dos testes de convite são conservadas: a UI dizia «À espera de pares» e conservava a página «A rede» depois do desbloqueio; as expectativas foram corrigidas. Os controlos de revogação e resposta atrasada mantiveram-se.

A versão web enviou 22 000 bytes exactos pela rota WS → RNS TCP/router de referência → série PTY, com a identidade, worker e IndexedDB no browser. Nem B nem C tinham listeners TCP RelayLoom; C só tinha RNS. Partição e relay-off impediram a entrega. Heal e seeder reiniciado com autora web offline permitiram entrega com autoria preservada. O relay não conseguiu ler/editar a mensagem privada. O host estático não recebeu chamadas `/api`. Os contadores das interfaces RNS reais estão no relatório.

Não prova rádio físico, WSS/WAN, Safari, dispositivos nativos ou paridade de grupos dinâmicos. A fonte Go de produção está inalterada face à base; este gate não repete nem reivindica toda a suite Go/race. O incremento iOS e o refactor posterior de certificados de grupos não pertencem a esta árvore.
