# CI d6d4ddb — segunda fronteira de tempo identificada

Run35868125390 terminouFAIL. native-node passou emUbuntu/macOS(535/535) eWindows(528PASS,7skips), e node-uiPASS. A separação da compilação fria ultrapassou o problema anterior nos três hosts. native-go falhou; restantes jobsdependentes foram skipped, incluindo Apple e browsers.

O processo Go/app atingiu o limite acumulado padrão de10min. O teste activo TestSiteRuntimeRecoversAuthorizedCopyAfterQuotaAndRestart tinha1m34. A stack mostra Handle à espera deNode.mu, enquanto a rotina de sincronização está runnable na serialização de uma stringbase64 de cerca1,46MB, passando por DocumentHash/ParsePayload/NormalizeRequest/AuthorizedBundle. Não chamar deadlock sem prova; o custo de serialização sob o lock merece medição e melhoria.

Log oficial job107216413611 e terminal/summary.json em .cache/ci-d6d4ddb. A falha fica preservada. Não éHTTP408; não aumentei prazos nem alterei serviços/bridges/permissões.

## Rascunho fora das fontes

.cache/canonical-fastpath-draft/canonical.go propõe copiar sequênciasASCII sem escapes embloco, conservando o percurso original deUnicode/WTF-8 para os restantes bytes. Acrescenta também verificação do limite global após a pontuação final. manifest.json guarda o hashbase. Ainda não instalado, compilado, medido ou testado; não copiar sobre fontes alteradas nem chamar corrigido.

Após22962 terminar: medir o código original e o rascunho com a mesma entrada grande, incluindo race, sem contar compilação como execução. Confirmar igualdade byte-a-byte com Node e percurso anterior emASCII/escapes/Unicode/surrogates, recusaUTF-8 inválido e fronteiras do limite debytes. Repetir o teste de quota/reinício e as regressões necessárias antes de consolidar. Preservar todos os checks e a reserva15GiB.

O resultado terminal foi curado em docs/evidence/ci-d6d4ddb, com8artefactos e manifesto. A regressão local posterior passou Go/app em468.735s; isso não reclassifica oCI, nem prova a optimização ainda emrascunho.
