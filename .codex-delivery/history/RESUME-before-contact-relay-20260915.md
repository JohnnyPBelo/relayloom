# RelayLoom — retoma activa, 2026-09-15

## Trabalho activo — contactos e relay, 2026-09-15

Pedido actual: cartão importado visível nas conversas e participação como relay clara. Implementação local em main.tsx,conversation-id.ts,relay-participation.tsx/css e testes; ainda NÃO publicada. Endereço DM canónico desde a linha de contacto e destinatários ordenados corrigem duplicação da primeira candidata quando se perdia a resposta. Controle UI de relay com estado pendente/confirmado, pares e limites Bluetooth explícitos. Nenhum adaptador Bluetooth nem descoberta automática foi acrescentado. Ver CONTACT-RELAY-UX.md.

Gate público FINAL terminou PASS: sessão37402,`node scripts/verify-public-web.mjs`,log.cache/contact-relay/public-gate.log,relatório.cache/public-web/gate/report.json. Passaram2oráculos,24UI do build existente,30UI/controlos públicos e1percurso2processos;55UI/transportes no total. Fontes/artefactos estáveis. Não tocar nas fontes enquanto os gates seguintes correm.

Continuação sequencial já lançada na sessão3226: `.cache/contact-relay/follow-on.mjs`. O gate público passou e o helper avançou para `scripts/verify-ui.mjs` (Node/Go/Linux) e3UI-RNS porengine. Relatório.cache/contact-relay/follow-on/report.json. Não lançar outro gate em paralelo nem repetir estes passos se o helper já avançou. Cópias prévias de capturas em.cache/contact-relay/preserved-evidence. Disco18GiB,mínimo15GiB.

Depois: integrar/evidenciar os resultados reais,commit de fontes exactas;publicar os assets pelo script existente;verificarHTTPS com launch.config econtact-relay.spec usandoRELAYLOOM_LAUNCH_URL;documentar,commit/push normalmain sóuma vez para não cancelarCI. Publicação actual ainda éec3a3baa/ff2fb60. Preservar todo o trabalho iOS e restantecontrato. Sem agentes novos,modelos,bridges ouserviços alheios.

CI anterior34940755521 de2d06c7e terminou failure apenas em iOS. Artefacto recolhido.cache/contact-relay/previous-main-ios: arranque e importação da fotografia passaram; tentativa funcional abortada comtimeout(exitnull),sem resultado integral. Não reutilizar automaticamente diagnóstico do teclado para este run. WIP496788b continua comselector da fotografia visível por resolver.

---

Produto NÃO concluído. Preservar todo o PROJECT-BRIEF.md: Windows/Android/macOS/iOS/Linux e web com paridade integral, Liquid Glass, mensagens/social/sites declarativos seguros, autoria separada de leitura/seeding e transporte agnóstico com Reticulum real.

## Marco actual e entrega web

Push final confirmado: HEAD e origin/main 2d06c7ef0bc0a06cf641613f0463487f7b24dba3. Inclui código ff2fb60 e documentação2d06c7e. Novo CI34940755521 foi criado e estava queued na última leitura; não cancelar com outro push. A publicação Pages34940021714 já terminou success. Esta confirmação pós-push fica local de propósito para não cancelar o novo CI com outro commit. Confirmar `git status --short` e recolher esse CI antes de nova fase.

URL HTTPS verificado: https://johnnypbelo.github.io/relayloom/browser/index.html
Guia: docs/WEB-TWO-DEVICES.md. Abrir em dois dispositivos na mesma LAN alcançável, criar identidades diferentes, trocar cartões públicos e depois oferta/resposta em A rede → Ligar um par. Não há STUN/TURN/sinalização automática nem promessa de atravessar qualquer NAT.

Publicação estática normal em codex/web-pages,ec3a3baa8ed39d103d9b9a4f7823be355bc9fd88. GitHub Pages configurado só neste repositório,https_enforced=true; CI34940021714 terminou success. Sem alterações a bridges/providers/autenticação/serviços alheios. O site distribui apenas código; identidades/dados/sinalização não são enviados a um backend RelayLoom. Independente do preview local; nenhum servidor local é necessário para este URL.

## Gates concluídos desta etapa

