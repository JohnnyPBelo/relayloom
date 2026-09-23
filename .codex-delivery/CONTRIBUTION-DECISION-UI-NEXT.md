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
