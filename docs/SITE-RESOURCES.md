# Recursos opcionais de sites — implementação em curso

Este incremento está na árvore `codex/site-optional-resources`. Não está integrado na versão pública. O estúdio publicado ainda não permite anexar estes recursos. O produto completo e a revisão independente continuam pendentes.

Um recurso contém um ficheiro até 2 MiB ou uma tabela declarativa (64 KiB, 256 linhas e 12 colunas). O envelope é assinado pelo criador e pode ter leitores privados ou ser público. A referência fixa o ID do envelope, autor, nome, tipo, tamanho e hash do payload canónico completo. Não é uma URL executável. HTML, SVG, JavaScript, SQL e módulos remotos não são executados pelo site.

## Criação local nos motores Node, Go e browser

O comando `resource-command` usa a mesma forma nos três motores. No daemon é um POST autenticado a `/api/resource-command`; no browser autónomo passa pelo motor local, sem pedir essa rota a um daemon.

- `{action: "state"}` devolve o registo de criação do proprietário: contador seguinte e até 128 resultados retidos, sem os bytes dos ficheiros/tabelas.
- `{action: "operation", sequence, operationId}` consulta um resultado. `retired: true` significa que já saiu da janela retida; não autoriza nova assinatura.
- `{action: "create", sequence, operationId, content, recipients, ttlMs}` valida e guarda uma intenção e a assinatura numa transacção privada antes de copiar para o armazenamento de conteúdo. `operationId` é um UUID; uma audiência privada é a lista ordenada, sem duplicados e incluindo o proprietário. Os cartões têm de existir e os leitores não podem estar bloqueados. A audiência pública usa `"public"`.
- `{action: "resume", sequence, operationId}` retoma apenas a intenção já guardada. Nunca substitui um recurso expirado por outro ID.

Todos os campos são validados. Não se aceitam propriedades adicionais. Repetir o mesmo pedido recupera o resultado; alterar payload, audiência ou prazo mantendo a operação é recusado. Um pedido novo só pode usar a sequência seguinte. Há no máximo uma cópia pendente.

A fase `copy-pending` conserva o envelope na área privada cifrada cuja chave depende da posse da chave de assinatura. Falta de espaço ou falha na cópia não perde essa assinatura. A fase `ready` só é gravada depois de reler e verificar a cópia efectivamente guardada. É o resultado histórico da criação: não promete que o recurso ainda esteja disponível após expiração, remoção ou perda do armazenamento. A fase `expired` conserva a identificação da tentativa, sem reassinar. Uma nova criação exige uma decisão explícita e outro UUID/sequência.

O motor tenta concluir uma cópia pendente no máximo uma vez a cada cinco segundos. Bloqueio de sessão invalida o runtime anterior. Bloquear um leitor suspende a cópia privada pendente; o browser verifica esse bloqueio dentro da própria transacção de cópia. O criador fixa a cópia local, dentro da quota configurada. Não há garantia de conservação por outros pares.

## Distribuição

Criar não envia o recurso. Os inventários automáticos excluem `site-resource`, e a publicação genérica/announce recusam estes envelopes. Uma consulta periódica devolve apenas metadados. Um pedido explícito por ID pode ser encaminhado através dos adaptadores e servido por um par consentido que conserve os bytes. Ler/servir uma cópia não transfere autoria. Um relay sem chave pode conservar cifra opaca; um leitor verifica assinatura, integridade, audiência e payload antes de a apresentar.

Os testes de transporte anteriores e os novos testes da API são descritos nas provas do incremento. O gate consolidado da API passou 450 testes Node, os pacotes Go sites/app com race, 19 testes de interoperabilidade e 19 por browser (57); não considerar os controlos do estúdio ou a leitura por referência assinada concluídos.

## Trabalho seguinte obrigatório

O documento v3 terá blocos com referências limitadas, cobertas pela assinatura do snapshot. A API de leitura receberá o ID exacto do snapshot e o ID do bloco, e extrairá a referência depois de autenticar/desencriptar esse snapshot. Não aceitará do chamador uma referência ou um autor arbitrário. Consulta de disponibilidade não iniciará pedidos; só uma acção explícita o fará. A resposta será comparada integralmente com a referência antes de devolver dados.

O estúdio deverá apresentar uma biblioteca de recursos, criação/retoma/expiração, escolha de tabela ou ficheiro e inclusão no rascunho. O leitor deverá distinguir disponível, por obter, sem acesso, expirado e inválido. Os ficheiros serão descarregados de forma segura e as tabelas abertas no renderer declarativo existente. Sem transferência automática ao abrir a página. É necessário provar ausência dos bytes antes da escolha, funcionamento depois, ausência do autor, reinício do seeder, partição/heal e falhas de autorização/corrupção pela UI nos três motores.

Formulários e contribuições de visitantes serão operações assinadas pelo visitante e aprovadas separadamente pelo dono. Não fazem parte da criação local de recursos agora implementada. A inspiração ZeroNet não implica compatibilidade de protocolo, scripts remotos ou alterações por quem apenas possui chaves de leitura.
