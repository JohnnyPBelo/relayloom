# CI93f24f1 — falha nativa observada

Run34760224339 terminou: Node3OS, Go e três pacotes desktop passaram. iOS26.4.1 arrancou/compilou/instalou; comando de arranque passou63.211s e a fotografia foi importada3.101s. O comando funcional saiu65 em138.653s:1 XCTest falhou58.149s antes de criar a identidade.

Erro exacto: `missing("keyboard dismiss control for Um novo fio na rede.")`. A query global por botão identificado como Done não encontrou controlo hittable e o título da secção estava fora da área visível. `ui-01.png` é a nova captura do momento da falha: nome/frase-passe preenchidos, botão Criar identidade visível e barra acessória nativa com símbolo de confirmação; `ui-02.png` mostra o onboarding anterior. Root reviu ambas. O símbolo visual não prova o nome/tipo acessível do botão.

A nova captura de falha funcionou. O gate parou numa pré-condição do helper de teste antes de tocar em Criar identidade; esta execução não demonstra falha de submissão da aplicação. Não há passe funcional iOS. O caso anterior1663cbe avançou à criação de identidade, mas falhou no formulário de publicação; continua por resolver/verificar.

Próxima correcção deve usar controlo nativo identificável ou a interacção normal de submissão, preservando verificação do resultado e toda a cobertura; não injectar JS/API, mudar preferências do simulador/bridge/isolamento nem aumentar prazos. Recolher metadados AX de botões próprios, sem valores de campos, se a identidade acessível da barra continuar desconhecida. A fonte dos eventos de grupo locais não estava neste CI.
