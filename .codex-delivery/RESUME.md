# RelayLoom — retoma, 16 de Setembro de 2026

**O produto completo não está concluído.** Preservar todo o PROJECT-BRIEF.md, incluindo todas as aplicações, paridade web, Liquid Glass, autoria separada de leitura/seeding e transporte agnóstico. Só este projecto. Manter Astra/Copilot Ultra e recuperação sequencial: sem novos agentes, alterações a modelos, bridges, autenticação ou serviços. O checkpoint extra de manutenção foi cancelado.

## Código e publicação

- `7d3bceb`: RNS/meios, validado e commitado em ficheiros explícitos.
- `359d652`: reparação do painel/client RTC, libertação de convites e testes, validado e commitado.
- Publicação `eafa109dd1639dc2a595b38ba7061a934d84c463`, branch `codex/web-pages`, source `359d652613c8664480f3cdce86ce5a5bbbc640ab`.
- Pages `35033701343`: success, HTTPS obrigatório. Os 13 ficheiros de execução coincidem por hash/tamanho; 3 testes no URL passaram.
- URL de entrada: https://johnnypbelo.github.io/relayloom/ (encaminha para browser/index.html).
- Confirmar HEAD/origin/main e o CI depois do push dos commits; não cancelar um CI activo com outro push.

## Correcções e observação real

O painel mantém campos separados por papel, observa a ligação nos dois lados, fornece diagnóstico sem SDP/chaves/IP/conteúdo e permite recomeçar. Fechar liberta convites pendentes e resultados tardios; conserva canais já abertos. Código/cópia aparecem antes da resposta; a ajuda está recolhível. Mensagens guardadas e identidades não foram migradas/apagadas.

O IAB observado tinha zero pares/contactos e relay pausado, com script antigo browser-BS8Dlbyr.js. Não era evidência do estado dos dois dispositivos físicos do proprietário. Recarregar conservava a versão antiga: por desenho, o service worker espera que os clientes antigos fechem. Navegar pela raiz pública activou browser-BLtN8NLC.js e o perfil continuou inicializado/bloqueado. A tentativa de abrir release.json no IAB foi recusada pelo cliente; o HTML da raiz funcionou, sem alterar segurança/cache/armazenamento. As instruções agora dizem fechar os separadores antigos e reabrir a raiz, sem apagar dados. Não recolher a frase-passe.

Continuam por responder as perguntas sobre ligações activas, SO/browser e Wi-Fi dos dois dispositivos. Cartão identifica o contacto; não estabelece RTC. Não afirmar que o caso físico ficou resolvido só pelos testes do host.

## Testes concluídos — não repetir sem motivo

- Primeiro gate integral: 61 web + 2 endereços, 6 RTC, gate RNS, 25 UI Node + 25 Go e Linux build/run/package/run. Sessão 64416 terminada.
- RNS: 8 cenários multiprocesso, 8 controlos de perfil/processo, 4 de política/catálogo, 5 BLE com GATT simulado, 1 justiça de fila, Go transport/webpeer com race, 3 UI. Fontes estáveis.
- Depois da revisão: reproducer orphan falhou antes (1 par em vez de 0) e passou depois; connectivity passou 2/2, incluindo criação atrasada de 2 s. Build passou.
- Gate final, sessão 62070 terminada PASS: **67 web + 2 endereços e 9 UI-RNS**, Chromium/Firefox/WebKit. Fontes/artefactos estáveis. Transportes/backends não mudaram desde o primeiro gate; a última alteração foi no cliente/painel autónomo.
- URL publicado: 1 percurso entre processos Chromium/Firefox (17,7 s) e 2 testes connectivity (20,4 s), todos passados. Sessões 86142/21384 terminadas.
- Publicação 72183 e verificação HTTP 21372 terminadas com sucesso. Não há teste/build desta etapa por terminar. Não parar previews/serviços anteriores que não pertencem a estes testes.

