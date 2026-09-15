# Web pública — publicação e testes verificados

O gate `node scripts/verify-public-web.mjs` terminou PASS com fontes/artefactos inalterados.

- 6 testes da UI autónoma por motor no build existente (18): Chromium153,Firefox155,WebKit26.6WPE/Linux.
- 8 testes por motor no build público sob /relayloom/ (24), incluindo os mesmos seis percursos e dois controlos de distribuição/cache.
- 1 percurso UI com dois processos independentes (Chromium e Firefox),63 488 bytes exactos de anexo, mensagens nos dois sentidos, recibo de leitura e recarga offline depois de fechar o emissor.

Comandos/durações/hashes em `report.json`; contagens em `counts.json`; capturas e auditorias do percurso independente em `local-two-processes`. As observações e falhas intermédias estão preservadas. `cache-negative.txt` mostra o teste a recusar a eliminação da cache de outra instalação quando se troca deliberadamente a guarda apenas no SW compilado; o original foi restaurado antes do gate final. `manifest-negative.txt` mostra a regressão do caminho de arranque reproduzida.

A UI Node/Go passou25+25 e o pacote Linux passou build/run/package/run; relatórios em native-ui. Publicação ec3a3baa a partir de ff2fb60,Pages34940021714 success. O percurso no URL HTTPS passou (published-https);13 ficheiros de execução têm hashes/bytes iguais aos verificados localmente (https-integrity.json). Não confundir engines/processos neste Linux com dois dispositivos físicos, Safari real ou aprovação do contrato completo.
