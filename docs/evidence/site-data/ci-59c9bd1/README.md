# CI da fonte59c9bd1 e diagnóstico iOS

Execução35314988987 concluída: Node em Windows/macOS/Linux, Go, UI nativa, Reticulum, browsers autónomos e os três pacotes desktop passaram. iOS falhou. [Estados exactos](jobs.json).

O log iOS foi verificado pelo hash do manifesto. Houve criação de identidade, publicação, contacto, ligação e mensagem privada recebida. Depois de escolher «Fototeca», a consulta de células em NativeSimulatorTests.swift:316 falhou ao resolver um elemento AX remoto; o waiter foi interrompido. O teste terminou65. As capturas anteriores à consulta mostram a aplicação; não comprovam que a grelha do picker estivesse pronta. Não concluir que a preparação da fotografia falhou: essa etapa terminou0.

**Correcção de registo:** os logs já existiam no artefacto descarregado. A listagem `rg --files` omitia `.log` por causa das regras de ignore. O ZIP directo confirmou os mesmos bytes. A execução anterior2d84a61 também chegou à mensagem e falhou na consulta AX da fototeca; inferir a etapa a partir das capturas isoladas foi insuficiente. A causa subjacente da falha do serviço/picker permanece por provar.

A alteração seguinte acrescenta apenas marcadores delimitados de fases, conserva observações do par Node mesmo na falha e recolhe logs de PhotosUI/PHPicker do simulador criado por este gate quando a fase de fotografia falha. Mantém os prazos, a selecção obrigatória da fotografia, as permissões e os serviços. Os25 testes do runner e a verificação estática passaram no host. Não houve compilação Swift nem execução Apple desta alteração local; o novo CI ainda é necessário. Nenhum marcador parcial concede um passe.

Não é validação de iPhone físico, assinatura de distribuição, rádio ou prontidão para catástrofes.
