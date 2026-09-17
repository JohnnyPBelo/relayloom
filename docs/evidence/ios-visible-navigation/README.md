# Correcção do selector XCTest

O CI35160603438 executou a cadeia Go e UI separada com sucesso. O iOS passou build/startup e importação da fotografia, mas falhou ao procurar o landmark de navegação. O diagnóstico registou um botão Community visível/hittable, com identifier vazio, mesmo quando a consulta pelo landmark não devolvia o destino.

O selector foi alterado para resolver novamente os botões visíveis por nome e exigir exactamente um candidato. Abre a gaveta apenas se não existir candidato visível. Mantém o prazo30s, os toques únicos, a fotografia e os controlos de transporte/recuperação. Não usa coordenadas forçadas, JSinjectado ou APIprivada.

A verificação estática e os22testes do runner noLinux passaram. A correcção necessita de execuçãoApple; não é um passeiOS por estes testes dohost.
