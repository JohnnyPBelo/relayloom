# CI 14457fd — browser completo; iOS ainda bloqueado na importação

[Execução35802455142](https://github.com/JohnnyPBelo/relayloom/actions/runs/35802455142), fonte 14457fd95345d15267f210fa9eec923b7fd1fad0, terminal FAILURE apenas no iOS. Os restantes jobs terminaram com sucesso: Node Windows/macOS/Linux, Node UI, Go/race, interoperabilidade, UI Go, Reticulum, três pacotes desktop e os dois shards de browser.

## Cobertura de browser preservada

Os dois relatórios Playwright terminais confirmam **90 + 69 = 159 testes PASS**, zero skipped/unexpected/flaky. O primeiro demorou 343,139 s e o segundo 487,756 s de testes. Os manifests de descoberta provam a união completa e sem duplicados; a execução sequencial conservou 15 min/job e todos os limites dos testes. Artefactos10728817087 (2850813bytes) e10728134555 (35009bytes), hashes dos ZIPs em browser-shards-verified.json. A mudança resolveu o excesso de orçamento da composição anterior sem eliminar cobertura. Não atribuir estes passes ao WIP de entrega de recibos posterior.

## Apple: causa ainda não demonstrada

Artefacto10727898996 (351690bytes),21 ficheiros dos manifestos verificados sem divergências. Xcode26.6/iOS26.4.1 reais: build-for-testing 30,713 s, instalação 12,550 s e startup XCTest 84,166 s PASS. O simulador arrancou em 62,946 s. A única importação da fotografia sintética excedeu 60,364 s; o percurso funcional principal não chegou a executar. O selector Swift compila, mas não foi exercitado nesta execução. Não houve mensagem/anexo/resposta desta execução nem teste físico/signing.

A repetição confirma um bloqueio no pré-requisito addmedia, não a sua causa. Os logs são preservados; não aumentar deadlines, repetir a mutação incerta em ciclo nem alterar permissões/serviços. O próximo controlo de inicialização pela própria UI Photos do simulador é apenas uma hipótese documentada em IOS-PHOTO-LIBRARY-READINESS.md, ainda não implementada/testada nesta fonte.

A persistência f131652 pertence a esta fonte; entrega automática dos recibos, decisões/proveniência/UI de contribuições e restantes plataformas/rádios/revisão independente continuam com âmbito próprio. O HTML público não foi actualizado por este CI.
