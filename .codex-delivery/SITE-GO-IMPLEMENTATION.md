# Paridade de revisões em Go

O contrato completo continua activo. Só RelayLoom, Astra/Copilot Ultra, execução sequencial sem novos agentes e sem alterar serviços/permissões/bridges. A continuação anterior foi progresso verificado.

O armazenamento privado Node/Go já partilha exactamente a mesma SQLite e cifra de preparação. A implementação actual acrescenta em native/sites/registry.go as transições equivalentes: reserva, base observada, commit, cancelamento, disponibilidade, expiração e conservação de cabeçalhos/contadores. Não está ainda ligada ao catálogo/API Go.

Próximos passos: comparar vectores de transições gerados pelo modelo Node num processoGo real, incluindo conflitos/quotas/replay; implementar pedido/conteúdo/catálogo persistente e recuperação; ligar à API/transportes Go; port browser; depois controlos do editor partilhado com endereços/histórico e testesUI em várias identidades/idiomas. Não considerar a compilação ou um modelo isolado conclusão do produto.


## Gate concluído

O catálogo, pedidos/conteúdo e API/transporte Go estão implementados.66vectoresNode/Go(10negativos), retomada de catálogoNode↔Go na mesmaSQLite e3percursos de APIs reais passaram. A extracção de validação detectou substituição indevida do literaltext; corrigida e repetida. O perfil do caso de anexo grande levou a remover validação redundante e trocar a regex de base64 por verificação equivalente, testada com10mil entradas;6,46→5,31s no mesmo caso normal.

Gate58779 terminouPASS e foi recolhido: Go-race completo730,622s,69interop498,023s,SQLiteC11,420s,31UI Node199,383s/31UI Go200,658s eLinuxbuild/run/package/run. Fontes estáveis. Provas docs/evidence/go-site-api. O browser está a ser preparado num worktree isolado em.cache/browser-site-parity, branchcodex/browser-site-parity, baseado eme4b82be; só quatro testes dirigidos Chromium e typecheck passaram até agora. Não o integrar sem concluir as verificações.
