# RelayLoom — retoma activa, 2026-09-15

Preview local actual: o processo antigo já não estava a escutar (ECONNREFUSED; nenhum processo foi encerrado). O build root das curvas portáveis passou e foi iniciado Vite preview na sessão20015, porta4174, entrada http://127.0.0.1:4174/browser/index.html. VerificaçãoHTTP200 e títuloRelayLoom concluída. É só distribuição estática de código; a identidade/dados permanecem no browser. Manter este processo para demonstração; o resto dos testes locais terminou.

## Ponto autoritativo final desta etapa

HEAD e origin/main confirmados: f378e130456d036315d9a0b432d65e71b22860a3. Push38336 terminou0. O marco de curvas portáveis/matriz está publicado. Todos os gates locais terminaram; nenhum processo de teste local ficou a meio. Gates87092 e6820:30browser porengine(90),3UI-RNS porengine(9),25UI Node+25Go,desktopLinux build/run/package/run. Evidência docs/evidence/browser-matrix; observação RTC anterior continua em aberto, sem correcção alegada.

Dois CI remotos estão activos/por recolher:
- mainf378:34916793582.
- WIPiOS496788baae0f8ec2b51900dd62ef681fb1914f29:34917778173, branchcodex/ios-keyboard-verification,worktree.cache/ik.

A repetição focada anterior34902268397/eec2806 confirmou teclado fechado com o botão nativo, publicação/contacto/TCP/mensagem privada; falhou depois no selectorPhotoLibrary. Captura real mostra Fototeca. O selector exacto inglês/PT foi corrigido em496788b e a mainf378 foi integrada nesseWIP por merge normal. O conflito add/add da nota foi resolvido preservando o histórico. Nada foi force-pushed e nenhum PR foi merged. O picker/retoma/restanteUI ainda precisam do novoCI, sem antecipar passe. Evidência local/publicável em docs/evidence/ios-keyboard-ci/attempt2.

Root preserva os doisficheirosUIKit/XCTest e notas/capturas anteriores não commitados. STATUS e RESUME têm actualizações locais posteriores ao marco; não fazer push que cancele o CI main activo. O preview anterior4174 foi preservado. Último disco22GiB, reserva15GiB.

A seguir: recolher os dois CI, resolver qualquer falha sem reduzir cobertura e continuar grupos dinâmicos na web (autoridade/IndexedDB/reserva4MiB/CAS/fences/carriers/outbox/replay/UI), restante paridade,backup/rotação/keystore,peering/WSS/NAT,embalagemRNS,quotasglobais/SOS/escala,hardware e revisãoindependente. O projecto não está concluído. Sem criar/retomar agentes enquanto se mantiver a instrução de recuperação sequencial. Modelos,bridges,serviços externos e permissões permanecem inalterados.

Os registos abaixo descrevem etapas anteriores e não substituem este ponto.

## Contrato

Continuar todo o PROJECT-BRIEF.md: Windows/Android/macOS/iOS/Linux e web autónoma com toda a paridade nativa; UI Liquid Glass; mensagens/social/sites declarativos; autoria separada de leitura e seeding; encaminhamento agnóstico entre meios com Reticulum real. Produto NÃO concluído nem validado para catástrofes.

Só este projecto: /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra e recuperação sequencial: sem criar/retomar agentes, sem alterar providers/modelos/bridges/serviços/permissões. Dependências/caches no projecto, uma compilação pesada de cada vez e pelo menos 15 GiB livres (último:22 GiB). Commits/pushes normais autorizados; sem force-push,git add-A,reset de root ou merge de PR. Não cancelar CI activo por um push. Checkpoint adicional de manutenção cancelado. Preservar os ficheiros locais e o preview antigo4174.

## Publicado

HEAD main f378e13 (push em curso/por confirmar no handle38336). Antecessores já publicados:

- a49e4a4: web autónoma/worker/IndexedDB/RTC/WS/SW; gate279Node/26browser/46UI/desktopLinux.
- b514ead: convites web pelaUI, revogação, rota web→WS→RNS TCP/router→sériePTY.
- 2d4d12c: fixture verifica persistência separadamente da entrega; corrigiu o1/58interop doCIa49.
- 335324d: protocolo de certificados partilhado e admissão de chaves degeneradas Node/browser/Go. Gate89503 passou281Node,16pacotesGo-race,5SQLiteC,58interop,28browser,50UI,desktopLinux,457fontes. Go/app416.988s dentro600s.
- f25598d: autora com sóumparRTC→browser intermediário→WS→RNS TCP/sériePTY;3UI-RNS passaram,22 000bytes exactos,partição/heal,relay-off,seederreiniciado comautora e browserintermediáriofechados. CI34906805922 passou tudo excepto iOS/teclado.
- f378e13: curvasNoble portáveis e matriz Chromium/Firefox/WebKit, descritas abaixo. README/STATUS foram consolidados; históricos preservados emdocs/history.

Evidência: docs/evidence/{browser-application/milestone,web-reticulum,control-envelope-storage,group-certificate-profile,rtc-reticulum,browser-matrix}.

