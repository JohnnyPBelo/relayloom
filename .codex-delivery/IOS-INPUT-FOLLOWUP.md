# iOS93f24f1 — correcção após o gate de eventos

Não editar fontes enquanto20449 corre. O CI34760224339 já terminou; não o relançar inalterado. Artefactos exactos: docs/evidence/ios/93f24f1.

Factos: arranque63.211s/fotografia3.101s passaram. O caso funcional falhou58.149s antes do submit: Done global não encontrado e título Um novo fio na rede fora da área visível. ui-01.png contém a captura efectiva da falha, com campos preenchidos, submit visível e barra acessória nativa/checkmark. O nome acessível do checkmark não foi observado. Não atribuir esta falha a submit/isolamento/criptografia nem remover cobertura.

Reparação proposta do helper, preservando a asserção de teclado fechado: procurar apenas controlos nativos semanticamente identificáveis de concluir/ocultar teclado (botões/teclas; rótulos limitados), recolher metadados AX sem valores se faltarem; trazer o anchor conhecido para a área visível com um número finito de gestos nativos antes de o tocar, em vez de exigir que já esteja no viewport. Verificar que o teclado desapareceu; não clicar cegamente em submit duas vezes, não injectar JS/API e não mudar preferências do simulador/bridges/isolamento/prazos. Só Apple/CI pode confirmar a execução.

Outra incompatibilidade visível no código, ainda não atingida no CI: unlock usa Nova conversa como marcador do estado desbloqueado e chooseRecipient procura sempre uma linha. A vista móvel compacta oculta o título geral e a lista quando já seleccionou uma conversa. Usar um marcador real exclusivo da shell desbloqueada (Pesquisar e navegar) e confirmar a conversa/identidade visível antes de escrever, ou regressar à lista pelo botão acessível real. Preservar todas as verificações de criação, post, mensagem, fotografia, resposta Node, background e relaunch. Isto corrige a localização dos controlos sem substituir a prova funcional.


## Implementado após o gate completo

Gate83716/desktop48666 terminaram0 e o marco de eventos foi commitado5d24a16. Depois alterou-se apenas NativeSimulatorTests.swift: controlos semânticos button/key, até3 gestos para anchor, metadados AX limitados em falha, marcador exclusivo da shell e selecção de conversa compacta validada pelo destinatário. A asserção de teclado oculto e todas as fases mantêm-se.22 testes host/estática passaram1.833s/0.030s, evidência docs/evidence/ios/input-controls-host. Não há compilação Swift nem resultado de simulador desta fonte ainda. Publicar normalmente e observar novoCI; não presumir solução só pelo passe host.
