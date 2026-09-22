# Próxima implementação: inbox durável e revisão do dono

Este documento é plano, não funcionalidade implementada. Depende do gate da fila/envio em `.cache/contribution-submission-final-1/report.json`. Não recomeçar catálogos/envelopes nem activar a paleta enquanto a revisão/aprovação/publicação não estiver funcional. Manter o contrato completo, execução sequencial, reserva de disco e fonte privada cifrada.

## Limite actual que tem de desaparecer

`inbox` reconstrói candidatos da store, deduplica só pelo certificado e devolve as últimas128 linhas. Não é journal, não memoriza conflitos entre certificados do mesmo autor/UUID e não sobrevive à expulsão da fonte. Sender permanece queued até cancelamento/expiração. Não converter estes candidatos em rótulos delivered/approved.

## Incrementos de implementação e provas

1. Contrato portátil de inbox, persistido em namespace privado signing-owned separado da fila do visitante. Cada entrada conserva certificado original, envelope vinculado, primeira observação, fonte histórica verificável e resultado. Dedupe por certificado e por `(contributor.id, operationId)` dentro da identidade dona, independentemente do envelope aleatório/site. Um segundo certificado com o mesmo par não cria outra aprovação. Registar conflito limitado, sem substituir a primeira prova. Não usar nomes de apresentação como identidade.
2. Estados separados: aguarda-fonte, candidata-verificada, decisão-preparada, rejeitada, aplicação-em-curso, publicada, expirada. Verificação histórica não renova validade. Publicação só depois de reler os bytes do site efectivamente guardado. Corrupção de persistência não se trata como uma recusa normal do utilizador.
3. Admissão transaccional com fonte/política actual. Node mantém execução síncrona e Go o mutex existente; browser usa a mesma transactValues para bloqueio/retirada/journal e verifica geração após awaits. Não reentrar no perfil de dentro da transacção. Limites explícitos por dono/contribuidor/bytes, com contrapressão: nunca expulsar revisão pendente para aceitar novas propostas. Expiração e retenção de resultados devem ter semântica documentada, sem prometer memória infinita.
4. Fonte em falta: guardar somente candidato limitado, sem recibo de admissão. Pedir snapshot por ID através da rede com consentimento e orçamento. Ligar a prova conservada na fila do visitante a um caminho autorizado de obtenção; a sua leitura não permite extrair o namespace nem a chave. Testar o dono sem source e o visitante offline com seeder autorizado; não assumir que qualquer relay tem a chave do snapshot.
5. Recibos com assinatura do dono: domínio próprio, certificado/autor/UUID/destino vinculados, fases inequívocas e prazos limitados. Persistir decisão/recibo antes de os publicar; retries usam bytes originais. ACK físico não confirma inbox e inbox não confirma aprovação. A fila do visitante verifica a chave do dono obtida do site, recusa recibos cruzados/falsificados/futuros/replay e não atribui alterações do dono à assinatura original.
6. Aceitar/rejeitar através de comandos fechados da API, com UUID/sequência e CAS. Revalidar base, esquema, contexto original e audiência efectiva. Consentimento público não torna o envelope público; consentimento privado não autoriza uma revisão pública. Se base/esquema/audiência mudaram, pedir reconciliação explícita, sem fabricar contexto. Persistir a aprovação antes do trabalho recuperável de publicação e definir o ponto de validade para concluir depois de um crash.
7. Só depois ligar UI PT/EN/ES: compor/duplicar formulário, pré-visualizar, consentir/enviar, pendentes, inbox, detalhe de proveniência, aceitar/rejeitar/reconciliar. Resumo útil na interface, detalhes técnicos opcionais. Textos e valores dos utilizadores mantêm língua/autoria. Liquid Glass com contraste, teclado/toque, foco e movimento reduzido.

## Gates obrigatórios

- Vectores completos canónicos Node/portátil/Go, incluindo conflitos de UUID, reempacotamento, prazo, quotas, corrupção e leitor sem autoridade de assinatura.
- Persistência entre processos Node↔Go e entre reaberturas IndexedDB, crash antes/depois de cada commit/recibo, resposta perdida e concorrência real.
- Três contas reais: dono, visitante e relay/leitor sem chave; multi-hop/multi-adapter, autor offline/seeder, partição/heal, bloqueio/retirada/lock enquanto o trabalho está suspenso.
- Negativos com controlo positivo do mesmo canal; não interpretar ausência por falta de ligação como autorização correcta. Snapshot em falta e replay têm de falhar pelo motivo observado.
- Aplicação web compilada e worker real; composição/revisão pela UI, não só RPC de fixture. Screenshots/Axe/desenho e todos os engines; regressão dos motores e API partilhada.
- Revisão independente continua pendente enquanto vigorar a restrição do dono a novos/retomados agentes. Auto-revisão não satisfaz esse gate. Apple/dispositivos/rádios permanecem com os estados reais de STATUS.
