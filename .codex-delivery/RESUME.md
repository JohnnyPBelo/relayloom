# RelayLoom — retoma activa, 2026-09-13

## Contrato e restrições

Continuar TODO o PROJECT-BRIEF.md, apenas em /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra, recuperação sequencial, sem criar/retomar agentes. Não alterar providers, autenticação, bridges, serviços externos, permissões ou segurança. Commits/pushes normais autorizados, sem force-push/merge PR. Caches/dependências no projecto, uma compilação pesada de cada vez, >=15GiB livres (103GiB observados). Checkpoint de manutenção adicional cancelado. Produto incompleto; a revisão de root não substitui revisão independente.

## Git e testes em curso

HEAD e origin/main: 1aaca64c8eea188527a265db03d7f8490a7da111, push85817 confirmado0. Marco de autoridade93c598f publicado; 1aaca64 só ajusta o orçamento do job CI Go de15→25min com cobertura inalterada. Preservar TODAS as alterações não commitadas. Não fazer reset.

Sequência66585 terminou0: typecheck e1 teste de preview Node passaram; Go3 testes de topo (seis cenários, incluindo quatro subcasos de commit) passou46.565s com race; CLI reconstruída e oito mortes Unicode passaram26.633s. Logs .cache/group-send-unicode-*.txt e .cache/group-send-recovery-unicode-after.txt. A falha Unicode anterior continua preservada.

**Gate71338 terminou0; nenhum teste deste gate fica em curso.** Build5.816s;219 testes Node194.189s;144 testes Go de topo com race507.918s (11 helpers executados pelos drivers);30 casos de interoperabilidade270.997s; fronteira SQLite C115.655s;17 UI Node115.990s e17 UI Go110.472s.22 testes host iOS1.887s e estática0.030s. Desktop Linux: preparação0.233s, execução1.041s, pacote5.812s, execução empacotada0.800s.26 relatórios Axe actualizados, zero violações.277 ficheiros de fonte inalterados durante os gates. Evidência em docs/evidence/group-send/final. Não repetir por perda de handles. Próximo: commit/push normal deste marco, depois corrigir sintaxe WebKit mantendo isolamento e continuar confirmações/carriers/UI segundo GROUP-CONFIRMATIONS-INTEGRATION.md.

## Implementação local nova

Node group-send.ts e Go group_send.go, integrados em node/outbox: mensagens/replies pela API, cartões/audiência do snapshot autenticado, head actual e destinatários exactos. UUID retido devolve ID/estado anterior antes de validar nova audiência. Mensagem assinada/verificada/decifrada localmente; admissão e intenção preparing no mesmo commit, antes de content store/rede. Reserva física → ready → transmissão. Nunca reconstruir bytes a partir do preview. Falha comunicada do content store marca unavailable. Recuperação verifica bytes e força escrita do índice antes de ready, preservando pin manual.

Go persistPrivateLocked passa pelo seam transaccional updateGroupState para outbox de grupo, cuja implementação por omissão continua a mesma transacção SQLite. Permite controlos reais antes/depois do commit, sem hooks globais ou alterações de configuração.

Preview Unicode: bug reproduzido no reinício Node→Go com159 caracteres+emoji; Go considerava unavailable o bundle válido por Node ter cortado um surrogate. Novos previews Node cortam caracteres completos como Go. Go aceita exactamente o prefixo legado com high surrogate, conservando as verificações de ID, autor, leitores, bytes, conversa e época. Um teste grava apenas a projecção privada no formato antigo e reabre o bundle realmente criado por API. Controlos rejeitam outros prefixes. Gate dirigido corrigido em curso.

Ainda PENDENTES: confirmações automáticas de grupo, publicação de eventos, carriers P2P, composição/gestão dinâmica na UI. outbound/messaging continuam false nesta integração parcial. Não atribuir mensagem dinâmica completa a estas APIs isoladas. A fixture messagingPair cria identidades/grupos/convites/consentimentos/envios por APIs, mas transfere provas explicitamente; não injecta chaves/intentos.

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

1. Gate71338 concluído e arquivado. Commit/push coerente do envio por API, depois correcção iOS e continuação integral.
2. Gate completo com fontes congeladas (Node/Go race, C SQLite, interoperabilidade incluindo workers, UI Node/Go, desktop); sem reduzir cobertura. Commit/push coerente só após passe.
3. Ligar confirmações históricas mínimas e eventos; preservar received/read completos após close e usar intenção incompleta para superseded.
4. Partição/add/remove/rekey/reentrar/close, audiência original, multi-adapter/multi-hop, seeder offline; carriers limitados e UI dinâmica real.
5. Continuar todo o contrato: keystore/rotação, pesquisa integral, social/media/templates, notificações reais, plataformas e revisão independente. Não fechar o objectivo neste marco.

Histórico integral anterior: history/RESUME-before-group-send-recovery.md. O goal apareceu blocked de interrupções antigas; utilizador retomou explicitamente e trabalho continua. Nenhum novo timeout upstream ocorreu nesta retoma até esta actualização.
