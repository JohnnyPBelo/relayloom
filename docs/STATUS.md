# RelayLoom — estado verificável

**Em implementação. Experimental. O contrato completo não está concluído.** Não é infraestrutura validada para catástrofes; não substitui serviços de emergência. Actualização: 2026-09-11.

## Evidência executada neste Linux

| Comando / artefacto | Resultado observado | Alcance |
| --- | --- | --- |
| `npm run build` | Passou | TypeScript + interface de produção Vite |
| `npm test` | 42 testes passaram, 0 omitidos, cerca de 24 s | Cofres/assinaturas/ACL, armazenamento, API, processos, TCP, série PTY, falhas e simulação identificada como tal |
| `npm run test:e2e` | 1 percurso completo passou, cerca de 19 s | Dois browsers/daemons reais: identidades, contactos, TCP, mensagens, anexo descarregável, reacção, grupo, social, pesquisa, isolamento de rascunhos, editor/rascunho cifrado, página remota com autor desligado e recuperação do nó |
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
| Anexos | Bytes cifrados, ficheiros, renderizadores imagem/áudio/vídeo; ficheiro validado por UI, 108 kB verificados na rota heterogénea | Captura de voz/câmara ainda ausente; reproduções imagem/áudio/vídeo ainda não verificadas no e2e; UI até 2 MB/anexo e objecto até 4 MiB |
| Persistência | Outbox/conteúdo cifrado, recuperação, metadados autenticados locais, rascunho de página cifrado | Rascunhos de mensagens por conversa ficam em memória; disponibilidade depende de quota/TTL |
| Social: perfil, feed, posts | Página pessoal assinada, posts públicos/privados, feed local verificado | Sem descoberta global, recomendações ou sincronização nativa em segundo plano |
| Social: seguir | Preferência local persistente | Ainda não selecciona o feed nem publica relação assinada |
| Social: comentários/reacções | Publicação e verificação; fluxo real entre clientes | Ricos controlos de gestão/edição de comentários incompletos |
| Social: colecções/partilhar | Colecção local Guardados; endereço do conteúdo copiável | Colecções nomeadas e importação pelo endereço ainda ausentes |
| Moderação | Bloqueio local, denúncia local, tombstones assinados e memória local autenticada | Sem federação de denúncias, sem moderação central; cópias remotas não podem ser recolhidas |
| Armazenamento/seeding | Verificação em recepção/leitura, quotas, 1.024 objectos, pin/unpin, TTL, LRU, seeder sem autoridade de autor | Protecção total contra adversários/dosagem por identidade por reforçar; journal privado limitado a 16 MiB e pedidos muito grandes podem saturar o UI |
| Encaminhamento | TCP+série, fragmentação, SOS antes de bulk, justiça, ACK/retry, hop/TTL, duplicados, limites e pausa consentida | Flooding limitado, sem optimização de rotas; retry de pacotes em memória e inventário de objectos persistente |
| Página pessoal | Blocos seguros, paletas, reordenar drag/drop/setas, pré-visualizar, guardar rascunho, publicar/ler offline | Drag físico ainda não exercitado pelo e2e; galeria/template/media mais rica por completar |
| Emergência | Saúde e pares reais, assinatura vs exactidão do alerta, SOS, baixo consumo | Não validado em catástrofes, ensaios de rádio/alcance ausentes |
| Acessibilidade/design | Light/dark, reduced-motion, contraste automático, teclado do editor, revisão de imagens | Leitor de ecrã real, dispositivos tácteis físicos e todas as combinações de estados ainda não testados |
| Notificações | Não implementadas | Permissões/browser/desktop/móvel pendentes |

## Plataformas e meios

| Alvo | Estado honesto |
| --- | --- |
| Linux | Node 22.22.3 e Chromium executados nativamente; artefactos/testes acima. Ainda sem instalador desktop |
| Windows | Fonte Node/React e job CI configurado; build/execução CI ainda não observados; app nativa não testada |
| macOS | Fonte Node/React e job CI configurado; build/execução CI ainda não observados; sem hardware Apple local |
| Android | Interface responsiva testada como viewport; SDK não configurado, aplicação nativa/background relay ainda não implementada/testada |
| iOS | Aplicação nativa ainda não implementada; Xcode, dispositivos e assinatura indisponíveis neste Linux — bloqueio externo explícito |
| TCP | Sockets/processos reais locais; LAN/Internet/NAT ainda não verificados |
| Série | Adaptador real + PTYs do sistema; nenhum rádio físico validado |
| BLE/Wi-Fi Direct/LoRa | Não implementados/testados |
| Reticulum/RNS | Documentação e licença avaliadas em TRANSPORT.md; nenhuma compatibilidade implementada/alegada |
| Simulação | Motor separado, sementes fixas e controlos; não representa hardware ou OS alvo |

## Próximos marcos

1. Consolidar este marco Linux com commit/push e observar os jobs CI reais.
2. Completar mensagens/media/notificações e social/colecções/partilha, ampliar e2e de estados e acessibilidade.
3. Empacotar desktop e avaliar ferramentas Android sem compras, root ou imagens excessivas; manter Apple/radios como bloqueios explícitos.
4. Rever desempenho, esgotamento de recursos, recuperação/revogação e todos os requisitos do contrato; corrigir e repetir gates.

Continuidade e 80+ critérios normalizados: `.codex-delivery/implementation-plan.md`, `requirements-normalized.json`, `traceability.md`. Não reduzir o objectivo ao marco já implementado.
