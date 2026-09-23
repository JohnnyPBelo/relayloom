# Entrega privada de recibos — incremento verificado

Fonte **426b471b72b0f8ca6ec3f42ce9a1fdf03a73e05b**. Os motores Node/Go/browser emitem o recibo guardado pelo dono e o visitante valida a assinatura e a ligação exacta à sua intenção previamente copiada. Guardar o facto e remover o payload privado partilham o commit. Received fecha a fila; cancelled/expired conservam o seu estado e acrescentam apenas recepção histórica. Nenhum recibo autoriza publicação de dados ou renova a concessão original.

## Execução

Reprodução integral num checkout limpo: `node docs/evidence/site-contributions/receipt-delivery/before-fixture-review/run-gate.mjs`, num checkout desta fonte com dependências do projecto e pelo menos 15 GiB livres. O script verifica a reserva e os hashes em cada fase, corre um build/teste pesado de cada vez e não substitui relatórios anteriores. O driver de revisão na raiz documenta a execução posterior e requer o relatório/cache do primeiro gate; não é uma nova execução dos testes Node/Go herdados.

- **531 testes Node**, zero falhas/skips; inclui 39 vectores de admissão Node/portátil/Go (11 aceites/28 recusados), corrupção/vínculos/prazos e janela realmente retirada após 129 operações.
- **17 pacotes Go/race** PASS. Consultar logs para distinguir execução nova de cache. Os helpers condicionais são executados pelos drivers; não se inferem passes de um helper saltado.
- **135 testes entre processos** PASS. Incluem falhas antes/depois do commit em ambos os motores, escritores concorrentes sobre a mesma SQLite, preservação de outra preparação, propostas não copiadas, recibos tardios e seeder opaco com o dono parado/socketECONNREFUSED. Bytes/audiência/autoria permanecem exactos.
- **110 Chromium / 110 Firefox / 110 WebKit** PASS; zero falhas/skips/flaky nos relatórios finais. Web↔Node/Go por RTC→WS via intermediário sem chave, worker compilado, recuperação, autoridade retida, quota/rotação, canais válidos e regressão existente. Isto não é Safari/iOS físico.
- Typecheck e builds nativo/web PASS. 757 hashes antes/depois iguais e conferidos contra o commit.

## Revisão das fixtures

O primeiro gate terminou FAIL em duas fixtures WebKit, depois de 531 Node/17 Go/135 processos e110Chromium/110Firefox PASS. Uma tentava cancelar uma operação que a recepção automática já tornara terminal; a outra pressupunha que a cache não podia ter um recibo próprio fixado. O teste agora confirma o recibo e a impossibilidade de reactivar/cancelar esse resultado; conserva também cancelamento antes de uma emissão atrasada. O teste de cache fecha o runtime, remove as cópias da página/proposta e conserva outros pins, incluindo um recibo, verificando explicitamente que a origem já não está na cache normal. O teste privado continua a recuperar a proposta com o visitante offline.

Só `tests/browser/site-contribution-send.spec.ts` mudou após o primeiro gate. O original foi reconstruído e conferido contra o hash registado, e está em before-fixture-review. Os passes Node/Go/build/processos conservam a proveniência desse gate; os três browsers foram repetidos integralmente. O primeiro relatório permanece FAIL. Uma verificação intermédia ainda tinha a asserção antiga de cache vazia, corrigida para a ausência exacta de origem/proposta e preservação de recibos.

## Controlos e defeitos corrigidos

Um recibo chegado enquanto o visitante estava bloqueado podia ficar na cache sem ser aplicado após unlock. O teste partição/seeder reproduziu a falha; recuperação limitada a 32 candidatos por ciclo corrige-a. No browser, o filtro de tamanho evita varrer media grandes. A preparação de recibos do dono roda lotes de 8, cobrando também falhas reais de quota e preservando os envelopes pendentes.

Um recibo autêntico sem operação local fechava RTC. O controlo real falhou antes e passou depois: recusa específica de vínculo local é consumida sem cache/admissão e sem fechar o canal. Assinaturas corrompidas, registo privado adulterado e erro comum com o mesmo texto continuam a propagar-se. O ACK do frame não é admissão do recibo nem aprovação da proposta.

Os negativos de rede cobrem envelope público/leitores extra/autor trocado, assinatura interior/exterior, certificado/UUID/dono diferentes, tempos alterados, campo extra, tamanho e ciphertext. Cada recusa tem tráfego positivo no mesmo canal. Um envelope sem chave pode ser cacheado opacamente, mas não confirma uma operação.

Falhas de fixture/driver são separadas: função do relógio capturada antes da simulação; engine omitido numa invocação, corrigida só essa fase; guard TypeScript após filter; patch de teste recusado antes de alterar fonte. Os logs anteriores/finais estão em controls. As compilações de aquecimento após limpeza de cache não são contadas como testes.

## Limites preservados

Revisão própria não é revisão independente. Aprovação/recusa assinada, CAS/reconciliação/proveniência e a UI completa de formulários com três contas continuam obrigatórias. A paleta e o HTML público mantêm a fronteira anterior até aos seus gates. Grupos web, backup/rotação/keystore, plataformas/rádios físicos e Apple/signing não foram concluídos por este incremento.

A recuperação de disco removeu apenas caches/executáveis de teste regeneráveis e uma cópia unpacked, preservando fontes, relatórios, perfis, AVD e instaladores. A sparsificação do system.img do SDK preservou tamanho lógico/SHA256; dados do AVD não foram alterados. Auditorias em resource-reserve. Não se alteraram modelos, bridges, permissões ou serviços.
