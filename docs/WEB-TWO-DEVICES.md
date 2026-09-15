# Testar RelayLoom em dois dispositivos

A versão web experimental está disponível em **https://johnnypbelo.github.io/relayloom/browser/index.html**. A publicação e a verificação HTTPS estão registadas em [STATUS](STATUS.md) e [evidência de lançamento](evidence/web-launch). A aplicação está em desenvolvimento; toda a paridade com as aplicações instaladas continua obrigatória.

## Preparar

Use dois dispositivos na mesma rede Wi-Fi/LAN, com um browser actual, e mantenha ambos os separadores abertos. Uma rede de convidados pode impedir a comunicação directa entre dispositivos. Não é necessário instalar a aplicação ou a PWA.

1. Abra o endereço em ambos os dispositivos e crie **duas identidades diferentes**, por exemplo Alice e Bruno. Cada uma tem a sua frase-passe e cofre local.
2. Em cada dispositivo, abra **Definições → Copiar cartão público**. Troque os cartões por um canal em que confie.
3. Em **Conversas → Adicionar contacto**, cole o cartão da outra pessoa e escolha **Verificar e adicionar**. Faça isto nos dois lados. O cartão é público; não partilhe a frase-passe nem o ficheiro de recuperação do cofre.

## Ligar os dois

1. No primeiro dispositivo: **A rede → Ligar um par → Criar código de ligação**. Copie o código completo e passe-o ao segundo dispositivo. Mantenha este diálogo aberto.
2. No segundo: **A rede → Ligar um par → Receber código**. Cole o código, escolha **Criar resposta** e devolva a resposta completa ao primeiro.
3. No primeiro: cole em **Resposta do outro dispositivo** e escolha **Concluir ligação**. Aguarde **Ligação estabelecida. Já podem trocar conteúdo.**

Não feche nem recarregue os separadores durante a troca. Os códigos estabelecem uma ligação desta sessão; não adicionam contactos nem dão acesso ao cofre. Se a ligação se perder após fechar ou suspender um browser, será necessário estabelecer um novo caminho.

## Experimentar a aplicação

Em **Conversas → Nova conversa**, escolha a outra pessoa e envie uma mensagem. Responda do segundo dispositivo e experimente um ficheiro pequeno pelo botão de anexar (até 2 MB na UI). O estado distingue **Em espera**, **Entregue** e **Lida**; a página estar aberta na Internet não prova que exista um caminho entre os pares.

Em **A praça**, publique uma história e veja-a no outro dispositivo. Em **A minha página**, edite os blocos, guarde o rascunho e publique. Conteúdo privado só é legível pelas identidades autorizadas; quem o guarda pode semear a cópia, mas não ganha a chave de autoria.

Depois de consultar uma conversa, feche o emissor e volte a abrir a página no receptor sem rede. Se os ficheiros da aplicação já estiverem em cache e o browser conservar o armazenamento, deve poder desbloquear o perfil e ler o conteúdo guardado. Novo conteúdo só chegará quando voltar a existir um caminho. A cache offline não substitui um backup.

## Se não ligar

Confirme que os códigos pertencem à mesma tentativa, estão completos e os dois separadores continuam abertos. Experimente uma LAN que permita comunicação entre clientes. Não desactive a segurança do browser, não ignore certificados e não abra portas de controlo da app.

A versão actual usa caminhos WebRTC locais e convites para a app instalada no mesmo dispositivo; ainda não tem sinalização automática nem configuração STUN/TURN para atravessar redes arbitrárias. O encaminhamento através de pares e Reticulum já foi testado, mas depende de existir um caminho compatível. O utilizador escolhe o destinatário; o meio não é escolhido em cada envio.

GitHub Pages serve apenas os ficheiros estáticos da aplicação. Não recebe mensagens, cofres, cartões ou códigos de ligação através de um backend RelayLoom. O fornecedor do alojamento recebe os pedidos HTTP normais de distribuição; a origem que fornece código continua a fazer parte da fronteira de confiança. O perfil é local ao dispositivo/browser e à origem; separadores na mesma origem partilham o perfil. A cache do código é separada por caminho, sem alegar isolamento criptográfico entre sites da mesma origem.

Os testes automatizados usam processos reais no mesmo Linux. **Não equivalem a testar dois telemóveis físicos, Safari/iOS ou rádios.** A confirmação nesses dispositivos continua pendente.

## Reproduzir e publicar

```sh
npm run web:build
npm run web:verify
node scripts/publish-web.mjs
# Publicação explícita dos mesmos ficheiros verificados:
npm run web:publish
```

O último comando publica apenas a distribuição estática em `codex/web-pages`, por um push normal, e configura inicialmente Pages apenas neste repositório. Nunca copia a árvore de trabalho, os dados de execução ou chaves. Recusa fontes/artefactos que mudaram depois do gate e uma configuração Pages preexistente diferente. O plano e o resultado ficam em `.cache/public-web/deployment.json`.

Verificação do endereço publicado:

```sh
RELAYLOOM_LAUNCH_URL=https://johnnypbelo.github.io/relayloom \
  node scripts/e2e.mjs --config tests/browser/launch.config.ts
```

Este teste cria apenas duas identidades sintéticas locais aos browsers, troca mensagens/anexo por RTC e fecha esses processos no fim. Não publica posts nem dados no alojamento.
