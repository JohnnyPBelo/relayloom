# C2 — convites, consentimentos e saídas (por implementar)

Continuação do contrato integral e de GROUP-CARRIERS.md. Esta nota resulta da leitura do código; não é prova de implementação ou teste. Recuperação sequencial mantém-se, sem novos/retomados agentes.

## Fronteira durável

O `GroupRegistry` já guarda o consentimento e a saída nos checkpoints. O resultado de `invite` só contém o certificado e o fingerprint do cartão: depois de um crash o emissor não consegue reconstruir a chave de leitura do convidado sem conservar o cartão exacto. Não derivar destinos de contactos mutáveis nem aumentar permissões por um envelope exterior.

- Gravar uma intenção limitada de convite com cartão/certificado/anchor/parent na mesma transacção de `executeGroupCommand`/Go. Falha desta gravação deve impedir que um convite seja confirmado como enviado. Repetição com o mesmo UUID precisa do mesmo resultado e material; retirada de uma operação antiga não autoriza retry automático.
- Consentimento e saída podem ser reconstruídos do checkpoint autenticado e do cartão do criador. Um limite de rede ou cache nunca pode reverter a saída local, o encerramento ou uma paragem da outbox. Não acrescentar a estas paragens uma dependência de espaço normal.
- Controlos cifrados dirigidos, tipos explícitos e limites próprios; reutilizar transporte, `ContentStore`, TTL e quotas C1. Avisos recebidos não entram na lista de mensagens nem em grupos activos por si só.

## Inbox e acções locais

Inbox cifrada, limitada por quantidade/bytes e por origem, com identificador de certificado idempotente. Validar assinatura interna, destino, cartão comprometido, anchor e parent. Estado bloqueado/encerrado/forked não pode ser reaberto por aviso; recusa/dismiss precisa de retenção limitada que evite reaparecimento imediato por replay.

Convite recebido fica pendente até acção local explícita. A acção abre o convite no registo, obtém a ancestry através de C1 e só aceita contra o parent verificado; um consentimento de outra instalação nunca substitui este acto local. Consentimento recebido pelo criador autoriza apenas a transição exacta que os verificadores existentes permitem; não altera automaticamente membros. Uma saída recebida informa o criador e conserva o seu pedido assinado, sem atribuir ao membro a chave de assinatura do criador.

## Integração e provas seguintes

API de inbox/gestão com operações idempotentes, depois UI Liquid Glass: criar grupo, ver origem e destinatários do convite, aceitar/recusar, rever membros/época antes de enviar, sair/encerrar, estados de espera e erro. Composição dinâmica só se activa quando a autoridade/admissão está verificada; rascunho e UUID não passam silenciosamente para outra audiência. Alternativas de teclado, foco, tamanhos móveis, efeitos reduzidos e anúncios acessíveis mantêm-se obrigatórios.

Testes: crash antes/depois do commit, falha de armazenamento, repetição e limites, desconhecidos/blocked/convites obsoletos, consentimento forjado/reutilizado, remoção/reentrada/saída com quotas cheias. Processos reais Node↔Go em ambas as direcções, autor offline e seeder opaco, partição/heal e TCP/serial. A seguir E2E real de toda a gestão/composição e gate integral de fontes estáveis. Bootstrap explícito de convite por HTTP nas fixtures C1 não satisfaz C2.
