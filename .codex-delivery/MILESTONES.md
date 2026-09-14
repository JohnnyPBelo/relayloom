# Consolidação em marcos verificados

O preview em4174 e todas as alterações da árvore principal são preservados. Sem novos/retomados agentes ou mudanças de modelos/bridges/configuração externa. As cópias de validação ficam dentro de `.cache` deste mesmo projecto, com dependências/caches partilhadas apenas do RelayLoom. Não são outras workspaces/produtos.

## Commits locais já criados

- `e095f2a`: tipos/canonical portáteis, validação deestrutura e modelos daoutbox partilhados. Aplicado sozinho sobre526d75a em `.cache/milestone-check`; build/43Node/1fluxoUI real passaram. Evidência pública em docs/evidence/portable-models. Não contém os runtimesbrowser/C2.
- `94c355f`: codecs/journal cifrado deavisos invitation/consent/leave emNode/Go e metadata read-only de syncState. Aplicado sozinho sobre e095f2a em `.cache/milestone-notices`; build/18Node/5Go-race/1driver deprocessos Node↔Go passaram. package.json foi incluído só com o pacote groupnotice, sem referências prematuras awebpeer. Evidência em docs/evidence/group-notice-codec.

Os três marcos foram publicados por push normal em origin/main, agora `bb85d1a`. Este terceiro commit integra o runtime C2/replay com evidência isolada. O remoto anterior `526d75a` tem a falha Windows65s conhecida; a nova execução CI ainda precisa de ser observada, sem aumentar o prazo.

## Conjunto de runtime C2 em validação

Candidato `.cache/milestone-group-runtime` sobre94c355f. Inclui API/journal de convites, transporte/replay de notices, barreiras e optimização de snapshotsincorporados. Os blocos web-peer/WS foram retirados APENAS da cópia candidata de apps/node/src/node.ts e native/app/node.go. Os originais principais não foram alterados. Os modelos de conteúdo já publicados são usados pela cópia.

Build/typecheck/CLI passaram. A sessão 43196 terminou com código 0: 269 testes Node (266 de topo), zero falhas/skips, 485.074 s; log `.cache/milestones/group-runtime-node-all.log`. Ficheiros/hashes candidatos em `.cache/milestones/group-runtime-{files,inputs}.json`; os 27 inputs coincidem com o registo anterior.

Gate de continuação terminado com código 0 na sessão 48888: `node .cache/milestones/verify-group-runtime.mjs`. Regista comandos, duração, resultado e hashes, executando Go/race dirigido, carriers Go, drivers C2/replay/seeding e toda a UI nativa com os dois motores. 360 fontes permaneceram estáveis. Passaram 7 Go/race dirigidos (um helper omitido, não contado), 18 percursos entre motores e 19 UI Node/19 UI Go. O relatório e logs foram copiados para `docs/evidence/group-notice-runtime`; commit `bb85d1a` publicado. O candidato UI seguinte está em `.cache/milestone-group-ui`, com 7 ficheiros de input registados e testes novos de recuperação ainda por recolher.

## Próximos conjuntos

1. Finalizar e commitar runtimeC2/replay comlimites e estado factual; resolver qualquerfalha sem reduzir cobertura.
2. Separar UI nativa de grupos; depois adaptadoresWS Node/Go com suasdependências e testes.
3. Browser/kernel e aplicaçãoautónoma/worker/SW compipeline e documentação completos. Cada conjunto deve compilar sem imports paraficheiros ainda ausentes.
4. Publicar marcos normais, observarCI actual (sobretudoWindows65s), continuar todos os pendentes do contrato, incluindo gruposdinâmicos no browser e plataformas/hardware.

As notas e artefactos anteriores sobre526d75a continuam a descrever árvores locais testadas. Não atribuir esses passes à origem nem alterar relatos de falhas para passes. O objectivo completo não está concluído.


## UI — estado do candidato actual

Cópia `.cache/u` (movida da antiga `.cache/milestone-group-ui` para manter o socket Electron abaixo do limite Unix). Primeiro gate:23 Node/23 Go passaram; arranque desktop falhou com caminho111bytes. Sem alteração de sandbox ou serviços. A revisão também reproduziu contador de convite fora do botão a320px; layout em colunas corrigido e mesmo fluxo E2E passou14.0s. A resposta tardia após lock foi reproduzida e corrigida antes (2casos Node6.6s/Go5.1s).

