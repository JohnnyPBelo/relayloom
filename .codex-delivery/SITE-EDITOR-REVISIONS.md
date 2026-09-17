# Estúdio com endereço e histórico — próxima integração

O marco browser de catálogo/API está integrado no principal e em gate de três motores em `.cache/site-browser-final` (sessão 31008). Não alterar fontes principais enquanto corre. Trabalho preparatório seguinte fica em `.cache/browser-site-parity`, que recebeu o commit Go por cherry-pick local **8bf95fc** (equivalente a 3f63f19). Não o confundir com uma publicação remota.

## Requisitos de comportamento

- O endereço estável de `profile` pertence à chave de assinatura. O histórico apresenta versões verificadas, disponibilidade real e conflitos; não escolhe uma revisão antiga por timestamp nem substitui uma cabeça sem bytes por um payload anterior.
- Cada rascunho novo guarda a base e sequência de publicação de quando a edição começou. Salvar/reabrir não actualiza essa base silenciosamente. Rascunho legado só adopta automaticamente a base se ainda não houver site versionado; caso contrário exige comparação/escolha explícita.
- Antes do primeiro envio, guardar UUID e digest do pedido juntamente com o rascunho cifrado. Uma resposta perdida procura o resultado da operação, retoma exactamente o pedido ou informa conflito. Não mudar UUID/conteúdo automaticamente. Bloquear alterações do rascunho enquanto há resultado por determinar; permitir resolução/cancelamento segundo a fase durável.
- Só mostrar publicação concluída para a fase ready. Quota, leitores bloqueados, preparação, expiração, cancelamento e resultado desconhecido são estados diferentes. Uma operação pronta ultrapassada por outra edição não permite adoptar a nova base sem revisão do utilizador.
- Ver uma versão antiga é leitura. Recuperá-la prepara um novo rascunho sobre a base confirmada e exige nova assinatura. Não atribuir autoria ao leitor, ao seeder ou a importações.
- Conflitos mostram todas as cabeças conhecidas e exigem confirmação explícita das mesmas; actualizações que cheguem depois são recusadas pelo CAS existente. Não simular merge automático.
- PT/EN/ES, teclado/toque, foco e feedback acessível, composição Liquid Glass consistente e zero controlos sem acção real. Endereço copiável, botão de actualização, histórico percorrível e pré-visualização verificada.

## Implementação prevista

Adicionar contexto opcional ao rascunho privado com validação partilhada TypeScript e equivalente Go: domínio, endereço do dono, base, sequência e pedido pendente ligado a um digest. Aplicar validação na admissão e leitura persistente em Node, Go e browser. As chaves ficam no worker/core; a UI só recebe o contexto do próprio rascunho.

Ligar o controlador do estúdio à API site-command existente e preservar os valores de rascunho em falhas. Integrar endereço/histórico/versão fixa/recuperação em leitura e escolha explícita da base. Esta nota é desenho do comportamento, não prova de funcionalidade implementada.

## Gates seguintes

Vectores positivos/negativos do contexto; gravação/leitura privada nos três motores; resposta de publicação perdida; edição concorrente entre duas instalações; interrupções antes/depois do commit; quotas; lock/reload; heads sem bytes; histórico e recuperação a nova versão. Testar a UI real em Node/Go e três engines web com contas distintas, Axe, captura e revisão visual. Depois gerar/verificar artefactos exactos, repetir regressões afectadas e publicar. A publicação pública actual mantém-se na fonte 0c6b58a / distribuição 45ecacdf até esse gate passar.

O contrato inteiro, Apple/hardware, grupos dinâmicos web, backup/rotação/keystore, dados/contribuições declarativas/ficheiros opcionais, todos os meios e revisão independente continuam obrigatórios. Recuperação sequencial, sem agentes/configurações/bridges/serviços externos.


## Candidata preparada durante a regressão browser

O gate do principal terminou e a correcção de selector passou nos três motores. A worktree acima tem agora o contexto opcional do rascunho ligado à persistência dos três runtimes e um componente de histórico/read/recuperação que chama a API real, com traduções PT/EN/ES. Este componente ainda não está montado no estúdio. Dois testes TypeScript de contexto, typecheck e TestEditingContextOwnerAndPendingShape em Go passaram. Faltam os vectores de paridade e testes de API da persistência, a ligação do controlador/publicação, resposta perdida, contexto legado e todos os percursos UI/Axe. Não copiar esses ficheiros por cima do principal validado antes dos gates.

Na próxima integração, carregar as operações pendentes pela API de estado do site; o resumo global sitePublishing é um estado em memória que só reflecte a recuperação depois da inicialização/tick. Não inferir ausência de trabalho durável a partir de um resumo inicial vazio.
