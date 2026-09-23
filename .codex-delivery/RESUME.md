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
