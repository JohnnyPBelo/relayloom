# Setup inicial, idiomas e continuidade do produto

Objectivo adicional do proprietário: concluir o produto, verificar todas as funções como utilizador com várias contas, aprofundar sites na óptica ZeroNet, explicar/configurar o produto no início, permitir várias línguas e manter UI profissional/intuitiva. O âmbito completo continua aberto.

O turno anterior foi progresso: fonte11d52be, entrega8a10142 e distribuição86cb0c3 publicadas e verificadas. CI35088386689 terminou: Node nos três hosts, Go, RNS, browser e pacotes desktop passaram; iOS falhou. A tentativa de recolher log-failed devolveu zero bytes, pelo que ainda não se atribui causa; job104779817281 passou build unsigned/testes host e falhou no passo de execução do simulador.

Recuperação sequencial mantém-se: não criar/retomar agentes, alterar modelos, providers, bridges ou serviços. WIP UIKit/XCTest/GroupNotices preservado; nenhuma operação anterior de teste/publicação está pendente. Disco71GiB, reserva mínima15GiB.

## Implementação em curso

- Catálogo explícito de interface em PT-PT, en-GB e es-ES, escolhido pela preferência guardada ou língua suportada do dispositivo. Selector antes da identidade e nas definições. Armazenamento da língua separado do cofre; falha de preferência nunca reinicializa perfis.
- Strings de interface, erros apresentados e datas devem usar localização explícita. Não usar MutationObserver/tradução automática do DOM: mensagens, nomes e páginas assinadas podem conter palavras iguais à interface e devem ficar intactos.
- Setup inicial deve explicar mensagens, pares, leitura/seeding e autoria; configurar identidade, língua e aparência; orientar configuração de rede/participação real. Não activar rádios/serviços nem inventar ligações.
- Inventário inicial em .cache/onboarding-i18n/string-inventory.json:936 ocorrências/857 valores, inclui alguns valores técnicos que exigem filtragem. Não declarar toda a interface traduzida só pelo selector.

## Validação prevista

Testes de preferência/idioma não suportado/interpolação e datas; UI completa em inglês/espanhol, troca de língua com rascunhos e conteúdo inalterados; três contas com mensagens/anexos, social e site lido/servido após autora offline; setup e configuração persistente, lock/reload/recovery, teclado e Axe em vários tamanhos. Conservar suites anteriores em PT explícito, sem remover cobertura. Build sempre antes da UI; hashes de fonte/assets e screenshots reais.

Depois: revisões/endereço estável de sites, dados/contribuidores assinados com permissões, ficheiros opcionais; grupos dinâmicos web, restantes funções e todas as plataformas. Não substituir o contrato por esta etapa nem marcar concluído enquanto houver funções, hardware ou revisão sem prova.

## Execução inicial

Fundação e catálogo de welcome integrados. npm run build passou duas vezes; teste node scripts/e2e.mjs --config tests/browser/browser.config.ts tests/browser/onboarding-language.spec.ts passou1/2,7s e1/3,0s após extracção para WelcomeScreen. Capturas reais mostraram a necessidade de encurtar o caminho no móvel; apresentação e identidade agora são etapas distintas, conservando os campos até ao desbloqueio. A primeira transcrição JSX perdeu o espaço entre texto e em: ajustado com espaço explícito, preservado no codemod para futuros textos. Último build+teste em sessão3219.

A aplicação inteira ainda não está traduzida. Próximas tarefas: catálogos por área, mensagens dinâmicas/datas/erros, preservar conteúdo assinado; helpers e contextos antigos em PT explícito + entrada Começar; testes de três identidades EN/ES com conversas/sites; build antes de cada teste. Não adaptar o produto para contornar expectativas antigas de UI — actualizar o fluxo dos testes mantendo controlos.

## Estado de integração local — ponto seguro

Não commitado nem publicado. O marco público continua8a10142/86cb0c3. O objectivo completo mantém-se activo.1031 entradas de catálogo PT-PT/en-GB/es-ES; lookup explícito, contextos (ex.: páginas do editor), nomes/parâmetros sem tradução recursiva. Setup separado em apresentação/identidade, preferências de leitura, guia recuperável nas definições, validação de formulário localizada. Nomes, mensagens, páginas e descrições escritas pelo autor mantêm os bytes/texto originais.

A revisão corrigiu rótulos de textarea que absorviam o conteúdo, comparação de estado de aprovação com texto traduzido (agora usa grupo/estado verificado), e Publicaciones cortado (paleta com ícones/etiquetas e grelha adaptável). Preservados logs das tentativas em .cache/onboarding-i18n. As capturas de falhas antigas podem ter sido substituídas pelo runner; só afirmar existirem quando a cópia foi efectivamente guardada.

