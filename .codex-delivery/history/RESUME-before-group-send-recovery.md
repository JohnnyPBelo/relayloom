# RelayLoom — retoma activa, 2026-09-13

Contrato integral: PROJECT-BRIEF.md. Só /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra. Execução sequencial: não criar/retomar agentes; não alterar providers/autenticação/bridges/serviços externos/permissões/segurança. Commits/pushes normais autorizados, nunca force-push/merge PR. Dependências/caches no projecto, uma compilação pesada de cada vez, >=15GiB livres (105GiB medidos). Checkpoint adicional de manutenção cancelado. O produto não está concluído.

## Estado imediato

**Checkpoint actualizado nesta retoma:** HEAD e origin/main confirmados `1aaca64c8eea188527a265db03d7f8490a7da111`; push85817 terminou0. O teste pendente6425 terminou0: cinco casos Node de falha de criação/envio passaram13.066s. Cinco cenários Go equivalentes (dois testes de topo, quatro subcasos de commit e um de índice) passaram com race38.954s, log `.cache/group-send-go-failures-first.txt`. Incluem TCP real, rollback/perda de resposta, bytes originais e falha de índice após escrita física. Go usa agora o mesmo seam transaccional também na persistência privada de outbox de grupos; sem alteração da transacção de produção por omissão.

Oito mortes reais Node/Go antes/depois de preparing/ready passaram26.735s, log `.cache/group-send-recovery-corrected.txt`, relatório `.cache/group-send-recovery/report.json`. As identidades/grupos/envios foram criados por APIs reais, com certificados transferidos explicitamente pela fixture. A primeira execução falhou no ACK da fixture: pacote inventado rejeitado pelo protocolo da aplicação, antes de chegar ao commit. Corrigido para request válido, sem relaxar produção; log original `.cache/group-send-recovery-first.txt`. Está agora em curso a variante Unicode no limite160 para investigar incompatibilidade de preview: `.cache/group-send-recovery-unicode-before.txt`, sessão43687. Confirmar resultado antes de repetir. Preservar todos os novos ficheiros de envio/testes/workers não commitados.

Último disco103GiB. CI34752751771 de1aaca64 estava in_progress: Node3OS passou; Go ainda em testes. Sem novo resultado Apple confirmado. As notas históricas seguintes descrevem marcos anteriores e não devem determinar um reset. Nenhum agente novo/retomado nesta fase. Continuar o contrato completo após os testes; produto incompleto.

HEAD e origin/main confirmados93c598f459f3152fafb53341be0eca1287f02d06. O marco de autoridade e o pré-arranque iOS foram enviados nos commitsaa664cd e93c598f. A base anterior era fde529ed0ff9dad7eacd7b3f157929ba1f3f0d6a. Foram enviados6734f1f (reservas),5845515 (admissão) e fde529e (captura de falha de arranque iOS). Há trabalho novo NÃO COMMITADO; preservar integralmente. Não fazer reset/stash destrutivo.

Gate completo da árvore local concluído. Sessões99690 e74545 terminaram0. 211 testes Node passaram179.064s;141 testes Go de topo com race476.758s (10 helpers omitidos isoladamente e executados pelos drivers);26 casos de interoperabilidade243.460s; fronteira SQLite C75.323s;17 UI Node115.845s e17 UI Go109.616s. Build5.524s;22 testes iOS host1.842s e verificação estática0.032s. Desktop Linux: preparação0.336s, execução1.507s, pacote10.029s e execução empacotada1.280s.26 relatórios Axe actualizados, zero violações. Fontes inalteradas durante os gates. Evidência pública em docs/evidence/group-outbox/final. Nenhum processo de teste desta fase está em curso. Não repetir por perda de handles. Próximo: commitar separadamente a alteração iOS de pré-arranque e a integração de autoridade da outbox, push normal, confirmar origin e continuar publicação/envio dinâmico real. O CI anterior está concluído; o push não o interrompe.

As capturas mobile Node/desktop Go da nova outbox foram revistas por root; isto não é revisão independente. Artefactos móveis precisam de rebuild/gates próprios e a publicação dinâmica continua desligada.

## Código local novo

Node/Go: groupEpoch/groupStopped são campos conjuntos exactos da intenção; superseded para incompletos com StopRecord. Autoridade e stops no mesmo commit reservado, mesmo sem crescer o documento privado. False em disco + stop normaliza em memória; true sem stop, binding trocado e stop órfão falham. Remoção de intenções/stops conjunta. Confirmações completas e tempos preservados. Reservas de quarentena/outbox agregadas e pins manuais separados.

CancelLocal/cancelLocal retira pacotes locais retidos e futuros fragmentos de todos os adaptadores. Uma trama em voo e cópias noutros peers não são recolhidas. Inventário/requests do autor usam autoridade actual, mesmo depois de received/read. Perfis bloqueados adiam partilha de mensagens privadas armazenadas; transit relay e conteúdo público mantêm-se, relay sem identidade pode semear ciphertext. Não confundir com revogação global.

Cache de stops por geração e por transacção reduz descodificações repetidas; retorno não pode alterar a cache e mutação/saída do âmbito invalida-a. Falta de prova actual pausa retry. Perda de snapshot histórico após avanço do cursor conserva disponibilidade; recuperar a prova retira hold obsoleto, mantendo reserva de outbox. Apagar snapshot do cursor verificado é corrupção e continua a bloquear (a primeira fixture errou nisso, foi corrigida sem relaxar produção).

Publicação dinâmica, emissão de confirmações pela app, carriers automáticos e UI de composição/grupos AINDA PENDENTES. outbound=false/messaging=false continuam temporários. Testes instalam bundle assinado/admitido e intenção via fixture, não provam ainda criação/envio dinâmico pelas APIs. Próxima direcção em GROUP-OUTBOX-INTEGRATION.md e docs/GROUP-OUTBOX.md.

