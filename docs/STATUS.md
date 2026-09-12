# RelayLoom — estado verificável

**Em implementação. Experimental. O contrato completo não está concluído.** Não é infraestrutura validada para catástrofes; não substitui serviços de emergência. Actualização: 2026-09-12. O CI verde de c3f5b42 e os gates posteriores de outbox/SAF têm evidência e versões distintas; os novos marcos não herdam automaticamente os passes CI anteriores.

**Checkpoint mais recente — b09f7f5, CI34671406360:** passaram Node nos três OS, o job Go completo e os três pacotes desktop; o desktop Linux também executou com Xvfb. iOS compilou e instalou a aplicação e arrancou o simulador em191,998s, mas a importação da fotografia sintética terminou por timeout em60,976s. O XCUITest não começou; a app não tem ainda evidência de execução iOS. Foi apagado apenas o simulador criado pelo gate. Não houve repetição automática deste job nem alteração de configurações. Relatório e hashes: `docs/evidence/ios/b09f7f5`. A verificação sequencial posterior `node --test apps/ios/Tests/SimulatorRunnerTests.mjs` passou11 testes em1,187s, saída0; são verificações no host Linux, não execução Apple. As secções seguintes preservam o histórico das versões anteriores.

**Implementação local posterior:** armazenamento transaccional cifrado e índice assinado para metadados de grupos em Node; build6,187s e103 testes58,653s passaram, incluindo10 casos reais de persistência/corrupção/quota/múltiplos processos. Ainda não está integrado na aplicação nem portado para Go. O probe do driver Go passou em Linux e compilou para Android/iOS arm64; não é teste móvel. Limites, formato e evidência em `GROUP-STORAGE.md`. Grupos dinâmicos, sincronização de provas e a sua UI continuam pendentes.

## Evidência executada neste Linux

| Comando / artefacto | Resultado observado | Alcance |
| --- | --- | --- |
| `npm run build` | Passou | TypeScript + interface de produção Vite |
| `npm test` | 79 testes passaram, 0 omitidos, 45,4 s | Cofres/assinaturas/ACL, armazenamento, API, processos, TCP/série PTY, consentimento, colecções, snapshots limitados, políticas desktop e simulação identificada como tal |
| `npm run test:e2e` | 14 percursos passaram após a revisão da outbox | Dois browsers/daemons reais: identidades, contactos, TCP, mensagens, anexo descarregável, reacção, grupo, social, pesquisa, isolamento de rascunhos, bloqueio com resposta atrasada, paginação, editor/rascunho cifrado, página remota com autor desligado e recuperação do nó |
| `node scripts/e2e.mjs tests/e2e/flows.spec.ts --reporter=line --output=.cache/drag-ui-e2e` | Passou, 18,4 s | Repetição posterior com dois movimentos drag/drop reais, além das alternativas de teclado/setas e do fluxo P2P completo |
| `docs/evidence/heterogeneous.json` | Passou | 3 processos; A→B TCP, B→C série PTY; C sem ouvinte TCP; partição, recuperação, pausa e substituição do autor desligado pelo seeder |
| `docs/evidence/ui/*-axe.json` | Zero violações nos estados capturados | Onboarding, conversa clara/escura, social, editor e social a 390 px; tags WCAG 2 A/AA e 2.1 AA. Não é certificação de acessibilidade |
| `docs/evidence/ui/*.png` | Capturas reais | Conteúdo fictício criado pelos testes, sem dados do proprietário |
| Revisão independente de agentes | Realizada para segurança, transportes e design | Falhas concretas corrigidas e testes repetidos; não é auditoria externa de segurança |

Algumas primeiras execuções falharam; as causas/correcções estão em `.codex-delivery/learning-log.md`. O navegador integrado não encontrou backend; os e2e usam Chromium do projecto, com sandbox activado, em Linux. Um viewport móvel não prova execução Android/iOS.

## Funcionalidades

