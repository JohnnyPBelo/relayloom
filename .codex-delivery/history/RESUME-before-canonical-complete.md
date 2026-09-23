# RelayLoom — retoma após recusa persistente e correcção do teste frio

Objectivo integral activo; produto não concluído. Manter PROJECT-BRIEF.md: messenger/social P2P cifrado, sites expressivos inspirados no ZeroNet, Liquid Glass, cinco SO e web com paridade, Reticulum/meios agnósticos, setup PT-PT/EN/ES e todos os gates. Recuperação sequencial, sem novos/retomados agentes; Astra/Copilot Ultra e configurações/serviços mantidos.

Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal em `codex/setup-languages` / `1e83db22`, com WIP histórico preservado. Código verificado localmente em `627ad6c0b98e10b0d4c4c68e3dffb7072118a81d` (persistência) e `e95b06853e2f57dc03e917da5ffb8e425f2d045e` (driver CI). Protocolo anterior: `da2d174`. Documentação/provas acompanham num commit posterior. Último envio confirmado antes desta nota: `9a56c5f`; consultar Git/origin e `.cache/latest-push.json` após o push de consolidação. Staging selectivo; preservar capturas/JSON históricos e node_modules; não usar git add -A/reset/force-push ou merge sem aprovação.

## Estado verificado

627ad6c guarda a decisão explícita do dono e remove a prova da proposta no mesmo commit. CAS da inbox, motivo/destinatário/prazo fixos, assinatura/selagem/cópia recuperáveis em Node/Go/browser. Recibos anteriores e outras preparações preservados; recusar sem origem não afirma verificação da origem. Namespace privado separado, sem expor helpers na RPC. Ainda não há entrega/admissão de recusas nem UI completa.

Gate revisto **45240 terminou e foi recolhido PASS**:535 Node,17 Go/race (app/sites novos, outros cached),167 casos únicos entre processos,120 por Chromium/Firefox/WebKit, builds e768 hashes conferidos no commit. O gate original98625 teve5 arranques bloqueados por reserva abaixo15GiB; a revisão repetiu os6 casos do ficheiro afectado (5 falhas+1 controlo), conservou os passes de fontes idênticas e concluiu a matriz. O original permanece FAIL. Provas em `docs/evidence/site-contributions/rejection-storage`; reprodução integral pelo driver `before-resource-recovery/run-gate.mjs`. Protocolo da2d174:64 vectores e regressão de recibos, Go/sites-race e2 casos por engine, provas em rejection-protocol.

**Nenhum teste ou arquivo local conhecido continua activo.** Handles45240,98625,83456,93355,67580,21672,80819 e24563 foram recolhidos. Não repetir suites por falta de handle.

## CI e diagnóstico concluído

CI35855333712/9a56c5f terminou FAIL no mesmo auxiliar Go aos60s nos três hosts; os jobs dependentes foram skipped. Provas `docs/evidence/ci-9a56c5f`.

21672 reproduziu localmente com caches próprias vazias: comando combinado parou aos60.009s ainda na preparação/vet, sem lançamento de app.test ou resultado. Compilação separada62.177s e execução27.353s PASS. e95b068 separa compilação/vet (limite120s) da execução (limite exterior60s, Go55s para diagnóstico). Mantém race, vet e cobertura, sem mudar limites dos jobs. Typecheck e3 testes do driver integrado PASS:62.267s preparação+27.335s execução. Provas `docs/evidence/ci-receipt-budget-cold`. Ainda precisa do próximo CI Windows/macOS/Linux; não reclassificar a falha anterior. Não éHTTP408.

## Recursos e restauro

Confirmar pelo menos15GiB antes de cada fase pesada; uma de cada vez, caches do projecto. A última medição ficou acima18GiB, mas o volume oscilou. Foram removidas apenas caches regeneráveis (Go build,8 binários de teste eChromium headed1243); headless-shell/Firefox/WebKit permanecem e completaram a matriz. O CLI actual, APKs, perfis, AVD, fontes e WIP estão preservados.

Oito AppImages antigos estão arquivados com todos os hashes verificados: `.cache/archives/desktop-history-20260923.tar.xz` na principal. Restauro exacto: `python3 -m tarfile -e /home/absint0o/projects/relayloom/.cache/archives/desktop-history-20260923.tar.xz /home/absint0o/projects/relayloom`.

