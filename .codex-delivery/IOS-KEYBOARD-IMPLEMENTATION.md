# Teclado iOS — incremento separado ainda por validar em Apple

O CI9866889 chegou ao formulário e à importação de fotografia, mas o XCTest falhou com `missing("keyboard dismissed for Um novo fio na rede.")`. A lista nativa de controlos capturada não continha Done/Hide/Dismiss. Tocar no título não fez o WKWebView resignar o primeiro respondedor. A falha e as capturas estão em `.cache/milestones/ci-9866889/ios-evidence`.

Root acrescentou um botão nativo acessível **Ocultar teclado**, junto ao `UIKeyboardLayoutGuide`, que chama a API pública `view.endEditing(true)` sem submeter o formulário nem injectar JavaScript. O botão acompanha o teclado, desaparece sem teclado/fora de foreground e é retirado ao descartar o WebView. O XCTest prefere esse controlo sem remover a asserção de que o teclado realmente desaparece, nem os percursos posteriores.

Ficheiros próprios: `apps/ios/RelayLoom/RelayViewController.swift` e `apps/ios/UITests/NativeSimulatorTests.swift`. Não foram copiados para o candidato RNS em validação. **Sem compilação UIKit ou execução Apple deste incremento ainda.** Não afirmar que corrigiu iOS antes de compilar/executar num runner Apple real. Não alterar permissões, runtime de bridge, políticas de origem ou segurança para fazer passar o teste. Fazer commit separado depois dos controlos disponíveis e publicar quando não cancelar CI em curso.


## CI Apple executado — eec2806

Ramo WIP codex/ios-keyboard-verification, CI34902268397. O novo UIKit/XCTest compilou e testStartupBeforeMedia passou25.409s. A preparação da fotografia excedeu o prazo antes do teste funcional; assetsd regista biblioteca em reconstrução/migração. Não se conclui que o teclado funciona. Evidência docs/evidence/ios-keyboard-ci. Não relançar o mesmo run nem aumentar prazos sem diagnóstico da prontidão da biblioteca no simulador criado pelo teste. Nenhum serviço/permissão alterado. A cópia root é preservada e ainda não integrada na main.


## Tentativa Apple2 — teclado confirmado, selector localizado

A tentativa2 doCI34902268397 importou a fotografia, fechou o teclado com relayloom.hide-keyboard e avançou por publicação/contacto/ligaçãoTCP/mensagem privada. O log confirma keyboard-dismissed e a captura mostra a mensagem recebida. O teste depois falhou em system Photo Library action: a captura ui-03.png mostra Fototeca, não Photo Library. Não se declara que todo o fluxo passou.

O selector passa a aceitar as duas etiquetas nativas exactas. A confirmação de escolha conserva as etiquetas inglesas e acrescenta os equivalentes portugueses, sem remover a verificação de que o anexo chega ao compositor. Actualização ainda por compilar/executar emApple. O ramoWIP integra agora a mainf378e13 por merge normal, preservando a história; o único conflito foi esta nota, resolvido conservando o histórico. Não houve merge de PR,force-push ou alteração de sistema/permissões.


## Tentativa Apple3 — fotografia visível, hierarquia por corrigir

CI34917778173/496788b terminou com todos os jobs passados excepto iOS. Startup passou, a fotografia foi importada e o fluxo avançou por teclado/publicação/contacto/TCP/mensagem privada. O menu Fototeca abriu. A captura `docs/evidence/ios-keyboard-ci/attempt3/picker-visible.png` mostra a imagem sintética colorida no canto superior esquerdo da grelha. O selector `app.collectionViews.cells.firstMatch` não a encontrou em20s; portanto, não atribuir a falha à ausência de fotografia. Recolher a hierarquia acessível do selector nativo e corrigir o selector semanticamente antes da próxima tentativa. O anexo, resposta/retoma/relaunch e gate iOS integral continuam sem passe. Main34916793582 conserva a falha antiga de teclado. Nenhum CI desta tentativa continua activo.
