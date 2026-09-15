# Contactos visíveis e participação como relay

Código `9abbf20`, sobre `2d06c7e`. Produto completo não concluído. Os controlos não são testes de dispositivos ou rádios físicos.

- `node scripts/verify-public-web.mjs`:PASS com fontes/artefactos estáveis.2oráculos,8UI porengine no build existente(24),10porengine no build público(30),1percurso com Chromium/Firefox em processos diferentes. `web-gate.json` e `web-counts.json`.
- `node scripts/verify-ui.mjs`:PASSED,25Node+25Go eLinux build/run/package/run. `native-ui.json` econtagens porbackend.
- `node scripts/e2e.mjs --config tests/reticulum/ui.config.ts --browser chromium` e equivalentes firefox/webkit:3porengine(9). ReferênciaRNS1.5.4,TCP,sériePTY,partição/retoma,resposta privada e seederreiniciado com autoraoffline. `follow-on.json`,`rns/`.

As capturas porengine mostram o contacto sem mensagens e o controlo de relay. A autorização de B é dada/retirada pela UI numa topologia com apenas A–B e B–C. Dois períodos de5s em pausa são negativos; entre eles e após retomar há entrega real. O intermediário recebeu a cópia mas a UI recusou lê-la. O rascunho/reply sobrevivem à chegada da primeira mensagem.

Falhas em `iterations/`: contacto ausente reproduzido; estado assíncrono do checkbox; selectores ambíguos depois de mostrar contactos;2mensagens indevidas na primeira candidata ao perder uma resposta. Endereço DM estável e destinatários ordenados corrigiram a última; o mesmo teste passou. A opção vazia do verificador também foi corrigida; nenhum teste foi retirado. Estas candidatas falhadas não foram publicadas.

A publicação Pages `35025782233` terminou com sucesso. Os três testes do URL actualizado passaram: um entre processos Chromium/Firefox (16,7 s) e dois de contactos/relay em Chromium (50,2 s). Comandos e alcance em `published-checks.json`; hashes HTTP em `https-integrity.json`. Mantêm-se os limites de Bluetooth,descoberta,NAT,segundo plano,paridade integral eplataformas.
