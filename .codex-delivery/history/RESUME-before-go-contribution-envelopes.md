# RelayLoom — retoma, 22 de Setembro de 2026

**Objectivo integral activo; produto não concluído.** Manter PROJECT-BRIEF.md: messenger/social P2P cifrado, editor expressivo inspirado no ZeroNet, Windows/Android/macOS/iOS/Linux e web autónoma com paridade, Reticulum/meios agnósticos, setup, PT/EN/ES e Liquid Glass. Só este projecto. Astra/Copilot Ultra intacto. Recuperação sequencial: **não criar nem retomar agentes**. Não alterar modelos/providers/bridges, autenticação, permissões, serviços ou outros projectos. Checkpoint extra de manutenção cancelado.

## Localização e preservação

- Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`.
- Principal: `/home/absint0o/projects/relayloom`, branch `codex/setup-languages`, HEAD1e83db22ff9b7b9a65a400601b891312a3188960. O seu WIP histórico está separado e preservado. Nunca git add -A, reset, force-push ou merge de PR sem aprovação.
- Commits novos locais: **d20d4ce** documento v4; **ac54af4** consulta de formulário; **0746edf** provas CI; **b8a8a9e** submissão/concessão; **6749483** journal Node/browser e codec privado Node/Go. Ver git log/status para o commit de documentação posterior. Origin estava0a85d7d antes do push final deste incremento; confirmar a nota final ou consultar origin.
- WIP restante inclui capturas/JSON antigos e symlink node_modules; preservar e não incluir indiscriminadamente. Nenhum código de outras worktrees foi copiado sobre esta.
- **Disco: cerca de15,9GiB livres**, reserva15GiB. Verificar antes de cada gate pesado. Dependências/caches no projecto; uma execução pesada local de cada vez.

## Estado actual do código

O documento v4 contém formulários declarativos ligados a tabelas do mesmo snapshot; valida campos/tipos/regras/destino e remapeia referências internas ao duplicar páginas/composições. Recursos v3 continuam válidos. As seis fronteiras de assinatura/admissão exigem revisão assinada para v3 e posteriores. **A paleta de formulários continua oculta.**

`contribution-command` com `action: form` está ligado em Node HTTP, Go HTTP e BrowserApplication/worker. Recebe apenas snapshotId/pageId/formId; autentica/desencripta e extrai o contexto do snapshot real, sem aceitar esquema/ACL do cliente. Verifica contribuidores/leitura/bloqueio/retirada/prazo/sessão. Resposta contém campos/metadados, sem linhas da tabela ou chaves; não assina/publica/pede à rede. Browser lê blocked+mutations na mesma transacção. A futura submissão deve resolver novamente o contexto, nunca confiar nessa resposta enviada pela UI.

`verifyForSubmission` é distinto de `verifyPublicationScope`; `verifyForForm` mantém a composição antiga. Proposta privada pode ser enviada ao dono de site público sem consentir publicação pública.57vectores TS/Go (14aceites/43recusados) e browsers verificam a distinção. Concessão não é aprovação, CAS ou prazo válido.

**Journal e catálogos Node/browser implementados como módulos internos:** primeiro commit guarda intenção+snapshot de origem sem certificado do visitante; segundo commit assina e conserva certificado. Repetição/reabertura mantém UUID/valores/concessão/tempos. Estados prepared/signed/cancelled/expired; uma preparação activa,128resultados/1MiB, janela final contígua e contador monotónico. Stage fica fora do inventário público. Quota/corrupção/sessão antiga recusam sem criar outro resultado. Namespace privado contribution em Node/Go deriva de posse da chave de assinatura, com AAD próprio. O codec Go está implementado e interoperável, **mas o catálogo/máquina de estados Go ainda não**.

**Ainda não existe API de submissão/envio, envelope/outbox/inbox, aprovação/rejeição/reconciliação CAS, proveniência de linhas ou UI de contribuições.** Os estados internos não significam enviado/entregue/aprovado. Ler docs/SITE-CONTRIBUTIONS.md, .codex-delivery/SITE-CONTRIBUTIONS-IMPLEMENTATION.md, CONTRIBUTION-CATALOG-REVIEW.md e CONTRIBUTION-JOURNAL-NOTES.md.

## Testes terminados — nenhum teste local vivo

**Todos os handles locais foram recolhidos.**76653 terminou0;72078 terminou1 (falha histórica corrigida). Não reabrir como vivos nem repetir suites por falta de handle.

- Gate final `.cache/contribution-journal-consolidated/report.json`: **494 Node PASS**, build PASS, **2 Firefox + 2 WebKit PASS** depois das correcções. Os102ficheiros de testes coincidem exactamente com o glob original. Hashes antes/depois de693fontes coincidem. Driver `.cache/contribution-journal-consolidate.mjs`; recusa sobrepor relatório.
- Chromium dirigido após correcção: **2PASS** em `.cache/contribution-review-fixes-chromium-report.json`; typecheck e14testes Node dirigidos PASS.
- Antes: Go sites/race PASS;28casos conjuntos de catálogo/storage/interop,10casos finais de catálogo, quatro casos de catálogo/contexto/cripto por browser e suplementos de worker PASS. São subconjuntos/repetições; não somar como cenários únicos.
- Consulta autenticada:10Node,Go sites/race,3Go app/race,builds,2percursos de processos TCP Node↔Go e contexto/worker nos três browsers PASS. Controlo com autor offline, seeder reiniciado, cópia antes ausente, bytes privados presentes sem chave, bloqueio/retirada e leituras históricas.
- Node journal: SIGKILL real em Linux antes/depois do commit de intenção e depois do commit de assinatura; recuperação e identidade/prazo fixos PASS. Variante Windows usa exit86 imediato sem cleanup JavaScript e ainda aguarda CI. Browser: assinatura retida+lock faz rollback para prepared; reabre, retoma, expira e rejeita stage/retention corrompidos.
- Provas curadas: `docs/evidence/site-contributions/{document-v4,authenticated-context,preparation}`. Curador `.cache/curate-contribution-journal.mjs` já executado; não substituir provas.

### Falhas preservadas

A primeira suite integral72078 deu493PASS/1FAIL de494 por rótulo Formulário sem EN/ES; corrigido antes da repetição494/494. O parser aceitava uma lacuna sintética no journal; agora exige comprimento/janela final exactos. `.cache/contribution-retention-{before,after}.json` preserva positivo e negativo. Mudaram só quatro ficheiros depois da primeira suite: i18n/studio.ts, contribution-operations.ts e os dois testes de catálogo. A prova final enumera-os.

Fixtures iniciais foram corrigidas: usar action/block (settings não bloqueia), reabrir storage depois de falha de integridade, e comparar estrutura em vez de ordem textual do JSON. Os logs originais permanecem. O JSON dos quatro casos WebKit foi sobrescrito pelo reporter seguinte; log terminal e observação real preservados, sem inventar relatório original. A repetição final captura JSON correctamente.

## CI e publicação

**CI35661349213 /0a85d7d terminou FAILURE apenas no iOS.** Node Windows/macOS/Linux,Go/race,interop,UI nativa,RNS,três pacotesdesktop e107browser PASS. Página extensa10144ms dentro do prazo15s. iOS26.4.1:build/install/startup XCTestPASS; seed-synthetic-photo expirou60433ms antes do percursofuncional.21ficheiros de execução/cleanup conferidos por hash. Provas `docs/evidence/ci-0a85d7d`. Não atribuir mensagens/fotografias entregues a essa execução, nem inferir a causa do bloqueio. O CI não inclui v4/contexto/journal posteriores.

Web pública: https://johnnypbelo.github.io/relayloom/ . Runtime **7fdb76a5de5869efa6ebdd721bc7e8f5efac68af**, distribuição **0fdbd1b9563540a5bc28c74d669668e948aa7667**, Pages35622927304SUCCESS. V3 com recursos publicado; novas correcções/formulários ainda não.20artefactos HTTPS,6percursos de recursos nos três browsers e1entreprocessos com mensagens/anexo/reload offline PASS. Provas em `docs/evidence/site-optional-resources/v3-ui/live`. Nova publicação exige artefactos exactos e gate HTTPS, nunca simples existência de WIP.

O gate anterior de recursos/relay terminou PASS e está em `docs/evidence/site-resource-performance`:107WebKit,2UI recursos Node/Go,33contratos,Go/race,Linuxbuild/run/package/run;12dirigidos porengine. A corrida de pausa de relay foi reproduzida/corrigida com erro tipado. Isso não prova resolver ausência histórica de candidatosICE ou ofertaFirefox de61,7s. Essas ocorrências mantêm causa por esclarecer.

## Espaço e higiene

A reserva da CLI recusou um gate quando havia14GiB; não foi alterada. Foram removidas apenas cópias ignored/linux-unpacked de8worktrees antigas, após lsof sem uso; AppImages, fontes/WIP e respectivos hashes preservados. Depois removeram-se4arquivos de download inactivos (JDK/Android/electron) com instalações mantidas. Não foram removidos perfis, provas, imagensOS, ferramentas instaladas, código ou processos. Auditorias `.cache/disk-recovery-21-sep.json` e `disk-recovery-22-sep.json`. Causas externas de crescimento não foram investigadas; não aceder a outros projectos/ficheiros pessoais.

## Próxima execução concreta

1. Confirmar gitstatus/log/origin e espaço. Consultar CI do novo push, sem cancelar execuções com pushes repetidos. Não repetir os gates terminados sem novas alterações/falha relevante.
2. **Portar contribution-operations e contribution-catalog para Go**, usando RunContributionPrivate. Preservar formato canónico e fonte autenticada; obter os mesmos vectores e transacções. Testar retoma Node↔Go sobre a mesmaSQLite e morte antes/depois dos commits, quotas, corrupção, leitura vsassinatura e retenção.
3. Ligar preparação/submissão nos três motores, com contexto resolvido novamente e política revalidada dentro da transacção. Nunca receber source/context/ACL do cliente. Envelope privado exacto, validade fixa, cópia verificável e outbox/inbox; não renovar prazo numa retoma. Node/browser createBundle usa Date.now internamente e precisa de uma solução explícita para os tempos fixos (Go já tem CreateBundleAt).
4. Decisão do dono durável, CAS/reconciliação de base/esquema/audiência, recibos verificáveis e proveniência. Só então activar paleta e UI PT/EN/ES; testar três contas, perda de resposta, partition/heal, autor offline, falhas de autorização/corrupção, acessibilidade e desenho.
5. Executar os gates integrais da candidata antes da publicação/entrega. Mantêm-se grupos web dinâmicos, backup/rotação/keystore, todos os SO/meios, hardware/radios, assinatura Apple e revisão independente. Nenhum passe de software demonstra prontidão para catástrofes. Não marcar complete/blocked: ainda há implementação útil autorizada.

O histórico desta retoma está em `.codex-delivery/history/RESUME-before-contribution-preparation.md`, e os históricos anteriores foram preservados. O turno produziu código e provas reais; classifica-se como progresso.


## Push e estado final confirmado

**HEAD e origin: bd419cb308fb6e4d043842e11bb14d6975676701**, push normal confirmado. **CI35670707944** foi criado para essa fonte e está queued na última leitura; consultar antes de outro push. O CI anterior35661349213 está terminal, não precisa de ser retomado. Fontes apps/packages/native/tests/scripts limpas e commitadas. Nenhum processo de teste local vivo; os daemons/fixtures foram terminados pelos respectivos testes. WIP histórico de documentação/capturas permanece preservado. Disco~15,9GiB.

Continuar pela portabilidade do catálogo/máquina de estados Go e integração de envio/aprovação/UI descritas acima. O módulo Node/browser guardado não encerra o objectivo. Não alterar harness/modelos/bridges, não criar/retomar agentes e não reduzir os requisitos.


## Continuação em curso — catálogo Go e envelopes

HEAD/origin **bd419cb**; CI35670707944 em curso, com Node nos três hosts, Go, interop/UI nativa e pacotes desktop aprovados na última leitura; iOS/RNS/browser final a acompanhar. Não fazer push que cancele esse CI sem necessidade.

Novas fontes WIP: catálogo/transições Go, helpers createBundleAt Node/browser, vínculo de envelope privado e seal/authorizedBundle nos três catálogos. **Não ligados à API de submissão, transporte/outbox/inbox/aprovação/UI.**53vectores (18aceites/35recusados),24testes de catálogo/clock/interop,15corefixos+regressão,Go core/sites-race,28Node/Go de envelope/catálogo e6dirigidos porbrowser PASS. Depois acrescentado teste de corrupção de envelope (17processos PASS) e concorrência real Node bloqueado no writerGo (1PASS). Registar sobreposições; não somar como cenários únicos.

A revisão reproduziu expiração durante a política em Node/Go; corrigiu-se a leitura final de relógio e a recusa antes de assinar, mantendo o positivo a-1ms. Browser também tem o controlo. Primeira fixtureGo usava fingerprint de TTL diferente, depois corrigida antes do negativo definitivo. O driver de operações também normalizava indevidamente relógio negativo para0; corrigido sem alterar o produto. Logs de falhas preservados. O teste worker esperado passou de3para5recusas ao acrescentar helpers; o produto já recusava todos, apenas o oráculo antigo falhava.

**Único teste local activo6285**, `.cache/contribution-go-envelope-final/report.json`. Typecheck PASS; Node integral em curso; depois native-build,18testes de catálogo de processos, web-build e21percursos afectados porbrowser.706fontes congeladas no report. Antes, o driver detectou apenas tsconfig.json omitido na enumeração e parou antes de qualquer teste; enumeração alinhada sem mudar código/configuração. Todos os outros handles locais foram recolhidos.

Preservar outputs antes de correr outra matriz do mesmo engine. Já existem `.cache/contribution-envelope-{chromium-fixed,firefox,webkit}-report.json` (6cada). Go-race final em `.cache/contribution-envelope-go-race-final.log` foi repetido com cache recompilada e sourcehashes iguais. Fonte de referência em `.cache/contribution-envelope-final-source.json`.

Disco voltou a cair abaixo de15GiB. Removeram-se só a cópia descompactada ignored do principal (AppImage/source/WIP preservados) e a cache compilada Go sem ficheiros abertos, mantendo módulos/ferramentas/binaries/provas. Auditorias `.cache/disk-recovery-go-envelope.json` e `.cache/go-build-cache-recovery.json`. Revalidar a reserva antes de mais builds; não investigar/tocar em outros projectos. Última margem cerca de15,9GiB.

Depois do gate: rever/fixar qualquer falha, curar provas e commits coerentes; continuar envio/inbox/aprovação/proveniência/UI conforme `.codex-delivery/CONTRIBUTION-SUBMISSION-INTEGRATION.md`. Objectivo integral activo, sem novos agentes nem alterações de harness/bridge/serviços. HTML público permanece7fdb76a/0fdbd1b9.