| Pedido | Implementado/testado | Parcial, por implementar ou verificar |
| --- | --- | --- |
| Identidades e chaves | Ed25519, X25519/HKDF/AES-GCM, prova do cartão, cofre scrypt/AES-GCM, exportação/recuperação | Keychain nativa, rotação/revogação completa, ratchet/forward secrecy, auditoria criptográfica externa |
| Mensagens 1:1 e grupos | Texto, destinatários explícitos, grupos fixos, respostas, reacções, pesquisa, edição/eliminação pelo autor | Mudanças de membros ainda em desenho; nova outbox distingue recepção/leitura por destinatário e expiração, com os limites documentados abaixo |
| Anexos | Bytes cifrados, ficheiros, renderizadores imagem/áudio/vídeo; imagem/áudio/vídeo/ficheiro verificados por UI e bytes entre pares; 108 kB na rota heterogénea | Gravação de voz implementada/testada com entrada Web Audio sintética e MediaRecorder real; microfone físico/câmara não testados. UI até 2 MB/anexo, objecto até 4 MiB |
| Persistência | Intenção de envio cifrada/idempotente enquanto retida, reserva limitada, repetição própria após restart mesmo com relay pausado, estados por destinatário/expiração, metadados autenticados locais e rascunho de página cifrado | Rascunhos de mensagens por conversa ficam em memória; disponibilidade depende de quota/TTL |
| Social: perfil, feed, posts | Página pessoal assinada, posts públicos/privados, feed local verificado | Sem descoberta global, recomendações ou sincronização nativa em segundo plano |
| Social: seguir | Preferência local persistente e filtro A seguir verificado | Relação pública assinada/followers ainda ausente |
| Social: comentários/reacções | Publicação e verificação; fluxo real entre clientes | Ricos controlos de gestão/edição de comentários incompletos |
| Social: colecções/partilhar | Guardados, colecções nomeadas cifradas, criar/renomear/eliminar/adicionar/remover; obtenção pelo endereço sem conceder leitura | Colecções sociais partilhadas/federadas não implementadas |
| Moderação | Bloqueio local, denúncia local, tombstones assinados e memória local autenticada | Sem federação de denúncias, sem moderação central; cópias remotas não podem ser recolhidas |
| Armazenamento/seeding | Verificação em recepção/leitura, quotas, 1.024 objectos, pin/unpin, TTL, LRU, seeder sem autoridade de autor; estado paginado até 100 resumos/4 MiB e anexos sob pedido | Journal privado limitado a 16 MiB; cache de resumos limitada a 16 MiB/1.024 entradas; leitura inicial de stores grandes ainda tem custo de verificação e cifra. Não é protecção absoluta contra exaustão |
| Encaminhamento | TCP+série, fragmentação, SOS antes de bulk, justiça, ACK/retry, hop/TTL, duplicados, limites e pausa consentida | Flooding limitado, sem optimização de rotas; retry de pacotes em memória e inventário de objectos persistente |
| Página pessoal | Blocos seguros, paletas, reordenar drag/drop/setas/teclado com browser real, pré-visualizar, guardar rascunho, publicar/ler offline | Dispositivo táctil físico e galeria/template/media mais rica por completar |
| Emergência | Saúde e pares reais, assinatura vs exactidão do alerta, SOS, baixo consumo | Não validado em catástrofes, ensaios de rádio/alcance ausentes |
| Acessibilidade/design | Light/dark, reduced-motion, contraste automático, teclado do editor, revisão de imagens | Leitor de ecrã real, dispositivos tácteis físicos e todas as combinações de estados ainda não testados |
| Notificações | Adesão explícita no browser, texto genérico, coalescência, limpeza ao bloquear; três e2e com API substituída | Notificações reais do OS, dispositivos e entrega em segundo plano não verificadas |

## Plataformas e meios

