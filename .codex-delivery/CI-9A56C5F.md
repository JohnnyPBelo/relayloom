# CI9a56c5f — observação em curso

Run35855333712. Windows job107162340216 e Ubuntu job107162340647 falharam em npmtest; macOS continua emcurso. Não cancelar a execução com outro push. Os logs dos jobs terminados foram recolhidos pela API de jobs; gh run view --log recusou enquanto o runglobal estava emcurso. Ficheiros em .cache/ci-9a56c5f; os IDs exactos estão nos JSON.

Ambos falham no teste Go receipt runtime applies the same rotating copy budget, including real quota failures:60.013s Windows/60.067s Linux; statusnull no spawnSync, sem resultado terminado do worker. O comando actual combina compilação com race e execução dentro dos60s. O gate local anterior tinha passado em28.161s depois do aquecimento de compilação documentado. Isto não éHTTP408 e não estabelece, por si, a causa exacta do timeoutremoto.

Hipótese a verificar: a compilação fria com race consome parte do orçamento do teste. Rascunho .cache/receipt-runtime-budget-driver-draft.ts separa compilação explícita limitada120s (padrão já usado nos drivers do projecto) e execução do binário com o mesmo limite exterior60s, com limiteGo55s para obter falha/stack antes do wrapper. Regista fases e nunca chama compilação de teste passado. Ainda não instalado nem executado; não chamar corrigido.

Não editar fontes do gate98625 emcurso. Depois recolher o gate, reproduzir/observar com cachefria própria dentro da reserva15GiB, rever o driver e validar execuçãoreal. O CIremoto continua necessário para comprovar Windows/macOS; não herdar passes de versões anteriores. Nenhuma alteração de provider, bridge, serviço, permissões ou segredo.

RunterminalFAIL: macOS107162340479 também falhou no mesmo auxiliar em60.015s. Os restantes jobs foram skipped por dependência, incluindo Apple, browsers, interop e pacotes; não são passes nem falhas dessas funcionalidades nesta execução. Logs dos três jobs e summary.json preservados em .cache/ci-9a56c5f. Não há CIactivo conhecido deste ramo. O gate local98625 continua independente e com fontes congeladas.

Está preparado .cache/measure-receipt-cold.mts para uma medição sequencial após o gate actual: uma única execução combinada com cachefria própria e limite60s, seguida de compilação fria separada e execução limitada. Não foi executado. Guarda tempos/logs/resultado e distingue ausência de reprodução local; só pode parar o grupo de processos criado pela própria fixture no seu prazo. Mantém reserva15GiB e não usa cache global/pessoal. Não iniciar enquanto98625 estiver vivo.

## Diagnóstico e correcção verificados

A hipótese foi reproduzida em Linux: comando frio60.009s sem teste lançado; compilação/vet62.177s, execução27.353sPASS. Fonte e95b068 integra o driver separado; typecheck e3 casosPASS, preparação62.267s/execução27.335s. Provas docs/evidence/ci-receipt-budget-cold. Novo CI ainda pendente; o FAIL anterior permanece.
