# CI d6d4ddb — resultado terminal e limites

Run35868125390, fonte d6d4ddb9cde7e29e04aadd32a6ce68f049e77fcc, conclusãoFAIL. Os três native-node e node-ui passaram. Ubuntu/macOS:535/535; Windows:528PASS/7skips previstos. A preparação e execução separadas do auxiliar Go passaram nos três hosts: compilação67.773/50.173/68.117s e execução28.206/28.411/21.591s, respectivamente.

native-go falhou quando o pacote Go/app atingiu o limite acumulado10min. O teste activo TestSiteRuntimeRecoversAuthorizedCopyAfterQuotaAndRestart tinha1m34. A stack mostra Handle à espera do mutex do nó e a sincronização runnable em canonical.appendString sobre base64~1,46MB, através de DocumentHash/NormalizeRequest/AuthorizedBundle. Não comprova deadlock; é um ponto de trabalho dispendioso a medir. Não éHTTP408.

Os jobs seguintes, incluindo Apple, Reticulum, interop, GUI nativa, pacotes e browser, foram skipped pela dependência. Os skips não são passes nem novas falhas funcionais dessas plataformas. As fontes WIP de entrega de recusa posteriores não estão abrangidas por esteCI.

Logs oficiais e estado terminal preservados. Não aumentar prazos cegamente nem reclassificar esteFAIL por haver passes locais. A proposta de optimização é separada e ainda precisa de igualdade de bytes, limites, medição e regressão.
