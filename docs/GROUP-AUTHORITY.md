# Autoridade persistente dos grupos

Implementação experimental em `packages/groups/src/registry.ts` e `native/groupauthority`. Estas bibliotecas ainda não estão ligadas aos grupos da aplicação, às mensagens, à sincronização ou à interface. Os grupos disponíveis no produto continuam a ter membros fixos. A exclusividade de abertura do perfil, descrita abaixo, já está integrada nos dois núcleos.

## Comportamento implementado na biblioteca

- Criação e alteração pelo criador, convites assinados, consentimento fresco para a época exacta, saída local persistente e encerramento.
- Cabeçalhos públicos e estados privados verificados separadamente. Um membro existente não pode saltar uma transição intermédia inválida; o cursor local só avança com os estados necessários. Uma adesão nova começa no consentimento explicitamente aceite e não fornece chaves de mensagens históricas.
- Uma cadeia incompleta fica pendente. Uma assinatura inválida ou referência órfã não permite escolher uma autoridade. Duas alternativas válidas do mesmo criador conservam ambas as provas e suspendem o grupo.
- Uma página pode ter um prefixo de provas válido seguido de uma prova inválida. O prefixo verificado é gravado antes de comunicar o erro, para uma assinatura inválida no fim não apagar uma remoção já observada. Erros de armazenamento/integridade continuam a abortar a transacção.
- Falta de espaço para um cabeçalho ou estado privado produz estados de capacidade distintos. A recuperação exige guardar o cabeçalho exacto ou receber novamente o estado privado exacto; libertar espaço por si só não activa uma participação.
- Até64 grupos lembrados e256 operações retidas. Sair, encerrar ou detectar conflito não liberta a identidade permanente do grupo. Repetir uma operação retida devolve o resultado original sem a aplicar de novo; um resultado ausente não autoriza repetir automaticamente uma operação incerta.

Cada checkpoint tem até52KiB; cada operação até2KiB. Recibos de saída/encerramento usam a reserva e o cabeçalho terminal fica no checkpoint do grupo. A reserva de4MiB comporta os limites declarados de checkpoints/recibos com o índice e os envelopes nos testes efectuados. Uma falha real no limite próprio do índice foi reproduzida e corrigida reservando também até128KiB do índice para checkpoints/recibos. Os testes incluem18 717 registos cifrados válidos e um controlo Go com apenas essa protecção retirada, que falha como esperado; ver `GROUP-STORAGE.md`. Custos físicos de SQLite/journal são contabilizados separadamente. A restauração integral de um backup antigo válido permanece indetectável sem uma testemunha monotónica externa.

## Verificação observada

A evidência está em `evidence/group-authority`. O conjunto inicial passou build,128 testes Node e interoperabilidade de certificados. A continuação passou23 testes do registo Node, incluindo processos reais, barreiras de saída, reentrada, conflitos, quota, estados fora de ordem e corrupção de operações. Houve regressões reais antes das correcções de ordenação, saída sob quota cheia e prefixos de provas. A falha posterior de uma fixture ao consultar um identificador depois de o handle ficar bloqueado foi corrigida fixando o identificador antes da falha, sem enfraquecer o bloqueio.

A versão Go passou11 casos iniciais de autoridade e11 de armazenamento com race. O cenário combinado de256 operações/64 grupos demorou435,400s; a reutilização do checkpoint apenas dentro da leitura da mesma transacção reduziu esse cenário para129,050s, sem remover verificações de cada assinatura/revisão. Uma regressão adicional em ambos os motores verifica que uma assinatura inválida continua a impedir a retirada de operações depois dessa reutilização. Isto mede testes com instrumentação race, não o desempenho de todos os dispositivos.

A interoperabilidade executa processos Node/Go sobre os mesmos ficheiros cifrados: CAS misto, morte real antes do commit nos dois sentidos, repetição Node após resposta Go perdida, Unicode exacto incluindo unidades UTF-16 isoladas, saída/reentrada, cursor intermédio, conflitos assinados, capacidade e corrupção. Estes testes não demonstram transporte de grupos dinâmicos nem execução móvel.

## Exclusividade do perfil integrada

`packages/profile/src/ownership.ts` e `native/profilelock` mantêm uma transacção SQLite exclusiva num ficheiro local sem dados de identidade ou conteúdo. Um segundo processo cooperante recusa abrir o mesmo perfil; outro perfil continua disponível. O fecho normal ou a morte real do proprietário liberta o bloqueio. Não há expiração por relógio, encerramento de um PID encontrado num ficheiro ou serviço externo de coordenação.

Os dois núcleos adquirem o bloqueio antes de ler o estado mutável. Uma falha de construção liberta-o sem repor ficheiros existentes. Uma instância encerrada não volta a desbloquear, escrever ou escutar depois de outra assumir o perfil. Chamadas concorrentes de fecho aguardam a conclusão. Os testes de aplicação reais verificaram a recusa do segundo núcleo e a recuperação da mesma identidade e operação de outbox pendente após o primeiro fechar, nos dois sentidos Node/Go. O gate alargado passou133 Node,95 Go com race,11 cenários de interoperabilidade,15 percursos de interface por núcleo e execução desktop Linux normal/empacotada. Estes números precedem a última correcção do índice, que tem gates próprios. Não se transfere esta evidência para APKs/pacotes antigos.

## Trabalho necessário para grupos dinâmicos no produto

Faltam fixar o identificador do registo por instalação, migrar o estado privado para a mesma fronteira transaccional, ligar admissão/IDs aceites/quarentena/outbox, sincronizar provas/carriers e implementar API/UI. O ficheiro JSON privado actual e a base de dados de autoridade continuam separados: o bloqueio do perfil não os torna automaticamente atómicos. A revisão independente deste código novo está pendente durante a recuperação sequencial sem agentes.

O contrato integral permanece em `PROJECT-BRIEF.md`. Não há prontidão validada para catástrofes, execução deste código novo em dispositivos físicos, rádio real, distribuição assinada ou grupos dinâmicos de ponta a ponta demonstrados.

A verificação final sobre o armazenamento com reserva de índice passou25 testes Node (23 do registo e2 do índice),12 Go com race e a interoperabilidade de autoridade. Comandos/output/hashes: `evidence/group-authority/final`. O contrato de aplicação continua parcial pelas lacunas acima.