### Preferências nativas

Desktop usa --http-port0; mobile chama app.Start com HTTPPort0. Preferência apenas em localStorage não cobria reinício da origem. Implementados packages/preferences/src/index.ts, apps/node/src/ui-preferences.ts, native/app/ui_preferences.go e endpoint autenticado GET/POST /api/ui-preferences. Só aceita língua/tema/glass/largeText/highContrast; não altera relay, identidade ou chaves. Ficheiro privado ui-preferences.json versionado, limitado a4096bytes, rejeição de symlinks/corrupção, patches preservam outros campos; corrupção não reinicializa o perfil. Node verifica requireRunning; Go usa n.mu/closed.

Frontend apps/web/src/device-preferences.ts coordena cache web e persistência nativa, fila serial de alterações, erros/repetição explícita e hidratação que não substitui escolhas mais recentes. Main configura o backend nativo através de usesLocalAPI e aguarda a leitura de preferências antes de aplicar o primeiro state; a verificação de geração/seq mantém-se depois do await. Campos do formulário são preservados em estado, mas submissão usa FormData para respeitar valores visíveis/autofill/host.

### Testes efectivos

- Build TS/Vite e Go CLI passaram. Último build .cache/onboarding-i18n/palette-build.log.
- node --import tsx --test tests/ui-preferences.test.ts tests/i18n.test.ts:7/7. Catálogos completos nos lookups literais/mapas, sem duplicados ou parâmetros perdidos; schema/getter, ficheiro limitado/corrupto/symlink.
- node --import tsx --test --test-concurrency=1 tests/native/ui-preferences.test.ts:2/2, Node→Go e Go→Node; auth, campos indevidos, alteração concorrente, cofre intacto e corrupção.
- Node UI completo antigo flows.spec.ts:1/19,2s após idioma PT e Começar explícitos. Não é o gate integral.
- Group-language Node:1/11,3s, criadora EN/membro ES, aprovação verdadeira e mensagem epoch com autoria verificada.
- Onboarding-language:4/15,4s na última regressão web; setup/língua/aparência, duas contas RTC/anexo, separador bloqueado/reactividade, quota de preferências e identidade preservada. Comparações de cartões usam objectos JSON completos, não ordem de propriedades.
- Device-preferences Node:2/3,7s; Go:2/2,5s. Reinício real de processo, porta antiga retida por fixture para garantir origem diferente, idioma/aparência e identidade recuperados. Resposta GET antiga não sobrepõe escolha mais recente.
- Site-language:1/19,8s no último ajuste, três contas, três páginas/imagem, importação inválida recusada, autora fechada, seeder pausado/activo e leitor novo. Paleta ES nas larguras1440/720/390 e Axe passaram.

Todos os processos de build/teste conhecidos deste incremento terminaram; sessões3219,52328,9379,98496,90261,12384,56403,30977,95052,73853,93722,82851,99782,81390,93216,63773,31051,25804,71743,39661,61414,38314,7465,6089,7303,82065,1043,58165 já foram recolhidas. Não relançar por confundir ficheiro de estado antigo com processo activo. Não houve novo agente/provider/bridge/auth/serviço modificado. WIP UIKit/XCTest/GroupNotices preserva exactamente os hashes originais.

### Próximos passos obrigatórios

1. Rever a implementação da fila/hidratação de preferências e ampliar falhas se necessário. O relatório de tests/native/ui-preferences.test.ts usa flags de controlos no finally; torná-las condicionais ao sucesso para não descrever controlos não executados em futuras falhas.
2. Adaptar testes móveis sem apagar WIP: iOS força AppleLanguages(en) para picker em inglês mas ainda procura a UI PT e Criar identidade antes do novo Começar. Actualizar por entradas UI EN/etapa de setup ou escolha real da língua, mantendo todos os passos de fotografia/teclado/retoma. Não declarar teste Apple executado neste Linux. scripts/android-ui.py precisa de escolher PT na UI e entrar em Começar antes de procurar campos; NativeSmoke.java espera UI PT. A submissão FormData mantém compatibilidade com o input do host. A execução Android nova ainda está pendente.
3. Executar gate integral sobre fontes congeladas e build anterior à UI: Node/raceGo/SQLiteC/interop, matrizes Chromium/Firefox/WebKit, UI Node/Go, desktop e public-web+RNS. scripts/verify-public-web.mjs e tests/browser/public.config.ts já incluem onboarding-language e site-language. Os contextos/tests anteriores têm PT explícito e dez entradas reais em Começar; nenhum caso foi removido.
4. Desktop smoke foi adaptado para clicar data-action=setup-start e comprovar o formulário visível e língua suportada, mantendo sandbox/API/canário. A execução/empacotamento desta alteração ainda não correu.
5. Rever capturas e acessibilidade finais, conservar evidência sanitizada, actualizar README/STATUS/traceabilidade, commits/push normal e publicação exacta só depois dos gates. Sem git add-A/reset/force.
6. Continuar sites (heads/revisões, contribuições assinadas/permissões e ficheiros opcionais), grupos dinâmicos web, backup/rotação/keystore, quotas/escala, restantes funções/apps/rádios e revisão independente. Nada disto foi dispensado nem declarado concluído.

