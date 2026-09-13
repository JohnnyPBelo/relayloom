# Admissão de conteúdo por épocas — integração parcial

Os núcleos Node e Go já admitem conteúdo a partir dos bytes cifrados guardados no ContentStore. Verificam a assinatura, decifram com a identidade local e validam o payload completo antes de o resumir. O histórico aceite vem exclusivamente do ledger autenticado; a API não aceita um contexto histórico fornecido pelo cliente.

A aceitação e as mutações/confirmações privadas associadas partilham a transacção do perfil. Uma resposta só é devolvida depois do commit. Falhas antes do commit revertem a admissão; uma resposta perdida depois dele recupera através da ligação assinada, preservando conjuntamente o contexto e a alteração. Um tombstone histórico pode continuar válido depois de os bytes do alvo saírem do cache. Uma expiração no registo que não coincide com o bundle assinado é recusada.

Quarentena e espera por provas têm reservas físicas separadas dos pins manuais, dentro dos limites existentes. Reservas sobrevivem ao reinício e respeitam quota/expiração; libertá-las não desfaz pins do utilizador. Uma escrita incerta protege conservadoramente a união até à reconciliação autenticada. Conteúdo corrompido é marcado como indisponível e não bloqueia outro objecto válido. Reservar bytes não concede leitura nem autoria.

Campos de grupo são reconhecidos pela presença, incluindo valores falsy. Não podem cair na autorização de DM/grupo fixo depois de a projecção apagar campos. Alterações sem ligação de época não podem modificar um alvo de grupo. Assinar como leitor não permite apagar conteúdo do autor. Um encerramento válido seguido de uma prova inválida mantém a restrição; só o histórico já aceite continua a aparecer automaticamente.

A consulta de objectos já retidos partilha uma transacção de leitura e o seu cache de autoridade termina nessa consulta. Um controlo com32 mensagens/32 épocas reproduziu1024 cabeçalhos visitados e3363ms; a correcção passou com32 cabeçalhos e cerca de120ms, mantendo a recusa após encerramento. É uma medição específica, não uma garantia universal de desempenho nem prova de ingestão fria à escala máxima.

## Verificação desta versão

190 testes Node passaram137.762s;129 testes Go de topo/race396.073s (9 helpers executados pelos drivers de interoperabilidade);24 testes de interoperabilidade219.736s; fronteira SQLite C15.538s;16 UI Node112.941s e16 UI Go103.288s. Build6.072s e CLI0.221s passaram. Desktop Linux: preparação0.224s, execução1.028s, pacote5.347s e execução empacotada0.798s.22 relatórios Axe actualizados, zero violações. Fontes inalteradas em todas as fases. Evidência em docs/evidence/group-content/final.

Os testes novos incluem TCP e APIs reais Node/Go, reinício com troca de núcleo, controlos de payload negativo confirmados presentes pela API, perda de resposta, rollback, falta de reserva, corrupção de cache e incoerência semântica autenticada. As falhas e correcções também estão guardadas. A revisão visual de capturas nesta fase foi feita pelo agente principal, não por um revisor independente.

## Trabalho ainda obrigatório

A outbox dinâmica, emissão de mensagens/alterações/confirmações pela aplicação, carriers automáticos e UI de grupos dinâmicos continuam em implementação. As fixtures assinam e injectam os bundles de teste e transferem os certificados pelas APIs; isto não prova envio dinâmico pela aplicação. `outbound:false` e `messaging:false` são limites temporários a substituir pela implementação completa. A UI e a outbox de DMs/grupos fixos existentes continuam funcionais.

Os APKs/frameworks anteriores não incluem esta mudança. Em iOS274004e houve lançamento real num XCUITest, mas a WKWebView não apareceu e nenhum fluxo funcional passou. Hardware, rádios físicos, assinatura de distribuição, revisão independente desta integração e os demais requisitos de PROJECT-BRIEF.md permanecem abertos. O produto é experimental e não é infraestrutura validada para catástrofes.
