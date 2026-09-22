# RelayLoom — retoma após descarte e protocolo de recibos

**Objectivo integral activo; produto não concluído.** Manter PROJECT-BRIEF.md: messenger/social cifrado, sites expressivos inspirados no ZeroNet, Windows/Android/macOS/iOS/Linux e web autónoma com paridade, Reticulum/meios agnósticos, setup PT-PT/EN/ES e Liquid Glass. Execução sequencial: não criar nem retomar agentes. Manter Astra/Copilot Ultra; não alterar providers, bridges, autenticação, permissões ou serviços. Checkpoint adicional de manutenção cancelado.

## Localização e preservação

Worktree activa `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. Principal `/home/absint0o/projects/relayloom` permanece em `codex/setup-languages` / `1e83db22`, com WIP histórico separado. Nunca git add -A, reset, force-push ou merge sem aprovação. Capturas/JSON antigos e symlink node_modules permanecem fora do staging deste incremento. Reserva revalidada: cerca de 23 GiB; mínimo 15 GiB; caches/dependências no projecto e uma execução pesada local de cada vez.

Último push confirmado: **f3f32fca43299a5bfab8a92b503f5ae3336c42e2** (origem privada e provas). Novos commits locais: **6e1f530** descarte/correcção de retry, **bf12d51** protocolo de recibo, **1a53620** selector de fotografia XCTest. Documentação/provas ainda a consolidar; consultar git log/status antes de prosseguir.

## Implementado/testado neste incremento

- `dismiss(id, revision)` nos três motores. CAS da inbox, remoção atómica da prova privada, fase dismissed com metadados de replay finitos e verifiedAt preservado. `inbox.management` permite descarte de candidatas bloqueadas/sem origem sem devolver valores ou provas. Não é recusa assinada nem apaga cópias em cache/pares.
- O gate amplo `.cache/contribution-dismiss-final/report.json` terminou **FAIL só em três casos WebKit**, com 46 Node, seis Go/race (quatro cached), 87 casos entre processos e 85 Chromium/85 Firefox PASS. O relatório falhado foi preservado.
- Dois controlos determinísticos reproduziram o defeito: retry idêntico substituía a referência de autorização e invalidava consultas em curso. O runtime browser conserva a referência quando o registo é igual; revogação remove-a e uma nova autorização usa outra. Quatro controlos provam os dois caminhos, com pedido novo positivo.
- `.cache/contribution-dismiss-reviewed/report.json`: **PASS**, typecheck/build e **89 casos por cada Chromium/Firefox/WebKit**, sem falhas/skips/flaky. Só runtime browser e teste de concorrência mudaram desde o gate amplo; os passes Node/Go/processos são herdados com proveniência explícita. 736 hashes finais coincidem com **6e1f530**. Provas em `docs/evidence/site-contributions/dismissal`.
- **bf12d51**: certificado de recepção do dono, ligação exacta ao certificado/autor/UUID/destino/prazos e envelope privado para dono+contribuidor. **52 vectores (7 aceites/45 recusados)** Node/portátil/Go, typecheck, Go/sites-race e **1 teste real por engine** PASS. Não há journal, admissão/entrega automática de recibos ou UI. Provas `docs/evidence/site-contributions/receipt-protocol`. Cinco fontes novas; não lhes atribuir os 89 casos do incremento anterior.

**Nenhum teste local deste incremento está activo.** Handles45853/55805/34744/96510 e controlos anteriores foram recolhidos. Não repetir suites por perda de handles. Os rascunhos em `.cache/receipt-staging` já foram integrados; não editar essas cópias históricas.

## CI e iOS

CI **35786710953 / f3f32fc**: matriz Node, node-ui, Go/race, interoperabilidade, UI Go, Reticulum e três pacotes desktop PASS. iOS terminou FAIL; autonomous-browser terminou PASS. Execução global terminal FAILURE apenas em iOS. O workflow cancela a execução anterior num novo push: a execução anterior já é terminal, portanto o próximo push normal não a interrompe. Documentação/provas prontas para consolidar e enviar. Recolher o novo CI após o push, sem alterar o workflow.

No iOS26.4.1/Xcode26.6, build/install/startup/importação passaram e o par Node confirmou uma mensagem privada assinada com leitores exactos. A falha foi `missing("seeded synthetic photo")` na linha308: a captura mostra o asset, mas AX expõe imagens PXGGridLayout-Info, sem células/ponto hittable. Artefacto10722173657 (1841035bytes), 27 ficheiros conferidos. Não houve anexo/resposta confirmada. Esta execução não teve o TimeoutError de observação anterior, mas não prova a causa do atraso antigo.

**1a53620** ajusta somente o selector XCTest à evidência observada: um único asset recente pelo identificador/data/frame visível, centro do rectângulo AX se necessário, mesmos limites20s/15s e confirmação enabled/compositor/Node mantidos. `node scripts/ios-simulator.mjs --check` passou apenas estruturalmente; não existe swiftc local. **Compilação e execução Apple deste selector ainda pendentes.** Provas em `docs/evidence/ci-f3f32fc`. Não declarar iOS corrigido nem teste físico/signing.

## Próxima implementação concreta

Ler `CONTRIBUTION-RECEIPTS-NEXT.md`, `CONTRIBUTION-RECEIPT-PROTOCOL.md`, `CONTRIBUTION-DISMISSAL.md` e docs/SITE-CONTRIBUTIONS.md. Continuar journal privado de recibos: intenção e destinatário público no mesmo commit da verificação; assinatura e envelope exactos persistidos em passos recuperáveis; cópia relida antes de rede; recibo tardio só regista recepção anterior, sem renovar concessão. Encerrar retries e libertar payload do visitante numa transição durável; cancelamento não apaga recepção confirmada. Registos antigos descartados sem dados suficientes não ganham recibos inventados.

Depois recusa assinada, aprovação com CAS/base/esquema/audiência, reconciliação/proveniência e UI completa PT/EN/ES com três contas reais. Paleta de formulários continua oculta até compor/enviar/rever/recusar/aceitar/reconciliar/publicar funcionar. Continuam grupos web dinâmicos, recuperação/rotação/keystore, plataformas/rádios, acessibilidade e revisão independente. Revisão própria não cumpre o último requisito.

HTML público inalterado: runtime `7fdb76a5de5869efa6ebdd721bc7e8f5efac68af`, distribuição `0fdbd1b9563540a5bc28c74d669668e948aa7667`, https://johnnypbelo.github.io/relayloom/. Só publicar após gate da distribuição exacta/HTTPS. Sem alegação de disaster-ready ou todas as plataformas/rádios testados.
