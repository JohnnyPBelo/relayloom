# Integração de entrega dos recibos — verificada em426b471

**Estado actual:** implementação commitada, gate finalPASS e provas curadas em `docs/evidence/site-contributions/receipt-delivery`.531Node,17Go/race,135processos e110casos porbrowser;757hashes conferidos. Os handles69695/96519 estão terminados/recolhidos. Não há teste local conhecido activo. A recusa/decisão/publicação e UI completas continuam pendentes.

As secções seguintes preservam desenho e histórico; notas de testes emcurso ou rascunhosWIP foram ultrapassadas pelo estado actual. Ver RESUME.md eREADME das provas para reprodução/proveniência.

## Visitante

Acrescentar facto `receipt` à operação de contribuição. A assinatura do dono deve ligar dono do endereço, contributorId local, certificateId, UUID, destino completo e created/expires originais. Exigir `transport.copied === true`: uma proposta meramente preparada/assinada/selada sem handoff não pode ser confirmada. Verificar também prazo/skew do próprio recibo na admissão; a autenticidade histórica do registo guardado não desaparece depois do prazo.

Transição atómica: validar envelope cifrado e recibo; se queued, reler/verificar o stage e removê-lo; guardar receipt e fase received. Se cancelled/expired, conservar esse estado local e acrescentar apenas o facto histórico (não voltar à fila). Cópias idênticas não alteram o journal; outro recibo válido para o mesmo certificado não substitui o primeiro. Uma operação já retirada da janela finita não é recriada por um recibo. Cancelamento depois de received não finge apagar recepção: apresentar o facto e, se a UI permitir, apenas intenção local de não prosseguir, sem prometer recolher cópias.

O runtime remove a operação do mapa permitido e cancela os pacotes próprios/apoios de origem. Não cancela conteúdo de outro originador nem um pacote independente com bytes iguais. Depois de crash, state/phase terminal impede o retorno do envio. O catálogo não expõe a assinatura privada pela RPC.

## Dono

Um processador de recibos percorre apenas intenções duráveis: prepared→signReceipt, signed→sealReceipt, queued→receiptBundle→store.put→get→copyReceipt. Só depois copia para o transporte. O histórico da inbox não precisa de conservar os valores para concluir o recibo. Retry usa o mesmo envelope/ID/timestamp e não recria nonce. Lease da sessão e política actual (bloqueio/retirada/prazo) são revalidadas em cada transmissão e depois dos awaits. Preservar referência da autorização em retries canonicamente iguais; revogação remove-a.

Não usar ACK físico como admissão de recibo. O dono não recebe confirmação de que o recibo chegou nesta fase: retries limitados até ao prazo próprio e seeding sujeito a consentimento/política. O estado mostrado deve ser "recibo preparado/copied" local, nunca "visitante notificado" sem prova adicional.

## Rede e fronteiras

Tipo `site-contribution-receipt` privado, 1–2 leitores, corpo assinado ≤8KiB, TTL próprio ≤30dias. Validar forma/assinatura/ligação à outer manifest para quem pode ler; terceiros validam envelope opaco limitado sem obter chave nem autoria. Integrar type/shape, inspect, receive, history summary, maySeed/own gating em Node/Go/browser e rotas via RTC/WS/TCP/Reticulum existentes. Sessão bloqueada recusa operações próprias e não deixa uma resposta retida escapar. Nenhuma nova porta/serviço obrigatório.

A UI pode depois distinguir fila local, cópia no dispositivo, recepção do dono e decisão/publicação. Formulários só aparecem na paleta quando todo o fluxo de compor/enviar/rever/recusar/aceitar/reconciliar/publicar e proveniência estiver pronto em PT/EN/ES.

## Gates concretos

- Journal Node/portátil/Go: recibo correcto/idempotente, desconhecido, outra assinatura/UUID/certificado/destino, não copiado, recebido depois de cancelamento/expiração e rejeição de renovação/alteração da proposta.
- SQLite/IndexedDB: receipt+cleanup atómicos, crashes/reabertura entre motores, stage corrompido, quotas e perda de resposta.
- Node↔Go TCP com relays pausados: receptor produz intenção automaticamente; ambos os lados reabrem; mesmas assinaturas/envelopes, visitante sai da fila e preserva histórico. Controlos positivos no mesmo canal durante recusas.
- Web↔Node/Go em RTC→WS via terceiro sem leitura, com ligação desligada no instante do recibo e reaberta; autor offline e seeder, cancelamento enquanto autorização está retida.
- Worker compilado/ausência de helpers na RPC, UI real de três contas depois de integrar decisões. Não declarar paridade Apple/radios ou disaster-ready por estes gates.


## Rascunhos ainda fora das fontes

