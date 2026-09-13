# RelayLoom — retoma activa, 2026-09-13

Contrato integral: PROJECT-BRIEF.md. APENAS /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra e não alterar providers/autenticação/bridge/serviços externos/permissões/segurança. Execução sequencial: sem agentes novos/retomados. Checkpoint adicional de manutenção cancelado pelo utilizador. Commits/pushes normais autorizados; nunca force-push ou merge de PR. Caches no projecto, uma compilação pesada de cada vez e>=15GiB livres (106GiB medidos). Não aceder a outros projectos/ficheiros pessoais.

## Estado corrente

A base publicada anterior é274004ee0e4c3d2a3f5c9513bdb741fc0ee3e4e9. As reservas estão versionadas em6734f1f; a admissão/evidência está no commit que contém esta retoma. O push normal está autorizado. Confirmar HEAD/origin com Git antes de pressupor publicação; nunca fazer reset para a base histórica. Todo o trabalho foi preservado.

Reservas físicas Node/Go: reserved é separado de pinned; sobrevive ao reinício, respeita quota/TTL e não confere leitura/autoria. Índice antigo sem reserved continua legível; Go injecta só esse default local antes da validação estrita. Falha inicial de restart e correcção preservadas.

Admissão Node/Go: bytes/assinaturas/payload completo antes de projecção; histórico só do ledger autenticado; aceitação e mutação/confirmação privada no mesmo commit. Quarentena física, falha de reserva, perda de resposta e recuperação assinada. As tags não caem no caminho legado; tombstone mantém efeito após retirada do alvo. Consulta estável usa um scope de leitura por snapshot, sem cache entre transacções. Teste32 mensagens/32 épocas:1024 visitas/3363ms antes;32/~120ms depois, mantendo encerramento efectivo.

Envio/outbox dinâmica, emissão de confirmações pela app, carriers automáticos e UI dinâmica AINDA NÃO estão ligados. outbound=false/messaging=false são temporários, não conclusão. As fixtures assinam/injectam os bundles e transferem provas por API. Próxima implementação concreta em GROUP-OUTBOX-INTEGRATION.md; substituir as recusas temporárias por execução real sem reduzir requisitos.

## Gate concluído

Sessões1317 e47369 terminaram0. 190 testes Node passaram137.762s;129 testes Go de topo/race396.073s (9 helpers executados pelos drivers de interoperabilidade);24 testes de interoperabilidade219.736s; fronteira SQLite C15.538s;16 UI Node112.941s e16 UI Go103.288s. Build6.072s e CLI0.221s passaram. Desktop Linux: preparação0.224s, execução1.028s, pacote5.347s e execução empacotada0.798s.22 relatórios Axe actualizados, zero violações. Fontes inalteradas em todas as fases. Evidência em docs/evidence/group-content/final.

Nenhum teste local desta fase está em curso. Não repetir por perder handles. Fontes do gate em source-hashes.json; logs/relatórios/capturas separados por núcleo. CLI actual é pure Go por omissão. AAR/APKs anteriores não contêm estas alterações. Detalhes em GROUP-CONTENT-INTEGRATION.md e docs/GROUP-CONTENT.md.

## Apple e restante âmbito

CI34721962376/274004e terminou: Node3OS, Go e3 desktop passaram. iOS26.4.1 importou fotografia10.038s; XCUITest lançou app PID17625 e executou1 teste, falhado57.965s por missing("WKWebView startup") após45s. Nenhum fluxo funcional passou. O flag simulatorExecuted=false do runner refere o gate completo, não apaga o lançamento/teste real. docs/evidence/ios/274004e. A próxima alteração de diagnóstico deve capturar a tela de falha antes de terminar a app; não mexer em bridge/configuração, não aumentar prazos nem repetir cegamente addmedia, que já passou.

Android: APK136a5103/AAR9e2fb77f passaram82 asserções no único emulador API36x86_64 e leitura Node do SQLite. Usa C SQLite/Bionic após SIGSYS comprovado; modernc mantém-se nos restantes alvos. AVD/adb próprios parados; identidade preservada. Novas fontes exigem novos artefactos/gates; não há hardware/ARM64 físico/radios/assinatura validados.

Continuar outbox/autoridade em um commit com stop reservado mesmo em quota cheia, depois publicação, sync/carriers, UI e gates completos de rede/partição/heal/seeder/corrupção. Continuar também keystore/rotação, pesquisa, social/media/templates, notificações reais, acessibilidade e revisão independente quando autorizada. Backup válido antigo continua indetectável sem testemunha monotónica. Produto experimental e incompleto; nunca declarar disaster-ready/todos OS testados.

Histórico preservado em history/RESUME-before-admission-milestone.md. Não relançar processos antigos indicados no histórico como activos nem copiar caches de staging sobre as fontes actuais.