## Evidência dirigida

- Node:31 testes de outbox/comandos passaram24.787s antes das mudanças posteriores de cache/partilha.19 casos com partilha/cancelamento passaram17.837s. Dois controlos finais de cache/prova passaram2.336s. O gate completo corrente substitui estas versões na conclusão.
- Go/race dirigido final da cache:13 testes de topo; groupledger1.773s, app71.927s, transport4.355s; sem falhas. O helper de morte real é omitido isoladamente e executado pelo driver.
- Quatro saídas reais Node/Go antes/depois de commit (81/82), reabertura pelo outro núcleo e retorno ao original passaram7.743s. .cache/group-outbox-process/report.json.
-256 bundles/intentos reais,128 parados+128 pendentes, reabertura Node→Go→Node e256 stops finais passaram93.339s; após retirar verificações de reserva repetidas,69.791s. As consultas Go ainda custavam3.874/6.752s; foi acrescentada a cache transaccional com controlos de invalidação. No gate completo final, a fixture levou32.668s; consultas Go0.487/0.672s. Relatórios anteriores preservados em .cache/group-outbox-process/bounds-before-reservation-fix.json e logs .cache/group-outbox-bounds-*.txt.
- Uma edição inseriu o teste256 dentro de outro ciclo; quatro subtestes foram cancelados pelo pai. Corrigido para nível superior sequencial. Não é falha do produto nem passe; log preservado em group-outbox-process-bounds.txt.

## iOS/CI

CI34728934069/fde529e terminado: Node3OS, Go e3 desktop passaram. iOS26.4.1 boot148.054s/build-for-testing115.631s/install23.115s passaram, fotografia timeout60.836s, diagnóstico5.754s; XCUITest não executou. Só o dispositivo criado foi removido. Não apagar evidência274004e: nesse run a fotografia passou e houve1 teste real falhado por missing WKWebView. Nenhum fluxo funcional iOS passou. Evidência nova em docs/evidence/ios/fde529e; originais .cache/ci-fde529e-ios.

Código iOS local seguinte (não executado em Apple): teste separado de arranque antes da importação, captura nativa antes de terminar app, até2 PNG de arranque exportados separadamente. Fotografia e teste funcional completo continuam obrigatórios. Prazo WebView45s, isolamento e deadline global preservados.22 testes host/estática passaram; o gate completo repete-os. Não mexer em bridges/permissões/serviços nem assumir causa do addmedia. O log assetsd não demonstra a causa.

Android anterior: APK136a5103/AAR9e2fb77f,82 asserções no único emulador API36x86_64 e leitura SQLite Node passaram. C SQLite/Bionic com sqlite_omit_load_extension após SIGSYS comprovado; outros alvos mantêm modernc. AVD/adb próprios parados, identidade preservada. Estes artefactos não contêm as alterações novas. Assinatura Apple, hardware físico/radios, keystore/rotação, social/media/templates, pesquisa, notificações reais e revisão independente continuam segundo contrato. Backup integral válido antigo continua indetectável sem testemunha monotónica.

Histórico da retoma anterior preservado em history/RESUME-before-group-outbox-authority.md. O goal apareceu blocked por interrupções anteriores do upstream; o utilizador retomou explicitamente e o trabalho continua. Não marcar complete nem alegar disaster-ready/todos OS testados.


## Iteração seguinte em curso — envio real por API

Depois do commit93c598f, estão NÃO COMMITADOS group-send.ts/group_send.go e integração em node/outbox, mais testes/fixtures group-send. Preservar estas alterações. O envio agora deriva cartões/audiência de snapshot e target autenticados, exige head actual para uma nova intenção e rejeita membros/destinatários diferentes. A criação local verifica assinatura e decifra os bytes recém-criados; admissão e intenção preparing gravam juntos antes de tocar no content store/rede. Falta física não reconstrói texto/anexos a partir de preview. Reserva física precede ready/transmissão. Na recuperação preparing, o pin preservado também força a fronteira de escrita do índice.

Os dois testes Node reais passaram7.894s (processos/API/TCP, texto/anexo/reply sem contactos globais, head/audiência e UUID imutável após close). Um erro de estreitamento TS foi corrigido com groupEpoch local; typecheck corrigido passou. Go compilou e o caso de prova em falta passou0.944s. CLI Go reconstruída. Três percursos mistos native/node, node/native e native/native passaram10.782s, com anexo sem texto e reply, criação pela API real e sem injectar chaves/intentos. Logs .cache/group-send-node-first.txt, group-send-typecheck-corrected.txt, group-send-go-compile.txt, group-send-mixed-first.txt; relatórios .cache/group-send-interop. Estes não são o gate completo da árvore nova.

Ainda faltam confirmações automáticas de grupo, eventos relacionados, carriers e UI de composição/gestão; outbound/messaging continuam false até ligar o percurso completo. Próximos controlos: fronteiras de falha do preparing/ready, reinício entre motores, alterações de membros durante partição, revogação/reentrada, multi-adapter/seeder, e validação completa. Não concluir o produto.

CI34750795247 de93c598f aparece cancelled. Node3OS passou; o job Go lista os checks como success mas foi cancelado ao fim de cerca15min, pelo que desktop/iOS foram skipped. Não foi outro push: ls-remote confirmou93c598f. O log exacto está a ser recolhido em .cache/ci-93c598f-go-job.txt para confirmar a razão antes de alterar qualquer orçamento do projecto. Nada foi alterado em bridges/modelos/serviços externos.
