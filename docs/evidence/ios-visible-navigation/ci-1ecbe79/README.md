# iOS — execução 35169832946

Fonte1ecbe7929dca39439223264c17e692914e5cd198, Xcode26.6, simulador instalado iOS26.4.1/iPhoneSE3. [CI](https://github.com/JohnnyPBelo/relayloom/actions/runs/35169832946). Artefacto `ios-simulator-execution-evidence`, id10476899882,355507bytes.

A compilação, instalação e o teste de arranque passaram. O comando `xcrun simctl addmedia <simulador-do-gate> <fotografia-sintética>` excedeu o prazo e terminou sem código de sucesso, após60827ms. O percurso funcional não arrancou; a correcção do selector de navegação não ficou validada por esta execução. O resultado é FAIL, não um passe parcial promovido a sucesso.

Os logs de Photos do simulador mostram o pedido às02:07:13.123, inicialização de ligações Metal às02:07:45, criação do asset às02:08:12.338 e resposta `success: Y error: (null) validate: 59.078497` às02:08:12.484. Isto mostra trabalho muito lento na preparação, sem demonstrar a causa desse atraso nem confirmar saída bem sucedida do comando. Não aumentar o prazo, repetir o comando, reiniciar serviços ou alterar permissões para transformar esta execução emPASS. Não foram inspeccionados álbuns pessoais.

O relatório original está em [simulator-report.json](simulator-report.json). O gate limpou apenas o simulador que criou. Node3hosts,Go,UI,Reticulum,browser e pacotesdesktop passaram nesteCI; não são execução física de iOS/rádios. Próximo diagnóstico deve investigar a preparação e conservar o teste completo de fotografia/anexo/navegação, sem usar este erro para concluir que o novo selector falhou.
