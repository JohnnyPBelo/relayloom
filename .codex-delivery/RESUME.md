# RelayLoom — retoma activa, 2026-09-13

## Contrato e restrições

Continuar TODO o PROJECT-BRIEF.md, apenas em /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra, recuperação sequencial, sem criar/retomar agentes. Não alterar providers, autenticação, bridges, serviços externos, permissões ou segurança. Commits/pushes normais autorizados, sem force-push/merge PR. Caches/dependências no projecto, uma compilação pesada de cada vez, >=15GiB livres (103GiB observados). Checkpoint de manutenção adicional cancelado. Produto incompleto; a revisão de root não substitui revisão independente.

## Git e testes em curso

Marco de confirmações commitado localmente3d11e5f após gate43343 completo. Origin/main ainda1663cbe8618f54ce973fced4ce2b2048240d0d32 (push17874 terminou0); publicar com o reforço do teste iOS para não repetir o erro inalterado. Commits publicados:1e027c8 (envio por API),c1d6f89 (logs completos),1663cbe (sintaxe de regras WebKit/controlos reais de compilador). CI34754740869 em curso, sem resultado Apple novo ainda. Confirmações já guardadas em3d11e5f; preservar a alteração iOS local e documentação.

Gate71338 terminou0 e está em docs/evidence/group-send/final. Build5.816s;219 Node194.189s;144 Go de topo/race507.918s (11 helpers pelos drivers);30 interoperabilidade270.997s; C SQLite115.655s;17 UI Node115.990s/17 Go110.472s;22 host iOS1.887s/estática0.030s;desktop build0.233s, execução1.041s,pacote5.812s,execução empacotada0.800s.26 Axe sem violações,277 fontes inalteradas. Este gate antecede as novas confirmações. Fontes iOS foram as duas únicas alteradas antes do commit seguinte;22 host/estática passaram, Swift/WebKit só CI Apple.

**Gate43343 terminou0; nenhum teste desta fase fica pendente.** Build5.598s;224 Node219.220s;148 testes Go de topo/race548.587s (11 helpers pelos drivers);33 interoperabilidade315.613s;SQLite C143.711s;17 UI Node118.995s e17 Go112.607s;22 host iOS2.319s/estática0.050s. Desktop Linux: build0.230s,execução1.011s,pacote5.055s,execução empacotada0.809s.26 Axe sem violações;284 fontes inalteradas. Evidência em docs/evidence/group-confirmations/final. Arquivar/commitar este marco antes de novas fontes. Depois reforçar o teste iOS no passo de teclado/publicação e continuar eventos/carriers/UI do contrato.

8460 terminou0: Go4 cenários de confirmações26.852s/race, seis percursos mistos32.808s. A nova prova histórica: primeiro teste removeu o snapshot do cursor ainda verificado após close (corrupção, correctamente recusada). Fixture corrigida avança/confirma snapshot sucessor antes de remover o antigo. Cinco casos Node24.640s e quatro testes Go de topo/cinco cenários29.530s com race passaram, sessão88840 terminou0. Logs group-confirmations-proof-*-corrected.txt; falhas preservadas. Não há outro teste dirigido pendente.

CI34754740869/1663cbe: Node3OS, Go e três desktop passaram. Os novos testes Swift/WebKit passaram45 asserções: política nova aceite, antiga recusada WKErrorDomain:6. Build app/framework passou.1 XCTest de arranque passou33.838s; fotografia passou38.204s. Teste funcional chegou à captura de onboarding e saiu65/119.017s; o resumo estruturado não foi recolhido, mas o log sanitizado EXISTE no artefacto: identity-created e falha missing("post form completed") após Publicar. A primeira listagem rg --files omitiu *.log devido ao ignore, corrigido lendo o caminho do relatório. As duas capturas foram revistas por root; não mostram o momento da falha. Nenhum fluxo completo passou. docs/evidence/ios/1663cbe. Depois do gate congelado, reforçar dismissKeyboard (Done global/confirmar teclado fechado), captura de falha antes de terminar e resumo estruturado de XCTest mantendo entrada real, isolamento e prazos; não inferir causa de scroll só pela imagem. Esta CI não contém as confirmações locais não commitadas.

## Confirmações históricas — gate completo concluído e commit3d11e5f