| Alvo | Estado honesto |
| --- | --- |
| Linux | Node 22.22.3 e Chromium executados nativamente; artefactos/testes acima. Shell Electron e pacote Linux x64 descompactado executados; fluxo de instalador ainda não testado |
| Windows | Node e pacote desktop Windows x64 passaram no runner Windows em c3f5b42. Testes PTY omitidos. GUI, instalador e hardware físico não executados |
| macOS | Node, PTY e pacote desktop macOS arm64 passaram no runner Apple em c3f5b42. GUI/instalador desktop, assinatura de distribuição e hardware Apple local não testados |
| Android | APK `fa1481d3…` com Go integrado, correcção da expiração e interface final: 38 asserções SAF, 15 de prazo/lifecycle, 16 de mensagens/recuperação e 11 de relay/seed no único emulador API36 x86_64. Hash instalado confirmado antes/depois; 80 asserções passaram. Não é dispositivo físico, ARM64 nem rádio |
| iOS | c3f5b42 compilou o XCFramework arm64 para dispositivo/simulador e a aplicação de simulador unsigned no runner Xcode26.6;25 asserções Swift/Foundation do host passaram. Aplicação/simulador/WKWebView ainda não executados. Dispositivo físico e assinatura não verificados |
| TCP | Sockets/processos reais locais; LAN/Internet/NAT ainda não verificados |
| Série | Adaptador real + PTYs do sistema; nenhum rádio físico validado |
| BLE/Wi-Fi Direct/LoRa | Não implementados/testados |
| Reticulum/RNS | Documentação e licença avaliadas em TRANSPORT.md; nenhuma compatibilidade implementada/alegada |
| Simulação | Motor separado, sementes fixas e controlos; não representa hardware ou OS alvo |

## Próximos marcos

1. A medição sequencial temporária terminou com um teste passado. Na continuação, a outbox foi consolidada em `10bdf48`, o runner iOS em `4913ef4` e o SAF Android em `f3e747a`. Observar os novos jobs CI depois do push; c3f5b42 continua a referência CI efectivamente verde até existirem novos resultados.
2. Observar o novo gate de execução iOS no simulador Apple e completar os restantes fluxos nativos. A compilação unsigned e 25 asserções Swift do host já passaram em c3f5b42; execução da aplicação continua pendente. O APK final `27a71947…` já passou os quatro gates no emulador; novas alterações futuras exigem o artefacto correspondente.
3. Implementar mudanças de membros conforme `GROUP-EPOCHS.md`, recuperação/revogação e extensões do perfil/social, com testes negativos e positivos. O contrato e as fixtures de épocas são apenas desenho; não há grupos dinâmicos implementados.
4. Continuar a revisão de recursos, fluxos nativos de ficheiros/notificações, acessibilidade e auditoria de todos os requisitos; manter hardware Apple/rádios/assinaturas como lacunas explícitas.

Continuidade e 80+ critérios normalizados: `.codex-delivery/implementation-plan.md`, `requirements-normalized.json`, `traceability.md`. Não reduzir o objectivo ao marco já implementado.

## Evidência adicional e limites de versão

`docs/evidence/ci-919beec.json` identifica o commit e jobs efectivamente observados (CI do núcleo Node, não da aplicação Go/Android em desenvolvimento). `docs/evidence/desktop` regista arranque do Electron e do binário Linux empacotado, API401/200, isolamento e encerramento. `docs/evidence/media` identifica entrada sintética e codificação/transporte reais. `docs/evidence/notifications` usa sempre APIs de notificação substituídas, sem alegar que apareceu uma notificação do OS.

O núcleo Go passou 11 testes e o transporte 11 testes com detector de corridas; a aplicação passou 17 testes normais e 17 com detector de corridas após a revisão de cache/paginação/tombstones. O gate Node↔Go compara 1.500 vectores numéricos, Unicode/UTF-16, cofres/chaves/ACL/cifra e armazenamento nos dois sentidos. As duas integrações mistas passaram após recompilar o CLI final (`a3dc0344…`): Go→Node→Go TCP e Go→Node→Node TCP+série PTY. A aplicação Go não implementa driver série nativo. Estes testes estão separados dos 66 testes Node acima.

A resposta periódica de um store Go cifrado de 37,6 MB ficou em 68 KB e o endpoint de anexo devolveu 2 MiB exactos. O primeiro processamento completo sob race detector levou 22,54 s; o seguinte, com cache verificada, 254 ms. São medições deste host instrumentado, não uma promessa de latência móvel. Ver `APPLICATION-REVIEW.md` para os controlos e limites, incluindo eventos privados recebidos enquanto bloqueado.

## CI publicado e integração local posterior

