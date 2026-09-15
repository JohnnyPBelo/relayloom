# Meios Reticulum e Bluetooth

A integração RNS directa desta etapa pertence ao **nó Node no Linux**. Go e web podem alcançar esses meios através de pares compatíveis; o RNS ainda não está embebido em todos os pacotes.

O envio RelayLoom continua a escolher destinatários, sem seleccionar um meio por mensagem. Um par instalado com adaptadores pode encaminhar envelopes cifrados de uma ligação para outra. Cada salto precisa de um caminho real e de consentimento para retransmissão. O catálogo de configurações não é uma certificação de rádio ou de plataforma.

## Catálogo da referência 1.5.4

O sidecar usa o RNS original, sem copiar ou modificar os drivers. A política reconhece exactamente as 14 famílias da função de configuração do upstream; o teste compara o catálogo ao código instalado. `share_instance=No`, `enable_transport=No`, o lease exclusivo do perfil e a recusa de módulos executáveis na pasta de interfaces mantêm-se. Máximo de 16 interfaces configuradas; diagnósticos limitados a 32 interfaces, com tipo/estado/contadores, sem nomes, endereços ou chaves.

| Interface upstream | Caminho | Estado nesta implementação |
| --- | --- | --- |
| TCPClientInterface / TCPServerInterface | IP em Wi-Fi, cabo ou outro suporte do SO | Integração real, incluindo trânsito pela referência |
| UDPInterface | IP unicast/broadcast configurado | Integração real; gate de loopback e multi-hop em `tests/reticulum/media.test.ts` |
| BackboneInterface / BackboneClientInterface | IP optimizado pelo upstream | Integração; gate real de loopback no mesmo ficheiro |
| SerialInterface | Porta série suportada | Integração real com PTY; dispositivo físico não validado |
| KISSInterface / AX25KISSInterface | TNC/série | Integração; gate com PTY; TNC e transmissão RF não validados |
| AutoInterface | Descoberta IPv6 local sobre interfaces do SO | Configuração aceite; descoberta em LAN/dispositivos físicos não exercitada nesta etapa |
| RNodeInterface | RNode por série; BLE via endpoint abaixo | Configuração aceite; RNode físico, firmware e rádio não validados |
| RNodeMultiInterface | Múltiplos rádios RNode | Configuração aceite; hardware não disponível para validar |
| WeaveInterface | Dispositivos Weave | Configuração aceite; hardware não disponível para validar |
| I2PInterface | Rede I2P por SAM | Configuração aceite; SAM/I2P não activados nem testados |
| PipeInterface | Programa local que transporta bytes | Recusado por defeito; exige `[relayloom] allow_pipe_interface=Yes` em configuração local. Nenhum site/cartão pode activar isto |

`LocalInterface` é infra-estrutura de partilha de instâncias, não um meio adicional: permanece excluído para não aderir a daemons de outros projectos. As variantes Android do upstream não equivalem a integração dessas APIs no APK RelayLoom. Esta continua pendente. Wi-Fi Direct não se transforma numa API de browser por existir conectividade IP.

O gate integral terminou com sucesso: 8 cenários multiprocesso RNS, 8 controlos de perfil, 4 de política, 5 BLE com GATT simulado, 3 UI e regressão de transporte Go/Node. [Comandos, fontes, resultados e falhas](evidence/connectivity-media/reticulum). Uma ocorrência BLE excedeu o prazo de heal numa iteração; duas execuções posteriores passaram sem alteração do prazo. A causa dessa ocorrência continua aberta.

## Bluetooth Nordic UART no Linux

`adapters/reticulum/bluetooth_serial.py` liga um periférico BLE indicado explicitamente e disponibiliza um endpoint série privado para `RNodeInterface` ou `SerialInterface` do RNS. Usa Bleak/BlueZ, valida o serviço e as características, segmenta ao MTU reportado (20 bytes como base), aplica contrapressão, limita a fila a 64 KiB e termina em falha/overflow. Não procura nem escolhe pessoas automaticamente, não altera potência, pairing, permissões ou serviços do SO. O endpoint só é anunciado depois de subscrever as notificações.

Isto requer um **periférico Nordic UART compatível**, por exemplo um RNode com firmware apropriado. Um browser de telemóvel normal não anuncia esse serviço. Não é chat Bluetooth directo entre browsers. Em Bluetooth clássico, uma porta RFCOMM já provisionada pelo utilizador pode ser configurada como série; esse percurso não foi validado aqui.

Instalar as dependências opcionais, fixadas por versão/hash, no ambiente do projecto (Linux x86_64/Python 3.11):

```sh
.cache/reticulum/venv/bin/python scripts/reticulum-setup.py --bluetooth
.cache/reticulum/venv/bin/python adapters/reticulum/bluetooth_serial.py --address ENDERECO_DO_PERIFERICO
```

O segundo comando requer substituir o marcador pelo endereço do periférico escolhido. Mantém-se em primeiro plano e, quando pronto, imprime o endpoint `/dev/pts/...`; esse endpoint não é um endereço para partilhar com contactos. Use-o como `port` na interface RNS apropriada, com as restantes definições que o seu hardware requer. Não copie parâmetros de frequência/potência de uma fixture para hardware real.

Exemplo estrutural de perfil dedicado (não é uma configuração pronta de rádio):

```ini
[reticulum]
share_instance = No
enable_transport = No
[interfaces]
  [[Periferico Bluetooth]]
  type = SerialInterface
  enabled = Yes
  port = /dev/pts/ENDPOINT_IMPRESSO
  speed = 115200
```

Para RNode, use `type=RNodeInterface` e a configuração do dispositivo. Inicie então o nó RelayLoom com `--rns-config CAMINHO_DO_PERFIL`, ligue o destino RNS em **A rede** e permita a retransmissão se quiser dar passagem a terceiros. Não é necessário mudar os destinatários ou o formato das mensagens. Se a conexão BLE cair, o processo termina e o endpoint deixa de existir; restabeleça-o e reabra o adaptador. As mensagens continuam dependentes da outbox/persistência normal, não de uma confirmação BLE.

## Reproduzir

```sh
.cache/reticulum/venv/bin/python tests/reticulum/interface_policy_test.py -v
.cache/reticulum/venv/bin/python tests/reticulum/profile_policy_test.py -v
.cache/reticulum/venv/bin/python tests/reticulum/bluetooth_serial_test.py -v
node --import tsx --test --test-concurrency=1 tests/reticulum/media.test.ts
node scripts/verify-reticulum.mjs
```

Os testes BLE exercitam o adaptador com GATT simulado e PTYs reais, incluindo fluxo bidireccional, fragmentação, contrapressão, overflow e desconexão. O percurso adicional integra este adaptador com processos RNS reais e simula exclusivamente o transporte GATT. Nenhum destes resultados constitui execução por rádio. O controlador local foi consultado em leitura: ligado e com GATT/advertising disponíveis; não houve scan, pairing ou validação de dispositivo físico.

Windows/macOS/Android/iOS, Bluetooth directo web e rádios físicos continuam a exigir implementação/integração ou validação específica. A paridade exigida no contrato permanece aberta. [Estado completo](STATUS.md).
