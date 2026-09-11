# RelayLoom

Conversas, comunidade e páginas pessoais numa rede entre pares. **Aplicação experimental em implementação. Não é infraestrutura validada para catástrofes e não substitui serviços de emergência.** O contrato completo continua em [PROJECT-BRIEF.md](PROJECT-BRIEF.md); o estado real, incluindo lacunas, está em [docs/STATUS.md](docs/STATUS.md).

O código executa um nó persistente por instalação, uma interface React servida por esse nó, TCP entre processos e um adaptador série. Não há serviço central obrigatório, telemetria, fontes remotas ou CDN de execução. A interface começa vazia: mensagens, pares e contadores vêm de operações reais.

## Arrancar em Linux (Node.js 22.12+)

```sh
npm ci --ignore-scripts
npm run build
npm run dev -- --data .runtime/alice --http-port 4173
```

Abra o URL completo impresso no arranque. O fragmento contém uma capacidade aleatória que autentica a interface local; não partilhe este URL. A API escuta exclusivamente em `127.0.0.1`. O ficheiro `.runtime/alice/runtime.json` contém os dados do processo e tem permissões privadas. Dados de execução, cofres e caches são ignorados pelo Git.

Crie a identidade com uma frase-passe de pelo menos 12 caracteres. Abra outro terminal:

```sh
npm run dev -- --data .runtime/bruno --http-port 4174
```

Crie a segunda identidade. Em **Definições**, copie o cartão público de cada pessoa; no outro cliente escolha **Adicionar contacto**. Em **A rede → Ligar um par**, use `127.0.0.1` e a **porta TCP de transporte** impressa pelo outro nó (não a porta HTTP). Crie uma conversa e envie uma mensagem. O conteúdo fica cifrado em disco e é transportado por sockets reais.

Para uma rede local entre máquinas, escolha explicitamente `--tcp-host 0.0.0.0 --tcp-port 4242` e troque o endereço IP por um canal de confiança. Só o transporte de objectos assinados é exposto; a API continua local e autenticada. Não altere firewalls nem encaminhamento de portas automaticamente. Sem um caminho alcançável, não há entrega. O arranque recusa executar se houver menos de 15 GiB livres neste ambiente.

## Verificar

```sh
npm run build
npm test
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium
npm run test:e2e
```

`npm test` inclui criptografia/armazenamento, API, processos TCP e três processos TCP → série através de dois PTYs reais do sistema. Os testes PTY são omitidos no Windows. **PTY não equivale a rádio físico.** O teste de isolamento desactiva o ouvinte TCP de C, verifica as ligações configuradas e prova que C não recebe durante uma partição nem com B sem retransmissão. Ao recuperar, C recebe os bytes exactos; com A terminado, B serve um objecto que C ainda não tinha.

A pasta `docs/evidence` guarda relatórios e imagens de execuções reais; os dados de teste são fictícios, criados pelas fixtures. Uma configuração CI não prova que um job correu: resultados efectivamente observados constam de STATUS.

## Segurança e limites actuais

- Ed25519 assina identidades e manifestos; X25519/HKDF/AES-256-GCM embrulha chaves de leitura por destinatário. O leitor pode semear o objecto exacto, mas não mudar a autoria. Cofres usam scrypt + AES-GCM.
- Não é o protocolo Signal: ainda não há double ratchet nem forward secrecy. Não existe auditoria criptográfica externa. A revisão independente dos agentes é uma revisão de engenharia.
- Conteúdos públicos expõem explicitamente a chave de leitura. Privados continuam cifrados em nós retransmissores. Endereços, tamanhos, tempos e padrões de tráfego não são anónimos.
- Apagar publica uma decisão assinada e conserva a decisão local autenticada. Não pode apagar cópias detidas por outros pares. Disponibilidade depende de cache, quotas, expiração e seeders ligados.
- Grupos têm membros fixos por grupo neste marco; rotação/revogação e mudanças de membros não estão concluídas. Máximo 64 destinatários, 4 MiB por objecto, quatro anexos por mensagem e 2 MB por anexo na interface.
- O editor usa apenas blocos declarativos; links externos são HTTPS e não são incorporados. Rascunhos podem ser guardados localmente com cifra.
- Linux é o ambiente de execução observado. Windows/macOS têm código e jobs CI, ainda sem evidência de execução. Android/iOS nativos, keychains, assinatura Apple, notificações e rádios físicos permanecem por implementar ou verificar. Um browser móvel não é um nó móvel nativo em segundo plano.

Arquitectura e ameaças: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Tarefas reais e revisões: [docs/AGENTS.md](docs/AGENTS.md). Plano de continuidade: [.codex-delivery/implementation-plan.md](.codex-delivery/implementation-plan.md).
