# RelayLoom — retoma, 16 de Setembro de 2026

**O produto completo não está concluído.** Preservar todo o PROJECT-BRIEF.md, incluindo todas as aplicações, paridade web, Liquid Glass, autoria separada de leitura/seeding e transporte agnóstico. Só este projecto. Manter Astra/Copilot Ultra e recuperação sequencial: sem novos agentes, alterações a modelos, bridges, autenticação ou serviços. O checkpoint extra de manutenção foi cancelado.

## Candidata guardada — branch de integração

Branch actual `codex/setup-languages`: backend37e0cde, UI/setup/idiomasf799539, Androidc2d6fb0 e iOS preparadoea2ee98. Os WIP anteriores UIKit/XCTest foram conservados na candidata iOS, sem os apresentar como testados em Apple; os backups continuam em .cache/onboarding-i18n/mobile-before e native-before. Restantes WIP e evidência anteriores fora destes marcos permanecem na árvore.

**Gate público actual em execução:** `node scripts/verify-public-web.mjs`, sessão36287, consola .cache/onboarding-i18n/public-final-console.log, relatório .cache/public-web/gate/report.json. A verificação anterior foi conservada em docs/evidence/onboarding-languages/public-candidate. Esta repetição satisfaz o guard de proveniência do publicador depois das alterações dos scripts Apple; não há alteração do runtime web/Node/Go. Fontes de packages/apps-web/tests-browser/scripts congeladas durante o gate. Não publicar nem repetir enquanto RUNNING.

Próximo: recolher gate36287; guardar relatório novo sem substituir o anterior; publicar só os assets exactos se PASS. A distribuição activa ainda é86cb0c3/11d52be. Push da candidata de integração e CI Apple ainda por confirmar nesta nota; conferir git/remoto e .cache/onboarding-i18n/post-push.json antes de repetir. Sem merge de PR/forcepush ou configuração externa. Produto completo continua por concluir.

## Incremento activo: setup e idiomas

WIP local ainda não publicado. Plano/detalhes em .codex-delivery/ONBOARDING-LANGUAGES.md.1031 entradas PT-PT/en-GB/es-ES; setup explicativo, campos conservados entre etapas/línguas, preferências persistentes no perfil Node/Go, UI/data de autoria separados. Mensagens, grupos e sites em várias contas passaram testes dirigidos; não equivalem ao produto completo.

**Gate integral concluído PASS:** node scripts/verify-onboarding-languages.mjs, sessão56541 terminada/recolhida. Relatório .cache/onboarding-i18n/final/report.json, terminado2026-09-16T18:02:00.870Z, sourcesUnchanged=true. Build/runner iOS host,345 Node,Go-race/SQLiteC,62interop,43 casos em cada Chromium/Firefox/WebKit(129),30 UI Node+30 Go, desktop Linux build/run/package/run, candidata public-web e9 UI-RNS. Não repetir sem alterações relevantes. Isto não é execução iOS nem hardware físico.

Android final: APKd2dd1ab1fddbf3b25ecc7145d9ef8552229330adee7e5a4d261313d77f274016 (18029628bytes), AAR9c81c716454f6d7a064699690eb4cad8f0461241e94f35427243e4a5e2fea23b. Instalado e hash instalado comprovado pelo gate privado. Emulador PID2598300, emulator-5580, adb5047; sem wipe. Testes terminados: smoke57 asserções (32reader,3línguas, UI/DOM, cofre intacto, troca e confirmação Recebida antes/depois de restart); SAF38 com16121bytes exactos e cofre recuperado; deadline15 aos120691ms; relay13, A–Android–C, negativo4s,12052bytes, autora offline; private-profile PASS sobre baseline histórico preservado (não foi nova migração). Relatórios em .cache/android/evidence/onboarding-{initial,native-text,delivery,relay}, documents-29c87e2fd0dd e documents-aecaac6d630c. Logs .cache/onboarding-i18n/android-*.log. Todas as sessões desta etapa foram recolhidas. A aplicação foi reaberta após a inspecção privada; emulador fica activo.

Localização nativa Android implementada em NativeText.java, MainActivity e limites de apresentação do DocumentController. Só lê ui-preferences.json até4096bytes, com fallback ao SO; não altera conteúdo/autoria/relay/permissões. iOS NativeText.swift e testes preparados, teclado/alertas/arranque traduzidos; preserva todo o WIP UIKit/XCTest. ios-static-check e22testes do runner passaram no Linux, mas Swift/iOS novos ainda NÃO compilados/executados. Necessário CI Apple; descrições Info.plist dos pedidos do sistema ainda PT.

