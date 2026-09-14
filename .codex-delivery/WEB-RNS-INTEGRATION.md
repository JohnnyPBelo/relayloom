# Web autónoma e rede Reticulum — incremento seguinte

Base publicada: a49e4a4. Manter recuperação sequencial, Astra/Copilot Ultra e o contrato completo. Não alterar serviços/bridges nem iniciar agentes.

1. Dar à app instalada uma interface para emitir/revogar o convite de rede para a versão web no mesmo dispositivo. O backend já limita a origem, o prazo e a capacidade; a UI não pode transformar esta capacidade em acesso ao cofre nem copiar o URL de controlo. Explicar alcance local e revogação, tratar respostas tardias depois de fechar/bloquear.
2. Testar emissão e revogação pela UI com os dois motores reais e verificar acessibilidade.
3. Exercitar a aplicação autónoma (worker/IndexedDB, sem daemon para a identidade web) por WebSocket → relay Node → RNS TCP/router de referência → série PTY → destinatária. Fazer envio/leitura/resposta pela UI, partição/heal e controlo de relay; provar ausência de caminho alternativo, intermediários sem leitura e autoria preservada. Reiniciar seeder com autora offline e verificar anexo exacto.
4. Registar comandos/resultados/hashes/capturas e rever os percursos afectados. A cobertura existente mantém-se; rádio físico, WSS/WAN, Safari/dispositivos, grupos dinâmicos web e restante contrato permanecem obrigatórios.

Os resultados só são marcados depois de executados. O incremento iOS não pertence a este conjunto.


## Resultado executado

A sessão86790 terminou0. A cópia isolada manteve os nove inputs; gate RNS,26browser,25UI por motor e desktopLinux passaram. Oito auditorias Axe novas sem violações; convite revogado por teclado a320px. O anexo tinha22000bytes. Comandos/logs/hashes/capturas e as falhasiniciais conservados em docs/evidence/web-reticulum. A fonteGo deprodução não mudou; iOS e orefactor posterior degrupos estão excluídos. Commit local preparado; esperar o CI34897998431 antes de umpush queocancele.


## Extensão RTC preparada depois de congelar GC

Root acrescenta um segundo percurso ao teste autonomous-ui.spec.ts: a autora só tem um par WebRTC; outro browser consentido faz a passagem RTC→WS para o nó RNS. A UI do intermediário deve recusar ler a mensagem privada. Fecha-se também esse browser antes do seeder nativo reiniciar. É um teste novo ainda NÃO EXECUTADO; não está no candidatoGC do gate89503. Depois de esse gate terminar, validar esta extensão separadamente e recolher o directório.cache/reticulum-web-rtc; não lhe atribuir passes anteriores.


## Extensão RTC concluída

Gate67931 terminou0: os três percursos UI-RNS passaram1.7min. SeisAxe sem violações,22 000bytes exactos e o browser intermediário sem autorização de leitura. Evidência docs/evidence/rtc-reticulum. O teste espera a confirmação do consentimento no worker; a primeira edição falhou por indentação e o seu ensaio sem alteração ficou identificado, sem mascarar falhas. Não houve alteração de produção nesta extensão.
