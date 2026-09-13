# Eventos de grupo — integração activa

Base93f24f1, árvore limpa confirmada,99GiB livres. O turno anterior foi progresso: UI implementada, gates reais e push confirmado. CI34760224339 observado em curso; não é passe. Recuperação sequencial sem novos/retomados agentes; Astra/Copilot Ultra e restantes restrições intactos.

## Semântica a implementar

- `publish` autenticado recebe edit/reaction/comment com binding target e head actual exacto. Deriva cartões da intersecção snapshot actual/leitores originais a partir de bytes verificados e admissão local. Recusa público, leitor novo, membros/cartões injectados, alvo errado, head antigo e bloqueios. Só o autor edita. Comentário/reacção exigem conteúdo permitido e não acrescentam campos sem semântica.
- Delete usa apenas a forma histórica mínima já especificada pelo acesso: type,target,conversation,targetEpoch,groupAudience=historical. Apenas autor original, audiência original exacta. Pode ocorrer após close/leave/removal com prova histórica válida; não reabre autorização para texto/edição/reacção novos.
- Criação/verificação/decifração local e admissão em transacção antes de Store/rede. Nunca aceitar resumo/contexto HTTP como autoridade. Não apresentar a operação como outbox com confirmação por destinatário; eventos retidos propagam por inventário como publicações, sujeitos a disponibilidade/quota/TTL. Confirmações de entrega continuam específicas de mensagens.
- Eventos novos locais retidos/na fila ficam sujeitos a autoridade actual em inventário/request e no cancelamento após alterações de grupo/lock/erro de persistência. A supressão deve alcançar payloads na fila cujo ficheiro já desapareceu. Cópias de outros leitores continuam seeders; histórico mínimo não é texto novo. Não prometer recolha de bytes já enviados.
- Edições/eliminações materializam através do percurso de admissão existente, preservando tombstones após evicção. Não alargar autoria por posse de chaves de leitura.

## Gates obrigatórios

Node/Go e percursos mistos por APIs/TCP reais, sem contactos globais; reacção/comentário/edição/eliminação e persistência. Acesso indevido, assinante não autor, novas chaves, cabeça antiga, provas/bytes ausentes, rollback/perda de resposta/corrupção e bloqueios. Alterações de membros/close separam evento novo e deleção histórica; cancelamento/seed em partição com controlos TCP positivos e seeder original offline. Gate completo dos núcleos/race/SQLite/interoperabilidade/UI/desktop após integração. Flags de produto mantêm a incompletude até carriers e UI dinâmica.


## Código e primeiros controlos

Helpers Node/Go e publish ligado; objectos edit/reaction/comment são semeados pelo autor só com admissão e autoridade actual, e removidos das filas locais quando deixam de ser autorizados. Delete histórico usa assinatura/audiência original. Primeiro Node real passou7.953s e três percursos mistos17.018s; scripts/CLI compilaram e teste Go legado0.634s passou. Não representam gate completo: controlos de falhas, corrupção, partições/seed e race ainda pendentes. Actualização de bloqueio/cancelamento posterior por verificar. Nenhum commit desta fase ainda.


## Verificação dirigida concluída e gate integral

Node8 falhas/fences passaram35.717s; ausência de prova antiga6.062s; corrupção do evento5.323s após corrigir a fixture para esperar o rate limit real de1s. A falha inicial da fixture está preservada; não se alterou o limite de produção. Go3 testes de topo/8 cenários com race58.407s passaram; o primeiro controlo evicted esperava err=nil apesar de conteúdo ausente, corrigido para exigir erro e denied. Go erro físico de índice/recuperação exacta por TCP passou7.347s com race. Cinco percursos mistos de eventos/seeding/removal/restart passaram46.618s; Node3 nós estendido passou19.088s. Novo leitor não decifra bytes antigos, removido não decifra edição nova mas recebe deleção histórica.

A última verificação TS encontrou apenas spread de união de tuplos na fixture mista; corrigido para argumentos explícitos. Typecheck corrigido passou. Novo gate completo foi iniciado por `python3 .cache/group-events-final/run.py`, com fontes congeladas; ler report.json e handle em RESUME. Inclui todos os testes Node, Go/race count=1, SQLite C com novos TestGroupEvent, interoperabilidade e19 UI por núcleo. Só depois executar desktop.py. Sem commit ainda; não modificar fontes até o gate terminar.


Gate20449: build8.606s,22 host iOS2.314s,estática0.041s e236 Node270.775s passaram. Go/race continua em execução. O CI do Glass terminou com Node3OS/Go/3desktop passados e iOS falhado no helper dismissKeyboard antes de submit; foto3.101s passou e a nova captura de falha foi revista. Artefactos docs/evidence/ios/93f24f1. Não alterar fontes para esse ajuste antes de concluir o gate corrente.


O primeiro Go completo terminou595.160s com uma única falha de desempenho em TestOutboxWarmStateDoesNotRehydrateReservedAttachment: duplicação de Store.List no caminho novo. Fonte corrigida para reutilizar os manifestos verificados da mesma consulta; Go passa a reconciliar eventos mesmo quando a outbox de mensagens está vazia. Memória original6.887s passou, e o conjunto de TestGroupEvent+memória (incluindo corrupção/outbox vazia) passou78.718s com race. Novo gate integral iniciado, fontes novamente congeladas; .cache/group-events-final/report.json é autoritativo.


## Gate final concluído

83716 terminou0; desktop48666 terminou0. Build5.580s,236Node291.635s,153Go de topo/race621.017s,38interop378.001s,SQLiteC207.489s,19UI Node134.686s/19Go133.737s;22host iOS1.975s/estática0.029s. Desktop0.208s/1.878s/4.889s/0.876s.300 fontes inalteradas,56Axe únicos arquivados sem violações. docs/evidence/group-events/final e failures preservam resultados/limites. Nenhum teste em curso; publicar marco coerente, depois ajustar XCTest nativo conforme evidência93f24f1 e continuar carriers/UI dinâmica/contrato.