CI35088386689 iOS: startup1/1 passou, addmedia expirou60340ms; artefacto .cache/onboarding-i18n/prior-ios. Biblioteca prep-accessible e pedido de inserção de1asset, sem conclusão/causa demonstrada. PNG128×128,336bytes validado por CRC localmente; não prova importação Apple. Não modificar permissões, bridge ou serviços.

Próximo: conservar evidência sanitizada dos gates concluídos e revisão de UI; diagnóstico Apple/CI real; actualizar README/STATUS/traceabilidade e commits/push/publicação precisos. Continuar sites com revisões/endereços estáveis, contribuições assinadas/permissões e ficheiros opcionais; grupos dinâmicos web, backup/rotação, quotas/escala, restantes funções/apps/rádios e revisão independente. Produto não concluído. Recuperação sequencial sem novos agentes/modelos/bridges/serviços externos. Disco68GiB.

## Estúdio de sites — marco publicado

Fonte do estúdio e evidência local: **11d52bed4c6712c5af90d1aecd828e572d9d54cf**. A referência de entrega da main e o CI são confirmados em .cache/site-studio/post-push.json; conferir git log e remoto antes de repetir qualquer push. A recuperação continua sequencial, sem agentes novos. UIKit/XCTest e GROUP-NOTICES WIP permanecem intactos e fora do commit; hashes de protecção em .cache/site-studio/protected-wip.json.

Gate final **PASS**, sessão43274 terminada: node .cache/site-studio/verify-publish-final.mjs, relatório .cache/site-studio/publish-final/report.json. 111 browsers com build explícito e hashes estáveis;26 UI Node+26 Go; pacote Linux executado;85 casos web+2 oráculos;9 UI-RNS. Os338 Node,16 pacotes Go/race,5 SQLite C e60 interop foram conservados apenas após comparação de fontes. Não repetir gates concluídos sem alterações. Falhas anteriores (PNG, overflow/contraste, locator ambíguo, diagnóstico RTC desfasado e retoma sobre assets antigos) preservadas em SITE-STUDIO.md e docs/evidence/site-studio. Nenhum teste foi removido nem teve prazo alargado.

Publicação de assets exactos solicitada: commit **86cb0c37713a2ec978ce1844654517c69e8ab1ce**, source11d52be, branch codex/web-pages. Pages **35087757274** terminou success. Processo29066 terminou com sucesso. node .cache/site-studio/verify-live.mjs terminou PASS, sessão10200:17 ficheiros HTTP iguais,3 testes de estúdio e1 percurso entre processos. Evidência pública em docs/evidence/site-studio/live. Não repetir como operação pendente nem inferir dispositivos físicos.

README/STATUS/SITE-STUDIO/traceabilidade e evidência pública foram actualizados. A entrega usa um commit de fonte e outro de verificação/documentação, enviados num único push normal. O resultado do push fica em .cache/site-studio/post-push.json; se não existir, conferir git log e o remoto antes de actuar. Assim não se cancela CI com pushes sucessivos. Confirmar HEAD remoto e o novo CI; não declarar produto concluído. Scripts de apoio .cache/site-studio/collect-evidence.mjs e finalize-local-docs.mjs já correram; não os repetir sobre a evidência existente. As capturas/logs foram revistos,36 logs passam a .txt e espaços finais de dois logs foram normalizados, com hashes originais conservados. NOTICE mantém os bytes verificados, incluindo a linha em branco final.

Continuam pendentes revisões/endereços permanentes e contribuições de sites, revisão independente, caso físico dos dois dispositivos, hardware/radios/Apple, grupos dinâmicos web, backup/rotação/keystore, quotas/escala e restantes requisitos. O estúdio não é compatível com ZeroNet nem executa scripts/HTML/SQL arbitrários. CI anterior35034984024 de e4a39f0 falhou só na preparação da fotografia iOS (seed-synthetic-photo); não atribuir ao estúdio/teclado.

## Código e publicação

- `7d3bceb`: RNS/meios, validado e commitado em ficheiros explícitos.
- `359d652`: reparação do painel/client RTC, libertação de convites e testes, validado e commitado.
- Publicação `eafa109dd1639dc2a595b38ba7061a934d84c463`, branch `codex/web-pages`, source `359d652613c8664480f3cdce86ce5a5bbbc640ab`.
- Pages `35033701343`: success, HTTPS obrigatório. Os 13 ficheiros de execução coincidem por hash/tamanho; 3 testes no URL passaram.
- URL de entrada: https://johnnypbelo.github.io/relayloom/ (encaminha para browser/index.html).
- Push confirmado: HEAD e origin/main `e4a39f03915bf656292115857c6879980eefee93`. Novo CI `35034984024` observado queued; recolher resultado sem o cancelar. Esta confirmação fica local para não provocar outro push/CI.

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