`.cache/receipt-delivery-draft` contém alterações propostas para journals do visitante (TS/Go), catálogos de recepção(Node/Go/browser), políticas de conteúdo e runtime(Node/browser). Não foram typechecked, compiladas ou executadas; não copiar toda a pasta cegamente. Rever/instalar em sequência só depois do gate actual. Ainda faltam runtimeGo, wiring de todos os pontos de admissão/seeding/history/worker, testes de fecho de fila e entregareal. Não referir estes rascunhos como funcionalidades ouprovas.

O rascunho inclui também teste TCP cruzado Node↔Go de entrega automática/reinício. Ainda precisa de controlos tardios/negativos, partição e equivalentes browser/worker; não foi executado porque o wiring correspondente não existe nas fontes congeladas.

Rascunhos Go de runtime/inspecção foram também preparados, ainda não compilados. Rever especialmente limpeza dos mapas quando a selagem altera a entrada antes de um erro; não deixar uma autorização antiga sobreviver a falhas. No wiring, recusar explicitamente site-contribution-receipt no caminho genérico publish/prepare em todos os motores, tal como já acontece com propostas. Só o journal pode preparar e emitir este tipo.


## Verificação dirigida em curso

**Handle 13518**, `.cache/receipt-delivery-regression/report.json`: typecheck PASS,46 testes Node de contribuições PASS, regressão de processos nativos em curso. Fonte congelada durante esta execução. Depois recolher resultado e corrigir regressões antes de outro gate. Ainda faltam vectores Go de recepção (os métodos novos compilaram e os catálogos foram testados), falhas/concorrência Node na recepção, controlos adversariais de rede, recibos em cache no browser com política retida, Firefox/WebKit, gate integral e UI de decisões. Os rascunhos .cache/receipt-delivery-draft são históricos; não os copiar sobre as fontes com as correcções actuais.

Falha preservada: .cache/receipt-partition-seeder-first.log. Ambos os envelopes chegaram às caches dos três processos, mas o visitante não marcava recepção; em relaunch, a ligação TCP lembrada podia receber enquanto a identidade ainda estava bloqueada. .cache/receipt-locked-recovery-fixed/network.log tem 4 PASS após recuperar recibos guardados. Não confundir esta falha corrigida com o timeout do importador de fotos iOS ou com o orçamento de 15 min do CI browser.


## Envio e recolha confirmados

HEAD/origin **14457fd95345d15267f210fa9eec923b7fd1fad0**, push normal confirmado, inclui f131652/6e83b3a e provas/documentação. Novo **CI 35802455142**, queued na última leitura. Não cancelar com push intermédio. Todo o WIP de entrega permanece fora desses commits.

**13518 terminou/recolhido PASS**: typecheck,46Node de contribuições e98testes entre processos. `.cache/receipt-delivery-regression/report.json` confirmou fontes iguais antes/depois. Nenhum teste local deste incremento permanece activo. Seguir controlos negativos/recuperação browser/vectoresGo/recepção crashNode e regressão integral antes de commitar a entrega. Não repetir o gate de persistência nem a regressão dirigida por falta de handle.


## Continuação da integração — recuperação e orçamento

13518 terminou PASS (46Node/98processos), fontes então iguais; alterações posteriores estão em validação separada. Novo ficheiro browser site-contribution-receipt-runtime.spec.ts testa recibo apenas emcache, cancelamento, expiração, bloqueio, lock durante admissão, referência errada e operação nunca copiada. Primeiro controlodeexpiração falhou porque a fixture substituía Date.now depois de o catálogo ter capturado a função; corrigido para função estável com valor variável, sem mudar prazos/produto. SeteChromium PASS antes de acrescentar orçamento.

Os runtimes agora limitam a preparação/selagem/cópia de recibos do dono a 8 por ciclo, com cursorrotativo; recuperação de recibos em cache mantém cap32. Novo controlo de9propostas exige8assinaturas/envios no primeirociclo e9totais apósosegundo,semresignar. Primeirotypecheck desta alteração apanhou entry.receipt possivelmenteundefined apósfilter; guard explícito acrescentado antes de executar.

**Handle95894 em curso**, `.cache/receipt-runtime-browser-matrix/report.json`: typecheck,builds e20casos porengine previstos (runtime8/send10/worker2), Chromium→Firefox→WebKit. Recolher resultado antes de novo teste pesado. Fontes aindaWIP posteriores a14457fd. Logs iniciais `.cache/receipt-browser-recovery-first.log`, fix `.cache/receipt-browser-recovery-fixed.log`, typecheck `.cache/receipt-budget-typecheck.log`. RestamvectoresGo de admissão, crashNode do recibo recebido, negativos de rede/corrupção/autor e controlo budgetNode/Go, depois regressãointegral e UIde decisões. Não afirmar conclusão da entrega apenas pelos positivos.


