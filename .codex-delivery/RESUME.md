# RelayLoom — retoma activa, 2026-09-13

## Objectivo e restrições

Continuar todo o PROJECT-BRIEF.md, apenas em /home/absint0o/projects/relayloom. Responder PT-PT. Manter Astra/Copilot Ultra, sem alterar modelos/providers/auth/bridges/serviços/permissões. Recuperação sequencial: sem agentes novos/retomados. Preservar alterações, caches/dependências no projecto, uma compilação pesada de cada vez e pelo menos15GiB livres (92GiB observados). Commits/pushes normais autorizados, sem force-push nem merge de PR. Sem outros projectos/dados pessoais/root/compras. Produto incompleto; não marcar goal completo.

## Estado mais recente após publicação

C1 publicado em origin/main63ded7b (codecs91e90c8, runtime2b0ce51, diagnósticosCI63ded7b); push confirmado. CI34777466884 terminou: Linux e macOS Node passaram, Windows falhou na asserção exitCode da fixture de seeder; Go/desktop/iOS skipped. Correcção local337561c reforça o controlo offline com exitCode OU signalCode e porta TCP anteriormente acessível que passa a recusar ligações.6 testes Node/Go/serial afectados passaram41.055s; não houve alteração de runtime. Publicar esta correcção e observar o novo CI.

**C2 NÃO COMMITADO:** packages/groups/src/notices.ts, native/groupnotice/{notice,journal,notice_test}.go e tests/group-notices.test.ts. Codecs de avisos invitation/consent/leave, binding ao convite original, emissor/destinatário exactos e journal cifrado transaccional (64in/64out,8por emissor,256retirados). Não importados nos runtimes; nenhum transporte/inbox/UI C2 entregue. Node5 casos passaram6.402s após corrigir a fixture que usava .value indevidamente; Go5/race27.074s passou. Novo teste Node de falha de retirada e typecheck estão na sessão71943, logs .cache/group-notices/typecheck-final-local.log e node-six.log; recolher antes de repetir. Retire agora aborta a transacção se uma escrita após delete falhar. Go primeiro comando foi só compilação, com no test files; não o contar como teste.

Seguem vectores e ficheiros Node↔Go C2, restantes limites/falhas, integração atómica de intenções de convite na API, reconstrução de consentimento/saída sem reverter paragens, inbox sem auto-adesão, transporte e C3UI. Preservar tudo; sem novos agentes/configurações.

## C1 — gate final concluído

Base publicada adfd52a21e1e6ff3c5c6b02ca5971c2280943b0c. Marco C1 verificado localmente, com fonteSHA256 b43741ef070d437b224b69b396e4ddddc9bc251c35dbab79f72ef68d70ffd017. Confirmar git status/log/origin antes de assumir publicação. A árvore tem código de carriers, testes, documentos e evidência gerada a preservar.

Sessão83929 terminou0: build6.056s;253 Node405.684s;161 testes principais Go/race711.420s (12 helpers exercitados pelos drivers);47 interoperabilidade480.894s;35 casos principais SQLite C283.498s;19 UI Node138.097s/19 Go128.687s;22 host iOS1.670s/estática0.031s. Sessão43358 terminou0: desktop Linux preparação0.319s/execução2.412s/pacote --dir7.260s/execução empacotada1.255s.62 Axe sem violações;326 fontes inalteradas. Root reviu Node320px, editor Node e conversa escura Go. Não é revisão independente. **Nenhum teste/build/preview conhecido activo.**

Evidência pública pronta: docs/evidence/group-carriers/final (relatórios, logs, hashes, runners reproduzíveis e capturas) e adversarial (falhas antes/correcção). Scripts originais em .cache/group-carriers-final/{run,desktop}.py. Os comandos npm test, npm run test:native e npm run test:interop incluem os novos casos. O CLI Go actual foi compilado; não relançar gates por perda dos handles antigos, todos concluídos.

