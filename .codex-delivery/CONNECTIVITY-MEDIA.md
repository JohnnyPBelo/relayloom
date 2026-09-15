# Ligações pendentes e meios — 2026-09-15

Contrato integral aberto. Trabalho sequencial, sem novos agentes ou alterações à bridge/modelo/serviços. Preservar UIKit/XCTest e restantes ficheiros locais.

## Evidência inicial

- 81 GiB livres. HEAD 4e4fcc7. CI 35026722736 ainda activo (Node nos três hosts passou; Go em curso).
- IAB skill backend indisponível; acesso alternativo CUA conseguiu ler o separador existente. Mostrou 0 pares, 0 conversas e relay pausado, com asset antigo browser-BS8Dlbyr.js. Versão publicada tem browser-BXEPX-ae.js. Recarregamento do separador sem ligações activas preservou o perfil e apresentou desbloqueio. Nenhuma frase-passe/dado privado foi recolhido.
- Isso não observa os dois dispositivos mencionados. Perguntas sobre pares/sistemas/rede continuam pendentes; não atribuir causa definitiva ao relato.
- Cartões não estabelecem RTC. Não há STUN/TURN/discovery automático. Heartbeat e limites mantêm-se até existir evidência de defeito.
- Painel de ligação partilha estado entre oferta/resposta e não acompanha a ligação no lado que responde. Corrigir com estado por percurso, progresso real e recuperação explícita sem apagar outbox.
- RNS 1.5.4 contém mais famílias do que as quatro permitidas. BLE upstream liga Android a RNode; não permite automaticamente browser-browser.

## Execução

1. Diagnóstico RTC finito e sem dados privados; progresso nas duas pontas; recuperação e indicação junto de mensagens pendentes. Testes negativos/positivos de outbox e ligação, tabs/SDP inválido, privacidade do diagnóstico.
2. Política de interfaces upstream: alargar famílias internas, preservar isolamento/consentimento/proibição de módulos remotos. Testes multiprocesso reais UDP/Backbone e KISS/AX25 em PTY; hardware explicitamente separado.
3. Bluetooth: verificar capacidades locais sem scan de dispositivos pessoais; implementar caminho viável com testes delimitados, registar bloqueios físicos/browser. Não contar whitelist/documentação como implementação de rádio.
4. Gates sequenciais das superfícies alteradas; publicação apenas após validação; não cancelar CI activo. Actualizar STATUS/README/RESUME com comandos e resultados efectivos.

Produto não concluído; paridade web, todas as plataformas, segurança, multi-meio e revisão independente continuam obrigatórios.

## Implementação e controlos locais antes do gate integral

- RTC: estados por percurso no painel, observação real de canal/ICE nos dois lados, recomeço explícito, recusa de cartão em lugar de SDP e diagnóstico finito sem chaves/SDP/IP/conteúdo. Map de tentativas limitado a 24; limites de transporte/heartbeat e criptografia preservados.
- RNS: catálogo exacto de 14 interfaces internas em `interface_policy.py`; Pipe exige opt-in exclusivamente local; módulos custom/shared daemon/transit sem consentimento continuam recusados. Contadores por interface sem identificadores de rede.
- BLE: `bluetooth_serial.py`, ligação Bleak/Nordic UART a periférico explicitamente indicado, PTY privada, fragmentação/contrapressão/limites/cancelamento. Dependências opcionais com hashes, apenas venv do projecto. Sem pairing/scan/power/service changes.
- `npm run build` e `npm run typecheck`: passaram. Teste UI delimitado: `node scripts/e2e.mjs --config tests/browser/browser.config.ts tests/browser/connectivity.spec.ts` passou 1/1 em 10,5 s. Negativos: cartões sem ligação e cartão inválido como SDP. Positivo: ambas as outboxes recebem confirmação e cada mensagem aparece uma só vez.
- Primeiro teste UI esperava a etiqueta incorrecta Entregue; snapshot mostrava Recebida. Corrigido o teste e docs, sem mudar a semântica de recibos.
- Catálogo/política 4/4 e BLE com GATT simulado 5/5 passaram. Perfil anterior 7/7; acrescentado depois controlo de processo Pipe sem opt-in, pendente no gate integral.
- Instalação pelo Python de sistema foi recusada pelo requisito 3.11; repetida com o Python 3.11 do venv, com sucesso. Não alterado Python global.
- Primeira fixture RNS esperava conteúdo privado na lista legível de B: falha nos quatro meios. A lista correctamente o oculta; corrigido para observar armazenamento cifrado e exigir rejeição explícita de leitura. Segunda fixture usava operação inexistente request em vez de retrieve; corrigida.
- `node --import tsx --test --test-concurrency=1 tests/reticulum/media.test.ts`: UDP (20,988 s), Backbone (25,985 s), KISS PTY (23,380 s), AX25 PTY (24,198 s) passaram; BLE simulado falhou no prazo de 45 s após heal. Execução instrumentada só BLE passou 30,227 s sem alteração do adaptador/prazos. Ocorrência de latência ainda não explicada; não tratada como bug resolvido nem ocultada por retry automático.
- Todos os meios exercitados exigem ausência durante pausa/partição, entrega exacta após retoma, recusa de leitura em B e seeding com autora offline. GATT simulado e PTYs não contam como rádio físico.