## Matriz dirigida de entrega recolhida

**95894 terminou/recolhido0**: typecheck,buildnativo/web e **20Chromium/20Firefox/20WebKit PASS**, semfalhas/skips/flaky. Inclui o controlo8→9 de orçamento e worker compilado. Relatório `.cache/receipt-runtime-browser-matrix/report.json`; hashes recolhidos depois em `sources-at-collection.json`, com diferenças face ao gate dirigido46Node/98processos. Não alegar freeze antes/depois onde o driver não o registou; fontes não foram editadas durante esta matriz.

Nenhum teste local conhecido deste incremento está vivo. CI 35802455142/14457fd continua activo na última leitura. WIP de entrega está preservado e **não commitado nem publicado**. Faltam os controlos enumerados acima e gate integral; não consolidar apenas pelos positivos. Continuar a partir das fontes, não dos rascunhos antigos emcache. O objectivo completo e o HTML público mantêm-se inalterados.


## Continuação de controlos — 23 de Setembro

O turno anterior foi progresso:39vectores de admissão (11aceites/28recusados) Node/portátil/Go PASS;3controlos de crashNode/concorrênciaGo+Node PASS;2casos de rede Node/Go com12recibos adversariais porcaso e positivos no mesmo canal PASS;3controlos de orçamento Node/Go (incluindoquota real) PASS;3Chromium de autoridade retida/normalretry/revogação PASS. Logs receipt-admission-vectors-first, receipt-admission-review, receipt-network-adversary-expanded, receipt-runtime-native-budget, receipt-authority-held. Todos esses handles foram recolhidos.

O teste RTC `absent local history` terminou FAIL antes da correcção: um recibo autêntico sem intenção local encerrava o canal. O handle23144 já não existe; o log receipt-unmatched-before é terminal e conserva a falha. Não é HTTP408. Foi introduzido UnmatchedContributionReceipt só para vínculos locais de uma assinatura já validada; o browser ignora esse controlo sem o guardar nem fechar RTC. Corrupção de assinatura/índice e outros erros continuam a propagar-se. OitoChromium passaram depois (receipt-unmatched-fixed.log). Controlos adicionais distinguem erro comum com texto idêntico e corrupção privada; typecheck receipt-error-scope PASS; ainda por executar os controlos novos e regressão ampla.

Disco caiu externamente de22para13.225GiB, antes de compilar novamente. Auditoria `.cache/disk-recovery-receipts-20260923.json`:131caminhos de caches/executáveis regeneráveis removidos, sem código/provas/perfis/instaladores/AVD apagados. A imagem do SDK system.img foi tornada esparsa emregiõesdezeros; tamanho lógico eSHA256antes/depois iguais,754.9MiB recuperados. Auditoria `.cache/android-allocation-audit.json`; userdataAVD só foi medida, não alterada. Reserva restaurada para~15.97GiB; revalidar antes de builds e não lançar descargas ou builds paralelos. A cacheGo foi limpa e próximos testes podem recompilar.

Nenhum teste local conhecido está activo após o typecheck39703. A lista de skills adicional não muda o projecto nem autoriza Sites hosting neste repositório; não foi usada. Próximo: controlos de distinção de erros, regressão receipt/runtime + gate integral com fonte congelada e reserva15GiB; depois consolidar entrega e começar decisões/proveniência/UI. Objectivo completo activo, sem agentes novos/retomados/modelos/bridges/permissões/serviços alterados.


## Gate integral de entrega — em execução

**Handle 69695**, `.cache/receipt-delivery-final/report.json`,driver `.cache/receipt-delivery-gate.mjs`. Typecheck e **531 Node PASS**, zero falhas/skips; native-race em curso na última observação, processo confirmado vivo.757 fontes congeladas e conferidas. Depois buildnative/processos/buildweb/browsers; não editar fontes nem repetir suites enquanto o gate estiver vivo.

Os controlos novos de erro específico passaram:5Chromium em receipt-unmatched-review/browser-controls-fixed.log. A primeira invocação desse driver não tinha RELAYLOOM_MATRIX_ENGINE e falhou na configuração antes de executar browser; apenas essa fase foi corrigida/repetida, sem voltar a compilar ou repetir39vectores jáPASS. Compilações de aquecimento após limparcacheGo estão explicitamente marcadas compilation only, não testes executados.

CI 35802455142/14457fd terminouFAIL só no iOS. Os dois shardsbrowser PASS **90 + 69=159**,zero skipped/unexpected/flaky, artefactos e partição verificados em `.cache/ci-14457fd` ecurados em docs/evidence/ci-14457fd. iOS compilou/instalou/arrancou, mas addmedia excedeu60,364 s, antes do percurso principal.21 ficheiros deartefacto conferidos. Não éHTTP408 e nenhum anexo/mensagem dessaexecução éinferido. Rascunho de teste Photos em `.cache/ios-photo-warmup-draft` éhipótese nãointegrada/nãocompilada; ver IOS-PHOTO-LIBRARY-READINESS.md.