Comandos, relatórios, hashes, capturas e falhas: `docs/evidence/connectivity-media`. Detalhes de iteração em CONNECTIVITY-MEDIA.md. Orquestradores locais `.cache/connectivity/verify-all.mjs` e `verify-final.mjs`; não relançar sessões já fechadas.

## Meios e limitações

A integração directa RNS pertence ao nó Node no Linux; Go/web chegam através de pares compatíveis. O catálogo aceita as 14 interfaces internas de RNS 1.5.4 com isolamento, lease e opt-in local para Pipe; não carrega código de sites ou módulos custom. UDP/Backbone foram testados com sockets reais, KISS/AX25 com PTYs. Auto/I2P/RNode/Weave configuráveis não equivalem a hardware testado.

BLE Nordic UART Linux usa Bleak e uma PTY privada, filas limitadas, fragmentação e cancelamento. O gate usa **GATT simulado**, sem rádio físico. Uma ocorrência ultrapassou 45 s no heal; a execução instrumentada e o gate integral passaram sem alteração de prazo/runtime. Causa ainda aberta. Não afirmar Bluetooth validado ou Bluetooth directo browser↔browser.

Guia/configuração: docs/RETICULUM-MEDIA.md. Para uso real é necessário um periférico compatível explicitamente escolhido, processo BLE em primeiro plano e nó Node/RNS configurado. Nenhum destes processos de rádio está activo por esta tarefa; não foi feito scan/pairing ou alteração de potência/serviço. Controlador local consultado em leitura: ligado e com GATT/advertising.

## Continuar o contrato completo

1. Confirmar nos dispositivos do proprietário: nova versão, pares realmente ligados, diagnóstico e entrega/recibos. NAT/descoberta automática continuam pendentes.
2. Validar BLE/RNode/TNC/LoRa com hardware apropriado; integrar/embalar RNS e Bluetooth nas restantes apps. Manter paridade web e limites de background explícitos.
3. CI anterior `35026722736`, source `4e4fcc7`, terminou failure só em iOS; restantes jobs listados passaram. Xcode 26.6/iOS Simulator 26.4.1: build, instalação e startup (1 teste) passaram; percurso funcional saiu 65. Artefacto em `.cache/connectivity/prior-ios`. Capturas mostram criação de identidade, sem asserção suficiente para causa; recolher resumo xcresult sanitizado antes de atribuir falha ao teclado/fototeca. Preservar UIKit/XCTest WIP.
4. Grupos dinâmicos web, backup/rotação/keystore, quotas/SOS/escala, restantes funções sociais/media/sites, plataformas físicas e revisão independente continuam obrigatórios.

Preservar UIKit/XCTest, GROUP-NOTICES e restantes alterações locais. Foram copiados 148 ficheiros de evidência prévia (7,99 MB) para `.cache/connectivity/preserved-evidence`. Não usar git add -A, reset, force-push ou merge de PR sem aprovação. Caches/dependências no projecto, uma compilação pesada de cada vez, mínimo 15 GiB livres (última leitura 78 GiB).

## Histórico do incremento anterior


Push final confirmado: HEAD e origin/main `4e4fcc717666be57c6730ced6c092a05662d97f6`, incluindo código `9abbf20` e documentação `4e4fcc7`. Novo CI `35026722736` estava queued na última leitura. Esta confirmação fica local para não cancelar esse CI com outro push. Confirmar git status/log antes de agir.

Web actualizada e verificada: https://johnnypbelo.github.io/relayloom/browser/index.html
Publicação `5bc5895bc944531c8ba761650528bb7ffd861ffb`, branch `codex/web-pages`; Pages `35025782233` terminou success, HTTPS obrigatório. Nenhum serviço local é necessário para abrir este URL. O site só distribui código.

O cartão verificado aparece imediatamente nas conversas, com endereço DM definitivo e sem mensagem fictícia. Destinatários ordenados mantêm o mesmo pedido quando a resposta se perde. Em A rede, Permitir retransmissão guarda consentimento/pausa e mostra falta de pares. Bluetooth directo e descoberta automática continuam ausentes. O browser precisa de perfil desbloqueado, separador activo e caminho entre pares; pode ser suspenso pelo sistema. Instruções: docs/WEB-TWO-DEVICES.md.

