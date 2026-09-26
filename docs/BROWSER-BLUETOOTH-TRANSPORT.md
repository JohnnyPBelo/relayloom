# Transporte Bluetooth para o browser — fundação experimental

Este incremento acrescenta ao encaminhador um canal GATT e um periférico Linux opcional. A integração visual e a preparação offline continuam num incremento separado; este documento não anuncia uma nova versão do site público nem paridade entre plataformas.

`BrowserRouter.connectBluetooth(device)` transporta os pacotes existentes por escritas GATT confirmadas e indicações, usando fragmentos e confirmações do protocolo nativo. Não é NUS/RNode directo: o dispositivo deve anunciar o serviço RelayLoom `7c9a0001-53b0-4c7d-a15b-96b235e9417b` e as características RX/TX/capacidade correspondentes. A indicação inicial e a resposta ATT têm de terminar antes de começar a primeira escrita de dados.

`BluetoothDiscovery` usa uma `BluetoothGrantStore` fornecida pela aplicação. A escolha inicial deve partir de um gesto real e usa o diálogo Web Bluetooth normal. A reconexão cruza `getDevices()` com as escolhas do perfil, até8IDs; uma permissão concedida à origem por outra página não basta. O chamador deve guardar estas escolhas no seu armazenamento protegido e verificar a sessão. O controlador não exporta identidades, chaves ou nomes de dispositivos e não altera permissões do navegador. Esquecer só fecha os caminhos e remove as escolhas após confirmar a gravação.

Cada ID tem um único proprietário local do stream. Encerrar uma tentativa antiga não lhe permite desligar a ligação substituta quando o sistema termina a operação mais tarde. Filas, linhas, operações e reconexões têm limites; os outros transportes mantêm os seus prazos anteriores. Retransmissão, deduplicação, prioridades, TTL, verificação do envelope e autorização continuam no encaminhador/aplicação. Uma confirmação do transporte não é uma confirmação assinada do destinatário.

## Periférico Linux

O processo `adapters/bluetooth/gatt_relay.py` regista apenas os seus objectos GATT/anúncio em BlueZ e liga à porta local de **pacotes** de um nó RelayLoom já em execução. Não liga o controlador, não instala serviços, não altera pairing/trust/permissões e não expõe a API de controlo. Usa `dbus-fast` do ambiente Bluetooth opcional já fixado pelo projecto.

```sh
.cache/reticulum/venv/bin/python scripts/reticulum-setup.py --bluetooth
.cache/reticulum/venv/bin/python adapters/bluetooth/gatt_relay.py --tcp-port PORTA_DE_PACOTES
```

Substituir o marcador por uma porta do próprio nó, nunca pela porta HTTP. Uma sessão central de cada vez. Tags de8bytes separam indicações visíveis a subscritores; são identificadores de sessão, **não credenciais nem chaves de leitura**. A autoria e o conteúdo privado conservam a criptografia da aplicação. O sinal BlueZ reconhece tanto a abertura pendente como a sessão activa; encerramento síncrono invalida continuações tardias, e o cleanup só elimina os seus recursos capturados.

Limites actuais: linhas4096bytes, payloadGATT20–244bytes, fila browser64KiB, oito nós guardados, até dois caminhos automáticos (um em baixo consumo), abertura20s e operação10s. O caminho tem os limites de armazenamento/TTL da aplicação; não foi medido o débito RF de mensagens ou anexos. No nó Linux, a ligação do gateway aparece como TCP local; no browser, como Bluetooth.

## Reproduzir os testes deste incremento

```sh
npm run build
node --import tsx --test --test-concurrency=1 tests/bluetooth-stream.test.ts
.cache/reticulum/venv/bin/python tests/bluetooth/test_gatt_relay.py -v
```

Os testes usam GATT simulado e TCP real. Cobrem fragmentação/quotas, frames/capacidades inválidos, pausa, concessões, erro de gravação, revogação, reconexão, fecho tardio, concorrência de proprietários e cleanup de uma sessão anterior. Não provam transmissão por rádio. O registo/remoção real em BlueZ foi exercitado separadamente no Linux disponível, sem segundo dispositivo.

Safari/iPhone sem Web Bluetooth precisa de um caminho por rede ou por nó compatível. Dois browsers centrais não passam a anunciar um periférico. Rádios físicos, integração nos restantes SO, revisão independente e todo o restante PROJECT-BRIEF.md continuam pendentes. Compilação e simulação não equivalem a validação de dispositivos ou prontidão para catástrofes.
