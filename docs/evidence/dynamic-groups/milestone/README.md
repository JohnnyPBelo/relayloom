# UI dinâmica — marco isolado sobre bb85d1a

`node scripts/verify-ui.mjs` terminou0 na sessão7421. 364 fontes inalteradas; typecheck4.513s, web1.782s, CLI Go9.246s;23 E2E Node164.130s e23 Go150.658s; desktop Linux build0.128s, arranque2.124s, pacote12.068s e execução empacotada0.817s. `report.json` conserva comandos e hashes, `scope.json` lista70 auditorias Axe sem violações.

As capturas em node/go correspondem ao motor indicado; as do fluxo dinâmico estão em groups. A revisão visual foi feita pelo implementador, não é revisão independente nem teste manual de leitor de ecrã. Larguras móveis não são dispositivos Android/iOS.

`before` conserva falhas reproduzidas: rascunho reposto por resposta tardia após lock; contador9px fora do botão a320px; primeiro arranque Electron falhado por socket111bytes na cópia longa. Após as correcções e a mudança da cópia para `.cache/u`, o gate completo foi repetido sem reduzir testes. Os traces privados completos ficam na cache local; os screenshots públicos contêm apenas dados sintéticos das fixtures.

O preview web principal não foi recompilado ou reiniciado por este gate. A aplicação autónoma e os seus grupos dinâmicos continuam em consolidação/implementação. O CI Windows de bb85d1a continua falhado e exige trabalho próprio; este passe local não o substitui.

Os logs públicos normalizam apenas espaços finais; scope conserva os hashes dos logs originais guardados na cache. Capturas completas dos fluxos anteriores ficam no arquivo local; são publicadas as capturas novas dos grupos, das falhas e do desktop, junto das70 auditorias.
