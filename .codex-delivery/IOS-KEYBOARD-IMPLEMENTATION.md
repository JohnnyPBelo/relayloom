# Teclado iOS — incremento separado ainda por validar em Apple

O CI9866889 chegou ao formulário e à importação de fotografia, mas o XCTest falhou com `missing("keyboard dismissed for Um novo fio na rede.")`. A lista nativa de controlos capturada não continha Done/Hide/Dismiss. Tocar no título não fez o WKWebView resignar o primeiro respondedor. A falha e as capturas estão em `.cache/milestones/ci-9866889/ios-evidence`.

Root acrescentou um botão nativo acessível **Ocultar teclado**, junto ao `UIKeyboardLayoutGuide`, que chama a API pública `view.endEditing(true)` sem submeter o formulário nem injectar JavaScript. O botão acompanha o teclado, desaparece sem teclado/fora de foreground e é retirado ao descartar o WebView. O XCTest prefere esse controlo sem remover a asserção de que o teclado realmente desaparece, nem os percursos posteriores.

Ficheiros próprios: `apps/ios/RelayLoom/RelayViewController.swift` e `apps/ios/UITests/NativeSimulatorTests.swift`. Não foram copiados para o candidato RNS em validação. **Sem compilação UIKit ou execução Apple deste incremento ainda.** Não afirmar que corrigiu iOS antes de compilar/executar num runner Apple real. Não alterar permissões, runtime de bridge, políticas de origem ou segurança para fazer passar o teste. Fazer commit separado depois dos controlos disponíveis e publicar quando não cancelar CI em curso.


## CI Apple executado — eec2806

Ramo WIP codex/ios-keyboard-verification, CI34902268397. O novo UIKit/XCTest compilou e testStartupBeforeMedia passou25.409s. A preparação da fotografia excedeu o prazo antes do teste funcional; assetsd regista biblioteca em reconstrução/migração. Não se conclui que o teclado funciona. Evidência docs/evidence/ios-keyboard-ci. Não relançar o mesmo run nem aumentar prazos sem diagnóstico da prontidão da biblioteca no simulador criado pelo teste. Nenhum serviço/permissão alterado. A cópia root é preservada e ainda não integrada na main.
