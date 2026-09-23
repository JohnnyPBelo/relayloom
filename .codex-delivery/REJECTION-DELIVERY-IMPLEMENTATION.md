# Estado actual verificado

Fonteac77224: gate finalPASS,539Node/17Go-race/185processos/140porengine,780hashes,55artefactos curados. Entrega implementada; aprovação/proveniência/UI completas continuam pendentes. Todos os handles desta integração foram recolhidos.

As secções seguintes preservam o histórico; notas de execução emcurso foram ultrapassadas por este estado.

# Entrega de recusas — WIP após d6d4ddb

O turno anterior foi progresso verificado e publicado (protocolo/persistência e correcção CI). O objectivo integral permanece activo, com recuperação sequencial, sem novos agentes nem mudanças de modelos, bridges ou serviços.

## Implementado localmente, ainda sem gate final

- Journal do visitante Node/portátil/Go conserva receipt e rejection separados. queued/received passam a rejected; cancelled/expired mantêm estado local e acrescentam o facto histórico. A recepção tardia não apaga a recusa. Vínculo exige operação copiada, certificado/UUID/destino/dono/prazos exactos; histórico ausente é um erro específico apenas após autenticação.
- Catálogos Node/Go/browser recebem a recusa e removem o payload privado da fila no mesmo commit. Browser revalida política, sessão e prazo após awaits.
- Validação, inspecção, resumo, recepção, seeding e proibição do publish genérico ligadas ao novo tipo. Comando fechado reject recebe só id/revisão/motivo; assinatura/selagem continuam fora da RPC.
- Runtimes processam recibos e recusas num orçamento combinado de8 por ciclo, com rotação, e recuperam até32 candidatos de ambas as classes em cache. Mapas de autorização separados; retry igual preserva referências, bloqueio/fecho cancela transmissões. Browser evita ler media grandes durante recuperação.

## Executado

TypechecksPASS.46 vectores novos de admissão Node/portátil/Go (16 aceites/30 recusados) e regressão39 dos recibosPASS, log .cache/rejection-admission-vectors-first.log. Seis casosTCP Node↔GoPASS (2 novos de recusa bidireccional/reabertura e4 de regressão dos recibos), buildnativoPASS: .cache/rejection-network-first/report.json. Handle71618 recolhido; não repetir por falta de observação.

**31844 emcurso**, .cache/rejection-browser-first/report.json: typecheck e dois casos reais por engine para recusa porRTC/reabertura e histórico ausente sem fechar canal. Recolher o resultado antes de novo teste pesado. O driver dirigido não registou hashes antes/depois; não lhe atribuir freeze retrospectivamente.

## Próximos controlos obrigatórios

Rever a integração e obter browser↔Node/Go porRTC→WS, relay sem leitura, partição/heal, dono offline/seeder, recepção bloqueada/reabertura, cancelamento/expiração tardios, corrupção/autoria/audiência e tráfego positivo no mesmo canal. Confirmar orçamento combinado8→9 nos três motores, quota/rotação e política retida/revogada. Recebimento atómico com crashes/concorrência e preservação de outra preparação. Worker compilado, comando fechado, regressão ampla e hashes finais antes de commitar/publicar.

UI de formular/enviar/rever/recusar/aprovar/reconciliar/publicar e proveniência continua obrigatória e ainda incompleta; paleta oculta. HTML público inalterado. Não confundir esta integração WIP com d6d4ddb testado no CI.

## CI observado nesta retoma

Run35868125390/d6d4ddb está activo. Windows eUbuntu native-nodePASS, macOSainda emcurso na última consulta. A correcção da compilação fria já ultrapassou o bloqueio nesses dois hosts. Não cancelar oCI com push. Apple/radios, paridade, backup/rotação/keystore e revisão independente mantêm-se pendentes.

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
