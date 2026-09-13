# CI f37067f — execução observada

Run34757307906, commit f37067f27460261b1fb4348bce2acce0d938b7cc. Node nos três OS, Go e três jobs de pacote desktop passaram. O job iOS falhou no preenchimento da biblioteca de fotografias do único simulador próprio iOS26.4.1, após o teste nativo de arranque ter passado.

Boot122.328s, build-for-testing131.598s, instalação19.991s; o comando XCTest de arranque passou94.457s (1 teste,41.627s). `simctl addmedia` excedeu60.306s; diagnóstico terminou3.081s. A nova alteração de teclado/captura do teste funcional **não chegou a executar**. Nenhum fluxo funcional iOS completo passou. Sem aumentar prazos, mudar permissões/serviços nem atribuir a causa aos logs de assetsd.

A limpeza do runner desligou/eliminou apenas o simulador criado. Fonte/artefactos por hash no relatório. Os logs aqui são os artefactos sanitizados do CI; a fotografia sintética é uma fixture, não conteúdo pessoal. A captura mostra apenas o arranque anterior à importação.
