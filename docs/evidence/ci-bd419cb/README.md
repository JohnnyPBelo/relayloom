# CI35670707944 — fonte bd419cb

A execução terminou FAILURE apenas no job iOS. Passaram Node Windows/macOS/Linux, Go/race, interoperabilidade, UI nativa, RNS, os três pacotes desktop e **112 testes de browser** (sem falhas/skips/flaky). Estes resultados pertencem a bd419cb, não aos novos commits a1040a7/16dbd6a.

No simulador iOS 26.4.1/Xcode 26.6, build/install/startup XCTest e importação da fotografia sintética passaram. O percurso funcional arrancou e registou identidade, publicação e mensagem privada. O par Node de produção recebeu uma mensagem cuja assinatura e audiência foram verificadas. **replyReadConfirmed=false**; o gate não concluiu anexo, resposta/reabertura ou recuperação.

O teste falhou em NativeSimulatorTests.swift:318, ao resolver células remotas de acessibilidade na fototeca: “Failed to resolve remote element AX element pid: 36303 … Interrupted by waiter”. O diagnóstico identifica 36303 como com.apple.mobileslideshow.photospicker, mas não estabelece a causa da falha AX. Isto é diferente do timeout seed-synthetic-photo no CI 0a85d7d; nessa execução anterior o percurso UI nem tinha começado. Não atribuir a variação à nova lógica de propostas nem dizer que a importação intermitente foi corrigida.

As três capturas foram inspeccionadas pelo implementador: ui-01 mostra setup com teclado; ui-02 mostra mensagem recebida; ui-03 mostra a mensagem ainda pendente. A numeração não é ordem cronológica. Nenhuma mostra a fotografia anexada. São capturas de execução real, não mockups, e não demonstram hardware físico.

Os 26 ficheiros dos manifestos de execução/cleanup conferiram por tamanho e SHA256. Esta curadoria conserva relatórios, logs sanitizados e capturas relevantes. O runner encerrou apenas o simulador que criou. Não foram alterados serviços, permissões, signing ou configurações Apple. O produto e os gates integrais de plataformas permanecem por concluir.
