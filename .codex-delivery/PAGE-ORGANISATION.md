# Organização de páginas — implementação activa

O produto completo continua por concluir. Este incremento acrescenta duplicação de páginas completas e ordenação com teclado/toque, dentro dos limites de site existentes. Não substitui os endereços/revisões/contribuições/ficheiros opcionais previstos em SITE-REVISION-IMPLEMENTATION.md.

Modelo em apps/web/src/site/model.ts: IDs novos para a cópia e todos os descendentes; ligações à própria página passam para a cópia; outras páginas e anexos partilhados são preservados. Títulos/slug respeitam80/40unidades, sem cortar um parUnicode; candidatos de slug únicos;12páginas/128blocos/orçamentoJSON validados antes de alterar o projecto. Ordenar conserva IDs,home e referências; passos fora dos extremos não criam alteração. UI emstudio.tsx/css tem controlos44px, posição e desfazer/refazer existentes, com PT/EN/ES. Não muda protocolo ou autoria/ACL.

9testes unitários iniciais (5novos+4i18n) passaram. BuildTS/Vite passou depois de formatar. Novos percursos tests/site-pages-journey.ts, tests/e2e/site-pages.spec.ts e tests/browser/site-pages.spec.ts exercitam UI, duplicação/links/imagem/ordem/undo/reload/publicação e leitor com autora offline; adicionados ao gate público. Execução dirigida Node iniciou agora: .cache/onboarding-i18n/page-ui-node.log, precedida depage-domain.log. Consultar sessões/processos antes de repetir. Go/browser/matriz e revisão de capturas ainda pendentes. Novoscontrolos nãoestãopublicados; URL activo é fonte02188da/distribuiçãoeff7e9b9.

Correcção adicional de consistência: os helpers nativos Android/iOS usavamENcomo fallback sem língua suportada, enquanto aWebView usaPT. Passam aPTcom vectores ajustados. Requer novos artefactos/gatesAndroid/Apple; não usar o APKd2dd1ab1 como prova desta alteração. Não foram alteradas línguas doSO/permissões/bridge/modelos.

HTTPS do marco anterior ficou finalmente verificado: sessãoobservada28134PASS11,7s com maxFullAvg10=0,26 e MemAvailable mínimo2312888320bytes. Sessão38957PASS:17assetsHTTP,9UI noHTTPS e1percurso entreprocessos (74136ms+14872ms). Report .cache/onboarding-i18n/live-final/report.json com hashes dosverificadores. Os timeouts prévios continuam arquivados; correlação com pressão de memória não prova causa única. Não recriar verificações terminadas nem promover o código novo como coberto por esses passes.


## Verificação dirigida e Android

64 testes de modelo/site/i18n passaram. O percurso novo passou com Node (7,3s), Go (6,5s), Chromium (10,5s), Firefox (14,7s) e WebKit (14,0s). Depois da primeira revisão, os campos ganharam espaço e os controlos ficaram agrupados; capturas incluem foco por teclado. O cenário de toque único da navegação compacta passou em WebKit (2,9s); não equivale ao XCTest iOS.

O CI02188da executou Swift/políticas/build iOS e startup1/1 com sucesso. A fotografia sintética foi inserida em4270ms; a etapa funcional falhou na navegação após importar contacto, sem chegar à selecção da fotografia. Captura mostra gaveta aberta e Conversas ainda seleccionada. Preparada correcção do XCTest: resolver o landmark Main navigation depois de abrir, esperar hittable no mesmo orçamento de30s e guardar geometria de candidatos. Não há retries de toque, JSinjectado ou passe Apple inventado. Artefacto em .cache/onboarding-i18n/ci-02188.

Após interrupção, PID antigo2598300 estava ausente e não havia dispositivo adb. Registo preservado em emulator-ended-2598300.json; mesmoAVD arrancado semwipe, novoPID70918/adb5047. APK40d808ae6baa6c89b427c983c4d5ae6f9724b48f9226b68242f5381ec81ff458 construído/instalado. Novo modo --pages da instrumentação passou25asserções: UI de cópia/ordem, documento exacto assinado recebido pelo Node, ACK privado e rascunho recuperado após reiniciar núcleo. Não existia rascunho anterior; ramo de restauração será exercitado no gate final. SourceRuntime WebView DOM events, não toque físico.

Gate geral UI em curso: node scripts/verify-ui.mjs, sessão36025, .cache/ui-verification/report.json e .cache/onboarding-i18n/page-shared-ui-gate.log. Fontes congeladas até recolher resultado. iOSstatic/22testes do runner passaram antes do gate; não executam a correcção no Apple. Restantes gates/móveis e evidência consolidada continuam pendentes.


Gate shared UI36025 concluídoPASSED:31Node+31Go, Linuxbuild/run/package/run, fontes estáveis. Matriz autónoma completa iniciada com Chromium/Firefox/WebKit, incluindo site-pages e mobile-navigation. Estado .cache/page-organisation/matrix/report.json; fontes congeladas até concluir. Não repetir por timeout de observação. O próximo gate Android deve recompilar a instrumentação depois da inclusão do campo previousDraftRestored; APK40d808ae de execução permanece válido se os hashes dos assets continuarem iguais.
