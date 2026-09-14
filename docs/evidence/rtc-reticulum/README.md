# Autora web com apenas um par WebRTC

Código de execução335324d, inalterado nesta extensão de testes. `node scripts/e2e.mjs --config tests/reticulum/ui.config.ts`: três percursos passaram, um worker, seis auditorias Axe sem violações. O final volta a exercitar a rota directaWS, a rota com browser intermediárioRTC e a UI nativa existente.

A autora só tem uma ligaçãoWebRTC. Outro navegador, que activou a retransmissão pelaUI, faz a passagem paraWS; seguem-se um nóNode, o routerRNS de referência porTCP e sériePTY até à destinatária. Não há listenersTCP RelayLoom emB/C; C só temRNS. O host estático não recebe chamadas/api. O navegador intermediário também recusa uma tentativa de ler a mensagem privada pelaUI.

Os três percursos verificam envio/resposta sem escolher meio. O percursoRTC confirma22 000bytes exactos, partição/heal, relay-off e seeder reiniciado com autora e browser intermediário encerrados; a autoria permanece na autora. PTY não é rádio físico, e este teste não demonstra WAN/Safari/dispositivos ou paridade de grupos.

Falhas preservadas: o primeiro ensaio usou check(), que exige mudança imediata do checkbox, enquanto aUI mostra o estado confirmado pelo worker. O teste passou a clicar e esperar a confirmação, mantendo a asserção inicial desactivado. Uma primeira tentativa de editar falhou por não coincidir a indentação e o comando seguinte repetiu o teste sem a alteração; esse log está identificado como edit-not-applied. A edição efectiva foi executada com interrupção em erro, e o teste corrigido passou antes do gate final completo. Nenhuma destas falhas foi reescrita como passe.
