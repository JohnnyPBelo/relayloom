# RelayLoom — checkpoint de implementação, 2026-09-12

Trabalhar só em `/home/absint0o/projects/relayloom`. O contrato integral `PROJECT-BRIEF.md` continua activo e incompleto. PT-PT; manter Astra/Copilot Ultra, providers/autenticação/bridge/serviços/permissões/segurança. Recuperação sequencial: nenhum agente novo ou retomado. A manutenção terminou e o utilizador cancelou o handoff adicional. Não criar esse checkpoint nem aguardar manutenção. Dependências/caches no projecto, uma compilação pesada de cada vez, pelo menos15GiB livres. Não tocar noutros projectos/ficheiros pessoais, comprar serviços ou obter root. Commits/pushes normais autorizados; nunca force-push/merge sem autorização.

## Continuação activa depois da publicação

Publicado normalmente até `b86a5b1bd5023fad52cabb4f1c15172507dbc370`; CI34686129024 terminou: Node passou nos três OS e Go passou build/unit/race, mas dois relatórios de interop falharam ENOENT por pasta não criada. Os jobs seguintes foram omitidos. A correcção de mkdir nos dois testes foi reproduzida/validada numa cópia limpa de b86a5b1, com cada relatório inicialmente ausente. Sessões81131/18520/83169/23032 são terminais. Ver `docs/CI-B86A5B1-FOLLOWUP.md`; próximo push correctivo/CI precisa de observação. Não confundir o novo CI com o antigo bloqueio Apple.

Há nova implementação local **não commitada/não integrada** em `packages/profile/src/{state,binding,database}.ts`, `native/profilestate`, `native/profilebinding`, com testes `tests/profile-{state,binding}.test.ts` e opção `newStoreId`/`NewStoreID` nos dois stores. Blob privado16MiB/32 blocos, CAS e binding assinado preparados. Node6 passou; Go state4 passou com race; binding/storage passou:17 casos Go de topo (4 state+2 binding+11 storage), com race em15.547s; sessão73042 terminal, comando/output em `.cache/profile-foundation`. Factory Node `database.ts` ainda sem testes, Go factory ainda por implementar. Detalhes/limites/retoma em `.codex-delivery/PROFILE-STATE-IMPLEMENTATION.md`. A aplicação ainda usa o JSON privado antigo; não declarar migração ou grupos dinâmicos concluídos. Sessões36262/77865/89612/64164/40937 terminaram;41430 terminou com typecheck passado antes do último reforço de validação do marker; a factory continua por testar.

## Estado real e operações

Todos os testes/supervisores locais desta continuação terminaram, incluindo82452 (gate completo),22349 (índice) e75133 (autoridade final). Não repetir por um handle ausente. Ler os respectivos ficheiros de comando/resultados antes de qualquer retoma. Não há app/emulador/build local conhecido em curso desta fase. AVD/adb próprios continuam parados. Última reserva de disco acima de120GiB.

Marcos locais já criados: `76ed7e0` reserva do índice/acessores, `0df38f3` outputs públicos, `19a1a74` autoridade Node/Go. O marco de exclusividade de perfil acompanha este checkpoint. Revalidar `git status --short`, HEAD e origin antes de continuar; não reset/clean. Último remoto/CI efectivamente observado ainda é0289ec7/34675214610; o próximo push/CI precisa de observação por commit exacto. Os13 ficheiros originais da recuperação foram preservados e integrados, não descartados.

## Implementado nesta continuação

- `packages/groups/src/registry.ts` e `native/groupauthority`: criação/convite/consentimento/alteração/saída/encerramento, cabeças e provas persistidas, cursor de validação de snapshots intermédios, conflitos assinados, suspensão/recuperação de capacidade, consulta/idempotência finita de256 operações,64 grupos permanentes. Checkpoints até52KiB; operações até2KiB; reserva4MiB. Biblioteca ainda sem importação na aplicação/API/UI: os grupos do produto continuam fixos.
- Certificados Node/Go verificam adesão pelo cabeçalho pai assinado sem dar snapshots/chaves históricas a recém-chegados. Um membro já admitido não pode saltar uma transição intermédia inválida.
- SQLite protegido partilhado: além da reserva de bytes, entradas normais deixam `min(128KiB,reserveBytes/4)` no índice de4MiB. Contagens expõem indexBytes/ordinaryIndexBytes/indexReserveBytes. Registos antigos acima dessa margem falham sem reset/destruição; não há migração silenciosa. Backup integral válido antigo continua indetectável.
- `packages/profile/src/ownership.ts` e `native/profilelock` já estão ligados a `LoomNode`/`native/app.Node`: um proprietário cooperante por perfil, libertação após morte/fecho, construtor falhado não repõe dados, instâncias encerradas rejeitam trabalho obsoleto. Chamadas concorrentes de fecho aguardam conclusão. Não há lease por relógio, PID-killing ou serviço externo.
- O JSON privado da aplicação/outbox ainda é separado do SQLite de autoridade. Exclusividade de processo não os torna atómicos. Store-ID por instalação, migração e coordenação transaccional são a próxima fase: `.codex-delivery/GROUP-RUNTIME-BOUNDARY.md`.

## Evidência e versões

