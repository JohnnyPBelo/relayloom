# Progresso de controlo durante a recepção

Quando uma gravação lenta mantinha o callback da aplicação pendente, as confirmações da direcção inversa e a presença esperavam pela mesma fila. A ligação podia encerrar apesar de ainda haver comunicação. ACK/ping/pong pequenos passam agora por processamento separado e limitado; payloads e cancelamentos mantêm a ordem. A confirmação de dados continua a exigir a aceitação completa da aplicação, incluindo a gravação. A validação de esquema/frequência mantém-se e há no máximo 64 controlos pendentes. Os prazos de transporte e presença não foram aumentados.

A descodificação base64 usa um buffer pré-alocado, conservando limite, gramática e re-encoding canónico. Isto reduz o trabalho temporário ao ler páginas cifradas grandes; não altera os formatos nem as primitivas criptográficas.

## Prova isolada

A candidata parte de `1efe643306fb8153f4d0c990397285a2c050884c` e altera apenas dois ficheiros de produção e quatro ficheiros de teste. Build/typecheck e 36 casos passaram: seis controlos/base64 em cada um dos três motores Linux, 16 casos de fundamento/encaminhamento com interoperabilidade Node/Go e duas jornadas da aplicação. Quatro auditorias Axe não encontraram violações. Os 753 inputs mantiveram os hashes e 463 versões instaladas coincidiram com o lock. [Comandos, contagens e hashes](evidence/rtc-control-progress.json).

Os controlos incluem aceitação suspensa durante 8,5 s sem ACK antecipado, ACK inverso/presença, mensagens malformadas, floods, backpressure limitado, falha de armazenamento, corrupção, partição/heal e seeder com autor offline. O limite de controlos pendentes usa um modelo explícito de stream; as ligações WebRTC e os processos de interoperabilidade são reais.

Reprodução a partir deste commit, com as dependências e browsers do projecto preparados:

```sh
npm_config_cache="$PWD/.cache/npm" npm run build
node scripts/e2e.mjs --config tests/browser/browser.config.ts tests/browser/rtc-control-progress.spec.ts tests/browser/crypto-decoding.spec.ts --browser=chromium
# Repetir a linha anterior com --browser=firefox e --browser=webkit.
GOFLAGS=-p=1 node scripts/e2e.mjs --config tests/browser/browser.config.ts tests/browser/foundation.spec.ts tests/browser/routing.spec.ts --browser=chromium
node scripts/e2e.mjs --config tests/browser/browser.config.ts tests/browser/application.spec.ts --browser=chromium --grep 'owns identity|cached application code'
```

Um gate pesado de cada vez, temporários/cache no projecto e pelo menos 15 GiB livres. A prova usou Node 22.22.3 e Go 1.26.8; a configuração da candidata limitou a compilação Go a um processo. Nenhum GitHub Actions foi usado.

Este marco não publica a GUI/preparação offline nova nem o sincronizador de grupos em desenvolvimento. Não é teste de Bluetooth físico, iPhone, todos os SO, revisão independente ou conclusão do produto. O contrato integral permanece activo.
