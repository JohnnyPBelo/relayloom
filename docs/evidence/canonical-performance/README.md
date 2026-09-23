# Serialização canónica — compatibilidade e desempenho

Fonte `4f309e6137eb66459c8e1b4336c4f54af3502064`. O encoder Go copia sequências ASCII sem escapes em bloco e conserva o caminho Unicode/WTF-8/escapes para os restantes bytes. O limite global passa também a contar a pontuação final. Não foram alterados algoritmos de assinatura/cifra, autoridades, deadlines de execução, serviços ou settings.

## Motivação e medição

O CI d6d4ddb atingiu o limite acumulado Go/app de10min enquanto uma sincronização serializava base64~1,46MB sob Node.mu. O Handle aguardava esse mutex. Isso não demonstrou deadlock; o log original permaneceFAIL em docs/evidence/ci-d6d4ddb.

O baseline local comrace mediu142,9/144,2/148,4ms poroperação,32alocações e~8,39MB alocados. A versão nova mediu6,20/5,20/4,97ms,4alocações e~3,10MB. São3repetições de3iterações no mesmo host, com~1,55MB deASCII; não generalizar a todos os dados, aplicação, dispositivos ou CI. O teste dirigido de recuperação de site passou em31,881s.

## Controlos

512combinações comparadas com o encoder anterior: trechosASCII, controlos, aspas/barras,Unicode, separadores, surrogatesWTF-8 eUTF-8 inválido.260vectores com bytes esperados produzidos pelo código Node, incluindo base64 grande, chavesUTF-16 e limites numéricos. Strings, arrays eobjectos têm testes no limite exacto24MiB e um byte além. O negativo falhou antes porque a pontuação final excedia o orçamento; a falha original fica emcontrols/canonical-baseline.

Reprodução do gate: `node docs/evidence/canonical-performance/run-gate.mjs`, nesta fonte com dependências do projecto e reserva15GiB. O driver recusa substituir relatórios, congela hashes e executa uma fase pesada de cada vez. Benchmark: `node scripts/go.mjs test -race -p=1 ./core -run '^$' -bench '^BenchmarkCanonicalLargeASCII$' -benchtime=3x -count=3`.

Gate terminalPASS: 540Node,17pacotesGo/race (ver logs para cache e helpers condicionais),185casos entreprocessos,140Chromium/140Firefox/140WebKit, typecheck/builds. 782hashes iguais antes/depois e conferidos no commit. Relatórios Node/processos/browsers sem falhas/skips; browsers semflaky. O CI remoto posterior continua a ter verificação própria.

## Âmbito

Não conclui o produto. Incorporação/aprovação/proveniência eUI completa das propostas, plataformas/rádios físicos, paridade e restante PROJECT-BRIEF mantêm-se obrigatórios. O HTML público permanece anterior. Revisão própria não substitui revisão independente; WebKitLinux não éSafari/iOS.
