# Gestão autenticada de grupos — integração parcial

O contrato completo permanece em `PROJECT-BRIEF.md`. As conversas da interface continuam a usar grupos fixos. A API de gestão de épocas funciona nos núcleos Node e Go; a admissão dos conteúdos já está ligada e verificada em [GROUP-CONTENT](GROUP-CONTENT.md). Envio/outbox dinâmica, carriers de controlo e UI continuam pendentes. `management: true` e `messaging: false` são capacidades distintas na resposta da API.

## Fronteira implementada

`POST /api/group-command` exige a capacidade local existente e uma identidade desbloqueada. Não é um serviço público de gestão nem de alojamento. Aceita acções `list`, `state`, `operation`, `create`, `invite`, `remember`, `accept`, `commit`, `close`, `leave`, `headers`, `snapshot`, `resume`, `proofs` e `private-state`.

Cada comando usa a mesma transacção do SQLite privado, verifica o digest do documento em memória e aplica a autoridade através do registo de acesso. O resultado só sai depois do commit externo. Um erro de resultado incerto provoca reabertura através da ligação assinada por instalação; se a leitura não puder ser autenticada, o núcleo bloqueia. O JSON legado não substitui uma base inicializada.

Uma operação retida conserva o resultado original. A repetição do mesmo UUID não cria outro grupo nem um novo consentimento. Reutilizar o UUID com parâmetros diferentes falha. O limite de 256 operações é finito; a ausência de uma operação antiga não autoriza a interface a repetir automaticamente uma intenção incerta.

O convite exige decisão explícita de recordar o grupo e consentimento assinado pelo convidado. Cabeçalhos desconhecidos não inscrevem automaticamente o grupo. Alterações de membros são assinadas pelo criador; posse de chaves de leitura e capacidade de semear não concedem essa autoridade. Saída local, remoção e reentrada são estados distintos, com consentimento novo na reentrada.

`headers` admite no máximo 16 provas/256KiB. O Go descodifica e verifica cada certificado dentro da transacção. Uma assinatura/esquema inválido na cauda devolve `observation.rejected` depois de gravar o prefixo válido; nunca anula um encerramento já verificado. Um erro de armazenamento/integridade continua a abortar a transacção. Uma página inteira fora dos limites não admite qualquer prefixo.

## Política e registo persistente

As bibliotecas Node/Go implementam as audiências por época, leitores originais, intersecção original/actual e controlos históricos mínimos descritos em `GROUP-EPOCHS.md`. Reconhecem tags por presença, incluindo valores inválidos/falsy. A geração da transacção invalida qualquer decisão em cache depois de uma mutação de autoridade.

O registo local conserva até 4096 contextos de admissão autenticados, 128 retenções pendentes/16MiB de bytes cifrados contabilizados, 256 paragens imutáveis e contadores limitados de retirada/recusa. As paragens cabem num checkpoint de 128 KiB dentro da reserva existente de 4 MiB; não dependem de aumentar o documento privado quando o espaço normal está esgotado. O histórico fornecido por HTTP nunca é aceite como prova de observação local.

A admissão e as reservas físicas do `ContentStore` estão agora ligadas conforme [GROUP-CONTENT](GROUP-CONTENT.md); a reserva dos envios dinâmicos continua pendente. Contabilizar um payload não demonstra que os seus bytes continuam disponíveis. Um backup integral anterior, ainda autenticamente válido, continua indistinguível sem testemunha monotónica externa.

## Evidência e limites

Os primeiros quatro percursos de API passaram em 5,684 s: Node↔Node e ambas as direcções Node↔Go, controlo401, ausência de inscrição por hints, convites/consentimento, rejeição de forja e campos extra, repetição de operações, saída/remoção/reentrada, prefixo restritivo, cifra em disco e reinício do membro pelo outro núcleo. A perda de resposta depois do commit é injectada na fronteira de persistência; não é apresentada como falha física de alimentação. Go testa também rollback antes do commit e digest privado desactualizado.

O primeiro gate misto falhou porque o servidor Go não encaminhava a operação nova; o encaminhamento foi corrigido e os casos repetidos. Uma expectativa de teste sobre `resume` num grupo não suspenso foi corrigida para exigir a recusa já especificada. Os logs das falhas são preservados.

Gate completo: build5.497s;177 testes Node122.851s;118 testes Go de topo com race380.032s (oito helpers omitidos sem fixture e exercitados pelos drivers reais);20 casos de interoperabilidade199.504s; driver C dirigido8.039s;16 UI Node112.105s e16 UI Go106.110s. Desktop Linux: preparação0.239s, execução2.075s, pacote5.377s e execução empacotada0.795s.22 relatórios Axe actualizados sem violações. Fontes inalteradas em todas as fases. Evidência em [evidence/group-runtime/final](evidence/group-runtime/final). Capturas do editor/social Node e conversa escura Go revistas por root; isto não é revisão independente. Nenhuma nova execução móvel pertence a este gate.

Os testes mistos transportam certificados entre APIs autenticadas através da fixture. Isto prova interoperabilidade real dos processos e ficheiros; **não prova sincronização P2P automática de controlo nem mensagens de grupos dinâmicos**. Os testes existentes de TCP/série, partição/recuperação, seeders e UI foram repetidos como regressão, mantendo essa distinção. Os APKs/frameworks anteriores não contêm este código novo. Hardware Apple, assinatura, rádios físicos e revisão independente desta integração continuam pendentes.
