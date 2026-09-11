# RelayLoom — estado verificável

**Em implementação. Experimental. O contrato completo não está concluído.** Não é infraestrutura validada para catástrofes; não substitui serviços de emergência. Actualização: 2026-09-11.

## Evidência executada neste Linux

| Comando / artefacto | Resultado observado | Alcance |
| --- | --- | --- |
| `npm run build` | Passou | TypeScript + interface de produção Vite |
| `npm test` | 66 testes passaram, 0 omitidos, 35,6 s | Cofres/assinaturas/ACL, armazenamento, API, processos, TCP/série PTY, consentimento, colecções, snapshots limitados, políticas desktop e simulação identificada como tal |
| `npm run test:e2e` | 10 percursos passaram, 81,5 s | Dois browsers/daemons reais: identidades, contactos, TCP, mensagens, anexo descarregável, reacção, grupo, social, pesquisa, isolamento de rascunhos, bloqueio com resposta atrasada, paginação, editor/rascunho cifrado, página remota com autor desligado e recuperação do nó |
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
| Mensagens 1:1 e grupos | Texto, destinatários explícitos, grupos fixos, respostas, reacções, pesquisa, edição/eliminação pelo autor | Mudanças de membros, estado de entrega completo/expiração explícita no UI, recibos por todos os membros |
| Anexos | Bytes cifrados, ficheiros, renderizadores imagem/áudio/vídeo; imagem/áudio/vídeo/ficheiro verificados por UI e bytes entre pares; 108 kB na rota heterogénea | Gravação de voz implementada/testada com entrada Web Audio sintética e MediaRecorder real; microfone físico/câmara não testados. UI até 2 MB/anexo, objecto até 4 MiB |
| Persistência | Outbox/conteúdo cifrado, recuperação, metadados autenticados locais, rascunho de página cifrado | Rascunhos de mensagens por conversa ficam em memória; disponibilidade depende de quota/TTL |
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
| Windows | Compilação e testes Node reais no runner Windows em 919beec passaram; testes PTY omitidos. Shell/instalador Windows e dispositivo físico não testados |
| macOS | Compilação e testes Node, incluindo PTY, no runner macOS em 919beec passaram. Shell/instalador macOS, assinatura e hardware Apple local não testados |
| Android | APK final `e1bdb088…d2a0` com Go integrado executado num único emulador API36 x86_64:16 asserções de identidade/mensagens/API/lifecycle e11 de Node→Android→Node, partição e seed takeover. Hash instalado coincide e página offline confirmada visualmente. Não é dispositivo físico, ARM64 nem rádio |
| iOS | Shell UIKit/WKWebView, binding Go, lifecycle/permissões e projecto Xcode implementados; sintaxe/referências locais verificadas. Compilação Swift/framework/simulador ainda não executada. Xcode, dispositivos e assinatura indisponíveis neste Linux |
| TCP | Sockets/processos reais locais; LAN/Internet/NAT ainda não verificados |
| Série | Adaptador real + PTYs do sistema; nenhum rádio físico validado |
| BLE/Wi-Fi Direct/LoRa | Não implementados/testados |
| Reticulum/RNS | Documentação e licença avaliadas em TRANSPORT.md; nenhuma compatibilidade implementada/alegada |
| Simulação | Motor separado, sementes fixas e controlos; não representa hardware ou OS alvo |

## Próximos marcos

1. Consolidar os marcos de desktop, multimédia/colecções/histórico e núcleo Go; observar os novos jobs CI após o push. CI 919beec passou nos três runners do núcleo Node.
2. Executar compilação iOS unsigned e políticas Swift no runner macOS quando o workflow for enviado; completar workflows móveis de ficheiros/notificações e repetir o APK quando for alterado.
3. Completar estados de entrega/expiração/outbox, mudanças de membros, recuperação/revogação e extensões do perfil/social, com testes negativos e positivos.
4. Continuar a revisão de recursos, fluxos nativos de ficheiros/notificações, acessibilidade e auditoria de todos os requisitos; manter hardware Apple/rádios/assinaturas como lacunas explícitas.

Continuidade e 80+ critérios normalizados: `.codex-delivery/implementation-plan.md`, `requirements-normalized.json`, `traceability.md`. Não reduzir o objectivo ao marco já implementado.

## Evidência adicional e limites de versão

`docs/evidence/ci-919beec.json` identifica o commit e jobs efectivamente observados (CI do núcleo Node, não da aplicação Go/Android em desenvolvimento). `docs/evidence/desktop` regista arranque do Electron e do binário Linux empacotado, API401/200, isolamento e encerramento. `docs/evidence/media` identifica entrada sintética e codificação/transporte reais. `docs/evidence/notifications` usa sempre APIs de notificação substituídas, sem alegar que apareceu uma notificação do OS.

O núcleo Go passou 11 testes e o transporte 11 testes com detector de corridas; a aplicação passou 17 testes normais e 17 com detector de corridas após a revisão de cache/paginação/tombstones. O gate Node↔Go compara 1.500 vectores numéricos, Unicode/UTF-16, cofres/chaves/ACL/cifra e armazenamento nos dois sentidos. As duas integrações mistas passaram após recompilar o CLI final (`a3dc0344…`): Go→Node→Go TCP e Go→Node→Node TCP+série PTY. A aplicação Go não implementa driver série nativo. Estes testes estão separados dos 66 testes Node acima.

A resposta periódica de um store Go cifrado de 37,6 MB ficou em 68 KB e o endpoint de anexo devolveu 2 MiB exactos. O primeiro processamento completo sob race detector levou 22,54 s; o seguinte, com cache verificada, 254 ms. São medições deste host instrumentado, não uma promessa de latência móvel. Ver `APPLICATION-REVIEW.md` para os controlos e limites, incluindo eventos privados recebidos enquanto bloqueado.
