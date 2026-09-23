# RelayLoom — retoma após entrega verificada dos recibos

Objectivo integral activo; produto não concluído. Preservar PROJECT-BRIEF.md: messenger/social P2P cifrado, sites expressivos inspirados no ZeroNet, cinco SO e web autónoma com paridade, Reticulum/meios agnósticos, setup PT-PT/EN/ES e Liquid Glass. Recuperação sequencial: não criar nem retomar subagentes; manter Astra/Copilot Ultra e configurações/serviços. Checkpoint adicional de manutenção cancelado.

## Estado de trabalho

Worktree activa `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal em `codex/setup-languages` / `1e83db22`, com WIP histórico separado. HEAD de implementação **426b471b72b0f8ca6ec3f42ce9a1fdf03a73e05b**; último push confirmado **14457fd95345d15267f210fa9eec923b7fd1fad0**. Provas/documentação desta fase estão a ser consolidadas. Preservar alterações históricas/capturas e symlink node_modules; staging selectivo, nunca git add -A/reset/force-push. Não fazer merge sem aprovação.

Reserva observada na retoma: cerca de17 GiB; mínimo15 GiB, uma execução pesada de cada vez e caches do projecto. Não há teste local conhecido activo; handles69695 e96519 terminaram e foram recolhidos. Não relançar a suite por causa de notas históricas de processos.

## Incremento verificado

426b471 entrega o recibo privado do dono em Node/Go/browser e fecha atomicamente a fila do visitante. Requer assinatura/destino/prazos e intenção anteriormente copiada; cancelled/expired conservam o estado, sem renovar autorização. Recupera recibos recebidos bloqueado (32 candidatos/ciclo); fila do dono roda8intenções/ciclo. Recibo autêntico sem história local não fechaRTC, enquanto corrupção continua a falhar.

Gate final `docs/evidence/site-contributions/receipt-delivery/gate.json` **PASS**:531Node,17pacotesGo/race,135casos entre processos e110porChromium/Firefox/WebKit; typecheck/buildsPASS,757hashes conferidos contra426b471. Node/Go/build/processos conservam proveniência explícita do primeirogate; os3browsers foram repetidos após correcção de duasfixtures WebKit. O primeirogate permaneceFAIL.82artefactos com manifesto. Reprodução limpa: `node docs/evidence/site-contributions/receipt-delivery/before-fixture-review/run-gate.mjs`. Não repetir agora sem mudança/defeito que o justifique.

CI35802455142/14457fd terminalFAIL apenas iOS: restantesjobsPASS; browser90+69=159PASS epartição completa validada. iOSbuild/install/startupPASS; addmedia excedeu60.364s antes do percurso principal.37artefactos curados em docs/evidence/ci-14457fd. Não éHTTP408 e não prova anexo/resposta. Nenhum CIactivo observado nesta retoma.

## Próximos passos

1. Consolidar docs/provas selectivamente, verificar manifestos staged e pushnormal autorizado. Verificar novoCIantes de outro push para não cancelar operação emcurso.
2. Recusa assinada distinta de descarte local: derivar intenção da inboxautêntica, retercard antes de purga, persistência/entrega/admissão com bloqueio/sessão/prazos. Rascunho `.cache/contribution-decision-draft/contribution-rejection.ts` ainda não integrado/testado; rever antes de usar.
3. Decisão CAS/base/esquema/audiência, publicação recuperável eproveniência separando proposta original de edições do dono. Só `published` depois de reler cópia real. Ver CONTRIBUTION-DECISION-UI-NEXT.md; paleta permanece oculta até fluxo completo de trêscontas PT/EN/ES, acessibilidade erevisão visual.
4. Apple: rascunhos em `.cache/ios-photo-warmup-draft` são hipótese nãointegrada/nãocompilada. AbrirPhotos apenas no UUIDdo simulador criado; selector observado nopicker não é evidência daappPhotos. Faltam testeshost eexecuçãoApple. Não aumentar prazos/repetir mutação incerta/alterarserviços.
5. Manter gruposwebdinâmicos, backup/rotação/keystore, hardware/rádios, paridade/revisãoindependente obrigatórios. Revisãoprópria não satisfaz gateindependente.

HTMLpúblico inalterado: runtime7fdb76a5de5869efa6ebdd721bc7e8f5efac68af, distribuição0fdbd1b9563540a5bc28c74d669668e948aa7667, https://johnnypbelo.github.io/relayloom/. Não publicarHTMLsem gateexacto/HTTPS. Não declarar disaster-ready, todosOS testados ou produto concluído.

Histórico desta fase, incluindo notas já ultrapassadas de processos emcurso: [RESUME-before-receipt-delivery-complete.md](history/RESUME-before-receipt-delivery-complete.md).

## Continuação actual — recusa explícita

Recibos/provas enviados em9a56c5f; CI35855333712 queued na última consulta. Protocolo novo da2d174 local, gatePASS com64vectores/Go-race e2testes porbrowser. Integração posterior de persistência da recusa é WIP:70vectores e typecheckPASS; handle25466 em execução, log .cache/rejection-storage-first.log. Browser novo ainda nãoexecutado. Ler CONTRIBUTION-REJECTION.md na worktreeactiva para comandos/limites. Não atribuir passes do protocolo ao novoarmazenamento; não repetir testes enquanto vivos.

## Gate amplo actual

73110 terminou/recolhido PASS: typecheck,37 casos Node/catálogos/processos (incluindo70vectores de operações e concorrênciaSQLite real),9 Chromium/9 Firefox/9 WebKit. Relatório .cache/rejection-storage-directed/report.json, hashes iguais antes/depois. O namespace privado acrescentou12 controlos ao driver que já passara anteriormente; não confundir passes parciais com o gate amplo.

**98625 emcurso**, .cache/rejection-storage-final/report.json, driver .cache/rejection-storage-final-gate.mjs. TypecheckPASS, suite Nodeintegral emcurso, depois17Go/race, builds, processos e120casos previstos porengine. Fontes congeladas; lista selectiva .cache/rejection-storage-source-paths.json. Não editar/repetir testes enquanto vivo.

CI35855333712/9a56c5f: Windows eUbuntu falharam em npmtest no auxiliar Go de orçamento de recibos aos60s; macOSainda emcurso. Ver CI-9A56C5F.md. Hipótese compilação+execução no mesmo prazo; driver alternativo emcache ainda nãointegrado. Preservar falhas, não aumentar cegamente o prazo de execução nem cancelar jobs.

## Gate amplo terminou; reserva de disco interrompeu cinco testes

98625 terminou/recolhidoFAIL:535NodePASS,17pacotesGo/racePASS (app/sites executados, restantes comcache),buildnativoPASS; testes entre processos162/167PASS. Cinco casos de tests/native/site-contribution-source.test.ts falharam ao arrancar Node porque a reserva desceu abaixo15GiB. Não é corrupção nemHTTP408; os pares nem arrancaram nesses casos. Buildweb/matriz120porengine ainda nãoexecutados neste gate. Fontes não foram alteradas; confirmar hashes antes de herdar fasesPASS.

Disco actual~13GiB durante recuperação. Nenhum teste local continuaactivo. **67580 emcurso**: compactação verificável de8AppImageshistóricos, em .cache/archives/desktop-history-20260923.tar.xz (na principal). Só remove originais após verificar todos osSHA256 e poupança suficiente; conserva provas/fontes/WIP/perfis/instaladoractual. Auditoria .cache/archives/desktop-history-20260923.json. Não interromper nem iniciar builds.

Depois recolher67580, restaurarreserva15GiB através de caches regeneráveis do projecto e confirmar espaço. Retomar os6casos do ficheirobloqueado e fasesweb/browsers com fontesiguais, preservandoFAILoriginal e proveniência das fasesanteriores. Não repetir535Node/Go só por perderumhandle. Mediçãofria do auxiliarCI e rascunho de admissão continuam fora dasfontes/nãoexecutados.
