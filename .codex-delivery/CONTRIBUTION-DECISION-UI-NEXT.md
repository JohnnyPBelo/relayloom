# Revisão e publicação de contribuições — preservar a experiência final

Desenho futuro, não funcionalidade implementada. Não activar a paleta antes do fluxo completo. O objectivo é liberdade para sites com páginas/dados/participação distribuída, mantendo blocos seguros, autoria e audiência; não reduzir a aceitação à infra-estrutura de recibos.

## Percurso das três contas

1. Dono compõe um formulário no editor, escolhe tabela e campos tipados/regras, revê leitores/contribuidores e publica uma versão assinada. Teclado/toque equivalentes ao drag/drop, estados PT/EN/ES e pré-visualização igual ao site real.
2. Visitante abre a versão autenticada, preenche valores e escolhe a audiência máxima de publicação dentro das permissões. Vê explicação de quem recebe a proposta privada e de quem poderá ler se for aprovada. Envia; offline/outbox/recibo são factos distintos.
3. Dono vê uma caixa de revisão com origem, autor, valores, prazo, conflitos e limites. Pode obter origem ausente, descartar localmente, recusar com resultado assinado ou rever para incorporar. Bloquear não o obriga a reabrir dados para libertar quota.
4. Incorporação mostra o destino actual e a diferença da base originalmente vista pelo visitante. Mesmo esquema não elimina a necessidade de CAS da revisão actual. Mudanças de tabela/tipo/campos/audiência exigem decisão explícita e/ou nova proposta; não reinterpretar automaticamente uma concessão antiga.
5. Ao publicar, a terceira conta autorizada vê os dados/proveniência, pode voltar offline e semear para outra conta com o dono desligado. Quem não tem leitura ou assinatura não consegue editar/descifrar. O visitante vê resultado recebido/publicado apenas com prova autenticada.

## Publicação recuperável

Persistir a intenção de decisão e versão/base/UUID antes de assinar. Reservar a operação de publicação segundo o catálogo existente. O commit de decisão não pode dizer published antes de reler a cópia assinada realmente guardada; a retoma liga os dois resultados sem criar outra linha ou versão. Uma mudança concorrente na base provoca reconciliação, nunca overwrite silencioso.

Cada linha incorporada precisa de ID estável ligado à contribuição e proveniência verificável. Um ID escolhido por outro autor ou uma colisão não permite substituir a linha. A estrutura de proveniência exige versão declarativa validada por Node/Go/browser: preservar o certificado original e distinguir valores originais dos que o dono editou. Não acrescentar propriedades a um esquema fechado sem versão/gates. Os limites de bytes/linhas/certificados contam para payload e rendering; não carregar scripts de sites.

Recusa assinada é distinta de descarte local. Não divulgar valores ao enviar recusa nem conceder capacidade de publicar. Uma proposta expirada pode conservar o histórico de recepção, mas não autoriza uma nova aprovação. Deletar/retirar a publicação não recolhe cópias já guardadas por pares.

## Interface e critérios de verificação

Editor com selecção real de destino/campos, validação junto ao campo, pré-visualização de tipos, avisos de dados que mudam de audiência e confirmação de publicação baseada na versão actual. Caixa de revisão com cabeçalho claro, metadados secundários acessíveis, comparação de valores, estado pendente/erro/expiração e navegação por teclado. Material Liquid Glass com contraste/legibilidade e redução de transparência/movimento; nenhuma informação crítica depende só de cor.

Testes reais de três contas nos browsers e nos dois backends, worker de produção, teclado/toque, idiomas, temas, Axe e revisão visual. Positivos/negativos de autoria e audiência, partição/heal, clique repetido/perda de resposta, concorrência de publicação, fonte/cópia corrompida, reinício do dono/visitante e seeder com dono offline. Revisão própria não substitui a revisão independente pendente. Publicar HTML só com distribuição exacta e gateHTTPS; não alegar Safari/iOS/hardware a partir de WebKit/compilação.


## Questões de implementação resolvidas para a proveniência

A proposta original vincula um formulário/snapshot. A publicação seguinte não pode simplesmente substituir a autoria da linha pela do visitante: o dono assina a versão do site e o visitante conserva a assinatura da proposta. Usar uma prova de incorporação do dono ligada a certificateId, destino da tabela/linha, valores incorporados, audiência e instante de decisão, com a proposta original intacta. A UI distingue valores originais e alterações do dono.

Evitar referência circular: um certificado que faz parte do payload não pode incluir o hash da própria versão final que o contém. Ligar a intenção ao UUID da publicação no journal, e só concluir published depois de reler a versão/envelope realmente persistidos. A prova de incorporação pode estar dentro da versão assinada, com base/UUID/rowId, sem fingir que o mero certificado de decisão prova que essa versão chegou à rede.

