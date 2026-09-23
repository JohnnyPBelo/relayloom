# RelayLoom — retoma após entrega de recusas e optimização verificadas

**Objectivo integral activo; produto não concluído.** Preservar PROJECT-BRIEF.md: messenger/social cifrado, sites expressivos inspirados no ZeroNet, Liquid Glass, Windows/Android/macOS/iOS/Linux e web autónoma com paridade, Reticulum/meios agnósticos, setup PT-PT/EN/ES e todos os gates. Recuperação sequencial: sem agentes novos/retomados; manter Astra/Copilot Ultra, providers, bridges, permissões e serviços. Só este projecto.

## Repositório e estado

Worktree activa `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal em `codex/setup-languages` / `1e83db22`, com WIP histórico preservado. Código local verificado: `ac772242145135894da0d97b1712bc7e9db64c92` (entrega de recusa) e `4f309e6137eb66459c8e1b4336c4f54af3502064` (serialização). Documentação/provas acompanham num commit posterior. Último push confirmado antes desta nota: d6d4ddb; consultar `.cache/latest-push.json`, Git/origin e CI após consolidação.

Staging selectivo; preservar capturas/JSON históricos e node_modules. Não usar git add -A/reset/force-push ou merge sem aprovação.

## Incrementos verificados

ac77224 entrega recusas assinadas entre Node/Go/browser. Admissão exige a operação anteriormente copiada e referências exactas; guardar a recusa e retirar o payload privado partilham o commit. Recibos anteriores permanecem. cancelled/expired conservam a decisão local; recepção tardia não reabre a fila. Recibos e recusas partilham orçamento rotativo de8; recuperação varre até32 candidatos. Corrigida falha de revogação no browser, reproduzida antes: autorizações de recusas retidas sobreviviam a bloquear/voltar a permitir, porque revokeInvalid só percorria recibos.

**22962 terminou e foi recolhido PASS:**539 Node,17 Go/race,185 processos,140 por Chromium/Firefox/WebKit, builds e780 hashes conferidos.55 artefactos em `docs/evidence/site-contributions/rejection-delivery`; driver reproduzível `run-gate.mjs`. Não repetir por falta de handle.

4f309e6 copia sequências ASCII sem escapes em bloco, conservando o encoder Unicode/WTF-8/escapes e contando a pontuação final no orçamento global. O controlo de limite falhou antes e passou depois.512 combinações com referência anterior e260 vectores com bytes esperados de Node passaram. Benchmark local race de~1,55MB:143–148ms antes,5–6ms depois; não generalizar a todo o produto. O pacote Go/app passou em384.325s neste host, contra468.735s na execução anterior.

**64504 terminou e foi recolhido PASS:**540 Node,17 Go/race,185 processos,140 por Chromium/Firefox/WebKit, builds e782 hashes conferidos.27 artefactos em `docs/evidence/canonical-performance`; `run-gate.mjs` reproduz o gate. Curadores52151/47659 terminaram e foram recolhidos. **Nenhum teste local conhecido permanece activo.** Os rascunhos canónicos antigos já foram integrados; não os copiar de novo.

## CI

Run35868125390/d6d4ddb terminou FAIL. native-node Ubuntu/macOS535/535, Windows528PASS+7skips, e node-uiPASS. A separação da compilação/execução corrigiu o bloqueio anterior do auxiliar nos três hosts. native-go atingiu o limite acumulado de10min de Go/app, durante recuperação de site grande. A stack tinha uma rotina runnable a serializar base64~1,46MB sob Node.mu; não demonstrou deadlock. Jobs seguintes, incluindo Apple/browsers/Reticulum/pacotes, foram skipped.

Provas oficiais em `docs/evidence/ci-d6d4ddb` (8 artefactos). A optimização local não reclassifica esseFAIL; precisa de novo CI. Não aumentar prazos ou remover checks. Não éHTTP408.

## Recursos

Confirmar pelo menos15GiB antes de cada fase pesada; uma de cada vez, caches do projecto. A reserva oscilou e foi recuperada com arquivos verificados. Fontes/WIP, perfis, AVD e APKs foram preservados. Chromium headed1243 e caches Go/testes regeneráveis foram removidos; headless-shell/Firefox/WebKit completaram as matrizes.

Antes do próximo emulador Android, restaurar a imagem inactiva do SDK: `python3 /home/absint0o/projects/relayloom/.cache/android/archives/restore-system-image.py`. O script verifica SHA256/tamanho e exige espaço adicional para manter15GiB; userdata não foi alterada. A imagem compactada conserva SHA256 eb4bd8cc…a1. Não redownloadar imagens nem alterar serviços/permissões.

Oito AppImages históricos estão arquivados com hashes verificados. Restauro: `python3 -m tarfile -e /home/absint0o/projects/relayloom/.cache/archives/desktop-history-20260923.tar.xz /home/absint0o/projects/relayloom`. Apenas a worktree antiga, limpa e ancestral site-ci-clean foi retirada; suporte ignorado em `.cache/retired-worktree-support/site-ci-clean`. site-data-next e worktrees com WIP permaneceram intactas. Auditoria `.cache/disk-recovery-rejections-20260923.json`.

## Próximo trabalho funcional

1. Consolidar docs/provas com verificação de manifestos, confirmar ausência de CI activo e fazer push normal. Registar o novo run em `.cache/latest-push.json`; não cancelar jobs com pushes intermédios.
2. Implementar incorporação/aprovação, com CAS da revisão actual, reconciliação explícita de esquema/audiência, proveniência preservando a proposta do visitante e distinguindo alterações do dono, e publicação recuperável. Só published depois de reler a cópia real.
3. O documento actual já usa v4 para formulários; proveniência exige versão seguinte, sem alterar silenciosamente tabelasv1. IDs de linha têm limite40, portanto não usar certificateIdhex64 directamente nem tratar truncagem como autoridade. Conservar limites de128KiB/documento e64KiB/tabela. Ver `CONTRIBUTION-DECISION-UI-NEXT.md` para limites de divulgação, origem indisponível, carry-forward e ausência de referências circulares.
4. Completar UI de compor/enviar/rever/recusar/aprovar/reconciliar/publicar, com três contas, PT/EN/ES, teclado/toque, temas, acessibilidade e revisão visual. A paleta continua oculta até esse fluxo funcionar. Não substituir o objectivo por infra-estrutura ou mockups.
5. Manter grupos web dinâmicos, backup/rotação/keystore, restantes funções sociais/mensagens, plataformas/rádios físicos, paridade e revisão independente obrigatórios. Revisão própria não satisfaz revisão independente. Rascunhos Photos em `.cache/ios-photo-warmup-draft` continuam não integrados/compilados/testados; percurso fotográfico iOS e assinatura permanecem pendentes.

HTML público inalterado: runtime7fdb76a5de5869efa6ebdd721bc7e8f5efac68af, distribuição0fdbd1b9563540a5bc28c74d669668e948aa7667, https://johnnypbelo.github.io/relayloom/. Publicar só com gate da distribuição exacta/HTTPS. Não afirmar disaster-ready, todas as plataformas testadas ou produto concluído.

Histórico: [RESUME-before-canonical-complete.md](history/RESUME-before-canonical-complete.md).
