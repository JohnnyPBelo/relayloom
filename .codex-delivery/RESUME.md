# RelayLoom — retoma, 21 de Setembro de 2026

O produto **não está concluído**. Preservar todo o `PROJECT-BRIEF.md`: messenger/social P2P cifrado, sites expressivos inspirados no ZeroNet, Windows/Android/macOS/iOS/Linux e web autónoma com paridade, Reticulum/meios agnósticos, setup, PT/EN/ES e Liquid Glass. Só este projecto. Manter Astra/Copilot Ultra e recuperação sequencial: **não criar nem retomar agentes**, nem alterar providers, bridges, modelos, autenticação, permissões ou serviços. Checkpoint adicional de manutenção cancelado.

## Onde continuar

- Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`.
- Principal: `/home/absint0o/projects/relayloom`, branch `codex/setup-languages`, HEAD `1e83db22ff9b7b9a65a400601b891312a3188960`. O seu WIP histórico permanece separado. Não resetar, apagar, copiar árvores antigas por cima, nem usar `git add -A`.
- Marcos novos: `995861d` contrato autónomo de contribuições; `def424f` inspecções de recursos; `5f6a929` corrida de pausa de relay; `564c280` evidência do CI anterior. Ver `git log -6 --oneline` para o commit de documentação posterior e confirmar origin antes de enviar.
- Commits e pushes normais autorizados; nunca force-push, segredos ou merge de PR sem autorização. WIP restante inclui relatórios/capturas antigos e o symlink node_modules: preservar, não incluir indiscriminadamente.
- Última leitura: **18 GiB livres**, reserva obrigatória de 15 GiB. Revalidar antes de builds/downloads. Uma execução pesada local de cada vez; dependências/caches no projecto.

## Publicação que existe realmente

https://johnnypbelo.github.io/relayloom/ — runtime **7fdb76a5de5869efa6ebdd721bc7e8f5efac68af**, distribuição **0fdbd1b9563540a5bc28c74d669668e948aa7667**, Pages35622927304 SUCCESS. V3 com recursos está publicado; as correcções recentes e formulários não estão no URL. Vinte artefactos HTTPS conferidos, seis percursos de recursos nos três motores e um entre processos Chromium/Firefox com mensagens/anexo/reabertura offline PASS. Provas: `docs/evidence/site-optional-resources/v3-ui/live`.

## Gates concluídos — não retomar como processos vivos

**Nenhum teste/processo local deste incremento permanece em curso.** Handle29159 terminou/recolhido0; 86072 terminou/recolhido0. Firefox15505 já não existia, mas log terminal e JSON confirmam12PASS em35s. Não repetir essas suites por falta de handle.

- `.cache/resource-relay-final/report.json`: typecheck, **33 contratos**, Go sites/race, build web, **107 WebKit**, **1 UI recursos Node + 1 Go**, Linux build/run/package/run, tudo PASS. Browser/UI sem skips, falhas ou flaky. Driver `.cache/resource-relay-final.mjs`; não sobrescreve relatórios existentes.
- `.cache/relay-clock-{chromium,firefox,webkit}-report.json`: **12 por engine** após mudanças de relay/relógio, todos PASS.
- `.cache/resource-performance-full/report.json` (FAIL histórico) contém Chromium104PASS e Firefox103/104 com oferta RTC lenta. `.cache/resource-performance-resumed/report.json` (FAIL histórico) contém Firefox104PASS e WebKit103/104 com corrida de relay. Só oito ficheiros mudaram depois, enumerados na curadoria; os passes anteriores conservam fonte própria, não são matrizes integrais reexecutadas na fonte final.
- Provas finais e comandos: `docs/evidence/site-resource-performance`. Curador local `.cache/curate-resource-relay-final.mjs` já executado; recusa substituir provas. Falhas/negativos estão preservados, incluindo intenção mutável `inspect→obtain` e erro alheio com a mesma mensagem de revogação.
- Página válida:128blocos/123referências, todas verificadas em10,6s neste WebKit, prazo15s mantido. Coalescing apenas simultâneo, sem cache de autorização; reabertura `posted2/held2/peak2`.
- Electron passou arranque/controlo de acesso/pacote; não é auditoria do sandbox do kernel. Aviso NSS original conservado, sem alterar configurações. Daemons criados pelos testes terminaram normalmente.

## O que foi corrigido e o que continua pendente

As inspecções readonly passam fora das filas de mutação com guards de sessão. A intenção é validada e copiada antes do primeiro await; bloqueio/lock invalidam respostas. A UI agrupa apenas pedidos simultâneos por snapshot/página/descritor completo, conserva slots enquanto chamadas reais acabam e clona respostas por consumidor; obtains continuam individuais.

`RelayRevokedError` identifica a revogação local no router. Só respostas automáticas capturam esse tipo; ficam sem responder após pausa mas mantêm o canal para tráfego próprio. Erros alheios/corrupção continuam a rejeitar admissão. As duas falhas negativas foram reproduzidas e 15 controlos repetidos passaram. Isto não demonstra resolução da ausência histórica de candidatos ICE nem da oferta Firefox de61,7s; três repetições e matriz seguinte passaram sem causa estabelecida.

Contribuições: esquema e certificado TS/Go, domínio, snapshot/revisão/formulário, UUID, valores, assinatura, validade e concessão máxima de publicação. Transporte cifrado privado e consentimento de divulgação futura são distintos. Tolerância300000ms igual ao envelope, com fronteiras300000/300001 testadas. Oito Node PASS, **48 vectores (11 aceites/37 recusados)** Node/portátil/Go, assinatura Go nos dois sentidos e browsers reais PASS. Evidência inicial46vectores preservada em `contract`; novas provas em `docs/evidence/site-contributions/clock-alignment`.

**Contribuições ainda não estão integradas na aplicação.** Ler `.codex-delivery/SITE-CONTRIBUTIONS-IMPLEMENTATION.md`: documento v4/form block, contexto derivado de snapshot autenticado, journal privado/replay, transporte/inbox, aprovação/rejeição/reconciliação CAS, proveniência de linhas e UI PT/EN/ES. Três contas reais e controlos de privacidade/restart/perda de resposta/quotas/autor offline obrigatórios. Não oferecer botões que não funcionem. A inspiração ZeroNet não autoriza scripts/HTML/SQL arbitrários.

## CI e plataformas

CI **35618030583 /7fdb76a** terminou FAILURE: Node nos três SO, Go/race, interop, UI nativa, RNS e pacotes desktop PASS; browser101/102 falhou desempenho (116/123), motivando a correcção actual. iOS build/install/startup PASS em26.4.1/Xcode26.6, mas `simctl addmedia` timeout60s impediu o teste UI funcional. Não afirmar mensagem/foto entregue nessa execução nem atribuí-la à falha AX de execuções anteriores. Vinte artefactos iOS conferidos; `docs/evidence/ci-7fdb76a` contém provas curadas/manifesto.

CI anterior35413693543 expirou25m cumulativos eminterop; jobs foram separados sem reduzir cobertura/prazos/permissões e35618030583 confirmou essa divisão. Novo CI das correcções deve ser acompanhado depois do push; não inferir passe remoto do gate local.

Hardware/rádios físicos, assinatura Apple, todas as plataformas efectivamente executadas, paridade integral e revisão independente continuam abertos/bloqueados conforme `docs/STATUS.md`. Não declarar prontidão para catástrofes. Grupos web dinâmicos, backup/rotação/keystore e restantes requisitos mantêm-se.

## Retoma exacta

1. Na worktree activa, ler este ficheiro e `PROJECT-BRIEF.md`; consultar `git status --short`, `git log -6 --oneline` e espaço livre. Preservar WIP. Não repetir gates já terminados.
2. Confirmar push/origin e CI com `gh run list --repo JohnnyPBelo/relayloom --branch codex/site-optional-resources --limit 3 --json databaseId,headSha,status,conclusion`. Não cancelar um CI em curso com pushes sucessivos sem necessidade.
3. Continuar integração real dos formulários. Actualizar TS/Go e fronteiras de assinatura v3→v4 em conjunto; duplicação deve remapear referências internas e inserir recurso não pode rebaixar versão. Ligar armazenamento/runtime/UI antes de alegar funcionalidade entregue.
4. Antes de actualizar HTML, validar artefactos exactos da distribuição e os percursos HTTPS; publicação existente permanece até esse gate. Não reduzir cobertura nem relaxar limites para passar.

O histórico integral desta retoma foi preservado em `.codex-delivery/history/RESUME-before-resource-relay-final.md`. A execução sequencial tem prioridade sobre a delegação até indicação contrária do proprietário.


## Actualização mais recente — documento v4 (posterior ao gate anterior)

Push confirmado de **0a85d7d** para origin/codex/site-optional-resources. CI **35661349213** arrancou: Linux/Windows em curso, macOS em fila na última leitura. Não reenviar commits sucessivos cancelando esse CI sem necessidade.

Nenhum teste local está vivo. 85184 terminou com código 2 por typecheck do novo fixture (nenhum Go arrancou); 8073 terminou 0 depois das correcções; 41369 terminou 0; 12342/90874 são controlos negativos terminados com código 1. Todos os resultados foram recolhidos.

Fontes v4 locais posteriores a 0a85d7d: documento/form-schema TS/Go, remapeamento ao copiar páginas/composições, compatibilidade de recursos e guards >= 3 nas seis fronteiras de publicação/admissão. O bloco form está oculto na paleta; envio e aprovação ainda não estão implementados. Os testes foram ampliados sem reduzir os anteriores.

Gate: **79 Node, 24 vectores (8 aceites/16 recusados), typecheck, Go sites/race, três testes Go app dirigidos com race, build e dois casos por browser (seis no total)**. O primeiro caso de browser usa catálogo/IndexedDB/assinatura/cifra reais; o segundo usa a UI de páginas existente. Não chamar esses seis casos de UI de formulários. A regressão completa da candidata v4 e o seu CI continuam pendentes.

Provas: `docs/evidence/site-contributions/document-v4`; relatórios locais `.cache/site-form-v4-current-source.json` e `.cache/site-form-v4-browser-final/report.json`. O guard BrowserApplication.prepare assinava antes de a admissão recusar; controlo anterior: uma assinatura e unpublished=true; depois: zero assinaturas. Erros iniciais de fixture/typecheck foram preservados e corrigidos, sem mascarar a causa. A fase v4 não está no CI 0a85d7d nem no HTML público.

Continuar com contexto de formulário derivado de snapshot autenticado na API, journal privado/replay, envio/inbox, aprovação/reconciliação/proveniência e UI real PT/EN/ES, conforme `SITE-CONTRIBUTIONS-IMPLEMENTATION.md`. Não declarar conclusão nem reduzir os restantes requisitos. Antes de novas alterações, consultar git log/status para o commit local que guarda v4 e as suas provas.