**Antes do próximo emulador Android**, restaurar a imagem inactiva do SDK: `python3 /home/absint0o/projects/relayloom/.cache/android/archives/restore-system-image.py`. O arquivo `.img.xz` preserva SHA256 eb4bd8cc…a1 e tamanho lógico; userdata não foi modificada. O restauro exige espaço adicional para conservar15GiB e verifica os bytes. Não redownloadar imagens nem alterar permissões/serviços.

Só a worktree antiga e comprovadamente limpa site-ci-clean foi retirada, com SHA6dd879d ancestral preservado. Cache/dist ignorados estão em `.cache/retired-worktree-support/site-ci-clean`; auditoria `.cache/disk-recovery-rejections-20260923.json`. site-data-next permaneceu intacta por ter ramo não ancestral. Não remover WIP de outras worktrees.

## Continuação

1. Consolidar docs/provas por manifestos, confirmar nenhum CI activo e fazer push normal. Registar o novo run em `.cache/latest-push.json`; observar o resultado do driver frio antes de outro push.
2. Integrar admissão/entrega da recusa nos catálogos, runtime/API, validação e transportes. Os dois rascunhos em `.cache/rejection-admission-draft` têm hashes de base: ainda não instalados/compilados/testados. Rever cada ficheiro antes de integrar; não copiar cegamente. Ver REJECTION-DELIVERY-NEXT.md e CONTRIBUTION-REJECTION.md.
3. Depois incorporação com CAS da revisão actual, reconciliação de esquema/audiência, proveniência distinguindo proposta original e alterações do dono, publicação recuperável e UI completa de três contas PT/EN/ES. Paleta oculta até ao fluxo completo; ver CONTRIBUTION-DECISION-UI-NEXT.md.
4. Manter grupos web, backup/rotação/keystore, plataformas/rádios físicos, acessibilidade e revisão independente obrigatórios. Revisão própria não satisfaz o gate independente. Rascunhos Photos em `.cache/ios-photo-warmup-draft` continuam não integrados/não compilados; Apple/signing e percurso fotográfico continuam sem passe integral.

HTML público inalterado: runtime7fdb76a5de5869efa6ebdd721bc7e8f5efac68af, distribuição0fdbd1b9563540a5bc28c74d669668e948aa7667, https://johnnypbelo.github.io/relayloom/. Publicar só após gate exacto/HTTPS. Não declarar disaster-ready, todos os SO testados ou produto concluído.

Histórico: [RESUME-before-refusal-storage-complete.md](history/RESUME-before-refusal-storage-complete.md).

## Envio confirmado

HEAD/origin `d6d4ddb9cde7e29e04aadd32a6ce68f049e77fcc` iguais; push normal concluído, inclui da2d174/627ad6c/e95b068 e provas. Novo CI: 35868125390 queued. Estado actualizado em .cache/latest-push.json da worktree activa. Não cancelar um CI activo com outro push. Nenhum teste local conhecido em curso; seguir admissão/entrega da recusa e observar o CI.

## Matriz dirigida recolhida — entrega implementada, gate amplo pendente

31844 e86666 terminaram e foram recolhidos PASS. A última matriz passou typecheck,4casos nativos de recusa (dois sentidosNode↔Go, reinícios; cancelamento/expiração com dono offline e seeder opaco) e6casos porChromium/Firefox/WebKit (RTC/reabertura, histórico ausente sem fecharcanal,4percursos RTC→WS com Node/Go emambosossentidos). O intermediário não lê proposta nem motivo; publish genérico recusa criar controlos, com tráfego positivo após a recusa. Logs em .cache/rejection-mixed-first. O gate anterior de6casos também incluiu4 regressões dosrecibos.46 vectoresde admissão com resultados Node/portátil/Go iguais permanecemPASS.

Nenhum teste local conhecido continua activo. WIP de25ficheiros ainda não commitado nem publicado; lista .cache/rejection-delivery-source-paths.json e hashes só no momento da recolha em .cache/rejection-delivery-sources-at-collection.json. Não inferir freezeantes/depois onde o driver não o registou.

