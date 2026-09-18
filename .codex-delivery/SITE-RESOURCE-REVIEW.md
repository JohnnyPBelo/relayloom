# Revisão local da criação de recursos — 18 de Setembro de 2026

Revisão pelo implementador; não satisfaz o gate de revisão independente. A recuperação sequencial continua a proibir criar/retomar agentes. O objectivo integral não está concluído.

## Fronteiras verificadas no código

- O domínio de armazenamento `resource:` e a derivação a partir da assinatura permanecem separados de sites e de leitura/seeding. Stage e registo são gravados na mesma transacção antes de a aplicação receber o resultado. Uma área privada ausente com dados existentes ou stage incoerente não é reinicializada.
- Node/Go reutilizam a mesma protecção de identidade, digest privado e encerramento por erro de integridade/SQLite dos catálogos de sites. A extracção desse adaptador não altera a política. Browser fixa a geração da sessão e invalida callbacks após lock/close.
- Repetições consultam a operação retida antes de resolver novamente cartões ou assinar. Payload/audiência/prazo diferentes com a mesma operação são recusados. Retenção finita e sequência impedem que pedidos retirados sejam tratados como criação nova.
- A expiração é tratada depois de autenticar o stage com o instante histórico da assinatura. Não mascara corrupção como expiração. Resume não reassina uma tentativa expirada.
- O runtime relê o ContentStore e o catálogo compara assinatura, autor, audiência, referência e hash do bundle exacto antes de apagar stage e gravar ready. Falha de quota/cópia/releitura mantém o resultado pendente. O estado ready é histórico, não garantia de disponibilidade futura.
- O bloqueio de um leitor é verificado antes da cópia. No browser é confirmado dentro da transacção de cópia, cobrindo alteração entre snapshot e commit; o teste injeta essa alteração através do armazenamento real. Um resultado já retido não é reescrito quando muda um cartão/bloqueio.
- O callback de cartões do browser é síncrono e não chama getValue dentro da transacção exclusiva. Os cartões são carregados antes. As operações de runtime e os ticks são serializados; nenhum task antigo pode completar após mudança de sessão.
- Não existe callback de publicação na criação de recursos. Inventários continuam a omitir estes IDs; pedidos explícitos e seeding consentido mantêm as verificações anteriores. A cópia fica fixada pelo criador e está sujeita à quota. Leitores/relays não ganham entrada no catálogo de autoria.

## Provas e limites

O gate consolidado passou 450 testes Node, Go sites/app com race, 19 de interoperabilidade e 19 por browser (57). A regressão UI adicional passou 23 percursos e 20 auditorias Axe. Os hashes de 628 ficheiros de fonte correspondem ao commit 96e35c1. As provas estão em docs/evidence/site-optional-resources/creation. O contrato tem também controlos de autoria, payload, MIME, audiência, canonicalização e limites. Esta é a revisão do implementador; a revisão independente continua pendente.

A leitura por referência de snapshot assinado, documento v3, biblioteca/editor/reader e testes UI de recursos ainda não estão implementados. Não prometer esses fluxos com base nos testes da API. A paridade de downloads na shell iOS, hardware e revisão independente continuam pendentes. Bloqueio não retira cópias nem chaves já recebidas por outros pares.