## Gate integral em execução

Iniciado 2026-09-15T22:11:12Z, sessão 64416. Orquestrador local `.cache/connectivity/verify-all.mjs`; relatório `.cache/connectivity/gates/report.json`. Ordem: public-web (inclui connectivity nos três motores/builds), controlos RTC foundation por engine, verify-reticulum com os novos testes, verify-ui Node/Go/desktop. Não lançar duplicados; ler resultado e diagnosticar antes de retomar se falhar. Fontes verificadas por hash pelos gates. Nenhum destes gates é PASS por ter sido lançado.


## Gates e revisão seguintes

- Primeiro gate integral terminou PASS: public-web61+2endereços,6RTC,Reticulum (8cenários+8perfil+4política+5BLEsim+1fairness+Go2pacotesrace+3UI),25UI Node+25Go+pacoteLinuxexecutado. Sessão64416 terminou.
- Commit local7d3bceb contém apenas RNS/meios, docs e evidência explicitamente seleccionados. Ainda sempush.
- Revisor root encontrou falta de limpeza ao fechar convites pendentes. Reproducer independente `.cache/connectivity/orphan.checks.ts` falhou (1par em vezde0); correção mantém pares abertos, liberta pendentes e trata resultados depois de unmount. Reproducer passou1/1 apósfix, connectivity2/2 passou (inclui atraso artificial de2s na criação realRTC). Não é revisão independente externa.
- Captura compacta revelou código para partilhar abaixo da resposta; reordenado e ajuda recolhível. Captura nova inspeccionada.
- Typecheck da fixture tardia falhou por this implícito; anotação explícita adicionada e build final passou.
- Gate final emsessão62070, relatório `.cache/connectivity/final-gates/report.json`; public-web integral e UI-RNS3engines. Fonte estável durantegate. Não anunciarpassed antesdoresultado.
- CI anterior35026722736 terminou failure sóiOS; outros jobs listados passaram. Isso não validaWIPiOS e não fecha requisitoApple.


CI iOS anterior recolhido, sem modificar Swift: artefacto ios-simulator-execution-evidence (1,395 MB), em `.cache/connectivity/prior-ios`. Source4e4fcc7, Xcode26.6, simulador iOS26.4.1, signing desactivado, runtime já instalado. Build/instalação/startup passaram (1teste), importação sintética de foto passou; execute-ui-test saiu65 após170,687s. Capturas mostram criação de identidade; não demonstram causa exacta da falha. Relatório não inclui a asserção XCTest, pelo que a próxima investigação deve recolher resumo xcresult sanitizado antes de atribuir falha a teclado/fototeca. Nenhum dispositivo físico executado. Cleanup do runner confirmou apenas o simulador criado removido.


## Publicação e controlo final — 2026-09-16, Lisboa

Gate final PASS:67web+2endereços e9UI-RNS. Commits7d3bceb/359d652. Publicação eafa109, Pages35033701343 success,13ficheiros HTTP conferidos,3testes HTTPS passaram. No IAB, reload ainda servia browser-BS8Dlbyr.js devido ao controlador offline antigo à espera de todos os clientes fecharem. Navegar pela raiz HTML activou browser-BLtN8NLC.js; perfil preservado. Abertura de release.json no IAB foi recusada pelo cliente; não se alterou segurança, cache ou dados. Guia corrigido: fechar separadores antigos e abrir a raiz, sem apagar armazenamento. A validação dos dois dispositivos físicos continua pendente. Nenhum teste desta etapa ficou por terminar.