## Retoma seguinte — testes gerais activos

O turno anterior foi progresso real. Corrigido o relatório de tests/native/ui-preferences.test.ts: flags de controlos só aparecem após sucesso. A fila web conserva todos os campos que não conseguiu guardar; guardar um campo já não apaga o aviso de outro campo pendente. Eventos de cache de outras vistas não são tratados como novas instruções na modalidade nativa; a fonte é o perfil.

Testes novos passaram: preferências Node3/4,3s e Go3/3,2s, incluindo resposta aplicada/perdida, repetição e escolha mais recente durante a resposta atrasada. Web5/16,4s, incluindo dois campos sem espaço e recuperação posterior. Logs retry-node.log, retry-go.log e retry-web.log em .cache/onboarding-i18n.

Testes móveis adaptados mas ainda não executados: XCTest conserva AppleLanguages(en), usa36 textos ingleses correspondentes ao catálogo e toca Get started nos dois arranques. Lógica anterior de teclado/fotografia/relaunch conservada; backup em .cache/onboarding-i18n/mobile-before/NativeSimulatorTests.swift e lista de alterações ios-ui-language-edits.json. UIKit RelayViewController não foi alterado neste turno. scripts/android-ui.py agora tem select-language e begin_setup, usando opções visíveis da aplicação, sem mudar a língua do Android. py_compile passou.

Artefacto real iOS de CI35088386689 recolhido (10444409962,609003bytes). Relatório confirma startup1/1, falha seed-synthetic-photo aos60340ms. Diagnóstico mostra biblioteca prep-accessible e pedido de inserção de1asset pelo CoreSimulatorBridge, sem conclusão registada. Isto não demonstra causa nem correcção; não mudar serviços/permissões e não chamar a fotografia testada. Ficheiros em .cache/onboarding-i18n/prior-ios.

**Em execução:** node scripts/verify-onboarding-languages.mjs, sessão56541, consola .cache/onboarding-i18n/gate-console.log, relatório .cache/onboarding-i18n/final/report.json. Última observação confirmou RUNNING em node-all, PID2003706. Já passaram build web, contrato do runner iOS no host e build Go. Fontes congeladas; antes de editar/repetir, recolher a sessão e o relatório. O gate inclui Node, Go-race, SQLiteC, interop, toda a matriz de browsers, UI Node/Go/desktop, public-web e9UI-RNS; não é teste físico/Apple.

A consulta android-emulator.py status confirmou nenhum emulador/dispositivo e nenhum pidRecord, mas o próprio adb iniciou o servidor isolado do projecto na porta5047. Fica disponível para a próxima etapa Android; não confundir com emulador activo nem parar serviços externos. Disco69GiB na leitura inicial.

Depois do gate: corrigir qualquer falha conservando evidência e cobertura; executar APK/Android no AVD existente, rever UI/capturas; continuar diagnóstico iOS sem fabricar resultados. Só publicar depois dos gates aplicáveis, com estado de plataformas preciso. Persistem todos os restantes requisitos e a revisão independente; recuperação sequencial sem agentes novos. O marco público ainda é8a10142/86cb0c3.

Actualização do gate56541: Node-all terminou exit0 (381329ms); a última leitura confirmou native-race RUNNING, PID2022724. Recolher o relatório/sessão antes de qualquer nova operação.

Gate56541 em 2026-09-16T17:09:28.107Z: native-race PASS (419563ms), SQLite C PASS; interop-all confirmado em curso, PID2053793. Fontes ainda congeladas. A imagem sintética iOS foi verificada localmente:128×128,336bytes, todos os CRCs válidos (ios-png-check.json); não prova importação no simulador. Novo guia de utilizador docs/SETUP-LANGUAGES.md descreve âmbito e limites, ainda sem publicação deste incremento.

Gate56541: interop-all PASS62/62 (451781ms reportados pelo teste); Chromium PASS43/43. Última observação confirmou browser-firefox RUNNING, PID2158726. As fontes continuam congeladas. Revisão estática adicional confirmou textos nativos PT em MainActivity.showStatus e RelayViewController.showStatus/keyboardDismissButton; localizar estes ecrãs/controlos ainda é obrigatório para a apresentação nativa, sem apagar o WIP anterior. Não inferir que a tradução da WebView já os cobre.

