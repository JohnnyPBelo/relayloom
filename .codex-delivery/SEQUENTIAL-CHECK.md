# Verificação sequencial temporária — 2026-09-12

Pedido do proprietário: manter Astra/Copilot Ultra, não alterar bridge/providers/autenticação/segurança, não criar nem retomar agentes, deixar tarefas já activas terminar e executar um único teste delimitado. O diagnóstico de timeout Copilot perto de61s foi fornecido pelo proprietário; concorrência continua hipótese, não causa demonstrada.

## Estado no início

A etapa anterior é classificada como **progresso**: implementação e revisões reais,79 testes Node,36 Go app normais/race,22 Go core/transport race,2 cenários mistos e14 percursos UI por núcleo passaram. Dois processos de4 testes de outbox, já lançados antes desta instrução, terminaram com sucesso e não foram reiniciados.

Agentes ainda activos no momento do pedido: `design_review` (Android) e `security_review` (contrato de épocas). Foram informados da restrição; nenhuma nova task ou retoma será feita nesta fase. Os resultados iOS já entregues foram integrados no workflow, mas a execução Apple do novo gate ainda está por observar.

## Teste único escolhido

```sh
node scripts/e2e.mjs tests/e2e/outbox.spec.ts --grep 'durable composer retries a lost response once' --reporter=line --output=.cache/sequential-stability/outbox
```

Âmbito: um percurso browser com processos Node reais, resposta perdida/idempotência, fila sem caminho, restart com relay pausado, recepção versus leitura e feedback/foco no diálogo. Não é teste de todos os sistemas, de hardware ou diagnóstico causal do serviço Copilot.

Estado: **concluído, com sucesso; exactamente uma execução e um teste**. Não repetir esta medição automaticamente.

## Entregas integradas antes do teste

- `design_review` terminou com resposta final real: SAF Android e APK `4de67c3e…` com 80 asserções anteriores no emulador. O checker de prazo posterior tem 28 asserções host, mas precisa de novo APK e gates. Emulador/adb próprios parados; AVD e identidade preservados. Handoff: `docs/evidence/android/documents-4de67c3e/post-apk-source-handoff.json`.
- `security_review` terminou com resposta final real: `docs/GROUP-EPOCHS.md` e 33 casos em `tests/fixtures/group-epochs.json`. São desenho declarativo, **não implementação nem testes executados**. O seu agente de revisão também já estava concluído.
- O runner iOS anteriormente entregue ficou integrado no workflow local; não houve push nem execução Apple nesta medição.
- README, STATUS, plano, rastreabilidade e registo de agentes foram actualizados. A correcção OD-3 do aviso dentro do diálogo ficou distinguida da revisão que a originou.

## Resultado observado

| Medida | Resultado |
| --- | --- |
| Ambiente | Linux, Node v22.22.3, Chromium do projecto com sandbox |
| Início/fim UTC | 2026-09-12 00:49:11.630633 → 00:49:23.740890 |
| Execuções / testes / workers | 1 / 1 / 1 |
| Repetições automáticas | 0 |
| Resultado e saída | `1 passed (11.7s)`, código 0 |
| Duração total do processo supervisionado | 12,108 s |
| Timeout do teste/supervisor | Nenhum |
| Fontes e assets durante a execução | Hashes antes/depois iguais |
| Espaço livre após o teste | 128,63 GiB |

O percurso executou dois clientes Node reais e reiniciou o emissor, com sockets TCP reais. Perdeu deliberadamente a primeira resposta de envio; as duas submissões conservaram o mesmo UUID e apenas um registo. Depois do reinício, preservou o conteúdo original e a preferência de relay pausado; a ligação posterior produziu recepção assinada sem leitura, e a abertura real pelo destinatário avançou para leitura. O feedback de repetição foi verificado dentro do diálogo. As quatro auditorias de acessibilidade deste mesmo teste registaram zero violações nos estados capturados; teclado/foco e viewport móvel também passaram. Root inspeccionou as capturas de foco e móvel, sem lançar outro browser ou teste.

Hash das fontes de produção: `66a18d61cc0a63b0bf30195462c2515912b333614d95dd69f1d503db409f830e`. Os hashes individuais dos inputs e assets estão em [result.json](../docs/evidence/sequential-stability/2026-09-12/result.json); a saída exacta está em [output.txt](../docs/evidence/sequential-stability/2026-09-12/output.txt). Capturas e relatórios desta execução foram preservados no mesmo directório. O marcador local `.cache/sequential-stability/attempt.json` impede uma repetição inadvertida pelo supervisor usado nesta fase.

Não foi observado novo erro Copilot 408 por root nem relatado pelos agentes durante esta etapa. Isto é uma observação da sessão, não telemetria do provider nem prova de que concorrência explique os erros anteriores. O aviso de variáveis de cor do Node presente na saída não é um timeout. As esperas normais por mensagens de agentes também não são erros upstream.

## Continuidade

Nenhum agente foi criado, retomado ou interrompido; nenhum provider, autenticação, bridge ou configuração de segurança foi alterado. Nenhum outro teste, build ou push/CI foi iniciado nesta medição. HEAD/origin permanecem em `c3f5b42`; trabalho posterior permanece nos ficheiros locais, sem reset/clean.

O contrato completo continua activo e incompleto. Próxima fase: consolidar os marcos verificados; compilar e testar o APK exacto com o checker/interface finais; observar o novo gate iOS em Apple; implementar grupos dinâmicos, armazenamento nativo de chaves/rotação, pesquisa integral e extensões de perfil/social. Hardware Apple, assinatura e rádios continuam lacunas explícitas. Esta conclusão diz respeito apenas à medição sequencial.
