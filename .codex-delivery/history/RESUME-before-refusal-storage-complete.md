# Ponto de retoma actual — recuperação da reserva de disco

**Objectivo integral activo; produto não concluído.** Continuar PROJECT-BRIEF.md, sites expressivos, Liquid Glass, cinco SO e web com paridade, Reticulum/meios agnósticos e todos os gates. Manter Astra/Copilot Ultra, recuperação sequencial sem novos/retomados agentes e sem alterações de providers/bridges/permissões/serviços.

Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`. HEAD local `da2d174d820a6dff1b9e199ab61c1b998fa2a5b2` (protocolo de recusa verificado); último push `9a56c5f0b54c74b83c38e45840d8629791312c3c`. WIP posterior de persistência da recusa em21ficheiros, lista `.cache/rejection-storage-source-paths.json`; preservar WIP histórico da principal e outras worktrees. Staging selectivo, sem git add -A/reset/force-push/merge.

**Gate amplo original concluído.** 98625 terminou/recolhidoFAIL:535Node,17Go/race (app/sites novos, restantescached) ebuildnativoPASS;162/167testes entre processosPASS. Cinco arranques foram recusados pela reserva abaixo15GiB; são os casos do ficheiro site-contribution-source.test.ts. Webbuild e120casos porengine ainda nãoexecutaram nessegate. Gate dirigido73110 játerminouPASS:37casos e9porChromium/Firefox/WebKit. Todos os handles de testes foram recolhidos.

**Operação actual: gate45240 em curso**, `.cache/rejection-storage-reviewed/report.json`, driver `.cache/rejection-storage-reviewed-gate.mjs`. Os6casos repetidos após recuperar espaço passaram; webbuildPASS e120ChromiumPASS, Firefox emcurso na últimaobservação. DepoisWebKit. Fontesiguais ao gateoriginal; não editar/repetir enquanto vivo. Recolher o resultado antes de consolidar/commitar a persistência.

**93355 terminou/recolhidoPASS**: system.img inactiva compactada em1547627036bytes; SHA256 da descompressão igual ao original eb4bd8cc…a1. Userdata/AVD intactos. Estado na principal `.cache/android/archives/android36-x86_64-system-eb4bd8cc.json`; restaurar antes de usar oemulador: `python3 /home/absint0o/projects/relayloom/.cache/android/archives/restore-system-image.py`. Oscript exige margem15GiB e verifica os bytes. Últimareserva18.02GiB; houve oscilação dovolume, confirmar antes de cadafase.

Recuperação já feita:67580 terminou/recolhido;8AppImages históricos compactados num arquivo161852852bytes, todosos hashes conferidos,856908415bytes recuperados. Restauroexacto: `python3 -m tarfile -e /home/absint0o/projects/relayloom/.cache/archives/desktop-history-20260923.tar.xz /home/absint0o/projects/relayloom`. CacheGo decompilação,8executáveis de teste eChromium headed1243 regeneráveis removidos; headless-shell/Firefox/WebKit permanecem. OcorePlaywright confirma que matrizheadless semchannel usaheadless-shell. OCLIactual eAPK/perfis/provas estão preservados. Apenas worktreeantiga site-ci-clean, comprovadamente limpa e ancestral, foi retirada; ignoredcache/dist movidos para .cache/retired-worktree-support/site-ci-clean eGitSHA6dd879d preservado. site-data-next permanece intacta porque não eraancestral. Auditoria `.cache/disk-recovery-rejections-20260923.json` aindaPARTIAL.

Depois da recuperação: `.cache/rejection-storage-reviewed-gate.mjs` está preparado, **não executado**. Confirma fontesiguais, herda535Node/17Go/buildnativo, repete6casos doficheirobloqueado (5falhas+1controlo) ecorre webbuild/120casos porengine. ConservaFAILoriginal; não repetir535Node/Go porfaltadehandle. Curador `.cache/curate-rejection-storage.py` só deve executar apósPASS ecommitdasfontes. Provas doprotocolo da2d174 jácuradas em docs/evidence/site-contributions/rejection-protocol.

CI35855333712/9a56c5f terminouFAIL noauxiliarGo quejunta compilação+execução dentro60s nos3hosts; jobsdependentesSKIPPED. Provas docs/evidence/ci-9a56c5f. Não éHTTP408. .cache/measure-receipt-cold.mts e .cache/receipt-runtime-budget-driver-draft.ts são diagnóstico/proposta **nãoexecutados/nãointegrados**; mediruma vez com cachefria apósregressão e com reserva suficiente, sem aumentar cegamente o prazo doteste.

Persistência da recusa nãoé entrega/admissão nemUI pronta. Seguem runtime/API, decisão deincorporação/CAS/reconciliação/proveniência eUI de3contas PT/EN/ES. Rascunhos de2journals em .cache/rejection-admission-draft têmmanifestodebases e nãoestão instalados/compilados/testados. Ver CONTRIBUTION-REJECTION.md, REJECTION-DELIVERY-NEXT.md e CONTRIBUTION-DECISION-UI-NEXT.md. OHTML público permanece inalterado. Hardware/radios/Apple/assinatura, gruposweb/backup/rotação/keystore e revisãoindependente continuamobrigatórios.

Histórico da retoma anterior: [RESUME-before-resource-reserve.md](history/RESUME-before-resource-reserve.md).

## Reserva recuperada; retoma de testes

93355 terminou/recolhidoPASS:SDKsystem.img guardado em1547627036bytes, hashdescompactado/original eb4bd8cc…a1 igual; userdata intacta. Reserva16.40GiB. Restauro doemulador exige o script/ espaço descritos acima. Auditoria dereserva agoraCOMPLETE_WITH_INACTIVE_IMAGE_ARCHIVED. Nenhum teste foi relançado enquantoabaixo15GiB.

Vai iniciar o driver .cache/rejection-storage-reviewed-gate.mjs (não confundir como originalFAIL). Confirmar .cache/rejection-storage-reviewed/report.json antes de qualquer repetição; herda fasesiguais e executa6casos bloqueados/webbuild/120porengine.
