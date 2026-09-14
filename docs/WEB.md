# Web sem instalação — contrato e implementação parcial

O proprietário exige uma aplicação autónoma aberta por URL, sem instalação de app, daemon ou extensão, com todas as funcionalidades de produto das aplicações nativas. A instalação PWA será opcional. Este alvo amplia PROJECT-BRIEF.md; não substitui os alvos Windows, Android, macOS, iOS e Linux.

**Já existe uma entrada autónoma em desenvolvimento:** `/browser/index.html`, com worker, UI LiquidGlasspartilhada eIndexedDB. O marco actual foi executado semdaemon em testes de mensagens/social/sites/reload/offline. A paridade completa ainda não foi entregue; gestão de gruposdinâmicos e outrosgates continuam pendentes. Ver [WEB-APPLICATION.md](WEB-APPLICATION.md) e [evidência](evidence/browser-application).

## Código já implementado

- `packages/core/src/protocol.ts`: tipos e codificação canónica partilhados, sem filesystem nem Node. O núcleo Node reexporta a mesma API pública.
- `packages/browser/src/crypto.ts`: Web Crypto Ed25519/X25519, HKDF/SHA256, AES256-GCM, cartões assinados, manifestos/chunks v1 e acesso por destinatário. Scrypt de `@noble/hashes`2.4.0, MIT, mantém o formato do cofre e os parâmetros existentes. Nada de primitivas criptográficas inventadas ou polyfills de Node no navegador.
- `packages/browser/src/profile.ts`: IndexedDB, cofre cifrado e estado/conteúdo cifrados com vinculação autenticada à identidade/ID. Commit de objecto+índice na mesma transacção, revisão optimista e Web Locks entre separadores. Limites por defeito128MiB/1024objectos; estado privado1MiB. Quota/pins/expulsão, bloqueio/reabertura, recuperação em perfil vazio e exportação do cofre de identidade. A exportação de identidade **não** é backup completo da base de dados.
- `packages/browser/src/rtc.ts`: ligação WebRTC real por DataChannel fiável/ordenado, SCTP/DTLS/ICE, fragmentos12288bytes, objecto6MiB, orçamento16MiB por direcção/fila e máximo8reassemblagens. Só confirma após verificar bytes/assinatura e o callback aceitar o objecto. Controlo de presença com sondagem após2s e prazo5s; suspender o browser pode provocar desconexão. Transferências15s; sinalização64k e recolha ICE7.5s. Sem servidor de sinalização/STUN/TURN configurado implicitamente.

A recepção criptográfica devolve um snapshot próprio antes de armazenamento; alterar o objecto original durante um `await` não troca os bytes aceites. Ler ou servir preserva o manifesto assinado e não transfere autoria.

O adaptador RTC tem agora codecs separados para bundles directos e pacotes de routing. `packet.ts` usa o mesmo corpo/ID/hops/TTL/prioridade do router nativo, com tipos partilhados em packages/transport/src/protocol.ts. `BrowserRouter` encaminha automaticamente com duplicados4096, saltos12, retenção64/16MiB e máximo24ligações. Filas RTC partilham os fragmentos:7turnos por prioridade e1pelo menos recentemente servido. O cancelamento verifica autorização antes/depois de backpressure e envia drop para retirar reassemblagem parcial, preservando tráfego próprio.

`BrowserMesh` liga IndexedDB ao router, inventário/pedidos limitados e sincronização periódica. O consentimento é cifrado/persistido; por defeito o relay está desligado até consentir. Uma exclusão Web Locks permite um único serviço de rede por perfil/origem; preferências são serializadas e revogar consentimento pára retransmissões imediatamente. Ler e servir não altera autoria. A retoma por inventário foi testada após fechar o autor e recarregar o leitor. Esta camada ainda não é a API de mensagens/outbox/grupos do produto.

O teste de interoperabilidade faz routers TCP reais aceitar/encaminhar pacotes produzidos pelo navegador e o caminho inverso de verificação. A ponte WebSocket Node/Go foi entretanto implementada e executada emloopback, com entradaRTC e saídaTCP/serialPTY. Convites, limites, cancelamento e falhas estão em [WEB-NATIVE.md](WEB-NATIVE.md); não é validação deWAN/WSS público, rádios ouaplicação autónoma completa.

## Matriz de paridade

