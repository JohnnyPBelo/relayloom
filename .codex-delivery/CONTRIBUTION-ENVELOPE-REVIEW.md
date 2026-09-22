# Revisão local — catálogo Go e selagem privada

Revisão do implementador, não independente. O requisito de revisão independente permanece aberto sob a restrição de execução sequencial do proprietário.

## Fronteiras revistas

O journal Go usa o mesmo domínio, campos exactos, limite de 128 resultados/1 MiB e janela contígua que Node/browser. Os 53 vectores comparam resultados completos e recusas, não só contagens. O catálogo revalida a fonte autenticada antes de expirar/remover staging; nunca substitui a página histórica por uma cabeça nova. O formato de stage anterior sem envelope continua aceite. Um envelope presente exige fase signed e certificado correspondente.

A intenção e a assinatura são commits separados. `seal` é um terceiro passo privado; só devolve um ID depois do commit real. Se o processo terminar antes desse commit, nenhum envelope foi entregue ao caller e uma nova tentativa pode criar o primeiro envelope durável. Se o commit existiu e a resposta se perdeu, retoma preserva os bytes exactos. Não prometer recuperar uma cifra que nunca foi guardada.

O envelope exige tipo site-contribution, autor lógico igual ao visitante, leitores exactos visitante+dono (uma identidade quando coincidem), cifra privada (manifest.publicKey=null) e tempos iguais ao certificado. `MatchContributionEnvelope` verifica esse vínculo depois de o motor verificar/desencriptar o envelope; não é autorização de inbox, aprovação ou admissão temporal por si só.

A concessão de publicação não modifica os leitores do transporte. O corpo pode autorizar divulgação pública futura e ainda assim o envelope é privado. `authorizedBundle` revalida política/prazo; state/assinatura/selagem não são estados de entrega. A aplicação ainda não admite/encaminha propostas por um comando de submissão.

## Correcções e provas

Foi reproduzida a expiração durante a política em Node e Go. O relógio capturado antes do callback deixou de ser usado como verificação final; há recusa antes de assinar e validação final actual. O positivo a 1 ms antes do prazo permanece; o instante exacto de expiração é recusado. Browser comprova que não chama sequer o helper de assinatura nesse controlo. Nenhum relógio do sistema foi alterado.

O teste concorrente mantém o writer Go numa transacção ainda não commitada, inicia Node e confirma ausência do resultado enquanto o lock está retido. Depois ambos recuperam o mesmo envelope, sem segundo contador. Crash/reopen foram exercitados em seis fronteiras Go, além dos controlos Node existentes; corrupção não cria um nonce de substituição. No browser o teste regista explicitamente zero tentativas de regeneração, para que um helper deliberadamente bloqueado não mascare uma tentativa indevida.

Os novos métodos do perfil continuam fora da whitelist RPC. O teste de worker foi ampliado para cinco recusas; a primeira falha era apenas a expectativa antiga de três. Também foi preservado o driver inicial que transformava clock negativo em 0 e o primeiro controlo Go com handle de outro TTL; as reproduções definitivas corrigiram essas fixtures antes de alterar produto.

## Gate e limites

Gate 6285 terminou 0: 500 Node, 18 testes de processos, builds e 21 percursos afectados por browser (63 execuções). Go core/sites-race passou na mesma fonte.706 hashes de fontes antes/depois coincidem. Provas em docs/evidence/site-contributions/envelopes; não somar subsets/repetições como novos cenários. O helper createBundleAt foi acrescentado sem alterar o relógio normal da função existente; histórico não é admitido como conteúdo vivo depois do prazo.

Ainda faltam cópia transaccional para transporte/outbox/inbox, recibos, aprovação/reconciliação/CAS, proveniência e UI completa. Pausa/cancelamento futura terá de retirar pacotes retidos usando a ligação durável envelope↔operação, inclusive depois de expirar o stage. Não expor source/context/ACL do cliente. Próxima implementação em CONTRIBUTION-SUBMISSION-INTEGRATION.md. Publicação, todos os SO/meios físicos, Apple, grupos web, recuperação/rotação/keystore e revisão independente continuam no contrato integral.