Próximo: rever/testar orçamento combinado8→9 (rascunhos .cache/rejection-owner-budget-node-draft.ts e .cache/rejection-owner-budget-go-draft.go ainda não instalados/compilados/testados; 4propostas verificadas+recusadas dão8 controlos, mais1recusa semorigem dá9). Acrescentar quota/política retida, negativosderede/corrupção/auth, atomicidade/crashes, recuperação browserbloqueado/reload/worker e regressão ampla antes de consolidar. A UI completa, incorporação/publicação/proveniência e restante contrato continuam pendentes.

CI35868125390/d6d4ddb: native-nodePASS emUbuntu/macOS(535/535,sem skips) eWindows(528PASS+7skips previstos). Driverfrio teve compilação67.773/50.173/68.117s eexecução28.206/28.411/21.591s respectivamente. Logs oficiais em .cache/ci-d6d4ddb. Outros jobs ainda activos/pendentes na última consulta; não cancelar compush. Estes resultados correspondem ad6d4ddb, não aoWIPposterior.

## Continuação — orçamentos, autorização e atomicidade

O turno anterior foi progresso; a integração continuou com controlos efectivos.51693 terminou/recolhidoPASS:6casos Node/Go (orçamento conjunto4recibos+5recusas, primeirociclo8/segundo9, quota real e envelopes preservados, mais regressão dos recibos). Os rascunhos de orçamento foram integrados e executados.

Falha real reproduzida no browser: revokeInvalid só retirava autorizações dos recibos; uma recusa com resposta de política retida sobrevivia a bloquear/voltarapermitir.29735 terminouFAIL como esperado antes da correcção (retainedtrue quando deveriafalse), provas em .cache/rejection-revocation-before e log .cache/rejection-revocation-before.log. Corrigido percorrendo ambos os mapas.52866 terminou/recolhidoPASS: typecheck,2casos de rede Node/Go com12controlos adversariais e positivos no mesmo canal,25casos porChromium/Firefox/WebKit (admissão/recuperação, fila conjunta, revogação retida e regressão de recibos).

83351 parou no typecheck das novas fixtures atómicas: camposcreated antigos e kind duplicado. Corrigidas apenas essas fixtures;59720 terminou/recolhidoPASS: typecheck,12casos de armazenamento entre processos com crashesNode/Go e concorrênciaSQLite, webbuild e3casos porbrowser no worker compilado, com setup/ligaçãopelaUI e retomaoffline. Não éUIcompleta de contribuições. Logs .cache/rejection-atomic-worker-first; a falha de typecheck fica em .cache/rejection-atomic-typecheck.log.

**Gate amplo22962 emcurso**, driver .cache/rejection-delivery-final-gate.mjs, relatório .cache/rejection-delivery-final/report.json. Fonte congelada e hashes conferidos; umafasepesada decada vez comreserva15GiB. Vai correr Nodeintegral,17Go/race, builds,185casos entreprocessos previstos e140porbrowser previstos. Ler resultado antes de editar fontes ou repetir; ainda WIP, semnovo commit/push. Lista selectiva .cache/rejection-delivery-source-paths.json.

Manter todos os requisitos e a paleta oculta até fluxo completo de aprovação/incorporação/reconciliação/proveniência/publicação e UIde3contas PT/EN/ES. Nenhuma revisão própria substitui revisãoindependente. HTMLpúblico inalterado; SDKsystem.img arquivada, restaurar comguard antes de emulador. CI35868125390/d6d4ddb aindaactivo na última consulta:3hostsNode eNodeUIpassaram, native-goemcurso. Não cancelar comoutropush nem atribuir essespasses aoWIP.

## Observação actual do gate e do CI

22962 permanece vivo, confirmado pelo handle ePID. Typecheck e **539testesNodePASS**, semfalhas/skips; native-race emcurso. Os780hashes de fonte foram conferidos como iguais; não editar nem repetir enquanto o gate corre.

CI35868125390/d6d4ddb terminouFAIL numa fronteira diferente: os três native-node eNodeUI passaram, mas Go/app atingiu o limite acumulado10min durante o teste de recuperação de site grande. A stack tem uma rotina runnable em canonical.appendString com base64~1,46MB, mantendoNode.mu; não foi demonstrado deadlock. Outros jobsdependentes foram skipped. Log oficial e sumário em .cache/ci-d6d4ddb; diagnóstico em CI-D6D4DDB.md.