- `node scripts/verify-public-web.mjs`: PASS,fontes e14artefactos estáveis;18 UI autónomos no build existente,24 no build público,1 percurso com processos Chromium/Firefox separados. Anexo63 488bytes exactos,recibos,autor fechado/receptor recarregado offline.
- `node scripts/verify-ui.mjs`: PASSED,25Node169.496s+25Go156.282s;desktopLinux build/run/package/run. Fontes inalteradas.
- `RELAYLOOM_LAUNCH_URL=https://johnnypbelo.github.io/relayloom node scripts/e2e.mjs --config tests/browser/launch.config.ts`:1pass14.5s noURL real.13ficheiros de execução conferidos byte/hash por HTTPS; .nojekyll é marcador de build.
- Os controlos reproduziram o manifesto a apontar para assets/index.html e a eliminação indevida de cache de outra instalação. Corrigidos caminhos e scope de cache. Logs de falhas e observaçõesWebKit preservados.

Evidência publicável: docs/evidence/web-launch. .cache/public-web/gate/report.json e .cache/ui-verification/report.json são os relatórios completos locais. Antes de publicar novamente,npm run web:verify;node scripts/publish-web.mjs mostra plano;--publish só aceita as fontes/artefactos verificados. O script usa índice Git temporário próprio e push normal;nunca a árvore ou os perfis. Não executar npmci nas worktrees/caches partilhadas.

43testes web locais+50UI nativa+1percursoHTTPS não substituem toda a matriz anterior ou dispositivos físicos. Viewport compacto não é telefone;WebKitWPE/Linux não é Safari real;PTY não é rádio;Axe não é revisão independente.

## iOS e trabalho preservado

Mainf378 CI34916793582 terminou: todos os jobs excepto iOS passaram. Main continua a falhar ao fechar o teclado.
WIPcodex/ios-keyboard-verification,496788baae0f8ec2b51900dd62ef681fb1914f29,worktree.cache/ik,CI34917778173 terminou: teclado/publicação/TCP/mensagem privada avançaram;Fototeca abriu. A imagem sintética está visível na captura,mas app.collectionViews.cells não a encontrou. Recolher a hierarquia acessível do picker e corrigir o selector; não repetir sem diagnóstico nem declarar ausência da imagem. Evidência docs/evidence/ios-keyboard-ci/attempt3. Anexo/resposta/retoma/relaunch continuam sem passe integral.

Root preserva as alterações anteriores em RelayViewController.swift e NativeSimulatorTests.swift (não integradas na main),notas e capturas antigas. Os testes regeneraram capturas habituais; cópias anteriores estão em .cache/milestones/web-launch/preserved-evidence. Não usar git add-A,reset,force-push,nem substituir root por uma worktree. Nenhum processo de teste desta etapa ficou a meio; o painel aberto por open_in_codex respondeu apenas queued,sem alegar abertura visual.

## Continuação obrigatória

1. Recolher CI34940755521 de main2d06c7e sem o cancelar com outro push. O push já foi confirmado.
2. Resolver o selector iOS a partir da hierarquia real; manter UIKit WIP separado até gate Apple.
3. Integrar grupos dinâmicos na web: autoridade/IndexedDB,reserva4MiB,CAS/fences,carriers/outbox/replay,UI e todos os controlos. Certificados partilhados não são paridade de aplicação.
4. Continuar backup/rotação/keystore,peeringdurável/WSS/NAT,embalagemRNS e política de trânsito por instalação,quotasglobais/SOS/escala,funcionalidades sociais/media/sites pendentes,dispositivos/rádios e revisão independente.

Só /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra e recuperação sequencial: sem criar/retomar agentes,sem alterar bridges/modelos/configurações. Evidência histórica real de agentes em docs/AGENTS.md. Uma compilação pesada de cada vez,dependências/caches no projecto;22GiB livres no fim dos gates,mínimo15GiB. Sem root,pagamentos,serviços de outros projectos ou ficheiros pessoais. Commits/pushes normais autorizados,nunca merge dePR sem aprovação. Checkpoint de manutenção adicional cancelado.

Histórico preservado em history/RESUME-before-public-web-20260915.md; os estados “em curso” lá descritos são históricos.