## Gates terminados

- `node scripts/verify-public-web.mjs`: PASS, fontes/artefactos estáveis. 2 oráculos; 24 UI no build existente, 30 no público, 1 percurso entre processos Chromium/Firefox — 55 casos web.
- `node scripts/verify-ui.mjs`: PASSED, 25 Node/184,432 s e 25 Go/159,559 s, Linux build/run/package/run.
- `node scripts/e2e.mjs --config tests/reticulum/ui.config.ts --browser <engine>`: 3 por engine Chromium/Firefox/WebKit (9), incluindo partição/retoma, resposta privada e seeder reiniciado com autora offline.
- URL publicado: `RELAYLOOM_LAUNCH_URL=https://johnnypbelo.github.io/relayloom node scripts/e2e.mjs --config tests/browser/launch.config.ts`: 1 passe/16,7 s; com `--config tests/browser/browser.config.ts tests/browser/contact-relay.spec.ts`: 2 passes/50,2 s. Treze ficheiros HTTP conferidos por hash/tamanho.

A cadeia A–B–C só cria A–B e B–C. Dois períodos em pausa bloqueiam a entrega; autorizar permite-a, os contadores avançam e a UI de B recusa leitura privada. O contacto persiste/reabre e a primeira mensagem/reply preserva o rascunho. A primeira candidata duplicava um envio com resposta perdida; foi reproduzido/corrigido antes de publicar. Todos os erros intermédios estão arquivados.

Evidência: docs/evidence/contact-relay. Relatórios locais: .cache/public-web/gate/report.json, .cache/ui-verification/report.json e .cache/contact-relay/follow-on/report.json. Sessões37402/3226/52999/80080 terminaram; não repetir esses gates por perda de contexto. Nenhum teste desta etapa ficou a meio. open_in_codex anterior só devolveu queued; a tentativa de Browser nesta etapa não encontrou backend iab, sem alterar a sessão do utilizador.

## Preservar e continuar

Root conserva o UIKit/XCTest WIP e notas/capturas anteriores não commitadas. Capturas anteriores aos testes: .cache/contact-relay/preserved-evidence. Não usar git add-A, reset, force-push nem substituir root por uma worktree. Dependências/caches no projecto; último disco81GiB, mínimo15GiB. Uma compilação pesada de cada vez; sem root, pagamentos, ficheiros pessoais ou outros projectos. Não cancelar CI main em curso com outro push. Commits/pushes normais autorizados; nenhum merge de PR sem aprovação.

1. Recolher CI `35026722736` de main `4e4fcc7` sem o cancelar. Push já confirmado; publicação Pages e testes HTTPS concluídos.
2. iOS: CI34940755521 de2d06c7e terminou failure apenas nesse job. Arranque e importação de fotografia passaram; tentativa funcional abortada com timeout/exitnull, sem resultado integral. Artefacto em.cache/contact-relay/previous-main-ios. Não atribuir automaticamente a falha ao teclado. WIPcodex/ios-keyboard-verification/496788b continua separado: fechou teclado, enviou e abriu Fototeca; selector não encontrou a imagem visível. Recolher a hierarquia acessível e corrigir, mantendo todos os controlos.
3. Grupos dinâmicos web: autoridade/IndexedDB, reserva4MiB, CAS/fences, carriers/outbox/replay e UI ainda obrigatórios; certificados partilhados não são paridade completa.
4. Continuar backup/rotação/keystore, peering/WSS/NAT/descoberta, integração de meios/embalagem RNS e política de trânsito por instalação, quotas/SOS/escala, restantes funções sociais/media/sites, plataformas físicas e revisões independentes.

WebKit WPE/Linux não é Safari/iOS; viewport compacto não é dispositivo; PTY não é rádio; Axe não é revisão independente. O checkpoint de manutenção adicional continua cancelado. Histórico integral anterior em history/RESUME-before-contact-relay-20260915.md.