O run GitHub `34655608855`, commit `c3f5b42ff80923981befecec1f82e3ff017bd6a3`, terminou com sucesso nos8 jobs: Node em Linux/Windows/macOS, núcleo/aplicação Go e UI, três pacotes desktop e compilação iOS. `docs/evidence/ci-c3f5b42.json` contém os jobs efectivamente observados. O artefacto iOS foi descarregado e inspeccionado em `docs/evidence/ios/c3f5b42`: Xcode26.6(17F113), Go1.26.8, framework de dispositivo+simulador arm64, app de simulador SHA-256 `9a8cf91304108fe70259053104dd9fd3752a99ad656b1c0f5eea728f39337904`. É compilação real, não execução da aplicação no simulador. Linux CI também executou o desktop e o pacote descompactado com sandbox/Xvfb.

A supervisão do proprietário observou uma falha local de contactos/resposta de grupo durante alterações concorrentes (`TestApplicationMessagesGroupsReceiptsAndPrivacy`, app_test.go117). Isto não é uma regressão demonstrada do commit remoto verde. A aprendizagem de cartões foi corrigida sem reduzir ACL/cobertura; o teste focado e os gates locais estabilizados passaram, como documentado abaixo. Os resultados posteriores têm hashes próprios e não substituem silenciosamente os anteriores.

## Outbox: evidência local posterior a c3f5b42

As alterações Node/Go da outbox passaram79 testes Node (incluindo13 regressões novas),36 testes Go de aplicação normais e com race detector, e2 cenários de3 processos mistos em82,890s. O hash das fontes de produção foi verificado inalterado durante os testes e novamente na integração: `66a18d61cc0a63b0bf30195462c2515912b333614d95dd69f1d503db409f830e`. CLI Go: `4e18b8b15d0da0883586a4d3e51e1ecbec351afd1ce1545bcb773d8f8aca422d`. O teste de grupos/contactos indicado pela supervisão foi corrigido e está incluído nos36, sem redução de ACL/cobertura. Os11 testes core e11 transport Go foram repetidos com `-race -count=1 -p=2`, passando em5,902s e9,136s.

A interface passou14 percursos Node e14 Go; a revisão posterior do aviso de repetição dentro do diálogo passou os4 percursos de outbox em cada núcleo. Esses últimos processos já tinham sido iniciados antes da instrução de verificação sequencial do proprietário. Foco de teclado, leitura parcial de grupos antigos, expiração e repetição após resposta perdida têm testes/screen captures reais. A última cópia da interface usa `index-Ct0M5tYK.js`/`index-BcajBo5I.css`.

A outbox conserva128 envios pendentes/32MiB e até256 registos totais. A idempotência é limitada aos registos retidos; a interface não repete silenciosamente uma operação incerta que já não esteja no estado fresco e desbloqueado. Confirmações assinadas são independentes de ACKs do relay; recibos antigos, dados evictos e grupos com criador bloqueado são cobertos. Atomicidade sincroniza ficheiro/directório emPOSIX; não é ensaio de corte físico de energia e não promete flush de directório noWindows. Ver `OUTBOX-PROTOCOL.md`, `OUTBOX-REVIEW.md`, `NATIVE-OUTBOX.md` e `docs/evidence/outbox`.

Verificação operacional sequencial pedida pelo proprietário em 2026-09-12: os agentes activos terminaram com entregas reais, sem novas tasks/retomas/interrupções. Foi executado apenas `node scripts/e2e.mjs tests/e2e/outbox.spec.ts --grep 'durable composer retries a lost response once' --reporter=line --output=.cache/sequential-stability/outbox`: **1 teste passou em 11,7 s**, uma execução, um worker, zero repetições, saída 0 e fontes/assets inalterados. As quatro auditorias Axe desse percurso tiveram zero violações. Resultado, saída e capturas: `docs/evidence/sequential-stability/2026-09-12`; contexto e limites: `.codex-delivery/SEQUENTIAL-CHECK.md`. Não foi observado novo 408 nesta etapa; isso não determina a causa dos anteriores. Não houve outro teste/build/push nesta medição; o contrato e o harness mantêm-se.

## Integração Android posterior à medição

