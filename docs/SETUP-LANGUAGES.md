# Primeiro arranque e idiomas

Esta funcionalidade já foi publicada na web. Os assetsHTTP foram conferidos; a execução final de10percursosUI noHTTPS passou, mantendo documentadas as falhas anteriores. O produto completo continua experimental e por concluir.

## Entrar na rede

O primeiro ecrã apresenta o produto e permite escolher português europeu, inglês ou espanhol. O idioma guardado tem prioridade; na sua ausência, é usada uma língua suportada das preferências do dispositivo. O botão **Começar** abre a configuração da identidade.

Escolha o nome apresentado, uma frase-passe de 12 a 1024 caracteres e a aparência inicial. Pode voltar à apresentação ou mudar a língua sem perder os campos que está a preencher. A frase-passe não é guardada nas preferências de interface. Se recarregar antes de criar a identidade, os campos privados ficam vazios.

A identidade é local: não há inscrição obrigatória num servidor. O cofre exportado permite recuperar as chaves com a respectiva frase-passe. **O cofre não constitui uma cópia completa do histórico de mensagens.** A cópia integral dos dados permanece no âmbito pendente.

## Contactos e ligações

Um cartão público identifica uma pessoa; não cria um caminho de comunicação. Depois de criar a identidade, em **A rede → Ligar um par**, troque o código e a resposta entre dispositivos, ou use os adaptadores compatíveis da aplicação instalada. Aguarde a confirmação nos dois lados.

Sem caminho, a mensagem fica guardada em espera. A escolha do destinatário é independente do meio usado no percurso. A retransmissão e o consumo de recursos podem ser configurados em **A rede** e **Definições**. Continuam necessários pares alcançáveis e permissões/capacidades efectivas do sistema.

## Idioma e aparência

Pode mudar a língua em **Definições**. Isso altera os controlos e mensagens da interface; nomes de pessoas, conversas e conteúdo escrito nos sites mantêm o texto original. Os modelos novos do editor são criados na língua escolhida naquele momento, e não são retraduzidos depois de editados ou publicados.

Na web, as preferências usam o armazenamento local do navegador. Nas aplicações com Node/Go, são guardadas no perfil local, para sobreviver a um novo endereço de loopback após reiniciar o processo. Este armazenamento contém apenas idioma, tema, efeitos de vidro, tamanho de leitura e contraste: não contém chaves, não desbloqueia a identidade e não altera a autorização de retransmissão.

Uma falha ao guardar preferências é apresentada na interface. A escolha continua a funcionar na sessão; **Tentar guardar as preferências** permite repetir a operação. Um erro no ficheiro de preferências não reinicializa o perfil nem apaga mensagens. Nos testes, a recuperação da identidade é comparada por todos os campos do cartão, independentemente da ordem das propriedades JSON.

## Verificação e limites

Os testes dirigidos locais exercitaram criação de identidades, mudança de língua, campos conservados, mensagens e anexos entre interfaces em inglês/espanhol, grupos com aprovação, sites com três leitores e autora offline, falhas de persistência, respostas perdidas e reinício Node/Go numa porta HTTP diferente.

O gate completo está em `scripts/verify-onboarding-languages.mjs`; o estado corrente fica em `.cache/onboarding-i18n/final/report.json`. Um relatório RUNNING não é um passe. A validação móvel é adicional: testes do runner iOS no host não executam a aplicação em iOS. Diálogos do sistema seguem as suas próprias preferências de idioma, os textos nativos Android foram exercitados no emulador; a implementação iOS está preparada, mas ainda requer compilação/execução Apple. As descrições dos pedidos do sistema no Info.plist iOS ainda estão em português.

A execução nova iOS dos testes móveis adaptados, rádios físicos, assinatura Apple, revisão independente e o restante contrato em PROJECT-BRIEF.md continuam obrigatórios. Não há afirmação de perfeição, prontidão para catástrofes ou validação em todos os dispositivos.

O gate completo terminou PASS e o Android actualizado passou mensagens, documentos, prazo, relay e verificação do perfil cifrado. [Comandos, hashes, capturas e limites exactos](evidence/onboarding-languages). A versão pública usa a fonte02188da; [a verificação HTTPS e os seus bloqueios](evidence/onboarding-languages/live) estão documentados.
