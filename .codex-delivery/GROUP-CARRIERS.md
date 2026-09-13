# Sincronização P2P de provas — implementação activa

## Recuperação sequencial de 2026-09-13 — estado mais recente

Confirmado `git status --short` sem perda de alterações; sessão85186 terminou0 (TCP→serial Node,10.351s).95GiB livres, sem agentes novos/retomados nem alterações a configuração/bridges/modelos.

- `node scripts/native-build.mjs`: saída0; `.cache/group-carriers/go-recovery-build.log`.
- `node --import tsx --test --test-concurrency=1 tests/native/group-sync-requests.test.ts tests/native/group-sync-serial.test.ts`:2 passaram22.538s; `go-recovery-transports.log`. Resposta perdida/cooldown/mesmos bytes/autoridade após close e TCP→PTY→serial com autor offline. PTY é fixture, não rádio.
- `node --import tsx --test tests/group-carriers.test.ts`:5 passaram3.455s; `codec-null-corrected.log`, inclui recusa de invitation:null na autorização.
- `node --import tsx --test tests/native/group-carriers.test.ts`:1 driver,18 vectores produzidos e verificados por Node/Go,4.257s; `vectors-first.log`. Inclui Unicode, pedidos/respostas, autoria interna, audiência excessiva, assinatura exterior não autorizada, cauda malformada, tamanho/esquema e corrupção. Go executado com race; chaves sintéticas só na cache privada temporária.
- Defeito reproduzido: `output` guardava respostas fora da quota auxiliar de `cache`; dois bundles ocuparam648886 bytes Node/649474 Go para um limite524288. Falhas `response-quota-{node,go}-before.log` preservadas. `retain` é agora comum a respostas e alterações locais; pressão adia respostas e conserva pins/reservas.3 testes Node passaram3.983s (`response-quota-node-corrected.log`); os4 testes runtime Go passaram com race31.888s (`response-quota-go-corrected.log`).
- Build/typecheck actual passou (`recovery-build.log`). `npm test` foi iniciado na sessão19734, log `node-regression-first.log`: recolher estado terminal antes de repetir ou alterar fontes. Nenhum outro teste/build conhecido activo. Ainda NÃO é gate integral.

Faltam ainda os restantes controlos adversariais C1 e a regressão completa, C2 e C3. A nova revisão é de root; não é independente. Nenhum commit/push desta fase.

Base adfd52a, árvore limpa confirmada e97GiB livres. O turno anterior foi progresso: eventos de grupo implementados, gates completos e dois commits/pushes. CI34765195200 observado em execução, sem resultado presumido. Recuperação sequencial mantém-se: sem agentes novos/retomados, sem alterar modelos/providers/bridges/auth/serviços/permissões.

## Arquitectura decidida

Usar bundles `group-control` assinados/cifrados do ContentStore e o transporte/inventário existente, com esquema separado do conteúdo que a UI renderiza. Não expor um endpoint capaz de assinar controlo arbitrário. Certificados internos continuam a ser do criador; o assinante do carrier pode ser um leitor que retransmite os mesmos bytes/provas. Sem novo serviço ou bootstrap central.

1. Carriers privados de estado (header+snapshot) e pedidos/respostas paginados de headers/snapshots. Estado privado só é cifrado para os membros exactos do snapshot assinado; respostas individuais exigem cartão do solicitante comprometido numa época verificada. Convite não autoriza snapshot antigo. Headers para antigo membro param no primeiro limite que lhe retira o cartão, incluindo esse limite para aplicar a revogação.
2. Actualizações aplicam headers e as paragens da outbox/eventos antes de snapshots e antes de responder; um snapshot/tail inválido não desfaz um prefixo restrictivo válido. Não confiar no autor exterior como autoridade de membros, em head/hints não ancorados nem em resumo de UI.
3. Descobrir produtores através de cartões já verificados (criador, snapshots, contactos opcionais e autores de bundles); nenhum contacto global obrigatório. Pedidos e publicação têm cadência/bytes/cache/TTL limitados. Recuperação/replay usa estado durável e controlos idempotentes; não reenvia mensagens de grupo antes de verificar os controlos pendentes recebidos durante lock.
4. Convites/consentimentos/saídas: inbox limitada sem auto-inscrição; entrada e mudanças de membros por acção explícita. Persistir material necessário ao envio junto da operação autenticada, sem perder o cartão do convidado num crash e sem deixar quota de rede reverter uma paragem de segurança. Não inventar expiração nos certificados existentes, que são vinculados ao parent; TTL do transporte é distinto.
5. Depois ligar criação/convites/entrada/gestão e composição por épocas à UI Liquid Glass, com audiência revista, rascunhos e todos os controlos acessíveis. Manter flags de produto parciais enquanto faltar integração.