Disco revalidado apóslimpeza/cachefria:~17.62GiB na últimaobservação. Manterreserva15GiB. O SDK system.img temmesmohashantes/depois dasparsificação; AVDdados nãoforam modificados. Nenhum processo deprojecto comexecutável eliminado ficou identificado na auditoriaposterior.


## Observação do gate integral

69695 continua vivo, agora em native-integration. **531 Node,17 pacotesGo/race ebuildnative PASS**. Nesta execução após cachefria os17 pacotesGo têm tempos novos, sem marcador cached (helpers condicionais continuam cobertos pelos drivers; não afirmar zero skips Go). Grupo groupauthority demorou170.776s, app488.176s; a duração não foi interpretada como timeout nem motivou reinício.757 hashes de fonte continuam iguais. Reserva17.53GiB na última leitura.

Provas doCI14457fd estão curadas em docs/evidence/ci-14457fd:37 artefactos commanifesto,21 ficheirosIOSoriginais conferidos,90 + 69browser terminaisPASS. Nenhuma fonte do gate foi alterada. O rascunho de UI Photos e os documentos de proveniência são separados e não recebem estes passes.


## Gate principal terminou com duas fixtures desactualizadas

69695 terminou/recolhidoFAIL:531Node,17Go/race,135processos,builds,110Chromium/110Firefox PASS; WebKit108PASS/2FAIL. Não é falha de transporte nova: uma fixture cancelava a primeira proposta depois de o recibo automático a confirmar; a outra tentava reduzir cache a1KiB mesmo quando havia um recibo do dono fixado. Os controlos foram actualizados para aguardar/confimar received (sem reactivar/cancelar história) e conservar cancel-before-late-broadcast; a perda de cache agora pára o runtime, expulsa as duas cópias alvo e preserva outros pins. Uma asserção intermédia de cache totalmente vazia ainda falhou, depois corrigida para ausência exacta de source/proposal e admissibilidade apenas de recibos próprios restantes.

O teste dirigido final passou2WebKit, log `.cache/receipt-fixtures-final.log`; typecheck PASS. Apenas tests/browser/site-contribution-send.spec.ts mudou. A fixture original foi reconstruída a partir do HEAD + secções WIP preservadas e conferida contra o hash do gate; cópia `.cache/receipt-delivery-original-send-fixture.ts`. O relatório original permaneceFAIL.

**Revisão emcurso: handle96519**, `.cache/receipt-delivery-reviewed-gate.mjs`, `.cache/receipt-delivery-reviewed/report.json`. Typecheck e três matrizes completas de110casos porengine; preserva os passes Node/Go/build/processos com proveniência explícita e confere que só a fixture mudou. Não editar fontes nem repetir enquanto vivo. O curador `.cache/curate-receipt-delivery.mjs` e `.cache/finish-receipt-delivery-docs.py` já distinguem a revisão do primeiro gate; só executar apósPASS e commit de fontes.

Próximo depois da revisão: guardar fontes/tests listados em .cache/receipt-delivery-source-paths.json, conferir757hashes contra commit, curar provas, actualizar docs e retoma. Os rascunhos de recusa e Photos continuam fora das fontes e não têm resultados executados. Objectivo inteiro activo; não afirmar UI de aprovação/publicação pronta.


## Entrega de recibos verificada — 23 de Setembro

**426b471:** Node, Go e browser entregam o recibo privado assinado pelo dono e fecham atomicamente a fila do visitante. A confirmação exige vínculo à operação anteriormente copiada; recibos tardios conservam cancelled/expired sem renovar autorização. Cache recebida antes de unlock é recuperada; um recibo autêntico sem história local não fecha RTC nem inventa confirmação. O processamento do dono roda lotes limitados e conserva os mesmos envelopes após quota/retry.

Passaram **531 Node, 17 pacotes Go/race, 135 testes entre processos e 110 casos por cada Chromium/Firefox/WebKit**, além de typecheck/builds. Os controlos incluem falhas de commit, concorrência real, partição/seeder com dono offline, mensagens positivas durante recusa e corrupção. [Provas, comandos e falhas corrigidas](../docs/evidence/site-contributions/receipt-delivery).

**Recepção continua distinta de aprovação/publicação.** Faltam recusa assinada, decisões/CAS/reconciliação/proveniência e a interface completa de contribuições de três contas. Paleta e HTML público ainda no estado anterior. Restantes requisitos de plataformas, rádios, grupos web, recuperação/keystore e revisão independente mantêm-se.
