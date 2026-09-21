# Próximos incrementos do site — desenho, não implementação

Este documento preserva o objectivo expressivo inspirado no ZeroNet depois das tabelas assinadas. Não descreve funcionalidades entregues nem altera o contrato do proprietário. As tabelas v2 já estão publicadas. Os recursos opcionais v3 estão implementados e publicados; ver `SITE-OPTIONAL-RESOURCES.md`. O contrato criptográfico de contribuições começou a ser implementado e testado em SITE-CONTRIBUTIONS-IMPLEMENTATION.md; a integração de aprovação, persistência, transporte e UI continua pendente. As secções abaixo descrevem o destino completo, não funcionalidades já entregues.

## 1. Dados e ficheiros opcionais

Separar dados maiores e ficheiros do documento principal através de referências a bundles imutáveis. Cada referência contém endereço de conteúdo, tipo declarativo, tamanho verificado, autor esperado e digest; a assinatura do snapshot cobre a referência. O leitor descarrega por consentimento/política de tamanho, valida o bundle e a associação antes de o apresentar e passa a poder semeá-lo. A ausência de um ficheiro aparece como indisponibilidade explícita. Nunca substituir um hash ausente por uma versão diferente nem contactar um CDN escondido.

As imagens actuais seguem no bundle principal; a primeira migração deve ser aditiva e versionada. O tamanho anunciado não autoriza alocações sem limite. O acesso a dados privados não passa automaticamente para uma página pública: a publicação deve verificar a audiência e exigir uma nova acção explícita de divulgação quando necessário. Remover uma referência deixa de a promover, mas não recolhe réplicas existentes. Expulsão/pinning/quotas operam por objecto, com estado visível ao utilizador.

Validar: Node↔Go↔browser; ficheiro ausente/corrompido/autor errado; recusa de referência cíclica ou profunda; consulta sem descarregar o opcional; descarregamento só após consentimento; quota e retoma; seeder reiniciado com autor offline; documento público a tentar referenciar dados privados; bytes exactos depois de atravessar adaptadores.

## 2. Contribuições assinadas

Um visitante usa a sua própria identidade para enviar uma proposta imutável, com site de destino, revisão observada, tabela/bloco, esquema, operação única e valores limitados. A assinatura do bundle identifica o contribuidor. A proposta nunca é uma revisão assinada pelo dono. Ter a chave de leitura ou os bytes do site não permite aprovar, publicar ou alterar a autoria.

O dono tem uma caixa de propostas com origem verificada, comparação dos valores e controlos aceitar/rejeitar/bloquear. Aceitar integra explicitamente os dados numa nova revisão do site através do catálogo e da operação de publicação recuperável existentes. Se a base ou o esquema mudaram, pedir reconciliação sobre a nova base; não aplicar silenciosamente. Uma proposta duplicada não cria linhas novas repetidas, mesmo depois de perda de resposta/reinício. A aceitação conserva proveniência sem alegar que o contribuidor assinou alterações posteriores do dono. Uma proposta privada não é republicada como pública sem consentimento explícito compatível.

A fila e os registos de resultado são limitados por número/bytes/prazo. Backpressure deve rejeitar entradas novas sem apagar decisões pendentes ou aceitar automaticamente spam. Regras de contribuidores são enumerações verificadas — convites/identidades/grupos autorizados — sem Python/JavaScript/SQL, expressões arbitrárias ou chamadas remotas. Não introduzir administradores implícitos nem aprovação conferida por uma chave de desencriptação.

Validar: autores distintos, impostor, assinatura corrompida, replay e reinício, mudança de base, duas aprovações concorrentes, quota cheia, remetente bloqueado, privacidade/revogação/expiração e perda de resposta nas fronteiras de commit. Percurso UI real com três contas: criar formulário, propor, rever, aprovar, ler a nova versão e semear com dono desligado. Não usar publicação automática como substituto da aprovação.

## 3. Composição avançada

Ligar tabelas verificadas a vistas de directório/cartões/listas através de nomes de coluna validados e consultas enumeradas. Formulários descrevem campos/tipos/limites e o destino da proposta. Pré-visualização usa o mesmo renderer e mostra claramente a acção que será assinada/enviada. Pesquisa e filtros correm localmente sobre dados autorizados, com paginação e índices limitados. Nenhum bloco pode executar scripts, injectar HTML, avaliar CSS livre ou enviar dados sem uma acção explícita do visitante.

Preparar modelos de comunidade, biblioteca pessoal e directório de recursos, sem os apresentar como informação de emergência verificada. Manter Liquid Glass na aplicação e opções tipográficas limitadas nos sites; testar contraste, teclado, foco, ecrã compacto e vários idiomas com texto autoral preservado.

## Ordem de execução e retoma

Terminar a revisão e os gates dos recursos opcionais v3, integrar a candidata e verificar a distribuição exacta primeiro. Implementar depois a aprovação de contribuições e os respectivos controlos UI em marcos separados e reproduzíveis. Alargar os gates sem remover v1/v2 existentes. Repetir a cobertura afectada após cada correcção; executar todos os critérios finais antes de declarar o produto concluído.

Continuam activos os restantes requisitos: web sem instalação com paridade, grupos dinâmicos, recuperação/rotação/keystore, todos os SO/meios suportados pelo Reticulum e testes físicos/revisão independente. Não criar ou retomar agentes durante a recuperação sequencial. Não alterar Astra/CopilotUltra, serviços, bridges, permissões ou autenticação.