## Sequência e gates

C1: codec/ACL Node+Go e sincronização automática de provas de grupos conhecidos por sockets, bootstrap com lacunas e seeder offline. C2: carriers duráveis de convite/consentimento/saída e inbox/gestão local real. C3: UI dinâmica completa e respectivos E2E. Continuar através das fases, não converter C1 em conclusão do produto.

Testar envelopes/ACL, excesso de leitores, assinatura de leitor sem autoridade, corrupção/replay, ausência de bytes/provas, limites e falhas de commit. Processos reais Node/Go, vários hops/adaptadores suportados, partição/heal, autor desligado, entrada/remoção/reentrada/close, passado inacessível ao novo membro e controlos positivos. Gate integral de núcleos/race/SQLite/interoperabilidade/UI/desktop, plataformas e revisão independente permanecem obrigatórios.


## Implementação corrente e evidência

Node e Go têm codec+ACL, runtime sync, replay disponível após unlock, pedidos/respostas privadas e cache de cada alteração local, com notices dirigidos de remoção. Snapshots de resposta podem ser cifrados só para produtor/solicitante autorizados; difusão usa roster completo. Bibliotecas e runtime ainda NÃO COMMITADOS. Novos testes estão incluídos em package.json test:native através de ./groupcontrol.

5codec/ACL Node3.336s;2TCP Node14.153s;8Node apóscache17.647s;3Go codec/race6.364s;3mistosbásicos15.341s;5mistos comcache/seed19.151s;Node seeder9.289s;Node replay>16controlos9.404s;Go runtime consentimento/fence7.385s passaram. São resultados dirigidos de versões próximas, não gate completo. O teste TCP de snapshots fora de ordem passou sem alteração adicional do registo; não inventar a falha inicialmente suspeitada do título.

CI34765195200/adfd52a: Linux/Windows Node eUI Linux passaram, macOS falhou fetchfailed em group-event-seeding.ts285 no commit de remoção apósreinício; restantes jobs skipped, iOS não foi executado. Log obtido por endpoint do job103744808644 (gh --log-failed estava vazio). Foi acrescentado agentHTTP porincarnação e diagnóstico sem retries gerais. Umaexecução local observouECONNRESET com processoalive, outra passou38.683s; causa macOS permaneceindeterminada. Não rotular isto como correção comprovada nem alterar limites para escondererro.

Checkpointdirigido44224 em .cache/group-carriers/checkpoint/report.json executa typecheck,10casosNode,3GoCodec/race e2GoRuntime/race. Recolher saída antes de repetir. Fontes314 registadas no mesmo directório; confirmar hashes. Nenhum commit/push desta fase enquanto não forem fechados os controlos e regressão integral.

Próximos passos: terminar gates adversariais C1 (ACL/TTL/flood, falhas de leitura/commit/cache, scopes após corrupção, seeder e múltiplos adaptadores, equivalênciaNodeGo), resolver/diagnosticar HTTPmacOS sem ocultar operações. Depois C2: armazenar material de envio junto da operação de convite/consentimento/saída e inboxlimitada semauto-adesão; C3: ligar UI de grupos à autoridadeactual. Não substituir o contrato integral por esta primeira sincronização de provas.


## C1 — gate final concluído, contrato incompleto

Build6.056s;253 Node405.684s;161 Go principais/race711.420s (12 helpers pelos drivers);47 interoperabilidade480.894s;35 SQLite C283.498s;19 UI Node138.097s/19 Go128.687s. Desktop Linux preparação0.319s/execução2.412s/pacote --dir7.260s/execução empacotada1.255s.62 Axe sem violações;326 fontes inalteradas. Sessões83929 e43358 terminaram0. Evidência em docs/evidence/group-carriers/final, falhas em adversarial. Root reviu as capturas; revisão independente e plataformas actuais pendentes. C2/C3 e todo o resto de PROJECT-BRIEF continuam activos; não marcar produto completo.
