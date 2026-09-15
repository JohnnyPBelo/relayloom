# iOS: compilação e arranque, percurso funcional bloqueado

Ramo WIP codex/ios-keyboard-verification,commit eec2806. CI34902268397: Node nos três SO,Go,Reticulum,web autónoma e pacotes desktop passaram. O app iOS e o alvo XCTest compilaram; testStartupBeforeMedia passou no simulador em25.409s.

A preparação seed-synthetic-photo excedeu o limite antes do teste funcional. O diagnóstico do simulador regista a biblioteca Photos ainda em reconstrução/migração e timeouts internos de assetsd. Não foi estabelecida a causa completa, nem foram alterados serviços,permissões ou limites para a contornar. O botão novo de teclado NÃO foi exercitado por este run; não afirmar que corrigiu a falha anterior. Só o simulador criado pelo gate foi removido na limpeza.

A cópia dos dois ficheiros UIKit/XCTest permanece isolada em ramoWIP e na árvore local, sem ser integrada como funcionalidade validada na main. Dispositivos físicos,assinatura e restante matriz continuam bloqueados/pendentes. O teste estático Linux não conta como execuçãoApple.
