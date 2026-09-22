# Formulários e contribuições — estado de implementação

Esta extensão continua o objectivo de sites distribuídos expressivos, inspirado no ZeroNet. **Ainda não existe um fluxo completo de envio e aprovação na interface.** O editor público continua a oferecer páginas, tabelas, recursos e versões; o novo bloco de formulário permanece fora da paleta até a integração estar concluída.

## O que já existe no código

O documento v4 define formulários ligados a tabelas do mesmo snapshot, inclusive noutra página ou dentro de uma composição. Os campos correspondem às colunas tipadas e distinguem valores obrigatórios/opcionais. A política enumera contribuidores específicos ou leitores autorizados. Não há scripts, HTML activo, SQL ou regras executáveis.

A consulta `contribution-command` com `action: form`, snapshotId, pageId e formId existe em Node, Go e browser. O motor autentica/desencripta a cópia local, resolve o formulário/tabela e verifica o visitante. Bloqueio, retirada, prazo e sessão são revalidados. A resposta contém campos, audiência e origem; não devolve linhas da tabela nem chaves. Consultar não publica, assina ou pede conteúdo à rede. A resposta descritiva não é uma autorização reutilizável para uma futura submissão.

O certificado do visitante fixa site, snapshot, revisão, formulário, esquema, UUID, valores, validade e a audiência máxima consentida para divulgação. Uma proposta pode ser enviada privadamente ao dono de um site público sem consentir publicação pública. A audiência do envelope e a concessão de publicação são coisas diferentes; adoptar a proposta continuará a exigir uma decisão assinada pelo dono e uma audiência compatível.

## Preparação privada ainda interna

Os catálogos Node/Go/browser guardam primeiro a intenção e o snapshot de origem, sem assinatura do visitante. Só uma transacção posterior cria e conserva o certificado. Reabrir ou repetir a operação conserva os valores, o prazo e a identidade dessa proposta. Corrupção e falhas de quota recusam a operação; não geram silenciosamente outra proposta.

O journal tem um contador monotónico, uma preparação activa e até 128 resultados num registo de 1 MiB. O stage separado contém a fonte autenticada e, depois do commit de assinatura, o certificado. O armazenamento reservado deriva da posse da chave de assinatura; a chave de leitura não permite extrair ou criar assinaturas. Os três motores têm o catálogo; Node e Go retomam a mesma SQLite e recuperam o mesmo certificado/envelope, com testes de concorrência e interrupção.

| Estado interno | Significado | O que não prova |
| --- | --- | --- |
| prepared | Intenção e origem foram guardadas | Assinatura, envio ou aprovação |
| signed | Certificado guardado; pode conter envelope privado persistido | Cópia para o transporte ou entrega |
| cancelled | Preparação local cancelada, resultado retido | Recolha de cópias já extraídas |
| expired | Prazo terminou, sem renovação silenciosa | Eliminação de cópias remotas |

A janela finita conserva a identidade das sequências retiradas pelo contador; não promete memória infinita de qualquer UUID reutilizado com uma sequência nova. O envelope privado conserva exactamente a criação/expiração do certificado e é guardado antes de ser devolvido ao runtime. Recuperar não muda o nonce ou renova o prazo. Um envelope corrompido é recusado, sem gerar uma substituição silenciosa. Nenhum endpoint de submissão expõe ainda estes catálogos.

## Autoria e aprovação

Ler, obter e servir uma página não concede autoridade para a editar. Assinar uma proposta identifica o visitante; não o transforma no dono da página. Só o dono pode criar a revisão que incorpora os dados. O verificador da concessão de audiência não é, por si só, uma aprovação, verificação de prazo ou resolução de conflito.

A integração seguinte tem de conservar a proposta original na proveniência dos dados. Se o dono alterar os valores, a interface não poderá atribuir essa alteração à assinatura do visitante. Mudanças de base, esquema ou audiência exigirão reconciliação explícita. O utilizador deverá receber estados verificáveis, não apenas etiquetas locais.

## Ainda obrigatório

- Preparação/submissão na API com política resolvida novamente pelo motor, envelope privado persistente, outbox e inbox.
- Aprovação/rejeição, conflitos/CAS, recibos, reconciliação e proveniência das linhas.
- Composição de formulários e caixa de revisão na UI PT/EN/ES, Liquid Glass, teclado/toque, acessibilidade e testes com três contas reais.
- Regressão completa dos motores e plataformas, publicação dos artefactos exactos e revisão independente. Nenhum teste de software substitui validação de hardware ou rádio.

Provas da fundação: [documento v4](evidence/site-contributions/document-v4), [consulta autenticada](evidence/site-contributions/authenticated-context), [catálogos e envelopes](evidence/site-contributions/envelopes). O estado das validações mais recentes e da candidata está em [STATUS](STATUS.md). Estes marcos não concluem o produto nem demonstram prontidão para catástrofes.
