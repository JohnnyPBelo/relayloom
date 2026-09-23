# Integração de entrega dos recibos — WIP após f131652

Desenho/roteiro, não entrega implementada. A persistência está em gate 75891; não alterar fontes até ao resultado terminal. O objectivo completo e a execução sequencial mantêm-se.

## Visitante

Acrescentar facto `receipt` à operação de contribuição. A assinatura do dono deve ligar dono do endereço, contributorId local, certificateId, UUID, destino completo e created/expires originais. Exigir `transport.copied === true`: uma proposta meramente preparada/assinada/selada sem handoff não pode ser confirmada. Verificar também prazo/skew do próprio recibo na admissão; a autenticidade histórica do registo guardado não desaparece depois do prazo.

Transição atómica: validar envelope cifrado e recibo; se queued, reler/verificar o stage e removê-lo; guardar receipt e fase received. Se cancelled/expired, conservar esse estado local e acrescentar apenas o facto histórico (não voltar à fila). Cópias idênticas não alteram o journal; outro recibo válido para o mesmo certificado não substitui o primeiro. Uma operação já retirada da janela finita não é recriada por um recibo. Cancelamento depois de received não finge apagar recepção: apresentar o facto e, se a UI permitir, apenas intenção local de não prosseguir, sem prometer recolher cópias.

O runtime remove a operação do mapa permitido e cancela os pacotes próprios/apoios de origem. Não cancela conteúdo de outro originador nem um pacote independente com bytes iguais. Depois de crash, state/phase terminal impede o retorno do envio. O catálogo não expõe a assinatura privada pela RPC.

## Dono

Um processador de recibos percorre apenas intenções duráveis: prepared→signReceipt, signed→sealReceipt, queued→receiptBundle→store.put→get→copyReceipt. Só depois copia para o transporte. O histórico da inbox não precisa de conservar os valores para concluir o recibo. Retry usa o mesmo envelope/ID/timestamp e não recria nonce. Lease da sessão e política actual (bloqueio/retirada/prazo) são revalidadas em cada transmissão e depois dos awaits. Preservar referência da autorização em retries canonicamente iguais; revogação remove-a.

Não usar ACK físico como admissão de recibo. O dono não recebe confirmação de que o recibo chegou nesta fase: retries limitados até ao prazo próprio e seeding sujeito a consentimento/política. O estado mostrado deve ser "recibo preparado/copied" local, nunca "visitante notificado" sem prova adicional.

## Rede e fronteiras

Tipo `site-contribution-receipt` privado, 1–2 leitores, corpo assinado ≤8KiB, TTL próprio ≤30dias. Validar forma/assinatura/ligação à outer manifest para quem pode ler; terceiros validam envelope opaco limitado sem obter chave nem autoria. Integrar type/shape, inspect, receive, history summary, maySeed/own gating em Node/Go/browser e rotas via RTC/WS/TCP/Reticulum existentes. Sessão bloqueada recusa operações próprias e não deixa uma resposta retida escapar. Nenhuma nova porta/serviço obrigatório.

A UI pode depois distinguir fila local, cópia no dispositivo, recepção do dono e decisão/publicação. Formulários só aparecem na paleta quando todo o fluxo de compor/enviar/rever/recusar/aceitar/reconciliar/publicar e proveniência estiver pronto em PT/EN/ES.

## Gates concretos

- Journal Node/portátil/Go: recibo correcto/idempotente, desconhecido, outra assinatura/UUID/certificado/destino, não copiado, recebido depois de cancelamento/expiração e rejeição de renovação/alteração da proposta.
- SQLite/IndexedDB: receipt+cleanup atómicos, crashes/reabertura entre motores, stage corrompido, quotas e perda de resposta.
- Node↔Go TCP com relays pausados: receptor produz intenção automaticamente; ambos os lados reabrem; mesmas assinaturas/envelopes, visitante sai da fila e preserva histórico. Controlos positivos no mesmo canal durante recusas.
- Web↔Node/Go em RTC→WS via terceiro sem leitura, com ligação desligada no instante do recibo e reaberta; autor offline e seeder, cancelamento enquanto autorização está retida.
- Worker compilado/ausência de helpers na RPC, UI real de três contas depois de integrar decisões. Não declarar paridade Apple/radios ou disaster-ready por estes gates.


## Rascunhos ainda fora das fontes

`.cache/receipt-delivery-draft` contém alterações propostas para journals do visitante (TS/Go), catálogos de recepção(Node/Go/browser), políticas de conteúdo e runtime(Node/browser). Não foram typechecked, compiladas ou executadas; não copiar toda a pasta cegamente. Rever/instalar em sequência só depois do gate actual. Ainda faltam runtimeGo, wiring de todos os pontos de admissão/seeding/history/worker, testes de fecho de fila e entregareal. Não referir estes rascunhos como funcionalidades ouprovas.

O rascunho inclui também teste TCP cruzado Node↔Go de entrega automática/reinício. Ainda precisa de controlos tardios/negativos, partição e equivalentes browser/worker; não foi executado porque o wiring correspondente não existe nas fontes congeladas.

Rascunhos Go de runtime/inspecção foram também preparados, ainda não compilados. Rever especialmente limpeza dos mapas quando a selagem altera a entrada antes de um erro; não deixar uma autorização antiga sobreviver a falhas. No wiring, recusar explicitamente site-contribution-receipt no caminho genérico publish/prepare em todos os motores, tal como já acontece com propostas. Só o journal pode preparar e emitir este tipo.


## Verificação dirigida em curso

**Handle 13518**, `.cache/receipt-delivery-regression/report.json`: typecheck PASS,46 testes Node de contribuições PASS, regressão de processos nativos em curso. Fonte congelada durante esta execução. Depois recolher resultado e corrigir regressões antes de outro gate. Ainda faltam vectores Go de recepção (os métodos novos compilaram e os catálogos foram testados), falhas/concorrência Node na recepção, controlos adversariais de rede, recibos emcache no browser com política retida, Firefox/WebKit, gate integral e UI de decisões. Os rascunhos .cache/receipt-delivery-draft são históricos; não os copiar sobre as fontes com as correcções actuais.

Falha preservada: .cache/receipt-partition-seeder-first.log. Ambos os envelopes chegaram às caches dos três processos, mas o visitante não marcava recepção; em relaunch, a ligação TCP lembrada podia receber enquanto a identidade ainda estava bloqueada. .cache/receipt-locked-recovery-fixed/network.log tem 4 PASS após recuperar recibos guardados. Não confundir esta falha corrigida com o timeout do importador de fotos iOS ou com o orçamento de 15 min do CI browser.