## Último incremento — concluído localmente

Falhas reais doWebKit/Linux reproduzidas emgenerateKey/importKeyX25519 egenerateKeyEd25519, antesdoenvio. packages/browser/src/crypto.ts agora usa@noble/curves2.4.0 paraEd/X (mesmos formatosDER,vault ewirev1), RNGdobrowser eWebCryptoAES/HKDF/SHA. Scryptmantido. Sem nova primitiva inventada ou mudanças de segurança.

Os testes incluíram512ciclos de geração/reimportação porengine, oráculosNode, vector públicoRFC7748 e operações nativas de curvas deliberadamenteindisponíveis. Passaram30casos porengine:Chromium153.0.8010.12,Firefox155.0,WebKit26.6WPE/Linux. Não inferir Safari/macOS doUA doWebKit.

A candidata.cache/bm baseada emf255 tem o código efectivamente testado. O gate final limpo87092 terminou0, fontes estáveis porengine. A continuação6820 também terminou0:3percursosUI-RNS emcadaengine (9) e25UI Node+25Go,desktopLinux build/run/package/run.42Axe novos arquivados; não são revisão independente. Não há gate local ainda activo.

WebKit precisou de5libsDeb comversão/SHA fixos emscripts/webkit-host-deps-linux.json. Foram descarregadas/extraídas em.cache/browser-libs e acrescentadas apenas aos caminhos sys/lib do seu bundle: binários ewrappers preservados, nenhum pacoteOS/scriptdeinstalação/root/sandbox alterado. Lock específicoUbuntu resolute/glibc2.43. Scripts de instalaçãoe runner committados. Firefox/WebKit estão em.cache/playwright.

## Observação RTC ABERTA

Um primeiro gateWebKit comcurvasportáveis passou29/30, mas o teste de revogação viu a ligaçãoB-C fechada depoisdeentregarSOS. Causa NÃO estabelecida.10repetiçõesisoladas,uma suitecomdiagnóstico,uma suitelimpa30/30 e3UI-RNS finais passaram. Não chamar aisto uma correcção. A instrumentaçãotemporária sónaBM foi arquivada eretirada; rtc.ts/router.ts deprodução sãoiguais aopublicadoantes. Registo docs/evidence/browser-matrix/known-observations.json; diagnósticos em .cache/milestones/webkit-relay-diagnostics. Se voltarafalhar, recolher causa exacta semaumentarprazos ouretirarcontrolo.

## iOS — ramoWIP e repetição focada activa

codex/ios-keyboard-verification,eec2806b520f63bc4891f0cadfb2233c4e540e0d,worktree.cache/ik. DoisficheirosUIKit/XCTest:botãoOcultar teclado viaUIKeyboardLayoutGuide/view.endEditing(true). Os originaisroot permanecemnão commitados; não os perder.

CI34902268397 tentativa1: UIKit/XCTestcompilou earranque25.409s passou;seed-synthetic-photo excedeuprazo comPhotos emreconstrução antesdotestefuncional. Nãoexercitouoteclado. Evidência docs/evidence/ios-keyboard-ci. CI34906805922/f255 depoisimportouafotografia echegou àfalhaantiga "keyboard dismissed for Um novo fio na rede." (mainnãotemcorrecção).

Após essecontroloindependente dopré-requisito, foi pedidaUMA repetiçãofocada dojobiOSWIP: `gh run rerun --job 104181014070`. O CLIprimeirorecusou run-id+job juntos semefeito; a sintaxecorrecta terminou0. CI34902268397 tentativa2 está EM CURSO, últimaetapa "Execute native iOS UI and real Node peer on one installed simulator". Acompanharsemcancelar. Se passar, integrar os doisficheiros exactos comaviso deescopo; sefalhar,recolher artefactosecausa,semrelançar emciclo. Nãoafirmarpassefuncional antecipado. Hardwarefísico/assinatura continuam bloqueados.

## Próximos passos

1. Confirmarpush38336 eobservar CI novo da mainf378. O últimoCI f255 játerminou, não foi cancelado.
2. RecolherCIiOSWIP tentativa2 e tratarresultado. Preservar todososrootdiffs e históricos.
3. Continuar o domínio OBRIGATÓRIO de gruposdinâmicos naweb: registo deautoridade/IndexedDB,reserva4MiB,CAS/fences,carriers,outbox,replay eUI. Certificados verificados NÃO sãoessa paridade.
4. Continuar backup/rotação/keystore,peeringdurável/WSS/NAT,embalagemRNS,quotasglobais/SOS/escala,matrizdispositivos/radios e revisõesindependentes. Contrato inteiro permanece activo.

Usar staging de ficheiros/blobs exactos; nunca trocar root por um candidato. node_modules e caches das cópias são symlinks deste projecto; não executar npmci nelas. As worktrees antigas e os ficheiros/capturas locais não relacionados com o incremento foram preservados. Evidência de agentes anteriores emdocs/AGENTS.md; nenhum novo agente foi iniciado nesta recuperação.