| Funcionalidade | Estado autónomo actual | Trabalho obrigatório |
| --- | --- | --- |
| Identidade, cofre e bundles | Implementados; teste real Chromium↔Node e Chromium↔Go | Worker, UX de recuperação, outros browsers/dispositivos, keystore/rotação/revogação |
| Armazenamento cifrado | IndexedDB limitado/transaccional; dois separadores, corrupção e reload testados | Backup integral, expulsão da origem, espaço real/armazenamento persistente, crash/power loss |
| Transferência entre browsers | WebRTC real e seeder com autor encerrado testados em contextos Chromium | Descoberta/sinalização UX, NATs reais, routers e adaptadores Node/Go, distribuição sem serviço obrigatório |
| Relay e rotas heterogéneas | Relay/inventário/pedidos, cancelamento/prioridades,4contextos/partição/heal/seeder reiniciado testados | WSS/RTC nativo fora de loopback, stress de memória/admissão com muitas ligações, autoridade de grupos, restantes falhas e plataformas |
| Messenger, grupos, outbox, eventos e anexos | Ainda não ligados à UI autónoma | Mesmas fronteiras de autorização e transacções dos núcleos; port/refactor da lógica, todos os negativos e E2E |
| Social e sites declarativos | UI existente apenas no modo daemon | Ligar ao motor web, publicação/leitura offline, colecções/templates/media, controlos de autoria |
| Arranque sem instalação e recarga offline | Ainda não entregue | Distribuição estática HTTPS, worker/service worker, cache/actualização segura, PWA opcional |
| Notificações, microfone, câmara e partilha | Paridade não verificada | Permissões explícitas por browser/OS e fluxos reais; nunca controlos fictícios |
| TCP/UDP bruto, BLE, Wi-Fi Direct e rádios | Sem equivalente universal no browser | Web Serial/Bluetooth onde disponíveis ou par consentido com adaptador; hardware e interoperabilidade real continuam gates |
| Relay contínuo em segundo plano | Não prometido | OS/browser podem suspender/encerrar separadores; service worker não é daemon permanente. Limitação explícita, sem contornar segurança |

Todos os estados nativos `done` anteriores continuam associados às suas versões e plataformas de teste. Não demonstram paridade web. O plano completo W1–W5 permanece em `.codex-delivery/WEB-IMPLEMENTATION.md`.

## Validação reproduzível

Com as dependências locais do projecto, Chromium Playwright disponível em `.cache/playwright` e toolchain Go do projecto:

```sh
npm run test:browser
node scripts/verify-browser.mjs --routing
```

O segundo comando guarda comandos, duração, exit codes e hashes das fontes em `.cache/browser-routing/final/report.json`, pára na falha e verifica a reserva15GiB. A fixture é um servidor estático de ficheiros de teste e verifica que não há chamadas `/api`; não inicia um daemon RelayLoom para dar capacidades ao navegador. `runNativeInterop` executa um programa Go de fixtures pelo stdin/stdout para os vectores cruzados, não um backend web.

Uma falha real foi preservada: depois de encerrar o contexto do autor, WebRTC sozinho não notificava o leitor em15s. O controlo de presença corrigiu a detecção e o mesmo teste passou sem aumentar o prazo. Esta observação não é um HTTP408 do provider.

O gate de routing passou22testes Node de transporte/16de núcleo e12Chromium com372fontes estáveis. Depois foram acrescentados2controlos de recusa/cancelamento do mesh e corrigido o caminho do reporter;14Chromium passaram juntos29.652s, sem alterar fontes de produção. [Evidência exacta](evidence/browser-routing). Uma tentativa anterior não estabeleceu um canal em15s, antes de testar prioridades; as seguintes passaram, mas a causa dessa falha de ligação permanece por esclarecer. Os prazos não foram aumentados.

A documentação de evidência final deve ser consultada para a execução exacta. Estes são testes de núcleo, sem fluxo da UI autónoma, revisão independente, Axe novo, Safari/Firefox/WebKit, rádio ou dispositivo móvel real.

## Confiança e limites

As chaves existem na memória JS enquanto desbloqueado; o bloqueio elimina referências e limpa buffers de chaves que controla, sem garantia de apagar cópias do GC. Cofre/estado/chunks locais estão cifrados; nome da base, tamanho e tráfego podem ser observados. Origem comprometida, XSS, extensão maliciosa e actualizações maliciosas do código podem capturar segredos durante o uso. Um worker ajuda a organizar a execução, não constitui uma fronteira contra a mesma origem.

O browser pode expulsar ou apagar o armazenamento. Transacção IndexedDB não prova persistência após perda de energia, nem detecta a restauração integral de uma cópia antiga válida. Sem identidade/estado autenticado não se inicializa silenciosamente uma conta vazia como recuperação. Cofres antigos podem restaurar a identidade, mas não os dados privados inexistentes na cópia. O protocolo não oferece forward secrecy nem apaga chaves já entregues.

SDP contém endereços/candidatos e fingerprint de transporte e deve ser trocado intencionalmente. Sem STUN/TURN e num NAT incompatível pode não existir caminho. Servir inicialmente o código da aplicação por HTTPS é distinto de alojar obrigatoriamente conteúdo pessoal num servidor central. A distribuição, actualizações verificadas e recarga offline ainda exigem implementação.