1. Pendente anterior recuperado sem repetição:9 Go certificados com race, saída0,5.883s; hashes de código/output confirmados. Sessão33737 inexistente após manutenção foi resolvida pelos artefactos.
2. Gate de runtime congelado:133 Node/74.563s;95 Go de topo com race/353.956s, quatro helpers unitários deliberadamente omitidos e executados nos drivers;11 interop/134.734s;15 UI Node/113.698s;15 UI Go/102.264s; desktop build0.359s, smoke1.307s, pacote9.877s, packaged smoke1.975s. Tudo passou, sem mudanças dos inputs. `docs/evidence/group-authority/runtime`. Isto precede a última correcção exclusiva do índice da biblioteca.
3. Correcção de índice: falhas reais antes em `docs/evidence/group-authority/index-reserve`;14 Node storage/index8.196s,11 Go storage/race2.439s e2 interop12.660s passaram. O teste com18 717 entradas válidas passa com o guard Go actual e falha com apenas esse guard retirado por overlay de teste; produção não é alterada. Essa fixture grande não usa race. Uma anotação literal TS foi corrigida e o build/typecheck passou depois.
4. Validação final de autoridade com índice corrigido:25 Node (23 autoridade+2 índice)28.460s;12 Go autoridade/race168.326s;interop real de autoridade22.922s. Outputs e hashes em `docs/evidence/group-authority/final`. Casos incluem CAS Node/Go real, mortes pré-commit em ambos sentidos, resposta Go perdida repetida em Node, Unicode exacto, saída/reentrada, cursor/fork/quota e corrupção.
5. O cenário combinado256 operações/64 grupos foi mantido:435.400s antes,129.050s com checkpoint reutilizado apenas na leitura da mesma transacção. Cada assinatura/revisão de operação continua verificada; nenhuma cache de autoridade cruza transacções. A regressão adicional confirma rejeição de assinatura inválida depois de preencher a cache. Não é benchmark de hardware móvel.

Artefactos UI continuam `index-CFZzmFWN.js`/`index-DwCp7KCv.css`; root reviu onboarding720px e social móvel,18 relatórios Axe actualizados têm zero violações. Notificações/microfone nos E2E têm stubs/entrada sintética declarados. O CLI Go e pacote Linux foram reconstruídos/executados; Android/iOS ainda não incluem a exclusividade de perfil. Alguns outputs TAP publicados têm cópia legível sem espaços finais e original exacto em base64 com `normalization.json`; nunca confundir o hash normalizado com o raw.

## Plataformas/CI

CI34675214610 para0289ec7 passou Node em trêsOS, job Go e três pacotes desktop. iOS26.5 compilou/arrancou/instalou, mas `simctl addmedia` terminou por timeout61.431s antes do XCUITest; diagnóstico7.198s recolheu inicialização/reconstrução da fototeca sem causa conclusiva. Foi apagado só o simulador criado. `docs/evidence/ios/0289ec7`. Não repetir a mesma preparação inalterada nem aumentar prazos em ciclo. Não há execução da app iOS nem distribuição assinada demonstradas.

APK/AAR anteriores fa1481d3/51dedfe0 mantêm80 asserções no emulador API36x86_64 para a versão anterior; não herdam este código. Sem hardware físico Apple/Android/radio, BLE/Wi-Fi Direct/LoRa, leitor de ecrã real ou prontidão para catástrofes. Reticulum interoperável não é afirmado.

## Próximo trabalho concreto

1. Concluir commits/push deste marco e observar o CI exacto sem tratar execução local como teste de todos os OS. Revalidar artefactos Android após rebuild; Apple permanece bloqueado na preparação da fototeca, requer investigação concreta preservando cobertura.
2. Fixar store-ID assinado por instalação e migrar o estado privado limitado para uma transacção comum com autoridade/admissão/outbox. Testar crash antes/depois de cada fronteira, corrupção, quota e recuperação; não usar SQLite como pretexto para dizer que o JSON separado já é atómico.
3. Sincronização de provas/carriers, admissão/IDs aceites, quarentena e audiências original/actual, operações superseded imutáveis e republicação explícita. Depois API/UI de grupos dinâmicos, controlos reais de rede/partição/restart/TTL/quota e acessibilidade. Preservar grupos fixos e não partilhar história/chaves silenciosamente. Acrescentar fontes de grupos aos digests de produção quando forem importadas; os digests já incluem profilelock e lockfiles.
4. Prosseguir keystore/rotação/recuperação, pesquisa integral, perfis/social/media/templates, notificações e todos os restantes critérios. Revisão independente do código novo continua pendente durante a proibição de agentes; não a inventar.
5. Polimento identificado na captura móvel: “1 publicações em cache” precisa de singular correcto na próxima iteração UI. Não declarar design/produto terminado.

Referências: `docs/GROUP-AUTHORITY.md`, `GROUP-STORAGE.md`, `GROUP-EPOCHS.md`, `docs/STATUS.md`, `.codex-delivery/GROUP-AUTHORITY-IMPLEMENTATION.md`, `GROUP-RUNTIME-BOUNDARY.md`, `learning-log.md`. Histórico anterior em `.codex-delivery/history/RESUME-before-authority-runtime-publish.md`.
