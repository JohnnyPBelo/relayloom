# Persistência privada de recusa — incremento verificado

Fonte `627ad6c0b98e10b0d4c4c68e3dffb7072118a81d`. Node/Go/browser guardam a decisão do dono e retiram a prova da proposta no mesmo commit. A revisão da inbox evita recusar uma vista desactualizada; a repetição conserva motivo, destinatário e prazo. O card autenticado do visitante fica retido antes da limpeza. Recibos históricos permanecem separados, e uma recusa sem origem disponível não afirma verificação dessa origem.

Assinatura, envelope e cópia têm etapas recuperáveis, com namespace privado próprio. Reabrir/repetir conserva os bytes. Expiração remove preparações limitadas sem apagar o facto da recusa nem renovar a concessão. Copied continua a significar cópia local, sem alegar entrega ao visitante.

## Execução

Reprodução integral num checkout limpo: `node docs/evidence/site-contributions/rejection-storage/before-resource-recovery/run-gate.mjs` nesta fonte, com dependências/caches do projecto e pelo menos15GiB livres. O driver recusa substituir relatórios e corre uma fase pesada de cada vez.

535 testesNode;17pacotesGo/race (consultar logs para execução/cache e helpers condicionais);167 testes entre processos;120Chromium/120Firefox/120WebKit. Typecheck ebuildsnativo/webPASS. 768hashes antes/depois iguais e conferidos no commit. O driver de revisão requer o relatório anterior e herda apenas fases de fontes idênticas. A primeira regressão teve cinco arranques bloqueados pela reserva15GiB; todos foram reexecutados com um controlo positivo depois da recuperação. O primeiro relatório permaneceFAIL. Nenhum skip/falha/flaky nos relatórios finais Node/browser. Drivers executam os helpers Go efectivos.

Controlos novos:70vectores Node/portátil/Go; CAS/repetição/motivo/expiração/quotas; crashes antes/depois da decisão/assinatura/selagem/cópia em ambos os motores; concorrência real na mesmaSQLite; domínios privados e transposição entre stores; preservação do recibo/provas alheias; corrupção bloqueia leitura e limpeza. IndexedDB real nos três engines: rollback, perda de resposta, bloqueio/sessão/prazo retidos, reabertura e129assinaturas expiradas em lotes128+1. Worker compilado recusa os helpers privados na RPC. Regressão existente de recibos/transporte/browser mantida.

## Falhas preservadas

O primeiro gate amplo passou535Node/17Go-race/buildnativo e162dos167casos entre processos. Cinco pares Node recusaram arrancar quando o volume desceu abaixo15GiB. Sem alterar fontes ou esse limite, a revisão repetiu os6casos do ficheiro afectado e executou buildweb/3browsers completos. A cobertura combinada tem167casos únicos; não se apresentam as162execuções anteriores como novas.

Primeiro teste de armazenamento:75/77PASS. Duas fixtures novas reutilizavam uma instância fechada por erro de integridade deliberado; agora exigem o fecho, reabrem e verificam o envelope original antes do controlo positivo. Não se relaxou a integridade. A primeira tentativa de matriz browser parou no typecheck por variável duplicada e resultado opcional na fixture; nenhum browser executou nessa tentativa. A revisão dirigida passou37casos e9porbrowser antes da regressão final. Logs anteriores ficam emcontrols. O primeiro teste curto não registava hashes antes/depois; não lhe atribuir o commitfinal.

## Fronteiras

Entrega/admissão da recusa no runtime eAPI/UI continuam pendentes. Não há aprovação/publicação, reconciliação ou proveniência completas. Paleta eHTML público permanecem anteriores. Revisão própria não substitui revisão independente. Hardware/radios/Apple/assinatura eparidade integral permanecem no contrato; WebKitLinux não éiOS. CIremoto é registado separadamente, sem herdar este passe para os seus falhanços. A recuperação de espaço arquivou instaladores históricos e a imagem inactiva do SDK com hashes exactos, preservando userdata/AVD, fontes e WIP. A imagem deve ser restaurada antes do próximo emuladorAndroid; instruções e auditorias emresource-reserve. Foram removidas apenas caches regeneráveis e uma worktreeantiga comprovadamente limpa; o suporte ignorado dessa worktree foi retido. Nenhum processo/serviço externo foi encerrado.
