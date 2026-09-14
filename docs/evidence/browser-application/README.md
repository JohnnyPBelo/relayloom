# Aplicação web autónoma — marco real, paridade incompleta

`node scripts/verify-autonomous.mjs` terminou0 com **403fontes inalteradas**. Base526d75a, código ainda local não commitado. O teste não usa umdaemon para fornecer as APIs da aplicação web.

- Typecheck5.007s, build2.135s eCLI0.283s.
- **271testesNode passaram475.610s**, após extracção dos modelos partilhados deconteúdo/outbox.
- **26testesbrowser passaram123.368s**: núcleo/transporte, API, UIautónoma, worker, storage, perda deresposta, recargaoffline e corrupção.
- **21fluxosUI por motor nativo**: Node203.927s,Go168.723s.
- DesktopLinux: build0.239s,execução1.891s,pacote15.284s,execução empacotada1.572s.
- **72Axe arquivados sem violações**. Root reviu conversa móvel eeditor da aplicação autónoma. Não é revisãoindependente ou teste manual de leitor de ecrã.

AsfontesGo não mudaram em relação ao gate nativo anterior; o comparativo está noscope.json. Não se apresenta um novo passeGo/race nestaetapa.

A entrada `/browser/index.html` cria identidades/contactos eenvia DMs porRTC, comoutboxoffline/UUID/recibosassinados/reload. Publicações, reacções/comentários, colecções eeditorDND foram exercitados. O leitor mostrou página assinada após o autor fechar e após recarregar. Conteúdo contendo script permaneceu texto.

O worker não enviou camposde chavesprivadas nas respostas observadas. Perder uma resposta de send depois de commit não criousegundapublicação. Umasegundaaba não assumiu o perfil activo. Corrupção do estado manteve a identidadebloqueada. Reservas impediram expulsão; erro de callback/abortoIDB preservaram conteúdo+ledger anteriores.

O servidor de código respondeu200 no controlo positivo e503 depois; aaplicação recarregou eabriu perfil/rascunho a partir deassetsverificados eIndexedDB, seminstalarPWA. Código corrupto emCacheStorage foi recusadooffline;voltou a funcionar apenas após regressar uma origemdisponível combytesverificados. Hashes não protegem contra umaorigemmaliciosa nem equivalem aassinarrelease.

Falhaspreservadas: navegação mobile dafixture, nomeacessívelConversas comcontador, DOMExceptionvazia tratada comosucesso eworker fora doescopoSW a pedir ficheiro503. Corrigidos sem retirar assertsnem aumentar prazos. Oworkerfoi movido para/browser. O serviceworker controla apenas esseâmbito eassetsconhecidos; não cacheia /api nemconversas.

Preview local iniciado àparte: http://127.0.0.1:4174/browser/index.html. Backend de automaçãoIAB não encontrado; abertura de painelCodexficouqueued, sempassegráfico IABreclamado. Os testes e capturasChromium descritosacima são a evidênciaUI real.

Continuam obrigatórios ependentes: gruposdinâmicos/autoridadenobrowser, restanteparidade, escala/concorrência/lifecycle sobcarga, fullbackup/rotação/keystore, peeringdurável/WSS/NAT, C2/C3 adversarial/gatesSQLite/interop/Windows, aparelhos/rádios/Safari/Firefox e revisãoindependente. Não há deploypúblico nem declaração deinfraestrutura de emergência pronta.