Expiração impede uma nova aprovação, mas não deve tornar impossível editar outra página de um site que já contém dados incorporados legitimamente. Conservar a prova de incorporação anterior para carry-forward dos mesmos valores/audiência; nova aprovação ou alargamento de leitores volta a exigir autorização compatível. Alterar valores não pode aparentar nova assinatura do visitante. Prazo/clock de uma decisão assinada é declaração do dono, não prova externa da precisão do relógio; não prometer impedir um dono malicioso de copiar texto que já leu.

Introduzir a versão de documento/proveniência nos três parsers e verificadores, com limites de bytes/linhas/certificados. Uma mudança de esquema/audiência exige reconciliação e validação explícita, não apenas copiar um campo para um parser permissivo. Migração do editor e renderizador segura vem antes de expor formulários na paleta. Estes são requisitos do próximo incremento, ainda não implementação.

## Formato recomendado e limites de divulgação

Manter as tabelas v1 fechadas em id/values. Acrescentar proveniência numa versão nova do documento, com provas únicas e referências de colocação nas linhas. A prova assinada conserva a proposta original, valores incorporados e a audiência aprovada; as referências de colocação pertencem ao snapshot assinado do dono. Assim, duplicar/mover uma página dentro do mesmo site pode reutilizar a prova sem reescrever a assinatura do visitante. Valores/colocação diferentes são identificados como alteração/reutilização pelo dono. Outro endereço de site não reutiliza automaticamente a concessão original.

Uma prova incluída no payload não pode apontar ao hash da própria versão que a contém. O journal liga o UUID da decisão/publicação à cópia real; a prova de incorporação contém referências anteriores e os dados de decisão, sem referência circular. Aprovação preparada não é publicação concluída.

Não incorporar inadvertidamente a ACL privada do formulário na proveniência pública: schemaHash cobre também as regras de contribuidores. Mostrar os identificadores e valores assinados; rótulos/layout actuais pertencem ao dono. Se o leitor não consegue obter/decifrar o snapshot original, não afirmar que verificou esse contexto histórico. A UI deve explicar a disponibilidade da origem separadamente das assinaturas verificadas.

O consentimento de publicação aplica-se à proposta completa. Se a prova inclui os valores originais, redigir essa consequência antes do envio e antes da publicação; omitir uma coluna visual não apaga os dados da prova. Não inventar divulgação selectiva/ZK nem alterar o protocolo de assinatura para ocultar essa limitação. A audiência do site tem de ficar dentro da concessão, também ao copiar provas antigas para uma revisão nova.


Existe um rascunho de certificado de recusa em .cache/contribution-decision-draft/contribution-rejection.ts, sem valores da proposta e privado para dono+contribuidor. Ainda não integrado/compilado/testado; não é decisão funcional. O próximo incremento deve derivar a intenção da inbox autêntica, guardar destinatário público antes de libertar prova, preservar bloqueio/sessão/prazos e concluir emissão/admissão antes da UI. Recusa tardia não concede publicação, e descarte local permanece disponível sem obrigar a notificar uma pessoa bloqueada.

## Verificação do formato actual antes da incorporação

A leitura das fontes confirmou que a versão4 já é usada pelos formulários (`packages/content/src/site.ts` e `native/sites/document.go`). A proveniência precisa de uma versão seguinte, sem reaproveitar silenciosamente a4 nem alterar tabelasv1. O documento continua limitado a128KiB e a tabela a64KiB; provas originais e incorporadas contam para esses orçamentos. Não aumentar limites apenas para fazer caber a implementação.

IDs de linhas são limitados a40 caracteres e começam por letra (`site-data.ts`), pelo que um certificateIdhex64 não cabe. Usar um identificador estável da intenção do dono (por exemplo c- seguido do UUID sem hífen), verificar colisão sem substituir outra linha e manter o certificateId completo na prova. Não truncar uma referência criptográfica e tratá-la como autoridade.

A prova de incorporação deve manter a proposta assinada original, assinatura do dono, decisão/instante, base anterior, valores incorporados e audiência aprovada. A colocação pertence ao snapshot posterior do dono. Ler a prova autentica as assinaturas e o vínculo; só afirmar que a origem histórica foi verificada quando o snapshotoriginal estiver disponível e tiver sido realmente validado. Não divulgar aACLoriginal do formulário na prova pública.

Uma decisão durável anterior ao prazo e uma publicação/copiação efectiva são factos distintos. Antes de implementar, manter explícita a política de expiração na retoma: não preparar uma nova aprovação após o prazo nem renovar o timestamp de uma intenção antiga; só declarar published depois de reler a cópia real. A UI deve explicar o que fica autorizado e o que já aconteceu, incluindo o conteúdo completo da proposta que a proveniência torna legível. Estas notas são desenho, não execução de aprovação/UI.
