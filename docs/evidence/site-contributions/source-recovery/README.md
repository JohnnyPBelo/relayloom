# Recuperação da origem de uma proposta

Código **593459a/16c5963**. O gate identifica **733 ficheiros de fonte**, com hashes iguais antes/depois e conferidos contra o commit. A alteração posterior do observador iOS tem testes separados e não pertence a este gate.

## Resultados

**516 testes Node, 17 pacotes Go/race, 74 testes entre processos e 78 percursos em cada browser** passaram, além de typecheck e builds. Pacotes Go inalterados podem reutilizar cache; os logs distinguem execução de cache. Os três relatórios browser não têm falhas/skips/flaky. Comandos, tempos, ambiente e fontes estão em `gate.json`; `run-gate.mjs` reproduz as fases e recusa sobrepor provas ou começar abaixo de15GiB livres.

O dono pede a origem usando o ID de uma candidata, através de `contribution-command/obtain-source`. O motor deriva o snapshotId da prova guardada e revalida política/prazo. IDs desconhecidos e campos de autoridade fornecidos pelo cliente são recusados. O resultado waiting/requested descreve um pedido local, não a chegada de dados nem uma aprovação.

O visitante só serve a cópia privada se uma proposta própria queued/copied e ainda permitida a referenciar. Não há leitura genérica do armazenamento privado, nova assinatura ou nova audiência. Os bytes, ID e autor do snapshot permanecem originais; a resposta usa os adaptadores existentes e prioridade bulk. Pode apoiar o envio próprio com relay para terceiros pausado.

As respostas são ligadas a operação e pacote local. Cancelar por ID preserva outro pacote com payload igual e pacotes originados por terceiros. O prazo absoluto entra no pacote para incluir o tempo de preparação. O browser tem ainda uma guarda local, fora do wire, revalidada antes de transmitir e durante o envio. Uma consulta retida ou uma validação pendente não pode reactivar uma resposta cancelada. Cópias já recebidas por outros pares não são recolhidas.

## Controlos concretos

- Seis percursos Node↔Go por TCP: recuperar, cancelar e bloquear/desbloquear. As duas caches perderam a origem depois de parar os processos; a fila privada do visitante era a única cópia disponível ao emissor. Ambos os relays estavam pausados. Chegada com bytes/autoria exactos, sem recriar a cache do visitante; post positivo no mesmo canal quando a origem foi recusada.
- Browser com IndexedDB e RTC reais: recuperação e cancelamento durante consulta retida, antes da admissão do pacote e depois de entrar na fila bulk. O canal continuou a entregar tráfego próprio positivo. Os routers também conservaram o pacote de outro originador e o pacote independente com conteúdo igual.
- Worker compilado/RPC: sem lease antes da operação autorizada, autor/UUID/prazo correctos depois de queued/copied, campos extra recusados e ausência após cancelamento; sem chaves privadas nas respostas. Setup/unlock/reload e restante UI existente foram cobertos pela regressão.
- Transporte web↔Node/Go, mensagens, sites/recursos, pausa de relay, partição/heal, seeder com autor offline, corrupção e bibliotecas existentes continuam no gate. São processos e engines de browser, não dispositivos/rádios físicos.

## Falhas de desenvolvimento preservadas

O primeiro patch colocou deadline no callback errado, apanhado pelo typecheck antes de executar. Uma fixture tinha continue fora de loop; corrigida antes dos testes. O primeiro teste de router browser tentou usar o datachannel antes do evento que o cria; passou depois de esperar a existência real do canal, sem alterar prazos do produto. Logs antes/depois em `controls/`.

Ainda faltam recibos assinados, recusa/purga, decisão/aprovação/CAS/reconciliação/proveniência e UI completa de formulários. A recuperação é explícita, não uma promessa de descoberta automática ou disponibilidade universal. Candidatas não verificáveis e pressão de quota continuam a precisar do fluxo de revisão. A paleta e o HTML público permanecem no estado anterior. O contrato integral de plataformas, rádios, recuperação/rotação, grupos web e revisão independente mantém-se.