Preparado rascunho .cache/canonical-fastpath-draft/canonical.go, com hashbase emmanifest.json. Ainda não instalado/compilado/medido/testado. Depois do gate, medir/rever fastpathASCII com igualdade byte-a-byte, Unicode/WTF-8/escapes/UTF-8 inválido e limites; verificar alteração adicional da pontuação no limite global. Não aumentar prazos nem remover validações. A publicação/incorporação/proveniência e UIcompleta seguem no objectivo integral; não reduzir a tarefa a este problema deCI.

## Gate avança para processos reais

22962 confirmado vivo, agora em native-integration.539Node,17pacotesGo/race ebuildnativoPASS. Go/app terminou localmente em468.735s; Go/sites13.289s. Os780hashes continuam iguais. Não reclassificar oFAIL doCI pelo passe local nem afirmar optimização ainda não executada.

CIterminal d6d4ddb curado em docs/evidence/ci-d6d4ddb (8artefactos/manifesto). Rascunho .cache/canonical-fastpath-draft contém agora também canonical_fastpath_test.go: referência anterior do encoder,512combinaçõesASCII/escapes/Unicode/WTF-8/bytes inválidos, fronteiras de24MiB ebenchmark de~1,46MB. Ainda não instalado/compilado/executado. Antes de aplicar, rever a alteração do limite final separadamente da optimização e medir original/novo; manterrace/vet/cobertura e todasasautorizações.

Nenhuma nova fonte de produção foi editada durante o gate. Continua primeiro a recolha/regressão; depois resolver o custo de serialização e seguir incorporação/proveniência/UI sem reduzir o contrato. Não declarar produto concluído.

## Entrada na matriz completa de browsers

22962 permanece vivo e confirmado; agora browser-chromium.539Node,17Go/race,buildnativo,185testes entre processos ewebbuildPASS. Nenhuma falha/skip nos relatóriosNode/processos. A matriz anunciada tem140casos porengine, emsequênciaChromium→Firefox→WebKit; não antecipar resultado.780hashes iguais.

Foi confirmada uma questão de versão para a incorporação: o formato4 já contém formulários. A proveniência precisa de nova versão; tabelasv1 mantêm IDs até40caracteres e orçamentos actuais. Notas em CONTRIBUTION-DECISION-UI-NEXT.md. É desenho a implementar depois da regressão/desempenho, não funcionalidade pronta nem passeUI.

Rascunho canónico continua fora dasfontes e não foi executado. Nenhum processo foi reiniciado/interrompido por expiração de observação. Continuar pela recolha do mesmohandle/relatório, mantendo todoo objectivo.

## Chromium integral concluído; Firefox activo

22962 confirmado vivo em browser-firefox.539Node,17Go/race,185processos,builds e140ChromiumPASS; relatórioChromium semfalhas/skips/flaky.780hashes iguais. Não tocar nasfontes nem repetir asfases concluídas; esperar Firefox eWebKit.

.cache/curate-rejection-delivery.py foi preparado, ainda nãoexecutado: exige gatePASS e hashes iguais no commit, conserva a falha de revogação e os controlos dirigidos. Executar só depois de terminar/rever o gate e commitar a lista selectiva .cache/rejection-delivery-source-paths.json. Não curar resultados parciais comoPASS.

## Firefox integral concluído; WebKit activo

22962 confirmado vivo em browser-webkit. Chromium eFirefox terminaram140casos cada, semfalhas/skips/flaky. WebKit iniciou140casos e ainda não temresultado terminal. Fonte continua congelada; manter ohandle/relatório e não repetir testes por timeoutdeobservação. Só consolidar apósGatePASS e verificação dos780hashes.

## Entrega de recusas consolidada; optimização canónica em regressão

22962 terminou/recolhidoPASS:539Node,17Go/race,185processos,140Chromium/140Firefox/140WebKit, builds e780hashes. Fonte commitada localmente em **ac772242145135894da0d97b1712bc7e9db64c92**; curador52151 terminou/recolhido e guardou55artefactos em docs/evidence/site-contributions/rejection-delivery. Ainda semnovo push, para tratar a falhaCI antes de o repetir. Todo o restante objectivo continua activo.

51033 terminou/recolhido: baseline canónica sem alterar produção. Compatibilidade com referência anteriorPASS; o novo controlo de limite final FALHOU como esperado porque a pontuação final podia exceder24MiB. Benchmarkrace de~1,55MB:142.9/144.2/148.4ms por operação,32alocações e~8,39MB alocados. Logs .cache/canonical-baseline.

