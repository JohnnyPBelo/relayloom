# Leituras verificadas por transacção — gate Linux

Sobre54d298a, só registry.ts e o novo teste de leituras por âmbito alteram fontes. O gate48594 terminou0:275 Node393.015s,57 interoperabilidade508.800s,23 UI Node177.158s/23 Go151.083s e desktop Linux build/run/package/run.366 fontes estáveis. `runtime-report.json` e `ui-report.json` contêm comandos e hashes;scope enumera70Axe sem violações.

Os logs incluem a falha original de trabalho repetido (5leituras por5estados), a primeira fixture de rollback que tentou ler um store correctamente bloqueado, e os6controlos finais. A fixture foi corrigida para exigir o bloqueio e reabrir antes de verificar rollback; a recusa do produto foi mantida.

O cenário real instrumentado passou38.261s antes e21.171s depois, sem remover fases nem alterar65s. O profiler interno não abriu listener; os perfis completos ficam na cache local. As somas de amostras entre processos em seeding-profile-comparison.json não são tempo de parede nem uma previsão estatística paraWindows.

Os logs públicos apenas retiram espaços finais; scope guarda os hashes originais. Nenhum passeWindows, rádio, dispositivo móvel ou revisão independente é inferido. Go/race integral e SQLiteC estão a correr separadamente e não são contados como concluídos.