C1 transporta automaticamente headers e snapshots privados por group-control nos sockets/inventário existentes. Certificados internos do criador conservam autoria; leitores podem re-encriptar e seeders opacos podem retransmitir bytes. Pedidos/respostas paginados, cartão comprometido por época, limites na fronteira de remoção, fork freeze, replay após unlock antes de novos envios e cache de alterações locais/avisos dirigidos de remoção. Não há auto-inscrição por carrier desconhecido.

Correcções comprovadas: tentativas falhadas consomem orçamento; respostas partilham quota auxiliar; substituição impossível conserva provas e a escrita precede limpeza; envelope público/oversized/TTL excessivo é recusado ANTES de armazenamento e trânsito, incluindo relay opaco. Máximos1MiB ciphertext/plaintext,2MiB bundle,1h+10ms duração;64 tentativas e4MiB/min; cache auxiliar8MiB ou1/4quota; estruturas/páginas limitadas. Expiração de carrier não apaga autoridade durável. Os stores não prometem transacção geral sobre quaisquer falhas físicas de I/O.

## Próxima implementação: C2 e C3

1. Guardar/publicar o marco C1 apenas com o estado de git e a evidência efectivamente confirmados. README/STATUS/GROUP-CARRIERS distinguem o gate local e plataformas pendentes. Não afirmar macOS corrigido nem todas as plataformas testadas.
2. C2: seguir .codex-delivery/GROUP-NOTICES-IMPLEMENTATION.md (nota de arquitectura, ainda NÃO implementada). Transporte durável de convites/consentimentos/saídas, inbox cifrada/limitada sem auto-adesão. Persistir cartão/material do convite junto da operação; consentimento e saída usam o checkpoint existente. Quota de rede não pode reverter close/leave/fences. Provar falhas/replays/partições/seeder/Node↔Go e recusa de convites obsoletos/consentimentos forjados.
3. C3: UI Liquid Glass de criar/convidar/aceitar/recusar/gerir/sair/encerrar, audiência/época verificadas antes de compor/enviar, rascunhos, teclado/touch/contraste e E2E real. A UI existente ainda usa grupos fixos. Não activar messaging/outbound só por existir C1.
4. Continuar pesquisa integral, keystore/rotação, restantes media/social/templates, notificações reais, plataformas e revisão independente. O contrato inteiro mantém-se. C1 não conclui o produto.

## Plataformas e diagnóstico pendente

CI34765195200/adfd52a terminou: Node Windows/Linux e UI Linux passaram; macOS falhou fetch failed em group-event-seeding.ts285 no commit de remoção após reiniciar o autor; Go/desktop/iOS skipped. Logs reais em docs/evidence/ci-adfd52a. Helper HTTP isolado por processo e diagnóstico privado sem retry de mutações. Uma execução local anterior observou ECONNRESET com processo vivo; passes Linux posteriores NÃO demonstram causa/correcção macOS. Diagnósticos futuros em .cache/fixture-http-failures (sem corpo/capacidade); conservar e inspeccionar antes de alterar portas/limites/retries. Não houve novo408 nesta recuperação.

Android APK136a5103/AAR9e2fb77f passou82 asserções anteriores, mas não contém C1 nem as alterações recentes; AVD/adb próprios parados/preservados. iOS93f24f1 passou arranque/fotografia e falhou no controlo do teclado antes do submit; ajuste XCTest adfd52a tem22 testes host/estática, mas foi skipped em Apple no último CI. Hardware/rádios, assinatura Apple, leitor de ecrã e revisão independente recente pendentes. PTY/Chromium móvel não são rádio nem dispositivo físico.

Histórico preservado em history/RESUME-carrier-final-validation.md, history/RESUME-carrier-first-iterations.md e versões anteriores. .codex-delivery/GROUP-CARRIERS.md conserva as iterações. O checkpoint extra de manutenção foi cancelado pelo proprietário.
