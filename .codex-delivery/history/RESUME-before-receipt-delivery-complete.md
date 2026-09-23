# RelayLoom — retoma de persistência e entrega de recibos

**Objectivo integral activo; produto não concluído.** Preservar PROJECT-BRIEF.md: messenger/social cifrado, sites expressivos inspirados no ZeroNet, Windows/Android/macOS/iOS/Linux e web autónoma com paridade, Reticulum/meios agnósticos, setup PT-PT/EN/ES e Liquid Glass. Recuperação sequencial: não criar nem retomar agentes. Manter Astra/Copilot Ultra, providers, bridges, autenticação, permissões, serviços e segurança. Checkpoint adicional de manutenção cancelado.

## Repositório e limites

Worktree activa `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal `/home/absint0o/projects/relayloom` continua em `codex/setup-languages` / `1e83db22`, com WIP histórico separado. Não usar git add -A/reset/force-push nem merge sem aprovação. Nunca incluir automaticamente capturas/JSON históricos ou o symlink node_modules.

Último push confirmado: **1a53620d837ea6a871848e6416c4e9786bcfd7bc**. Commits locais posteriores: **0f4d5df** provas anteriores, **f131652040190110c594445c43559e92dfa30bb8** persistência de recibos e **6e83b3a** shards CI. Documentação/provas desta fase ainda a consolidar. Existe WIP posterior de entrega dos recibos; não o confundir com os commits verificados. Reserva actual cerca de22 GiB; mínimo15 GiB; uma execução pesada local de cada vez, caches/dependências apenas no projecto.

## Persistência — concluída neste âmbito

f131652: intenção do recibo no mesmo commit que verifica a origem; assinatura/envelope/cópia em passos recuperáveis e bytes/prazos fixos em Node/Go/browser. Namespace contribution-receipt separado com AAD/HKDF próprio. Descarte/expiração conservam intenção/facto histórico; limpeza browser em lotes128 respeita cap192chaves. Migração antiga só com prova retida e política actual. Não inventa recibos para descartes antigos. Não há aqui aprovação/publicação.

**Gate 75891 terminado/recolhido PASS**, `.cache/receipt-persistence-final/report.json`, driver `.cache/receipt-persistence-gate.mjs`. **526 Node,17 pacotes Go/race(app/sitesexecutados,restantescached),117 casos entre processos,builds e97 casos por cada Chromium/Firefox/WebKit**, sem falhas/skips nos relatórios Node/browsers.745 hashes confirmados contra f131652. Provas curadas `docs/evidence/site-contributions/receipt-persistence`,35 artefactos/hashes. O comando Go curto inicial com helpers skipped não é a prova de interoperabilidade; os drivers posteriores executaram crashes e dois escritores reais.

## Entrega de recibos — WIP posterior, não commitada/publicada

Rascunhos já instalados e alterados nas fontes (não voltar a copiar `.cache/receipt-delivery-draft`, que ficou histórica): tipos/inspect/manifest/history/generic-publish refusal, journals do visitante com fase received+recibo ligado à intenção copied, catálogos de admissão e remoção atómica do payload, processamento de intenções do dono, cancelamento de retransmissão e wiring Node/Go/browser/mesh. Uma confirmação tardia preserva phase cancelled/expired e não renova a concessão.

Passes dirigidos:1teste de journal Node/portátil;2TCP Node↔Go;5Chromium (4mistos RTC→WS via intermediário sem chave e1worker compilado com UI de ligação/reload);9controlos de catálogo Node/Go (tardios, não copiado, referência errada, crashGo antes/depois). Logs `.cache/receipt-delivery-first`, `.cache/receipt-mixed-worker-first.log`, `.cache/receipt-admission-storage-first.log`.

O primeiro teste partição/seeder FALHOU: o envelope estava na cache do visitante mas não se aplicava após unlock. A ligaçãoTCP lembrada recebia durante a fase bloqueada do relaunch. Corrigido nos três runtimes com recuperação limitada a 32 candidatos por ciclo (browser evita bundles >64 KiB para não varrer media grandes). **4testesTCP/seeder PASS** depois: cancelled e expired recebem o facto histórico de um relay sem chave, com dono parado e socketECONNREFUSED, preservando bytes originais. Falha `.cache/receipt-partition-seeder-first.log`; positivo `.cache/receipt-locked-recovery-fixed/network.log`.

**Teste local ainda em curso: handle 13518**, `.cache/receipt-delivery-regression/report.json`. Typecheck e46Node de contribuições PASS; regressão nativa de contribuições em curso. Fontes congeladas neste teste; não editar/repetir enquanto vivo. Recolher resultado, corrigir regressões reais e depois continuar negativos de rede/recuperaçãobrowser/vectoresGo/recepçãocrashNode/Firefox/WebKit e gate integral. Os passes da persistência não cobrem este WIP. Nenhum outro teste local conhecido permanece activo.

## CI 1a53620 e workflow

**CI 35794083324 terminou FAILURE**. MatrizNode,NodeUI,Go/race,interop,UI Go,Reticulum e três pacotes desktop PASS. iOS falhou; autonomous-browser CANCELLED. Provas `docs/evidence/ci-1a53620`.

- iOS: selector1a53620 compilou emXcode26.6; build/install/startup XCTest PASS no simulador26.4.1. A importação da fotografia sintética excedeu60.720s após boot360s/startup236s. Percurso funcional principal/selector/anexo/resposta não executaram. Artefacto10725338239,418779bytes,21ficheiros dos manifestos verificados. Log assetsd mostra migração/pedido de inserção, não demonstra causa ou sucesso. Sem aumento de timeouts, repetição cega da mutação, permissões ou serviços alterados. Não éHTTP408.
- Browser: anotaçãooficial confirma limite acumulado15 min.152casos anunciados,151completosPASS,semJSONterminalPlaywright/semresultado do152.º. Artefacto10725364105 de2817178bytes,logs/anotação/progresso recolhidos. Não apresentar como suitePASS.
- **6e83b3a** divide a descoberta completa emdois shards sequenciais (`max-parallel:1`,fail-fastfalse), mantendo15 min/job,umworker e limites existentes. Verificador/listagem provou159 casos locais=90 + 69,disjuntos/completos; negativos de omissão/duplicação/vazio PASS. Workflow analisado estaticamente. ExecuçãoCI desta organização ainda pendente. Não houve alteração de provider/bridge/serviço/configuração de segurança.

Como oCIanterior já éterminal, pode consolidar provas/documentação e fazer push normal dos commits verificados sem cancelar trabalho. O WIP de entrega não deve ser incluído antes dos gates. Encadear commit/check/push numa rotina check=True: uma falha documental não pode deixar correr o push seguinte por separação da shell.

## Próximos passos concretos

1. Recolher 13518, sem relançar suites já concluídas.
2. Consolidar docs/provas de f131652/6e83b3a/CI1a53620 emcommit selectivo e push normal; preservar WIP de entrega. ObservarnovoCI quando pertinente, especialmente o selector iOS e shardsbrowser.
3. Concluir/rever/testar entrega dos recibos (ver CONTRIBUTION-RECEIPT-DELIVERY.md), depois recusa assinada, decisão CAS/base/esquema/audiência, reconciliação/proveniência e UI completa de três contas PT/EN/ES. Paleta oculta até compor/enviar/rever/recusar/aceitar/reconciliar/publicar funcionar.
4. Manter gruposweb dinâmicos, backup/rotação/keystore, plataformas/rádios, acessibilidade e revisão independente obrigatórios. Revisão própria está em RECEIPT-PERSISTENCE-SELF-REVIEW.md e não satisfaz o gate independente.

HTML público inalterado: runtime7fdb76a5de5869efa6ebdd721bc7e8f5efac68af,distribuição0fdbd1b9563540a5bc28c74d669668e948aa7667,https://johnnypbelo.github.io/relayloom/. Publicar só após gate da distribuição exacta/HTTPS. Nenhuma alegação de disaster-ready, todos osSO/radios testados ou produto concluído.


## Envio e recolha confirmados

HEAD/origin **14457fd95345d15267f210fa9eec923b7fd1fad0**, push normal confirmado, inclui f131652/6e83b3a e provas/documentação. Novo **CI35802455142**, queued na última leitura. Não cancelar com push intermédio. Todo o WIP de entrega permanece fora desses commits.

**13518 terminou/recolhido PASS**: typecheck,46Node de contribuições e98testes entre processos. `.cache/receipt-delivery-regression/report.json` confirmou fontes iguais antes/depois. Nenhum teste local deste incremento permanece activo. Seguir controlos negativos/recuperação browser/vectoresGo/recepção crashNode e regressão integral antes de commitar a entrega. Não repetir o gate de persistência nem a regressão dirigida por falta de handle.


## Continuação da integração — recuperação e orçamento

13518 terminou PASS (46Node/98processos), fontes então iguais; alterações posteriores estão em validação separada. Novo ficheiro browser site-contribution-receipt-runtime.spec.ts testa recibo apenas emcache, cancelamento, expiração, bloqueio, lock durante admissão, referência errada e operação nunca copiada. Primeiro controlodeexpiração falhou porque a fixture substituía Date.now depois de o catálogo ter capturado a função; corrigido para função estável com valor variável, sem mudar prazos/produto. SeteChromium PASS antes de acrescentar orçamento.

Os runtimes agora limitam a preparação/selagem/cópia de recibos do dono a8porciclo, com cursorrotativo; recuperação de recibos emcache mantém cap32. Novo controlo de9propostas exige8assinaturas/envios no primeirociclo e9totais apósosegundo,semresignar. Primeirotypecheck desta alteração apanhou entry.receipt possivelmenteundefined apósfilter; guard explícito acrescentado antes de executar.

**Handle95894 emcurso**, `.cache/receipt-runtime-browser-matrix/report.json`: typecheck,builds e20casos porengine previstos (runtime8/send10/worker2), Chromium→Firefox→WebKit. Recolher resultado antes de novo teste pesado. Fontes aindaWIP posteriores a14457fd. Logs iniciais `.cache/receipt-browser-recovery-first.log`, fix `.cache/receipt-browser-recovery-fixed.log`, typecheck `.cache/receipt-budget-typecheck.log`. RestamvectoresGo de admissão, crashNode do recibo recebido, negativos de rede/corrupção/autor e controlo budgetNode/Go, depois regressãointegral e UIde decisões. Não afirmar conclusão da entrega apenas pelos positivos.


## Matriz dirigida de entrega recolhida

**95894 terminou/recolhido0**: typecheck,buildnativo/web e **20Chromium/20Firefox/20WebKit PASS**, semfalhas/skips/flaky. Inclui o controlo8→9 de orçamento e worker compilado. Relatório `.cache/receipt-runtime-browser-matrix/report.json`; hashes recolhidos depois em `sources-at-collection.json`, com diferenças face ao gate dirigido46Node/98processos. Não alegar freeze antes/depois onde o driver não o registou; fontes não foram editadas durante esta matriz.

Nenhum teste local conhecido deste incremento está vivo. CI35802455142/14457fd continua activo na última leitura. WIP de entrega está preservado e **não commitado nem publicado**. Faltam os controlos enumerados acima e gate integral; não consolidar apenas pelos positivos. Continuar a partir das fontes, não dos rascunhos antigos emcache. O objectivo completo e o HTML público mantêm-se inalterados.


## Continuação de controlos — 23 de Setembro

O turno anterior foi progresso:39vectores de admissão (11aceites/28recusados) Node/portátil/Go PASS;3controlos de crashNode/concorrênciaGo+Node PASS;2casos de rede Node/Go com12recibos adversariais porcaso e positivos no mesmo canal PASS;3controlos de orçamento Node/Go (incluindoquota real) PASS;3Chromium de autoridade retida/normalretry/revogação PASS. Logs receipt-admission-vectors-first, receipt-admission-review, receipt-network-adversary-expanded, receipt-runtime-native-budget, receipt-authority-held. Todos esses handles foram recolhidos.

O teste RTC `absent local history` terminou FAIL antes da correcção: um recibo autêntico sem intenção local encerrava o canal. O handle23144 já não existe; o log receipt-unmatched-before é terminal e conserva a falha. Não é HTTP408. Foi introduzido UnmatchedContributionReceipt só para vínculos locais de uma assinatura já validada; o browser ignora esse controlo sem o guardar nem fechar RTC. Corrupção de assinatura/índice e outros erros continuam a propagar-se. OitoChromium passaram depois (receipt-unmatched-fixed.log). Controlos adicionais distinguem erro comum com texto idêntico e corrupção privada; typecheck receipt-error-scope PASS; ainda por executar os controlos novos e regressão ampla.

Disco caiu externamente de22para13.225GiB, antes de compilar novamente. Auditoria `.cache/disk-recovery-receipts-20260923.json`:131caminhos de caches/executáveis regeneráveis removidos, sem código/provas/perfis/instaladores/AVD apagados. A imagem do SDK system.img foi tornada esparsa emregiõesdezeros; tamanho lógico eSHA256antes/depois iguais,754.9MiB recuperados. Auditoria `.cache/android-allocation-audit.json`; userdataAVD só foi medida, não alterada. Reserva restaurada para~15.97GiB; revalidar antes de builds e não lançar descargas ou builds paralelos. A cacheGo foi limpa e próximos testes podem recompilar.

Nenhum teste local conhecido está activo após o typecheck39703. A lista de skills adicional não muda o projecto nem autoriza Sites hosting neste repositório; não foi usada. Próximo: controlos de distinção de erros, regressão receipt/runtime + gate integral com fonte congelada e reserva15GiB; depois consolidar entrega e começar decisões/proveniência/UI. Objectivo completo activo, sem agentes novos/retomados/modelos/bridges/permissões/serviços alterados.


## Gate integral de entrega — em execução

**Handle69695**, `.cache/receipt-delivery-final/report.json`,driver `.cache/receipt-delivery-gate.mjs`. Typecheck e **531Node PASS**, zero falhas/skips; native-race emcurso na última observação, processo confirmado vivo.757fontes congeladas e conferidas. Depois buildnative/processos/buildweb/browsers; não editar fontes nem repetir suites enquanto o gate estiver vivo.

Os controlos novos de erro específico passaram:5Chromium em receipt-unmatched-review/browser-controls-fixed.log. A primeira invocação desse driver não tinha RELAYLOOM_MATRIX_ENGINE e falhou na configuração antes de executar browser; apenas essa fase foi corrigida/repetida, sem voltar a compilar ou repetir39vectores jáPASS. Compilações de aquecimento após limparcacheGo estão explicitamente marcadas compilation only, não testes executados.

CI35802455142/14457fd terminouFAIL só no iOS. Os dois shardsbrowser PASS **90+69=159**,zero skipped/unexpected/flaky, artefactos e partição verificados em `.cache/ci-14457fd` ecurados em docs/evidence/ci-14457fd. iOS compilou/instalou/arrancou, mas addmedia excedeu60.364s, antes do percurso principal.21ficheiros deartefacto conferidos. Não éHTTP408 e nenhum anexo/mensagem dessaexecução éinferido. Rascunho de teste Photos em `.cache/ios-photo-warmup-draft` éhipótese nãointegrada/nãocompilada; ver IOS-PHOTO-LIBRARY-READINESS.md.

Disco revalidado apóslimpeza/cachefria:~17.62GiB na últimaobservação. Manterreserva15GiB. O SDK system.img temmesmohashantes/depois dasparsificação; AVDdados nãoforam modificados. Nenhum processo deprojecto comexecutável eliminado ficou identificado na auditoriaposterior.


## Observação do gate integral

69695 continua vivo, agora emnative-integration. **531Node,17pacotesGo/race ebuildnative PASS**. Nesta execução após cachefria os17pacotesGo têm tempos novos, sem marcador cached (helpers condicionais continuam cobertos pelos drivers; não afirmar zero skips Go). Grupo groupauthority demorou170.776s, app488.176s; a duração não foi interpretada como timeout nem motivou reinício.757hashes de fonte continuam iguais. Reserva17.53GiB na última leitura.

Provas doCI14457fd estão curadas em docs/evidence/ci-14457fd:37artefactos commanifesto,21ficheirosIOSoriginais conferidos,90+69browser terminaisPASS. Nenhuma fonte do gate foi alterada. O rascunho de UI Photos e os documentos de proveniência são separados e não recebem estes passes.


## Gate principal terminou com duas fixtures desactualizadas

69695 terminou/recolhidoFAIL:531Node,17Go/race,135processos,builds,110Chromium/110Firefox PASS; WebKit108PASS/2FAIL. Não é falha de transporte nova: uma fixture cancelava a primeira proposta depois de o recibo automático a confirmar; a outra tentava reduzir cache a1KiB mesmo quando havia um recibo do dono fixado. Os controlos foram actualizados para aguardar/confimar received (sem reactivar/cancelar história) e conservar cancel-before-late-broadcast; a perda de cache agora pára o runtime, expulsa as duas cópias alvo e preserva outros pins. Uma asserção intermédia de cache totalmente vazia ainda falhou, depois corrigida para ausência exacta de source/proposal e admissibilidade apenas de recibos próprios restantes.

O teste dirigido final passou2WebKit, log `.cache/receipt-fixtures-final.log`; typecheck PASS. Apenas tests/browser/site-contribution-send.spec.ts mudou. A fixture original foi reconstruída a partir do HEAD + secções WIP preservadas e conferida contra o hash do gate; cópia `.cache/receipt-delivery-original-send-fixture.ts`. O relatório original permaneceFAIL.

**Revisão emcurso: handle96519**, `.cache/receipt-delivery-reviewed-gate.mjs`, `.cache/receipt-delivery-reviewed/report.json`. Typecheck e três matrizes completas de110casos porengine; preserva os passes Node/Go/build/processos com proveniência explícita e confere que só a fixture mudou. Não editar fontes nem repetir enquanto vivo. O curador `.cache/curate-receipt-delivery.mjs` e `.cache/finish-receipt-delivery-docs.py` já distinguem a revisão do primeiro gate; só executar apósPASS e commit de fontes.

Próximo depois da revisão: guardar fontes/tests listados em .cache/receipt-delivery-source-paths.json, conferir757hashes contra commit, curar provas, actualizar docs e retoma. Os rascunhos de recusa e Photos continuam fora das fontes e não têm resultados executados. Objectivo inteiro activo; não afirmar UI de aprovação/publicação pronta.