Gate final activo7421, relatório `.cache/u/.cache/ui-verification/report.json`, log `.cache/milestones/group-ui-corrected-final.log`. Inputs finais em `.cache/milestones/group-ui-final-inputs.json`. Depois arquivar relatórios/capturas/Axe e falhas, commitar os7 inputs UI mais documentação coerente. Não incluir o painel autónomo ainda não publicado no fragmento main.tsx deste marco. O preview principal continua preservado. CI34805308160/bb85d1a activo; não cancelar por um novo push enquanto se procura o resultado Windows65s.


## Estado mais recente

C3 foi commitado como719a53f e o fecho de fixtures SQLite como54d298a, ambos ainda locais. Originbb85d1a. Gate finalUI7421 passou; versões e evidências exactas em RESUME.md. CIbb85d1a terminou failure(Windows), não foi relançado.

O candidato actual é `.cache/p` sobre54d298a, para o cache de leituras verificadas de autoridade.2inputs;6controlos e cenário completo antes/depois passaram;gate integral48594 activo (Node/interop/UI/desktop), relatório `.cache/milestones/scoped-reads-report.json`. A prioridade de integração é recolher/corrigir este gate e verificar Windows com uma alteração fundamentada, antes de continuar a consolidação WS/browser e a paridade. Todo o contrato permanece activo.


## Publicação mais recente

719a53f,54d298a e60f514c foram publicados por push normal;HEAD/origin60f514c. O gateNode/interop/UI/desktop48594 terminou0 com366fontes estáveis; evidência em docs/evidence/scoped-authority-reads. Go/race integral+SQLiteC continuam nohandle90010, com a cópia.cache/p congelada. NovoCI34809654103 observadoqueued; confirmarWindows65s antes de atribuir passe. Não fazer outro push que o cancele.


## Adaptadores WS preparados, ainda sem build

Foi criada.cache/w sobre60f514c com23inputs registados em `.cache/milestones/websocket-inputs.json`. Contém apenas os adaptadores/API/cancelamento Node+Go, dependênciasWS e licenças/staging desktop/móvel. O package/lock da cópia não inclui ainda@noble/hashes como dependência de execução nem scriptsbrowser, porque esse motor será outro marco. A árvoreprincipal permanece intacta. Nenhum build/teste desta cópia foi iniciado; esperar pelo gate local90010 para manter compilação sequencial. Não transferir passes de outras árvores paraeste conjunto.


WS:build/CLI e24Node dirigidos passaram21.398s. Go/race dos3pacotes alterados está na sessão3650. Os3testes/fixture APIWS novos foram escritos apenas na árvoreprincipal; copiar para.cache/w e executar depois de recolher3650. Cobrem APIreal,capacidade de transporte≠controlo,origininválida preserva sessão,lock/reissue/stop e aplicação ainda utilizável. Ainda não contar como testados.


## Prioridade actual após CI60f514c

O run34809654103 passou todosNode,masGo-app excedeu600s. A optimização equivalente decheckpoint por transacção foi implementada emGo:5testes/8subtestes comrace passaram e cenário37.881s→26.780s. Candidato.cache/g,5inputs;gate67254activo (Go-p2/SQLiteC/interop/UI). Não publicar antes do resultado.

WS.cache/w tembuild/CLI,24Node,89Go e2API passados, mas ainda faltam gates completos/consolidação; não misturar a novaGoMemo nessa cópia enquanto o gate isolado decorre. API lock mantém relayopaco consentido, bloqueia leitura/assinatura e emissão de novosconvites; revogação é stop/expiry. O objectivo de paridadeweb e todos os outrosrequisitos mantêm-se.


## Estado autoritativo mais recente

9866889 publicado,gateGo67254 concluído173Go/45Cgo/57interop/23UIGo/35Axe,368fontesestáveis. NovoCI34815555671 activo. WS.cache/w foi avançado para9866889 preservando26inputs;gate96043activo(Node/Go/interop/UI/desktop),nãoeditar fontes. Enumerar filenamesGit com-z: a primeira tentativa derestore comaspasUTF8 falhou antesdeaplicar, depois corrigida semalterar osinputsWS. Próximo:recolhergateeCI,finalizarWS,consolidarbrowser/app eimplementarparidadedinâmica.


## Consolidação browser sobre 5e049f1 — 2026-09-14

A sessão3463 terminou0. Gate `node scripts/verify-autonomous.mjs`:279 Node,26 browser,23 UI por motor e desktop Linux build/run/package/run,442 fontes estáveis. Evidência em docs/evidence/browser-application/milestone. A paridade dinâmica continua obrigatória e pendente. O CI5e049f1 passou Node3SO/Go/RNS/desktop e falhou iOS no fecho do teclado; incremento Apple preservado separadamente. Próximo: rota web autónoma↔Reticulum com controlos/UI, grupos dinâmicos e restante contrato.