Gate56541: Firefox43/43 e WebKit43/43 concluídos com sucesso; total129 casos da matriz. Última observação: shared-ui-and-desktop, PID2263463, RUNNING. Fontes congeladas até à conclusão. Não voltar a correr a matriz sem alterações relevantes.


## Gate concluído e retoma Android

Relatório final PASS em .cache/onboarding-i18n/final/report.json, terminado2026-09-16T18:02:00.870Z. Sessão56541 recolhida; fontes estáveis. Todos os checks passaram:345Node,Go-race/SQLiteC,62interop,129browser,60UI Node/Go, pacote Linux executado, public-web e9UI-RNS. A candidata não foi publicada. Estado corrente de Android e pendências em RESUME.md; os estados RUNNING acima são observações históricas. APK1db4be779f4eadcde202e053567ca735c86489e8e77eec3ed54a3a2b528b7658 foi instalado sem wipe no emulador existente; gates de execução pendentes.


## Localização nativa — implementação corrente

Android NativeText lê só ui-preferences.json (4096bytes, UTF-8/JSON/schema validados, sem seguir links no core/ficheiro, open não bloqueante); fallback à primeira língua suportada do SO. Traduz arranque/erro, avisos de documentos e notificações genéricas, sem alterar permissões ou conteúdos. APKd2dd1ab1fddbf3b25ecc7145d9ef8552229330adee7e5a4d261313d77f274016 instalado. Smoke passou55 asserções, incluindo32controlos de reader e3línguas pela UI/DOM; cofre intacto, transporte/armazenamento/restart reais. SAF documentos passou com16121bytes exactos e recuperação da identidade; relatório .cache/android/evidence/documents-29c87e2fd0dd. Prazo SAF ainda em curso, sessão86906, log .cache/onboarding-i18n/android-native-text-deadline.log.

Na captura de smoke, a bolha ainda dizia Em espera após reinício: a fixture suspendia logo após receber uma resposta, sem esperar confirmação assinada. Não prova defeito de entrega; ampliado o teste para exigir Recebida antes da suspensão e depois da retoma, mantendo prazos. Nova execução dirigida pendente, sem alterar runtime.

iOS NativeText.swift/localização do teclado/avisos preparada, mantendo WIP UIKit. Testes de reader no host Apple acrescentados a PolicyTests e projecto actualizado. ios-static-check e22testes do runner no Linux passaram, mas NÃO compilaram Swift nem executaram iOS. Nova asserção do rótulo inglês do teclado no XCTest; execução Apple ainda obrigatória.


## Gates móveis concluídos, candidata e publicação pendente

Android finald2dd1ab1:57smoke com confirmaçãoRecebida persistente (sessão86546exit0);38SAF(s54408exit0);15prazo aos120691ms(s86906exit0);13relay(s13580exit0);private-profileexit0 com hash instalado confirmado e cofre/legacyintactos face ao baselinehistórico. Não é nova migração. Emulador2598300conservado; app reaberta.

75artefactos sanitizados,5,49MB, em docs/evidence/onboarding-languages, com hashes originais/finais e comparação de fontes. Capturas de introdesktop/estúdioES390/Android recebida inspeccionadas; Axe não equivale a revisãoindependente. Branchdeintegração codex/setup-languages separa37e0cdebackend,f799539UI,c2d6fb0Android,ea2ee98iOSpendenteApple. Novo gatepúblico36287ainda emexecução; detalhes correntesemRESUME.md. Nenhum passe anterior foi substituído ou usado como passeApple.


## Falha posterior à publicação — conservar, não promover

Novo gatepúblico36287PASS(121+2), relatório preservadopublic-final. Pages35139489431success, fonte02188da/distribuiçãoeff7e9b9,17hashesHTTPPASS. O driverHTTPS40761FAIL(3clicktimeouts/6passes) incluía porerro6casos novos queusaramlocalhost. Corrigidosapp-host/uiHost e3ficheiros. Typecheck+controlosPASS; dirigido20801noHTTPSrealFAIL90sdepoisdetrocamensagens/anexo, antesdeconcluirmudançalíngua/retoma. Pressãomemóriafullavg300~33%observada,nãocausademonstrada. docs/evidence/onboarding-languages/live eRESUME guardamâmbito,traceslocais,comandos ependentes. Nenhumaalteraçãodeapp/transporte paraestafalha,nenhumaumentodeprazos,nenhumprocessoexternoparado. VerificadorWIPnãocommitado; nãochamarpublicaçãototalmentevalidada.