Em fase posterior, mantendo execução sequencial e sem novos agentes, root compilou o APK `27a71947f73e3a2622da6efbcb402d04260e53293cb6156e27f43ea3b3f8e5a2` com o checker/interface finais. O hash instalado coincidiu antes/depois; SAF38, prazo15, mensagens16 e relay11 passaram, uma execução de cada gate e fontes/assets/AAR inalterados. Prazo observado121.264ms, HOME1.254ms; bytes exactos e recuperação da identidade confirmados. Os controlos de ausência de rota, pausa/heal e seeder com autor desligado passaram. Três capturas foram revistas. Evidência: `docs/evidence/android/documents-27a71947`, comandos completos em `ANDROID.md` e `.codex-delivery/ANDROID-FINAL-INTEGRATION.md`. AVD/adb próprios parados, instrumentação de teste removida, identidade preservada,127,54GiB livres. Isto fecha o gate do checker que estava pendente no APK4de, sem alegar hardware físico, rádio ou suspensão real.

## CI de 3d6641a e correcção em curso

Os cinco marcos foram publicados normalmente até `3d6641a`. O run `34663513261` passou Node nos três OS e os testes unitários/race Go, mas falhou o quinto caso de interoperabilidade: a outbox Go podia mostrar expiração enquanto a reserva automática ainda estava fixada. Desktop e iOS foram omitidos por dependência, não executados com sucesso. Root reproduziu o problema também em Node e corrigiu a inconsistência de instantes entre reconciliação e resposta. Os controlos focados de estado/envio/repetição passaram; gates completos estão em curso antes de publicar a correcção. Ver `OUTBOX-SNAPSHOT-EXPIRY.md`. Os binários anteriores mantêm a sua evidência por hash e precisam de rebuild para incluir esta correcção.

Há ainda uma biblioteca Node local de certificados de grupos, com11 testes criptográficos passados e typecheck, mas sem integração na aplicação nem port Go. Grupos dinâmicos continuam por implementar/testar de ponta a ponta; os casos declarativos originais não foram transformados automaticamente em resultados executados.

## Marcos correctivos posteriores

A correcção de expiração ficou em `7246340`: build,93 testes Node (82 da aplicação/existentes e11 da biblioteca de grupos),37 testes Go de aplicação com race,11 core/11 transport e5 casos de interoperabilidade passaram. O cenário que falhou no CI passou mantendo a asserção original. Hashes e comandos: `docs/evidence/outbox/snapshot-expiry`. O layout ficou em `c7f5488`:15 percursos UI por núcleo, oito larguras, teclado, contraste claro/escuro e execução real do desktop/pacote Linux passaram; o smoke passou a rejeitar overflow horizontal. Ver `ONBOARDING-LAYOUT-REVIEW.md`.

O Android foi novamente ligado/compilado para incluir as correcções: AAR51dedfe0 e APKfa1481d3 passaram os quatro gates,80 asserções no mesmo emulador, com hashes/inputs preservados. Evidência: `docs/evidence/android/documents-fa1481d3`. O núcleo Apple ainda precisa de nova compilação/execução CI; não herda os passes locais. Existe um rascunho Go da biblioteca de grupos em desenvolvimento, ainda sem testes ou integração na aplicação; a funcionalidade de grupos dinâmicos permanece parcial.

## Resultado CI f93e741 e biblioteca de certificados

O run34669716466 confirmou Node nos três OS, todo o job Go e pacotes Windows/macOS. Linux desktop falhou na captura do compositor (`UnknownVizError`); iOS falhou no limite de180s enquanto o simulador criado ainda migrava dados iniciais. A app iOS não foi executada; a limpeza eliminou só o simulador criado. `CI-F93E741-FOLLOWUP.md` descreve a captura por frame apresentado e o novo limite finito de600s de primeiro arranque, com controlos de segurança/disco e prazo global preservados. Smoke local e11 testes host do runner passaram; a recuperação no CI está por observar.

A biblioteca de certificados tem agora implementação Node e Go,11 casos Node,8 testes Go com race e um vector bidireccional executado em processos reais, incluindo assinaturas negativas válidas sob a chave sem autoridade, Unicode exacto e envelopes de leitores. `GROUP-CERTIFICATES.md` delimita esta evidência. Registry durável, sincronização de provas, admissão/quarentena de mensagens e UI de grupos dinâmicos continuam por integrar; não há suporte completo de grupos dinâmicos.
