# RelayLoom — retoma activa, 2026-09-15

Produto completo NÃO concluído. Preservar todo o PROJECT-BRIEF.md, incluindo todas as aplicações, paridade web integral, Liquid Glass, autoria separada de leitura/seeding e transporte agnóstico com Reticulum real. Só este projecto; manter Astra/Copilot Ultra e recuperação sequencial, sem criar/retomar agentes nem alterar bridges/modelos/configuração.

## Incremento actual

Código `9abbf20` commitado em main local. A documentação desta etapa ainda precisa do push final juntamente com o código; origin/main antes desse push é `2d06c7e`. Confirmar git status/log antes de agir.

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

Root conserva o UIKit/XCTest WIP e notas/capturas anteriores não commitadas. Capturas anteriores aos testes: .cache/contact-relay/preserved-evidence. Não usar git add-A, reset, force-push nem substituir root por uma worktree. Dependências/caches no projecto; último disco18GiB, mínimo15GiB. Uma compilação pesada de cada vez; sem root, pagamentos, ficheiros pessoais ou outros projectos. Não cancelar CI main em curso com outro push. Commits/pushes normais autorizados; nenhum merge de PR sem aprovação.

1. Confirmar o push final main e recolher o novo CI sem o cancelar.
2. iOS: CI34940755521 de2d06c7e terminou failure apenas nesse job. Arranque e importação de fotografia passaram; tentativa funcional abortada com timeout/exitnull, sem resultado integral. Artefacto em.cache/contact-relay/previous-main-ios. Não atribuir automaticamente a falha ao teclado. WIPcodex/ios-keyboard-verification/496788b continua separado: fechou teclado, enviou e abriu Fototeca; selector não encontrou a imagem visível. Recolher a hierarquia acessível e corrigir, mantendo todos os controlos.
3. Grupos dinâmicos web: autoridade/IndexedDB, reserva4MiB, CAS/fences, carriers/outbox/replay e UI ainda obrigatórios; certificados partilhados não são paridade completa.
4. Continuar backup/rotação/keystore, peering/WSS/NAT/descoberta, integração de meios/embalagem RNS e política de trânsito por instalação, quotas/SOS/escala, restantes funções sociais/media/sites, plataformas físicas e revisões independentes.

WebKit WPE/Linux não é Safari/iOS; viewport compacto não é dispositivo; PTY não é rádio; Axe não é revisão independente. O checkpoint de manutenção adicional continua cancelado. Histórico integral anterior em history/RESUME-before-contact-relay-20260915.md.
