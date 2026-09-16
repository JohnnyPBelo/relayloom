# Organização de páginas — candidata de integração

A cópia cria uma página e blocos com IDs próprios; conserva a página original e os anexos partilhados e adapta as ligações da cópia à própria página. A ordem pode mudar por teclado/toque, preservando a página inicial e o histórico de desfazer/refazer. Mantêm-se os limites do documento e a assinatura do proprietário.

Comandos já executados:

| Comando | Resultado |
| --- | --- |
| `node --import tsx --test tests/site-pages.test.ts tests/site-document.test.ts tests/i18n.test.ts` | 64 testes passaram |
| `RELAYLOOM_TEST_BACKEND=node node scripts/e2e.mjs tests/e2e/site-pages.spec.ts` | 1 passou: rascunho, publicação e leitor após encerrar autora |
| Mesmo comando com `RELAYLOOM_TEST_BACKEND=native` | 1 passou com Go |
| `RELAYLOOM_MATRIX_ENGINE=<engine> node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/site-pages.spec.ts` | 1 por Chromium/Firefox/WebKit, com WebRTC real, rascunho cifrado e autora fechada |
| Mesmo comando WebKit para `tests/browser/mobile-navigation.spec.ts` | 1 passou com toque emulado em375×647; não é XCTest/iOS físico |
| `node scripts/verify-ui.mjs` | 31Node+31Go, build/run/package/run Linux; fontes estáveis |
| `node scripts/android-smoke.mjs --final --pages --evidence-dir .cache/android/evidence/page-organisation` | 25asserções; documento exacto recebido porNode, ACKprivado, rascunho recuperado após reiniciar núcleo |

O Android foi executado no APK40d808ae6baa6c89b427c983c4d5ae6f9724b48f9226b68242f5381ec81ff458, no mesmo AVD API36x86_64. Usa eventos DOM/React na WebView e APIs de controlo para asserções; não afirmar input físico. O primeiro percurso começou sem rascunho; o ramo de restauração de rascunho existente ainda requer execução. O APK de testes é separado do APK da aplicação.

O CI35138345398 da fonte02188da compilou Swift/iOS, passou36controlos de idioma no hostMac e45controlos de política, e o startupXCTest1/1. A fotografia foi inserida em4270ms. A etapa funcional falhou depois de criar identidade/post/contacto, ao procurarConnect apeer; a captura conserva a gaveta aberta e a página anterior. Preparado um selector do landmarkMain navigation, espera dehittable no mesmo prazo e diagnóstico de geometria. Essa correcção e o fallbackPT actualizado ainda não foram executados emApple. Não há redução do teste de fotografia nem mudança de serviços/permissões.

**Pendentes nesta candidata:** matriz completa dos browsers, regressões finais Android, nova execuçãoApple e publicação dos controlos novos. O URL actual ainda serve02188da/eff7e9b9 (verificado separadamente). Revisões/endereço estável, contribuições e ficheiros opcionais continuam no contrato; esta alteração não conclui o produto.
