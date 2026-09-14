# Grupos dinâmicos na interface

A interface Liquid Glass liga a gestão de grupos às APIs reais de Node e Go. Em **Grupos e convites**, o criador pode criar um grupo e convidar um contacto verificado. A pessoa convidada abre e aceita o convite; o criador revê e aprova a entrada. O painel mostra os membros da versão verificada, permite mudar o nome, remover membros, sair ou encerrar o grupo. As listas de leitores fixos continuam disponíveis como um fluxo separado.

Uma mudança de versão conserva o rascunho e exige rever os destinatários antes de enviar. Mensagens novas usam a audiência actual verificada; respostas e eventos respeitam também os leitores do conteúdo original. O envio fica indisponível se faltarem as provas ou os membros, se a pessoa já tiver saído ou sido removida, ou se o grupo estiver encerrado, em conflito ou sem capacidade. A API volta a verificar a autoridade; os controlos visuais não concedem permissões.

Uma resposta perdida não autoriza repetir a mutação. O painel conserva o UUID da operação ao fechar e reabrir, permite consultar o resultado guardado e exige uma decisão explícita se o registo já não existir. Bloquear a identidade desmonta o painel. A recuperação verifica a sessão depois de cada leitura assíncrona para impedir que uma resposta antiga execute callbacks com rascunhos da sessão anterior.

## Verificação e defeito corrigido

Um E2E novo executou uma criação real, perdeu a resposta depois do commit e reteve a resposta da consulta seguinte até depois de bloquear a identidade. O rascunho apagado reapareceu ao desbloquear: a falha foi reproduzida antes da correcção. A guarda de sessão após a segunda leitura corrigiu-a. O mesmo par de testes passou em Node (6,6 s) e Go (5,1 s), incluindo o controlo positivo de recuperação sem uma segunda criação.

O gate completo no candidato isolado sobre `bb85d1a` passou: 23 E2E Node em 164,130 s e 23 Go em 150,658 s; typecheck, build, CLI, arranque Linux, pacote e execução do executável empacotado passaram. As 364 fontes mantiveram-se inalteradas. Foram arquivadas 70 auditorias Axe sem violações e capturas reais. [Evidência completa e falhas anteriores](evidence/dynamic-groups/milestone).

A revisão visual também encontrou o contador de convites quase 9 px fora do botão a 320 px. Uma asserção geométrica reproduziu a falha; o layout compacto passou a distribuir ícone, texto e contador em colunas. O mesmo fluxo passou depois da correcção e novamente no gate completo, com ambos os motores. O primeiro arranque Electron falhou por um caminho de socket Unix de 111 bytes; a cópia de teste foi movida para um caminho de 94 bytes dentro do projecto, mantendo a sandbox e o mesmo teste.

Os comandos reproduzíveis são:

```sh
npm run build
npm run native:build
node scripts/e2e.mjs tests/e2e/group-operation-recovery.spec.ts
RELAYLOOM_TEST_BACKEND=native node scripts/e2e.mjs tests/e2e/group-operation-recovery.spec.ts
node scripts/verify-ui.mjs
```

Os testes usam Chromium, processos reais Node/Go e, no gate Linux, execução do pacote desktop com sandbox. Larguras móveis no Chromium não são testes Android/iOS. A revisão visual pelo implementador não substitui revisão independente ou leitor de ecrã.

## Limites em aberto

A versão web autónoma ainda usa leitores fixos: estes grupos dinâmicos têm de ser integrados no worker com a mesma autoridade, persistência, outbox e transporte. Continuam no contrato os casos adicionais de recuperação após retirada do UUID, convites bloqueados/obsoletos, remoção/reentrada, audiência de anexos e respostas, estados de conflito/capacidade e testes de teclado em todos esses estados. A paridade completa, as plataformas actuais e a revisão independente continuam pendentes; este marco não conclui o produto.