apps/node/src/group-confirmations.ts e native/app/group_confirmations.go verificam/decifram os bytes originais, exigem admissão local e cartões/leitores exactos, rejeitam bloqueios, assinam payload histórico mínimo e gravam admissão antes de Store/transporte. Node publishConfirmation e Go ensureConfirmationLocked estão ligados para delivery automático e receipt por view. Sem contactos globais nem campos de texto/anexo nos recibos. Histórico continua permitido após close; mensagens novas continuam sujeitas ao head actual. Node limita também tentativas falhadas por tick. Go passa a ignorar recibo próprio sem ligação histórica correcta ao suprimir novas emissões.

Node real passou1 caso7.105s; native/node,node/native,native/native passaram3 casos19.948s. Todos provam received antes de close, read após close, audiência original, nenhum contacto global e recusa de decifração por outsider. Node rollback/perda de resposta/bloqueio/bytes ausentes passaram3 casos13.996s. Primeiro controlo de bloqueio falhou por faltar value=true na fixture; corrigido, com cleanup que fecha handles antes de apagar directórios (Windows). Go equivalente passou3 cenários em20.819s com race; está agora a repetir com controlo adicional de recibo mal ligado e os percursos mistos de envio.

O teste misto de group-send foi ajustado para exigir read preservado após close e criar um segundo envio realmente incompleto, com leitor parado e peers desligados, para exigir superseded. Não foi retirada a asserção de paragem nem reduzida audiência. Outbound/messaging continuam false: eventos, carriers e UI dinâmica pendentes. Faltam os restantes controlos (provas/quota/restart de confirmações, partições mais amplas, inventário/callbacks) e gate completo antes de próximo commit.

## Implementação local nova

Node group-send.ts e Go group_send.go, integrados em node/outbox: mensagens/replies pela API, cartões/audiência do snapshot autenticado, head actual e destinatários exactos. UUID retido devolve ID/estado anterior antes de validar nova audiência. Mensagem assinada/verificada/decifrada localmente; admissão e intenção preparing no mesmo commit, antes de content store/rede. Reserva física → ready → transmissão. Nunca reconstruir bytes a partir do preview. Falha comunicada do content store marca unavailable. Recuperação verifica bytes e força escrita do índice antes de ready, preservando pin manual.

Go persistPrivateLocked passa pelo seam transaccional updateGroupState para outbox de grupo, cuja implementação por omissão continua a mesma transacção SQLite. Permite controlos reais antes/depois do commit, sem hooks globais ou alterações de configuração.

Preview Unicode: bug reproduzido no reinício Node→Go com159 caracteres+emoji; Go considerava unavailable o bundle válido por Node ter cortado um surrogate. Novos previews Node cortam caracteres completos como Go. Go aceita exactamente o prefixo legado com high surrogate, conservando as verificações de ID, autor, leitores, bytes, conversa e época. Um teste grava apenas a projecção privada no formato antigo e reabre o bundle realmente criado por API. Controlos rejeitam outros prefixes. Gate dirigido corrigido em curso.

No marco de envio publicado, confirmações automáticas ainda estavam pendentes; a implementação local nova acima já as liga, com gates dirigidos. Publicação de eventos, carriers P2P e composição/gestão dinâmica na UI continuam pendentes. outbound/messaging continuam false nesta integração parcial. Não atribuir mensagem dinâmica completa a estas APIs isoladas. A fixture messagingPair cria identidades/grupos/convites/consentimentos/envios por APIs, mas transfere provas explicitamente; não injecta chaves/intentos.

## Evidência dirigida já concluída

- Dois testes API Node passaram7.894s: texto/anexo/reply, head/audiência e UUID após close.
- Três percursos native/node,node/native,native/native passaram10.782s: anexo sem texto, reply, zero contactos globais.
- Teste pendente6425 confirmado0: cinco falhas Node13.066s (.cache/group-send-node-failures-first.txt).
- Cinco cenários Go equivalentes com race38.954s (dois testes de topo, quatro subcasos commit+um índice), .cache/group-send-go-failures-first.txt. TCP testemunha positiva, ausência de transmissão antecipada, mesmos bytes após retry e erro real do índice após escrita do payload.
- Oito mortes Node/Go antes/depois de preparing/ready passaram26.735s; .cache/group-send-recovery-corrected.txt e .cache/group-send-recovery/report.json. Saídas83/84 reais, recuperação pelo outro motor, retorno ao original, testemunha TCP e entrega/bytes. O gate actual repete com Unicode.
- Falha inicial da fixture: ACK inventado recusado pelo protocolo; corrigido para request válido sem relaxar produção. .cache/group-send-recovery-first.txt.
- Falha real Unicode antes da correcção: .cache/group-send-recovery-unicode-before.txt, unavailable em vez de pending após ready-rollback Node→Go. Preservar como controlo negativo.

