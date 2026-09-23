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
