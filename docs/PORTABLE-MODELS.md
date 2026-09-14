# Modelos portáteis

Os tipos/codificação canónica do protocolo, o formato de conteúdo e as transições da outbox podem ser usados pelo núcleoNode e por um motor no navegador sem importar filesystem/cryptoNode para esse motor. A API pública do núcleoNode mantém os mesmos exports; o fingerprint de envio continua calculado pelo seu cryptoNode.

A validação partilhada verifica a estrutura do conteúdo. A camadaNode continua a verificar as assinaturas dos cartões dos membros. Esta extracção não concede autorizações nem substitui verificação criptográfica, autoridade de grupos ou transacções.

O conjunto foi aplicado sozinho sobre526d75a numa cópia isolada do mesmo projecto. Passou build,43testes de núcleo/social/outbox/segurança e1fluxo UI real de doisclientes com mensagens/anexo/grupo/social/site/recuperaçãooffline. Comandos/logs/hashes em [evidência](evidence/portable-models/scope.json). O browser completo e as restantes alterações locais são marcos separados; este refactor não prova paridade de plataformas ou prontidão para emergências.