## Gates anteriores e plataformas

93c598f: build5.524s;211 Node179.064s;141 Go de topo/race476.758s (10 helpers exercitados por drivers);26 interoperabilidade243.460s; SQLite C75.323s;17 UI Node115.845s e17 Go109.616s;22 testes iOS host1.842s/estática0.032s; desktop Linux build0.336s, execução1.507s, pacote10.029s, pacote executado1.280s.26 Axe sem violações. docs/evidence/group-outbox/final. Não repetir por perda de handles; estes resultados não cobrem a árvore nova.

CI34752751771 de1aaca64 terminou: Node3OS, Go e três desktop passaram; iOS falhou no novo teste de arranque antes da fotografia. Uma captura nativa mostra erro de activação do isolamento; ramo compileContentRuleList recusou regras antes da WKWebView. Boot169.530s/build39.092s/install13.165s passaram, execute-startup-test saiu65/165.729s. docs/evidence/ios/1aaca64 contém relatório/captura revista por root. Nenhum fluxo funcional iOS passou. Hipótese concreta: regex(/|$) usa$ fora do fim, proibido pelo parser WebKit. Após o gate de fontes congeladas, separar origem exacta/prefixo com barra e testar compilação real com controlos; não retirar isolamento, não mudar bridge/serviços/configuração. CI34750795247/93c598f cancelado por prazo15min (anotação exacta), apesar de passos Go success; desktop/iOS skipped. Evidência docs/evidence/ci-93c598f.

Nenhum fluxo funcional iOS passou. fde529e: boot/build/install passaram, fotografia timeout60.836s, XCUITest não executou.274004e: fotografia passou e1 XCUITest falhou missing WKWebView. aa664cd acrescenta teste de arranque antes da fotografia e captura nativa separada;22 host/estática passaram, mas Apple ainda por confirmar. Não atribuir causa aos logs de assetsd nem confundir com timeout Copilot.

Android anterior APK136a5103/AAR9e2fb77f:82 asserções no único emulador API36x86_64 e inspecção cifrada Node passaram. AVD/adb próprios parados, identidade preservada. Esse artefacto não inclui as mudanças de grupo actuais. Apple signing, hardware/radios continuam bloqueados/não verificados; sem desastre-ready/todos OS testados.

## Próximos passos

1. Gate71338 concluído, arquivado e commitado1e027c8/c1d6f89. Correcção iOS implementada em OriginPolicy/PolicyTests: origem exacta e prefixo com barra, compilação WebKit real positiva/negativa e matriz semântica.22 testes host1.817s/estática passaram; sem Swift/WebKit local. Publicar estes commits com a correcção e observar CI Apple; não repetir o iOS inalterado.
2. Gate completo com fontes congeladas (Node/Go race, C SQLite, interoperabilidade incluindo workers, UI Node/Go, desktop); sem reduzir cobertura. Commit/push coerente só após passe.
3. Ligar confirmações históricas mínimas e eventos; preservar received/read completos após close e usar intenção incompleta para superseded.
4. Partição/add/remove/rekey/reentrar/close, audiência original, multi-adapter/multi-hop, seeder offline; carriers limitados e UI dinâmica real.
5. Continuar todo o contrato: keystore/rotação, pesquisa integral, social/media/templates, notificações reais, plataformas e revisão independente. Não fechar o objectivo neste marco.

Histórico integral anterior: history/RESUME-before-group-send-recovery.md. O goal apareceu blocked de interrupções antigas; utilizador retomou explicitamente e trabalho continua. Nenhum novo timeout upstream ocorreu nesta retoma até esta actualização.


## Alteração iOS seguinte

NativeSimulatorTests.swift procura Done global nativo/hittable, confirma que o teclado desapareceu e guarda screenshot de falha antes de terminate; não altera UI/produto/bridge/isolamento/prazos.22 testes host e estática passaram (sessão47093 terminou0); Swift/Apple ainda por executar. É a única fonte alterada face ao gate completo de confirmações. Evidência docs/evidence/ios/keyboard-dismiss-host. Commit/push normal e observar novo CI, sem atribuir passe funcional antes dos resultados.
