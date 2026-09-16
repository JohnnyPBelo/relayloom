# Setup, idiomas e preferências — evidência de integração

O produto completo não está concluído. Esta evidência descreve os gates locais e Android. A distribuiçãoeff7e9b9 foi posteriormente publicada; a [verificação HTTPS](live) está incompleta e conserva falhas e uma correcção do verificador.

## Gate geral concluído

`node scripts/verify-onboarding-languages.mjs` terminou PASS em 2026-09-16T18:02:00.870Z, com fontes estáveis. [Relatório](local-gate.json) e [logs](logs):

| Gate | Resultado observado |
| --- | --- |
| Build | TypeScript/Vite e CLI Go passaram |
| Node | 345 testes passaram |
| Go | Race detector passou; parte dos pacotes estava em cache. SQLite C do host também passou |
| Interoperabilidade | 62 testes passaram |
| Browser autónomo | 43 Chromium + 43 Firefox + 43 WebKit: 129 casos no Linux |
| UI Node/Go | 30 por motor: 60; Linux desktop build/run/package/run passou |
| Candidata pública local | 19 por motor (57), 63 na matriz pública, 1 entre processos: 121 casos, mais 2 oráculos |
| UI através de RNS | 3 por motor: 9; sockets e PTY, não rádios físicos |

As preferências autenticadas sobrevivem a reinício Node/Go, preservam a identidade/relay e recusam campos indevidos ou ficheiro corrupto. A UI inclui configuração inicial, três línguas, campos conservados, apresentação de erros e repetição. Os testes usam várias contas para mensagens, anexos, aprovação de grupos e sites com um novo leitor depois de a autora fechar. Conteúdo do autor mantém a língua original.

## Android posterior ao gate

Só a apresentação/testes móveis e os scripts Apple mudaram depois do gate geral; [comparação exacta](source-conservation.json). Web, Node/Go e transportes conservaram os bytes das fontes. O Android foi recompilado e executado com estas alterações.

APK `d2dd1ab1fddbf3b25ecc7145d9ef8552229330adee7e5a4d261313d77f274016`, AAR `9c81c716454f6d7a064699690eb4cad8f0461241e94f35427243e4a5e2fea23b`. O gate privado compara o hash do APK efectivamente instalado. Mesmo AVD API36 x86_64, identidade sintética conservada, sem wipe.

| Comando | Resultado |
| --- | --- |
| `python3 scripts/android-build.py` | APK construído, assinatura de desenvolvimento e alinhamento verificados; testes de políticas no host passaram |
| `python3 scripts/android-instrumentation.py` | APK de testes separado construído |
| `python3 scripts/android-emulator.py install` | Instalação da actualização, sem apagar o perfil |
| `node scripts/android-smoke.mjs --final --evidence-dir .cache/android/evidence/onboarding-delivery` | 57 asserções: 32 controlos do reader de preferências, PT/EN/ES, cofre intacto, mensagens cifradas e estado Recebida antes/depois de restart |
| `node scripts/android-documents.mjs --final` | 38 asserções; selector e destino do sistema, 16121 bytes exactos, cancelamentos/limites e exportação de cofre que recupera a mesma identidade |
| `node scripts/android-documents.mjs --final --deadline` | 15 asserções; expiração observada aos 120691ms, sem prolongar o prazo de 120s; retorno Home fechou os listeners em 1182ms |
| `node scripts/android-relay.mjs --final --evidence-dir .cache/android/evidence/onboarding-relay` | 13 asserções no dispositivo, mais controlos do host; A–Android–C sem caminho directo, negativo em pausa 4s, 12052 bytes exactos após retoma e seeding com autora parada |
| `node scripts/android-private-profile.mjs .cache/android/evidence/onboarding-native-text` | PASS; SQLite cifrado do dispositivo autenticado pelo Node; identidade e cifra legada preservadas em relação ao baseline histórico |

O baseline privado foi reutilizado do mesmo AVD já migrado: este incremento **não executou uma nova migração**. A UI usa input UIAutomator para a escolha inicial PT e eventos DOM/React na instrumentação; não é toda input físico. Microfone, câmara, notificações reais, ARM64 e rádio físico não foram testados.

A primeira captura mostrava Em espera: a fixture suspendia o transporte logo após receber uma resposta, antes de aguardar a confirmação assinada. Acrescentou-se a asserção Recebida antes/depois do reinício. Passou sem alteração ao transporte nem aumento de prazos. As execuções anteriores e as capturas ficam em .cache/onboarding-i18n e .cache/android/evidence/onboarding-{initial,native-text}.

## iOS pendente

Foram preparados textos nativos de arranque/erro, teclado e alertas, um leitor limitado de preferências e testes Swift. `python3 scripts/ios-static-check.py` e `node --test apps/ios/Tests/SimulatorRunnerTests.mjs` passaram no Linux (22 testes do runner). **Não compilaram Swift nem executaram iOS.** Descrições dos pedidos do sistema em Info.plist ainda estão em PT.

CI anterior35088386689: startup XCTest1/1 passou; importação da fotografia sintética excedeu60340ms, sem causa demonstrada. Não foi dispensada nem substituída por uma alegação de sucesso. Continuação Apple obrigatória.

Capturas e relatórios são de fixtures sintéticas. [Manifesto](manifest.json) conserva hashes originais e dos ficheiros sanitizados. Não inclui cofres, perfis, tokens, chaves privadas, SDP ou traces privados. Revisão independente, plataformas/dispositivos físicos e restante PROJECT-BRIEF.md continuam abertos.
