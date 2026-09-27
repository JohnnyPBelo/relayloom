# Fila local de recuperação

Este marco adiciona `BrowserGroupRecovery` e sete controlos determinísticos. O componente organiza trabalho local pendente sem guardar decisões de autorização. A integração na aplicação e na interface permanece separada; este commit não activa grupos na versão web publicada.

A fila limita-se a 1152 referências, processa lotes de duas e mantém apenas uma operação em curso. Falhas usam intervalos de 2 a 30 segundos. As referências que falham passam para o fim da fila, para permitir avanço das seguintes. Uma leitura incompleta não permite usar a lista anterior. Fechar a sessão cancela trabalho agendado e impede a utilização de uma leitura tardia.

Depois de uma leitura completa sem trabalho, mudanças apenas de controlo não voltam a ler todas as páginas protegidas. O chamador tem de invocar `wake()` depois de confirmar novos dados. Trabalho pendente continua a reagir a alterações de autoridade; uma notificação recebida durante uma leitura em curso é preservada.

O chamador fornece `ready`, `authorityRevision`, `scan` e `recover`. Cada tentativa de `recover` tem de verificar novamente os bytes, a autoridade actual e a sessão. A fila guarda identificadores e prazos, nunca uma autorização ou capacidade de escrita. Deve existir uma instância por sessão desbloqueada, encerrada ao bloquear o perfil. Controlos de rede, deduplicação e limites de origem continuam a pertencer ao transporte e à aplicação.

## Validação desta versão

Foi criada uma candidata isolada sobre `b38c829`, com dependências do lockfile original, sem novas dependências e sem scripts de instalação. Passaram:

```sh
npm run build
node --import tsx --test tests/browser-group-recovery.test.ts
```

Os sete modelos usam relógio virtual. Cobrem coalescência, concorrência, progresso perante falhas, encerramento de sessão, limites, dados inválidos, erros de leitura e chegada concorrente de trabalho. Não são uma prova de criptografia, interface, rádio ou execução noutros sistemas operativos.

[Comandos, resultados e hashes](evidence/group-recovery-scheduler.json). Não foram usados GitHub Actions. O produto completo continua em desenvolvimento.
