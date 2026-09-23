# CI 1a53620 — selector compilado; importação no simulador excedeu o prazo

[Execução35794083324](https://github.com/JohnnyPBelo/relayloom/actions/runs/35794083324), fonte1a53620d837ea6a871848e6416c4e9786bcfd7bc. O relatório final run.json é terminal FAILURE: iOS falhou e autonomous-browser foi cancelado pelo limite do job. Matriz Node, Node UI, Go/race, interoperabilidade, UI Go, Reticulum e três pacotes desktop passaram. iOS falhou no pré-requisito de importação da fotografia.

Artefacto10725338239 (418779bytes), **21 ficheiros dos dois manifestos conferidos**, sem divergências. Xcode26.6/iOS26.4.1 reais: build-for-testing75.278s, instalação18.882s e startup XCTest236.484s PASS. O novo selector Swift compila. O simulador levou360.004s a arrancar; a importação da imagem sintética expirou após60.720s. O teste funcional principal, incluindo o selector novo, **não chegou a executar**. O campo simulatorExecuted:false refere esse percurso principal; appStartup documenta o teste real de arranque que passou.

O diagnóstico do simulador criado por esta execução mostra migração de assetsd e recepção de um pedido PhotoKit de inserção, mas não comprova a causa do atraso nem a conclusão da importação. A saída menciona getpwuid_r. Não é HTTP408 do Copilot nem prova de falha do selector ou entrega de anexo. Não se repetiu a mutação em ciclo, aumentou o timeout ou alterou permissões/serviços. O runner recolheu provas e eliminou apenas o seu simulador.

A mensagem confirmada pelo Node na execução anterior f3f32fc continua evidência dessa fonte anterior; não foi repetida nesta execução. Selecção da fotografia, anexo, resposta, recuperação, hardware e signing permanecem por validar. A persistência de recibos f131652 e a entrega WIP posterior não pertencem a este CI. Todo o contrato e cobertura permanecem obrigatórios; a próxima execução autorizada deve conservar a fotografia como requisito.


## Browser: orçamento do job, sem retirar testes

A anotação oficial confirma `The job has exceeded the maximum execution time of 15m0s`. O runner anunciou152 casos e o log comprova151 completos com passe; o152.º e o relatório JSON terminal Playwright não chegaram a concluir. Não é um passe de suite nem HTTP408. O artefacto10725364105 tem 2817178 bytes; logs, anotação e progresso enumerado foram recolhidos. Não se infere que as capturas parciais provam o último caso.

**6e83b3a** divide a mesma descoberta Playwright em dois shards sequenciais, max-parallel 1/fail-fast false, mantendo os 15 min por job, um worker, timeouts de cada teste, compilação web/nativa e browser Chrome. Nenhum caso foi excluído. Um verificador descobre a suite completa e os dois subconjuntos e exige união exacta sem duplicados; os controlos negativos recusam omissão/duplicação/lista vazia. Na fonte local que inclui a nova persistência foram descobertos159 casos: 90 + 69, disjuntos e completos. Isto é verificação de cobertura/listagem; a execução efectiva do workflow ainda precisa de CI.

Os testes WIP de entrega dos recibos não pertencem a este commit nem ao CI 1a53620. Os passes locais de persistência f131652 são documentados separadamente. As alterações de organização do CI são ficheiros deste projecto; modelos, providers, bridges, autenticação, serviços e permissões permaneceram inalterados.
