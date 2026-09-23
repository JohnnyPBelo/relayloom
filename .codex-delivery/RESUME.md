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
