# Isolamento de cópias locais corrompidas

Uma cópia danificada em disco podia interromper um pedido com vários identificadores. O seeder Node ou Go deixava também de responder aos conteúdos saudáveis seguintes. O problema foi reproduzido com processos reais e TCP: antes do dano, ambas as respostas chegavam; depois, nenhuma chegava. O teste mantém o processo activo para não confundir esta situação com a limpeza do índice feita no arranque.

O ramo de leitura exacta passa a ignorar apenas a cópia cuja leitura verificada falhou e continua para o identificador seguinte. O orçamento existente mantém-se, assim como a autorização e a verificação de integridade de cada resposta. O conteúdo danificado continua indisponível; os restantes podem ser entregues. Browser e ramo de descoberta já tinham esse isolamento.

## Provas deste marco

A candidata foi criada a partir de `b993ea12b52a105d1a1c45ad6366d44c51a504b7`, separada do WIP de páginas. O negativo também foi repetido nessa fonte base, com controlos positivos antes da corrupção. Depois da correcção passaram:

- Typecheck, build web e compilação Go.
- Os dois controlos de corrupção Node/Go, sem alterar prazos ou permissões.
- 35 testes de integridade, armazenamento, páginas e transporte.
- `go test -race -count=1 -p=1 ./core ./transport ./webpeer ./app`.
- Sete percursos UI por motor Node/Go: identidades, mensagens, anexos, grupos, social, páginas, recursos, outbox e recuperação nos cenários especificados.
- Quatro percursos de interoperabilidade por Chromium/Firefox/WebKit: RTC/WS com Node/Go, rota RTC/WS/TCP/série PTY com partição/heal e seeder reiniciado, e ACK atrasado.

[Relatórios, comandos, durações e hashes](evidence/corruption-isolation/verification.json). As execuções usam contas sintéticas e browsers/processos Linux. Não são execução em todos os SO, rádio físico, Safari/iOS ou revisão independente. O produto permanece incompleto e todo o PROJECT-BRIEF continua obrigatório.

A distribuição web pública continua com fonte b993ea1/distribuição67da3c3c; este marco corrige os motores Node/Go. As novas funções locais de páginas e o polimento posterior dos diálogos pertencem a marcos separados. O último CI de produto b993ea1 teve16jobs passados e falha na preparação da fotografia iOS; esta fonte precisa do seu próprio resultado CI, sem herdar aquele passe parcial.