Foi aplicado o fastpath de sequênciasASCII sem escapes e a verificação final do orçamento. Unicode/WTF-8/escapes mantêm o percurso anterior.36658 terminou/recolhidoPASS: typecheck,Go/core-race,512combinações decompatibilidade/limites,260vectores combytesesperados doNode, benchmarkrace e teste de recuperação de site. Novo benchmark6.20/5.20/4.97ms,4alocações e~3,10MB; o teste de recuperação passou em31.881s. Não generalizar este microbenchmark a todoo produto nem declarar CI corrigido semnovaexecução. Logs .cache/canonical-fastpath-first.

**64504 emcurso**, driver .cache/canonical-final-gate.mjs, relatório .cache/canonical-final/report.json. Nova regressão completa sobre a produçãoalterada, fontescongeladas ehashesconferidos. Não editar/não relançar enquanto estiver vivo. WIP desta optimização: native/core/canonical.go, native/core/canonical_fastpath_test.go e tests/canonical-runs.test.ts. Não voltar a copiar rascunhos antigos.

Depois: recolher64504, corrigir falhas, consolidar provas comdiferença de versão e gates, actualizarREADME/STATUS/retoma e fazerpushnormal apósconfirmarCIanterior terminal. Continuar incorporação/proveniência/formulários/revisão/publicação/UIde3contas e todoocontrato; o incremento de recusa não conclui as páginas nem o produto.

## Regressão canónica avança para Go

64504 permanece vivo, agora native-race. Typecheck e540testesNodePASS, semfalhas/skips. Os782hashes de fonte continuamiguais. Não editar nem relançar enquanto o gate está activo; depois recolherGo/processos/browsers e só então consolidar a optimização. O microbenchmark continua limitado à serializaçãoASCII local; não implica aceleração uniforme do produto nem passeCIremoto.

## Go/app passou na regressão optimizada

64504 já avançou para native-integration, confirmado vivo. Os17Go/race ebuildnativo terminaramPASS. Go/app terminouPASS em384.325s (execução anterior de entrega de recusas468.735s nestehost), Go/sites10.997s. É uma observação local, não garantia de melhoria uniforme nem passeCI. As restantes fases continuam;782hashes iguais e fontescongeladas.

Preparado .cache/curate-canonical-performance.py, ainda não executado: exige gatePASS/commit com hashes exactos, guarda o controlo de orçamento que falhou antes, oráculos e medições originais/finais. Não curar ou commitar como verificado antes do resultado terminal. Nenhuma fase foi reiniciada por falta de observação.

## Optimização entra na matriz de browsers

64504 confirmado vivo, agora browser-chromium.540Node,17Go/race,185casos entre processos ebuildsnativo/webPASS. Nenhum skip/falha nos relatóriosNode/processos. Matriz140casos porengine emcurso; não anteciparFirefox/WebKit.782hashesiguais, semedições duranteogate. A optimização permaneceWIP atéconclusão/revisão/commit/provas; CIremoto d6d4ddb permaneceFAIL.

## Chromium canónico concluído; Firefox activo

64504 confirmado vivo em browser-firefox. Chromium terminou140casosPASS, semfalhas/skips/flaky, somando-se a540Node/17Go-race/185processos/builds.782hashesiguais. A matrizFirefox/WebKit ainda precisa de resultado terminal; não repetir nem editarfonte. Curador canónico preparado mas nãoexecutado. Depois do gate: revisão/commit/provas, envio normal comCIanterior terminal e continuaçãofuncional de incorporação/proveniência/UI.

## Firefox canónico concluído; WebKit activo

64504 confirmado vivo em browser-webkit. Chromium eFirefox terminaram140casos cada, semfalhas/skips/flaky. WebKit aindaemcurso; nãoantecipar resultado.782hashesiguais. Depois do resultado terminal: rever, commitar os3ficheiros daoptimização, executar .cache/curate-canonical-performance.py, consolidar docs/provas dasrecusas/ac77224 ecanónica, confirmarCIanterior terminal epushnormal. Continuar aprovação/incorporação/proveniência/UI com todososrequisitos; nãodeclarar produtoconcluído.
