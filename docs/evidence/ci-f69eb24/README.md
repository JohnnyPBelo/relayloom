# CI f69eb24 — resultado exacto

Execução [35676434531](https://github.com/JohnnyPBelo/relayloom/actions/runs/35676434531), fonte **f69eb2442c3db373a81748c20cd87470f020ef37**. Resultado global FAILURE, apenas no job iOS. Node nos três hosts, Go, interoperabilidade, UI nativa, Reticulum, os três pacotes desktop e **115 testes browser** passaram (zero skipped/flaky/unexpected). Estes resultados não cobrem o WIP local posterior de submissão de propostas.

Recolha delimitada: `gh run download 35676434531 --repo JohnnyPBelo/relayloom --name ios-simulator-execution-evidence --dir .cache/ci-f69eb24/ios` e o mesmo para `autonomous-browser-evidence`, destino `.cache/ci-f69eb24/browser`. Artefactos 10675246827 (1 856 424 bytes) e 10674387543 (2 829 574 bytes). O ficheiro `failed-jobs.log` recolhido inicialmente estava vazio e não foi usado para inferir a causa.

Os **27 ficheiros** dos dois manifestos iOS foram conferidos por tamanho/SHA-256, sem ausências ou divergências. `verification.json` mantém os caminhos originais da recolha; as cópias estão em `ios/`. O relatório bruto browser está preservado no caminho de cache acima; `browser-summary.json` conserva estatísticas/hash/tamanho. `run.json` conserva a lista de jobs e fases.

## iOS executado e falha

Simulador iOS 26.4.1, Xcode 26.6, iPhone SE (3.ª geração), sem assinatura/dispositivo físico. Build, instalação, startup XCTest e importação da fotografia passaram. O percurso criou identidade, publicou um post e enviou uma mensagem privada cuja assinatura e leitores foram verificados pelo par Node real.

O teste falhou em `NativeSimulatorTests.swift:308` com `missing("seeded synthetic photo")`. Não é o timeout de importação da execução 0a85d7d nem a excepção AX remota da execução bd419cb. O diagnóstico `IOS_SIMULATOR_PHOTO_CONTROLS` mostra a fotografia sintética como imagem com identificador `PXGGridLayout-Info`, sem células seleccionáveis pelo predicado actual; o teste procura células quadradas e hittable. A captura `ui-04.png`, inspeccionada, mostra a imagem sintética no canto superior esquerdo e o painel inicial de acesso privado à fototeca. Isto identifica uma incompatibilidade concreta do selector do teste, mas não prova que uma selecção alternativa, envio do anexo, resposta ou recuperação funcionem.

A última fase foi `failure-keyboard-hidden`. Não há recibo de leitura/resposta confirmado nem anexo entregue. O simulador criado pelo gate foi encerrado e eliminado pelo próprio gate; nenhum processo externo foi interrompido na recolha. Nenhum resultado equivale a validação de dispositivo físico, rádio ou prontidão para catástrofes.
