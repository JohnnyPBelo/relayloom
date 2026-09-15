# RelayLoom — retoma activa, 2026-09-15

Produto NÃO concluído. Preservar todo o PROJECT-BRIEF.md: Windows/Android/macOS/iOS/Linux e web com paridade integral, Liquid Glass, mensagens/social/sites declarativos seguros, autoria separada de leitura/seeding e transporte agnóstico com Reticulum real.

## Marco actual e entrega web

Código ff2fb60 (main local; push do código e desta documentação é o último passo desta etapa). Origem antes desse push f378e130456d036315d9a0b432d65e71b22860a3. Confirmar `git status --short` e `git log -3 --oneline`; não assumir que a referência anterior ainda é HEAD.

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

1. Confirmar o push finalmain e recolher o novoCI sem o cancelar com outro push.
2. Resolver o selector iOS a partir da hierarquia real; manter UIKit WIP separado até gate Apple.
3. Integrar grupos dinâmicos na web: autoridade/IndexedDB,reserva4MiB,CAS/fences,carriers/outbox/replay,UI e todos os controlos. Certificados partilhados não são paridade de aplicação.
4. Continuar backup/rotação/keystore,peeringdurável/WSS/NAT,embalagemRNS e política de trânsito por instalação,quotasglobais/SOS/escala,funcionalidades sociais/media/sites pendentes,dispositivos/rádios e revisão independente.

Só /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra e recuperação sequencial: sem criar/retomar agentes,sem alterar bridges/modelos/configurações. Evidência histórica real de agentes em docs/AGENTS.md. Uma compilação pesada de cada vez,dependências/caches no projecto;22GiB livres no fim dos gates,mínimo15GiB. Sem root,pagamentos,serviços de outros projectos ou ficheiros pessoais. Commits/pushes normais autorizados,nunca merge dePR sem aprovação. Checkpoint de manutenção adicional cancelado.

Histórico preservado em history/RESUME-before-public-web-20260915.md; os estados “em curso” lá descritos são históricos.
