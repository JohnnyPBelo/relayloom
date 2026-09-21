# Recursos extensos e pausa do relay — validação local

Código guardado em `def424f` (inspecção) e `5f6a929` (relay); o contrato autónomo de contribuições está em `995861d`. O gate começou em `7f67d1d` com WIP, depois guardado sem mudar os bytes. `report.json` contém comandos, ambiente, horas e hashes antes/depois; `summary.json` distingue os resultados da fonte actual dos anteriores.

## Resultados

- Fonte actual: typecheck, 33 testes de contratos, Go `./sites` com race, build web, **107 WebKit**, **um percurso de recursos com Node e um com Go**, Linux build/run/package/run. Nenhuma falha, skip ou flaky nos percursos de browser/UI.
- Depois das duas correcções finais: **12 casos dirigidos por engine** (Chromium, Firefox, WebKit), abrangendo routing, pausa de relay e contrato de contribuições.
- Antes dessas correcções: matrizes completas **104 Chromium e 104 Firefox**, conservadas com origem e oito ficheiros alterados identificados. Não são reclassificadas como matrizes completas da fonte final. A regressão WebKit final acrescenta três controlos de corrida, perfazendo 107.
- A página válida com 128 blocos e 123 referências verificou todas as referências em 10,6 s no WebKit deste host, sem alterar o prazo de 15 s. A reabertura cancelou a subscrição antiga e emitiu novo pedido, com `posted=2`, `held=2`, `peak=2`; o resultado não é cache de autorização.

## Falhas e controlos preservados

O CI anterior chegou a 116/123 referências. As duas filas de mutações serializavam inspecções readonly; os controlos separados demonstram concorrência real, bloqueio e invalidação de sessão. O pedido é validado e copiado antes de aguardar, impedindo que o chamador mude `inspect` para `obtain`. Só se partilham inspecções simultâneas da mesma referência no mesmo snapshot/página; pedidos de bytes são sempre individuais. Não há cache de autorizações.

A pausa local podia acontecer durante a preparação de resposta automática e fechar a ligação como frame inválido. Os dois controlos negativos reproduziram o fecho; o terceiro, um erro alheio com a mesma mensagem, já tinha o comportamento esperado. Depois, os 15 casos repetidos passaram: o erro tipado de revogação deixa o canal disponível para tráfego próprio; corrupção e outros erros continuam recusados. Não se captura por mensagem.

O primeiro gate também observou uma criação de oferta RTC Firefox de 61,7 s. Três repetições inalteradas e a matriz Firefox posterior passaram. A causa desse atraso e da ausência histórica de candidatos ICE continua por estabelecer; não atribuir todas essas ocorrências à corrida agora corrigida.

## Reprodução e limites

`run-final-gate.mjs` conserva o driver exacto; numa checkout com dependências/caches do projecto, executa as fases sequencialmente e recusa substituir um relatório já existente. Os comandos de cada fase estão em `report.json`. Para os controlos dirigidos: `RELAYLOOM_MATRIX_ENGINE=webkit node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/relay-policy-race.spec.ts tests/browser/routing.spec.ts tests/browser/site-contribution.spec.ts` (substituir engine para Chromium/Firefox).

Este é um passe local delimitado, não o novo CI nem uma publicação HTTPS. As duas interfaces nativas usam processos reais e o pacote Linux foi executado. A prova Electron verifica controlos e flags de isolamento; não audita o sandbox do kernel. O aviso NSS original do host está preservado, sem alterar segurança ou configuração. Não há prova de rádio físico, Safari/iOS real, signing Apple ou revisão independente. Formulários/contribuições ainda não estão ligados à aplicação; todos os restantes requisitos mantêm-se.
