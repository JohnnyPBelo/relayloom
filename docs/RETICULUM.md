# Reticulum real — integração experimental validada no host

O adaptador transporta os envelopes RelayLoom existentes através de `RNS.Destination`, `RNS.Link` e `RNS.Channel` da implementação de referência 1.5.4, instalada sem alterações. Cada canal leva segmentos binários limitados; o encaminhamento entre interfaces é executado pelo RNS. A identidade guardada no perfil RNS serve apenas o transporte e não contém as chaves de autoria/leitura do RelayLoom. O destino RNS não é uma conta de utilizador nem autoriza leitura ou publicação.

## Executar no host validado

```sh
python3.11 scripts/reticulum-setup.py
node --import tsx apps/node/src/cli.ts --data .runtime/rns-peer --rns-config .runtime/rns-config
```

O directório RNS deve conter um `config` explícito, com `share_instance = No` e `enable_transport = No`. O adaptador não usa nem altera um daemon RNS partilhado, configuração global ou interfaces executáveis personalizadas. Exemplo de interface TCP, para um par que o operador tenha configurado:

```ini
[reticulum]
share_instance = No
enable_transport = No
[interfaces]
 [[Rede local]]
 type = TCPClientInterface
 enabled = Yes
 target_host = 127.0.0.1
 target_port = 4242
```

A API local autenticada expõe o destino de transporte em `state.reticulum.destination`. `POST /api/reticulum-connect` recebe `{ "destination": "<32 caracteres hexadecimais>" }`, apenas com a identidade desbloqueada. A configuração do Python/ficheiros é exclusiva do arranque local, não de um pedido web. Um bloqueio do SO impede duas aplicações RelayLoom de activarem o mesmo perfil RNS. Os sete controlos de processo incluem exclusividade, reinício, morte abrupta do proprietário e recusa de identidade corrompida. O perfil conserva a identidade de transporte; a lista de destinos pretendidos ainda não é persistida e precisa de ser reapresentada após reinício.

O router RelayLoom continua a aplicar consentimento, prioridade, validação de objectos, limites e seeding. Os sidecars de aplicação não são routers de trânsito RNS arbitrário: rejeitam `enable_transport=Yes` para evitar tráfego de trânsito fora da política de pausa da aplicação. Routers RNS dedicados, com consentimento dos respectivos operadores, podem integrar a rota subjacente. A integração da política de trânsito RNS por instalação continua pendente; não é uma redução do requisito de relay.

## Testes e limites

```sh
npm run verify:reticulum
```

A fixture executa três aplicações (origem Node ou Go; dois pares Node), dois sidecars RNS e um router RNS de referência com TCP e série por PTY. A comunicação A→B usa TCP; B→C usa um Link RNS com dois saltos, cruzando TCP e série no router intermédio. Há controlos de isolamento, partição/heal, cifra sem leitura pelo relay, pausa, reinício e seeder com a autora offline. O relatório só é escrito como passado após todas as asserções.

A validação local terminou por etapas, com fontes verificadas: 279 testes Node; 177 testes Go de topo com race detector (229 incluindo subtestes; 13 helpers omitidos nesse comando); 58 testes entre Node e Go; 23 percursos UI por motor; 70 auditorias Axe e execução do pacote Linux. Os três cenários RNS, os sete controlos do perfil e o percurso adicional pela UI passaram. A UI enviou, recebeu e respondeu durante uma partição TCP→RNS/série por PTY, com duas auditorias Axe adicionais.

Uma invocação conjunta foi interrompida com código 143 antes de a etapa UI produzir saída. O relatório original continua marcado como interrompido; a etapa pendente passou isoladamente em 17,3 s, seguindo-se Go integral, interoperabilidade e UI/desktop. Não se apresenta essa invocação interrompida como sucesso. [Relatório, comandos, hashes e falhas corrigidas](evidence/reticulum/milestone/report.json).

PTY não é rádio. Não há execução RNS comprovada em Windows/Android/macOS/iOS, empacotamento nativo, rádios físicos ou acesso RNS directo no browser. A rota web→RTC→WS→Reticulum já passou os gates registados em STATUS; não implica acesso directo do browser ao rádio. O envio normal deve continuar a pedir destinatários e apresentar estado de entrega; os meios pertencem ao diagnóstico opcional.

## Dependências e licença

RNS 1.5.4, wheel PyPI SHA256 `862615b12d449750c0b3c451dfc2cb189fd6da1c573c477a29f36f97d2a66a19`. O lock com hashes em `adapters/reticulum/requirements-linux.lock` fixa também cryptography, cffi, pycparser e pyserial para o host Linux/Python 3.11. Os avisos estão em `docs/licenses/reticulum`.

A **Reticulum License** inclui condições de finalidade e conservação de avisos; não deve ser designada MIT. README/LICENSE do mirror oficial foram consultados no commit `1565126ffd08b9d7bc750ce5df82d5aa3e38183e`. A versão incorporada é o wheel fixado, sem alegação de equivalência de commit. Referências: [upstream](https://github.com/markqvist/Reticulum), [API](https://markqvist.github.io/Reticulum/manual/reference.html).

O catálogo completo de interfaces internas e o adaptador Bluetooth Nordic UART Linux estão descritos em [Meios Reticulum e Bluetooth](RETICULUM-MEDIA.md), com distinção entre configuração aceite, testes IP/PTY/GATT simulado e hardware não validado.
