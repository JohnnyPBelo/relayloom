# Contrato inicial de contribuições — 21 de Setembro de 2026

Oito testes Node,46vectores de equivalência TS/Go (9aceites/37recusados) e assinaturas produzidas/verificadas em ambas as direcções passaram. Um teste executado em Chromium/WebKit reais também confirmou a cifra privada para visitante+dono e a separação da concessão de publicação pública. Os logs de browser incluem outros casos de recursos; esses casos não são contados como provas de contribuições.

A verificação de assinatura não equivale a aprovação. O contexto usado pelo teste representa dados já autenticados; a futura API tem de os extrair do snapshot assinado em vez de aceitar esse contexto do cliente. O documento v3 e a versão publicada ainda não incluem formulários ou caixa de propostas. Persistência/replay, controlo do dono, ligação ao transporte e UI continuam pendentes, bem como revisão independente.

O relatório contém comandos e hashes. A regressão alargada está em .cache/resource-performance-full/report.json; não confundir estas provas dirigidas com uma aprovação final dessa execução.
