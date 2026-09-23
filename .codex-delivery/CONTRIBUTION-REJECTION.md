# Estado actual — persistência verificada, entrega/UI pendentes

Fonte627ad6c, gate revistoPASS e41 artefactos com hashes.535Node,17Go/race,167casos únicos entre processos e120porengine. Ver README das provas em docs/evidence/site-contributions/rejection-storage para a recuperação de cinco arranques sem reserva. Todos os handles locais foram recolhidos; nenhum teste conhecido activo. O driver CI e95b068 também passou localmente; novo CI pendente. As secções abaixo conservam o histórico.

# Recusa explícita de contribuições — integração em curso

O objectivo integral mantém-se activo. Recuperação sequencial, sem novos agentes nem alterações de modelos, bridges, permissões ou serviços.

## Verificado

O marco de recibos e as provas foram enviados em `9a56c5f0b54c74b83c38e45840d8629791312c3c`. CI35855333712 encontrava-se queued na última consulta; não interromper com outro push.

Protocolo de recusa commitado localmente em `da2d174d820a6dff1b9e199ab61c1b998fa2a5b2`, ainda sem push. `node .cache/rejection-protocol-gate.mjs` terminou PASS: typecheck, 64 vectores novos Node/portátil/Go (15 aceites/49 recusados), regressão dos 52 vectores do recibo, Go/sites-race e dois testes reais por Chromium/Firefox/WebKit. 762 hashes conferidos no commit;14 artefactos curados em docs/evidence/site-contributions/rejection-protocol. É protocolo, não entrega ou UI.

## Integração posterior, ainda WIP

Registo de decisão em Node/Go/browser: fase rejected e intenção privada do dono no mesmo commit que retira a prova da proposta. CAS sobre revisão da inbox; repetição com o mesmo motivo conserva o timestamp, destinatário público e prazo, sem reabrir a concessão. Uma candidata sem origem pode ser recusada sem alegar verificação da origem. Descarte local continua separado e pode ser usado sem notificar alguém bloqueado.

A nova intenção conserva o card autenticado do visitante antes da limpeza. Assinatura/envelope/cópia seguem etapas recuperáveis; o namespace contribution-rejection usa domínio próprio e não altera formatos/chaves existentes. Recibos anteriores conservam-se. Limpeza browser cobra também preparações de recusa no limite existente de128 por commit, sem aumentar o máximo de192 chaves.

Passaram os70 vectores de operações Node/portátil/Go (27 aceites/43 recusados), incluindo CAS, repetição, expiração, motivo, separação de recibos e quotas. Comando `node --import tsx --test tests/site-rejection-operations.test.ts`; logs rejection-operations-first e rejection-storage-compile. Typecheck da integração passou, mas os testes de persistência estão em curso.

Handle25466: `node --import tsx --test --test-concurrency=1 tests/site-contribution-inbox.test.ts tests/native/site-contribution-rejection-storage.test.ts tests/native/site-private-storage.test.ts`, log `.cache/rejection-storage-first.log`. Fonte do armazenamento não deve mudar enquanto executa. O ficheiro browser novo foi preparado separadamente; ainda não executado. Handles92265,73876,34163,65316,78540 terminados/recolhidos.

## Pendentes desta fase

Recolher o teste de persistência; corrigir falhas. Testar IndexedDB, perda de resposta/rollback/sessão/política, limpeza limitada e corrupção nos três browsers. Acrescentar concorrência real, quotas e controlos das assinaturas fora da RPC. Rever o código e executar regressão adequada com hashes congelados antes de commitar esta integração.

Seguem entrega/admissão da recusa, API e UI completas, decisão de incorporação/CAS da versão actual, reconciliação e proveniência. Paleta e HTML público inalterados. Nenhum destes testes de catálogo equivale a UI completa, hardware, revisão independente ou produto concluído.

## Revisão dos primeiros testes

25466 terminou FAIL,75/77PASS. Duas fixtures tentavam continuar na instância de base de dados fechada por um erro de integridade deliberado; agora verificam esse fecho e reabrem para confirmar bytes originais.57165 parou no typecheck por duas falhas nas fixtures; nenhum browser executou. Logs preservados.

Novo handle73110, driver .cache/rejection-storage-directed-gate.mjs, relatório .cache/rejection-storage-directed/report.json. TypecheckPASS; execução dirigida de catálogos/processos e9casos porengine emcurso. Inclui concorrência Node/Go sobreSQLite e limpeza129recusas no browser. Fontes congeladas; não editar/repetir enquanto vivo. Ainda éWIP.

## Gate amplo actual

73110 terminou/recolhido PASS: typecheck,37 casos Node/catálogos/processos (incluindo70vectores de operações e concorrênciaSQLite real),9 Chromium/9 Firefox/9 WebKit. Relatório .cache/rejection-storage-directed/report.json, hashes iguais antes/depois. O namespace privado acrescentou12 controlos ao driver que já passara anteriormente; não confundir passes parciais com o gate amplo.

**98625 emcurso**, .cache/rejection-storage-final/report.json, driver .cache/rejection-storage-final-gate.mjs. TypecheckPASS, suite Nodeintegral emcurso, depois17Go/race, builds, processos e120casos previstos porengine. Fontes congeladas; lista selectiva .cache/rejection-storage-source-paths.json. Não editar/repetir testes enquanto vivo.

CI35855333712/9a56c5f: Windows eUbuntu falharam em npmtest no auxiliar Go de orçamento de recibos aos60s; macOSainda emcurso. Ver CI-9A56C5F.md. Hipótese compilação+execução no mesmo prazo; driver alternativo emcache ainda nãointegrado. Preservar falhas, não aumentar cegamente o prazo de execução nem cancelar jobs.

## Gate amplo terminou; reserva de disco interrompeu cinco testes

98625 terminou/recolhidoFAIL:535NodePASS,17pacotesGo/racePASS (app/sites executados, restantes comcache),buildnativoPASS; testes entre processos162/167PASS. Cinco casos de tests/native/site-contribution-source.test.ts falharam ao arrancar Node porque a reserva desceu abaixo15GiB. Não é corrupção nemHTTP408; os pares nem arrancaram nesses casos. Buildweb/matriz120porengine ainda nãoexecutados neste gate. Fontes não foram alteradas; confirmar hashes antes de herdar fasesPASS.

Disco actual~13GiB durante recuperação. Nenhum teste local continuaactivo. **67580 emcurso**: compactação verificável de8AppImageshistóricos, em .cache/archives/desktop-history-20260923.tar.xz (na principal). Só remove originais após verificar todos osSHA256 e poupança suficiente; conserva provas/fontes/WIP/perfis/instaladoractual. Auditoria .cache/archives/desktop-history-20260923.json. Não interromper nem iniciar builds.

Depois recolher67580, restaurarreserva15GiB através de caches regeneráveis do projecto e confirmar espaço. Retomar os6casos do ficheirobloqueado e fasesweb/browsers com fontesiguais, preservandoFAILoriginal e proveniência das fasesanteriores. Não repetir535Node/Go só por perderumhandle. Mediçãofria do auxiliarCI e rascunho de admissão continuam fora dasfontes/nãoexecutados.
