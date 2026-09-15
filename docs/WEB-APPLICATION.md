# RelayLoom directamente no navegador — implementação parcial

A entrada `/browser/index.html` é uma aplicação estática com a UI Liquid Glass partilhada. Gera e usa a identidade no navegador, conserva dados cifrados em IndexedDB e troca pacotes por WebRTC/WebSocket. Não chama `/api` de um daemon para executar as funcionalidades abaixo. Ainda não é a paridade completa exigida pelo proprietário. A versão experimental está publicada em [HTTPS](https://johnnypbelo.github.io/relayloom/browser/index.html); consulte o [guia para dois dispositivos](WEB-TWO-DEVICES.md).

## Executar a versão local para desenvolvimento

```sh
npm run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort
```

Abrir `http://127.0.0.1:4174/browser/index.html`. Este processo serve apenas os ficheiros da aplicação; não executa um nó RelayLoom em nome do browser. Para distribuição normal, os mesmos ficheiros necessitam de um servidor estático HTTPS. A visita inicial requer acesso ao código. Depois de a cache estar preparada, foi testada a recarga com o servidor a devolver503, sem instalar aPWA. A instalação opcional usa o mesmo motor e não desbloqueia funcionalidades exclusivas.

## Separação de execução

`apps/web/src/browser/worker.ts` possui o cofre, as chaves e o domínio da aplicação. `client.ts` mantém RTC/WebSocket na janela, onde estesAPI estão disponíveis, e transmite bundles cifrados/metadados públicos entre o motor e a rede. Plaintext autorizado chega à UI para apresentação; chaves privadas não são devolvidas. O teste observa as respostas reais do worker e perdeu deliberadamente uma resposta de envio para provar recuperação sem nova publicação.

Só uma instância da aplicação detém o perfil por origem. Outro separador não termina nem assume o primeiro. Bloquear invalida trabalho pendente; recarregar exige novo desbloqueio. Worker não é protecção contra origem, extensão ouXSS comprometidos. Não há promessa de apagamento verificável de todas as cópias de memóriaJS.

## Implementado e âmbito dos testes dirigidos

| Função | Implementação actual | Evidência/pendente |
| --- | --- | --- |
| Identidade/cofre/contactos | Worker, cofrev1 compatível, recuperação/exportação cifrada, cartões verificados | UI de criação/contactos/reload; chave privada ausente nas respostas observadas; exportação não é backup completo daDB |
| Mensagens e outbox | DM e leitoresfixos, envio UUID/fingerprint, reservas/commitIDB conjunto, retries do mesmoobjecto, recibos assinados | UI: criaçãooffline→RTC→leitura→reload. Resposta perdida aplicada uma única vez. Corrupção deconteúdo retido recusa accepted |
| Grupos dinâmicos | Ainda não ligados ao worker | Obrigatórios para paridade. UI identifica leitoresfixos; não simula êxito das APIs de autoridade/convites |
| Social | Publicações, comentários/reacções, seguir/guardar, colecções eacções locais | UI de comentário/reacção/colecção e persistência passou; autor/ACL de eventos têm controlos negativos |
| Páginas pessoais | Mesmos blocos declarativos, arrastar/setas, rascunho cifrado e publicaçãoassinada | UI publicou e leu offline depois de fechar autor. Texto comscript permaneceu texto, semexecução |
| Rede | Códigos oferta/respostaRTC, conviteWS, mesmoRouter/Mesh real | Semservidor de sinalização obrigatório. Convites emitidos/revogados pela UI nativa e rota web→WS→RNS TCP/série PTY foram verificados. Peering persistente, conectividade WAN/WSS e gestão detalhada permanecem em integração |
| Cache de código | Serviceworker em/browser, assets comhashes, versão isolada, semAPI/conversas naCacheStorage | Servidor503 e corrupçãodoworker emcache foram exercitados; código inválido é recusado e sóreparado quando existe origemdisponível válida |
| Segurança local | Estado cifrado, reservas contraevicção, rollback deIDs/índice/ledger | AbortoIDB e falha do callback preservam estado. Cofre/índicecorrompido não causa reset silencioso |

Os limites continuam reais: metadados privados1MiB, armazenamento128MiB pordefeito, conteúdos4MiB e os limites partilhados de outbox. A memória/escala/muitospares e todo o domínio ainda requerem revisão e testes adicionais. O navegador pode apagar/expulsar armazenamento; exportar o cofre recupera a identidade, não reconstrói sozinho os dados privados perdidos.

## Cache e actualizações

Os assets emitidos peloVite têm um manifesto dehashes incluído no serviceworker. Verifica-se integridade ao instalar e ao ler da cache. Código e worker ficam no âmbito browser do caminho de instalação, incluindo /relayloom/browser/ no alojamento público; o cliente nativo em/index.html e a suaAPI não são interceptados. Uma versãonova não força skipWaiting eminstâncias antigas: aguarda o fecho dos clientes antes de assumir. Hashes detectam corrupção; não substituem assinatura de distribuição nem protegem contra servidor deorigem malicioso. Essa fronteira e a assinatura das releases continuam pendentes.

## Verificação

```sh
node scripts/verify-autonomous.mjs
```

O gate compila, corre a regressãoNode, todos os testes de browser (incluindo núcleo, adaptadores e UIautónoma), a UI nativaNode/Go e odesktopLinux. Os relatórios ficam em `.cache/browser-application/final`. Assegura pelo menos15GiB livres e fontes estáveis. O gate sobre `5e049f1` terminou 0 com 442 fontes estáveis: 279 Node, 26 browser, 23 UI por motor e pacote Linux executado. Relatórios e oito auditorias Axe novas sem violações estão em `docs/evidence/browser-application/milestone`. A correcção posterior dos caminhos de recolha de artefactos CI está discriminada no mesmo directório; não altera código de execução.

A matriz posterior de Chromium/Firefox/WebKit no Linux passou 90 testes autónomos e nove percursos UI-RNS (docs/evidence/browser-matrix). A distribuição pública passou outros 43 testes locais,50 UI Node/Go e um percurso real no URL HTTPS entre processos Chromium/Firefox (docs/evidence/web-launch). Viewports móveis, microfones sintéticos, mocks de notificações e PTYs não provam dispositivos/rádios. Safari real, Android/iOS actuais, hardware/keystore/rotação, revisão independente, adversariais restantes e paridade completa continuam pendentes.


## Ligar à rede de uma app instalada

Na app instalada no mesmo dispositivo, abre **A rede → Ligar um par → Usar a versão web neste dispositivo**. Introduz o endereço da página RelayLoom e cria o convite. Na versão web, abre **A rede → Ligar um par → App instalada** e cola-o. O convite é temporário e limitado à origem; só concede transporte de conteúdo cifrado. Revogá-lo fecha as ligações, sem bloquear a identidade. A ligação directa actual usa o mesmo dispositivo; WSS/WAN continua pendente.

A partir daí, escolhes o destinatário e envias normalmente. O percurso web→WS→RNS TCP/router de referência→série PTY foi executado com partição/heal, resposta privada e seeder reiniciado com autora offline. Ver [evidência](evidence/web-reticulum). PTY não é rádio físico.
