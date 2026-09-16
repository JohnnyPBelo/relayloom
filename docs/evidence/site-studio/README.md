# Estúdio de sites — evidência local

O produto completo não está concluído. Resultado final local PASS em 2026-09-16T10:54:22.257Z.

338 testes Node; 16 pacotes Go com race (app executada, restantes cacheados); 5 pacotes SQLite C do host; 60 testes de interoperabilidade; 37 casos por motor Chromium/Firefox/WebKit (111); 26 UI Node e 26 UI Go; build/execução/pacote/execução Linux; 85 casos do gate web público e 2 oráculos; 9 percursos UI-RNS.

Reprodução completa: `node scripts/verify-site-studio.mjs`. A retoma executada está em `provenance/verify-publish-final.mjs`, com comandos, fontes e resultados em `gates/final.json`. Herdou quatro gates de domínio após comparar hashes, permitindo apenas alterações de estilos, painel RTC e testes UI. O relatório original dos domínios conserva FAIL por uma falha UI posterior; apenas os quatro checks com exit0 são herdados.

As fontes da UI e os assets mantiveram-se estáveis durante a matriz final, que começou por build explícito. Tentativas anteriores serviram CSS antigo; não provam a correcção final. Uma candidata pública falhou por feedback RTC desfasado do diagnóstico. O painel foi corrigido mantendo testes/prazos/transporte. Uma asserção ambígua de status e um PNG sintético inválido também foram corrigidos. Os logs preservam esses resultados.

Os percursos entre processos verificam rascunho cifrado, falhas de autorização/corrupção, autora terminada/porta recusada, ausência sem caminho e com relay pausado, reinício do seeder e bytes idênticos no terceiro leitor. As capturas usam conteúdo sintético. Perfis privados e traces não foram publicados.

Axe/auto-revisão não são revisão independente. Go/SQLite host não são Android; WebKit/Linux não é Safari/iOS; viewports não são dispositivos; PTYs não são rádios. O inventário de fontes inclui UIKit/XCTest WIP preservado que estes gates Linux não compilam. Publicação HTTPS concluída e validada: ver [live](live/README.md).
