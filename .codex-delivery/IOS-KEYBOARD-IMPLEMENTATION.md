# Teclado iOS — incremento separado ainda por validar em Apple

O CI9866889 chegou ao formulário e à importação de fotografia, mas o XCTest falhou com `missing("keyboard dismissed for Um novo fio na rede.")`. A lista nativa de controlos capturada não continha Done/Hide/Dismiss. Tocar no título não fez o WKWebView resignar o primeiro respondedor. A falha e as capturas estão em `.cache/milestones/ci-9866889/ios-evidence`.

Root acrescentou um botão nativo acessível **Ocultar teclado**, junto ao `UIKeyboardLayoutGuide`, que chama a API pública `view.endEditing(true)` sem submeter o formulário nem injectar JavaScript. O botão acompanha o teclado, desaparece sem teclado/fora de foreground e é retirado ao descartar o WebView. O XCTest prefere esse controlo sem remover a asserção de que o teclado realmente desaparece, nem os percursos posteriores.

Ficheiros próprios: `apps/ios/RelayLoom/RelayViewController.swift` e `apps/ios/UITests/NativeSimulatorTests.swift`. Não foram copiados para o candidato RNS em validação. **Sem compilação UIKit ou execução Apple deste incremento ainda.** Não afirmar que corrigiu iOS antes de compilar/executar num runner Apple real. Não alterar permissões, runtime de bridge, políticas de origem ou segurança para fazer passar o teste. Fazer commit separado depois dos controlos disponíveis e publicar quando não cancelar CI em curso.


## Ramo de validação Apple

Este ramo WIP assenta em2d4d12c e acrescenta só os dois ficheiros UIKit/XCTest acima e esta nota. Não contém o refactor posterior de certificados/perfil de chaves. O CI completo existente vai compilar e executar o simulador Apple; a validação está pendente. O controlo Python local verifica apenas consistência do projecto e políticas, nunca compilação Swift ou execução iOS. Não integrar como correcção comprovada antes de recolher o resultado Apple. Hardware físico e assinatura permanecem bloqueados.
