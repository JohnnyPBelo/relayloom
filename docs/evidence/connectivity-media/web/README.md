# Reparação da ligação web

Código `359d652`. O cartão guarda um contacto; o caminho entre browsers usa oferta/resposta. A observação do IAB mostrou uma versão antiga e zero pares/contactos, não o estado dos dois dispositivos físicos do proprietário.

O painel separa os papéis, acompanha a ligação nos dois lados, fornece diagnóstico sem SDP/chaves/IP/conteúdo e permite recomeçar. Fechar o diálogo liberta convites pendentes, incluindo resultados tardios; canais abertos permanecem ligados. Código/cópia precedem o campo da resposta. Os dados do perfil não foram migrados ou apagados.

`node scripts/verify-public-web.mjs`: PASS, 67 casos web (30 no build normal, 36 no público, 1 percurso Chromium/Firefox em processos separados), mais 2 oráculos de endereços. Fontes e artefactos estáveis. O teste com dois envios pendentes exige ausência inicial, rejeição de cartão como SDP, confirmação nas duas pontas, mensagens únicas, recibos e libertação de tentativas abandonadas. O atraso artificial de 2 s cobre o resultado tardio; não substitui RTC/cripto.

Reproducer orphan: falhou antes com 1 par pendente em vez de 0; passou após correcção. Os logs intermédios conservam ainda duas expectativas erradas das fixtures e a anotação TypeScript em falta no teste tardio, todas corrigidas antes do gate final.

`first-integrated-gate.json` e `host-ui-before-final-browser-cleanup.json` descrevem a primeira candidata: 61 web, 6 RTC, gate RNS, 25 UI Node + 25 Go e execução do pacote Linux. O último ajuste só alterou o cliente/painel autónomo; a versão final volta a executar o gate público e 3 UI-RNS por engine, todos passados (final-gates.json). Esses relatórios não afirmam testes de dispositivos físicos ou de toda a aplicação nativa actualizada.

Capturas e Axe provêm de browsers no Linux. Diagnósticos exportados contêm apenas estados/contadores. UI WebKit WPE não é Safari/iOS. Não houve teste nos dois dispositivos do proprietário. A publicação HTTPS deve ser confirmada separadamente no registo de deployment e nos testes do URL.

Publicação eafa109…, source359d652, Pages35033701343 success/HTTPS obrigatório. Treze ficheiros de execução conferidos por hash. No URL público:1percurso Chromium/Firefox entre processos passou17,7s e2testes connectivity passaram (ver logs). IAB confirmado no assetnovo após navegação pela raiz: simples reload conservava o controlador offline antigo por desenho. Perfil continuou inicializado; não foram lidas chaves nem frase-passe. Guia corrigido para fechar os clientes antigos e reabrir.
