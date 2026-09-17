# Revisões browser — marco local validado

Catálogo/runtime/worker/mesh integrados no principal, sobre Go3f63f19. Passaram 17casos dirigidos por engine e 66cenários consolidados por engine (198 combinações), após corrigir dois selectores globais de estado num teste. Os seis percursos de rede usam Browser/Node/Go e WebRTC/WebSocket/TCP reais, com controlos de pausa/retoma, leitura privada e seeder único reiniciado depois de o autor sair. O worker compilado reabre o perfil, preserva a publicação idempotente e recusa falsificações/métodos de assinatura. Evidência docs/evidence/browser-site-api; logs e drivers .cache/site-browser-final.

Sessões 31008 (primeira matriz, FAIL apenas no selector WebKit) e 73124 (repetição dirigida, PASS) terminaram e foram recolhidas. Os relatórios não foram substituídos por um falso passe. Fontes de produto e assets iguais entre execuções. Não voltar a relançar os gates por perda de handle.

A publicação web continua em 0c6b58a / distribuição45ecacdf; não publicar o novo painel de revisões antes da integração e dos gates correspondentes. Controlos ainda não presentes no HTML público.

## Candidata do contexto/editor seguinte — não integrada

Worktree .cache/browser-site-parity, branch codex/browser-site-parity, HEAD8bf95fc (cherry-pick local do Go3f63f19 sobre e4b82be). O antigo WIP de browser foi copiado por 11 caminhos explícitos para o principal; não voltar a copiar em bloco esta worktree, que agora contém mudanças adicionais.

Mudanças novas apenas nessa worktree: packages/sites/src/editing.ts; native/sites/editing.go; SiteDraft.editing e validação/leitura/gravação em Node, Go e browser; apps/web/src/site/history.tsx/history.css e traduções PT/EN/ES. O componente usa site-command real, mas ainda não está ligado ao estúdio/controlador. A publicação deve conservar base/UUID/digest no rascunho antes de enviar, resolver resultados desconhecidos e requerer escolha explícita para rebase/conflitos/recuperação. Consultar SITE-EDITOR-REVISIONS.md.

Verificação da candidata: dois testes TypeScript em tests/site-editing.test.ts PASS (195,7ms), typecheck PASS, teste Go TestEditingContextOwnerAndPendingShape PASS (pacote0,003s). Logs .cache/site-editing-typescript.log, site-editing-typecheck.log e site-editing-go.log na worktree. O último teste executou o toolchain Go1.26.8/cache do projecto com -p=1/GOMAXPROCS=2. Sessões9825/68344 terminaram e foram recolhidas. Ainda faltam vetores de paridade/integração da gravação privada, UI, Axe/capturas e regressões dessa candidata.

O teste novo site-worker.spec.ts foi copiado da worktree para o principal e já passou nos três engines. A correcção mínima de dois selectores em application.spec.ts também está no principal; a worktree tem formatação adicional e o seu site-network.spec.ts é uma candidata anterior. Preservar ambos; reconciliar por ficheiros/hunks, não por cópia total. Não considerar os novos painéis ou metadados como parte do marco browser já verificado.

O contrato inteiro continua activo e a revisão independente permanece pendente sob a execução sequencial pedida pelo proprietário. Nenhum agente/modelo/bridge/configuração foi alterado.

## Histórico de preparação

# Revisões no browser — implementação em curso

Em 2026-09-17, a candidata corrigida está no worktree `.cache/browser-site-parity`, branch `codex/browser-site-parity`, com base e4b82be. Não reaplicar os rascunhos antigos de `.cache/browser-site-candidates`.

Implementados: transactValues com WebLock e commit conjunto de blobs/índice, limites finais e de memória, autenticação dos valores substituídos/removidos, latch de erros e handle encerrado; assinatura e leitura histórica dentro do perfil; catálogo async com o protocolo partilhado; runtime serial com recuperação/estado/resolução/conflitos; integração na aplicação/worker existente e verificação pública antes de forwarding na mesh. A sessão é capturada e verificações legíveis inválidas não se transformam em sucesso opaco.

Typecheck PASS. Primeiro dirigido 7/8 com falha no cleanup da fixture (Mesh.stop inexistente); o caso passou 1/1 após usar Mesh.close. Asserções intactas. Bateria de três engines em curso, `.cache/site-browser-check/report.json`; consultar antes de continuar. Não confundir harness de domínio com UI ou transporte real.

Depois: integrar sobre o Go verificado, testar APIs entre processos browser/Node/Go com percurso heterogéneo, isolamento, seeder offline e controlos negativos. Implementar controlos do estúdio partilhado para endereço/histórico/versão fixa/recuperação/conflitos/base/idempotência, PT/EN/ES e teclado/toque/Axe. Publicar apenas artefactos exactos que passem os gates. Objectivo integral e revisão independente continuam pendentes.

## Notas históricas da revisão da candidata

# Revisões no browser — preparação

Não aplicar código enquanto o gate Go estiver a verificar fontes congeladas. A primeira candidata de transacção está em .cache/browser-site-candidates/profile-values.methods.ts; NÃO foi integrada ou testada.

A transacção deve manter o WebLock do perfil, capturar a sessão antes da espera, autenticar valores antigos, limitar leituras/escritas, impedir uso do handle após o callback, proteger operações que atravessam lock/unlock e só devolver resultados depois do commit IndexedDB conjunto. A remoção de staging deve remover índice e blob numa só transacção; um valor corrompido não é ausência. Usar as derivações da chave de assinatura já existentes no BrowserProfile.

Depois: método de assinatura de snapshot dentro do perfil sem exportar chaves; leitura histórica privada com verificação normal da validade mantida na admissão/transmissão; catálogo async com o mesmo modelo/pedido/certificado de Node/Go; integração na fila do BrowserApplication e na mesh; estados de quota/conflito/expiração e recuperação. Testar três motores e pares Node/Go/browser antes de activar os controlos no estúdio partilhado.

A candidata precisa de revisão de rollback, operações concorrentes esquecidas pelo callback, observações de metadata, limites de memória e tratamento de remoção/substituição no orçamento total. Não é funcionalidade entregue nem migração completa. O objectivo integral permanece activo.

## Revisão da candidata ainda não aplicada

Antes de integrar transactValues, fechar o handle imediatamente após o callback, detectar métodos assíncronos ainda pendentes e fazer latch de erros, mesmo quando o callback os apanha. A candidata actual mantém o handle aberto durante a preparação do commit e precisa dessa correcção. Leituras internas posteriores devem validar a sessão sem reabrir o handle externo.

Aplicar remoções antes das escritas e validar o orçamento do resultado final, mantendo limites separados de memória pendente. A validação por cada escrita intermédia pode recusar uma troca que caberia no estado final; não remover limites nem enfraquecer a detecção de corrupção para resolver isso. Estes pontos são trabalho pendente, não resultados testados.
