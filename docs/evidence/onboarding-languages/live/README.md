# Publicação: verificação final concluída, falhas preservadas

A [execução final](final) passou:17assetsHTTP,9percursosUI e1percurso entre processos, terminado2026-09-16T19:44:11.459Z. As observações abaixo descrevem as tentativas anteriores e não substituem esse resultado. Não é aprovação do produto completo.

Pages35139489431 terminou success. Distribuiçãoeff7e9b9ed8e476f9ad13900d2ecc34f804856e9, fonte02188da77359f3d7bae8c9489070eb15c9676884. O URL já serve os novos ficheiros;17assetsHTTP coincidem por tamanho/SHA-256. Isto não equivale a passe de todas as interacções.

A primeira tentativa do driver local terminouFAIL:3timeouts de clique e6testes passados. Os3testes existentes de site-studio usaram o HTTPS;5casos de onboarding-language e1de site-language usaram localhost porque não respeitavam o URL. Não contar esses6 como execução pública. A selecção foi corrigida com uiHost e controlo de URL na navegação/relatórios. Typecheck e controlos positivos/negativos do host passaram.

Comando dirigido posterior: `RELAYLOOM_LAUNCH_URL=https://johnnypbelo.github.io/relayloom RELAYLOOM_MATRIX_ENGINE=chromium node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/onboarding-language.spec.ts --grep 'English and Spanish identities'`. TerminouFAIL por prazo total90s. O trace confirma HTTP200 no URL exacto, criação das identidades, troca de mensagens e verificação dos bytes do anexo; o percurso completo de mudança de língua/retoma não terminou. Há erros de fecho de contexto no teardown. **Não é um passe funcional integral nem prova de defeito do transporte.**

Pressão de memória elevada foi observada no host (swapcheio,fullavg300cerca33%), mas não foi demonstrada como causa única. Nenhum prazo foi aumentado, caso removido, emulador/serviço encerrado ou bridge alterada. Não repetir em ciclo: investigar antes de novo ensaio. O teste posterior entre processos da tentativaHTTPS não foi lançado porque o driver parou na falha; o correspondente gate local tinha passado.

Traces e contextos completos ficam apenas em .cache/onboarding-i18n/live-attempt-1 e live-directed-failure. A publicação anterior e os gates locais/Android continuam com a sua evidência original. As alterações do verificador são WIP local separado da fonte publicada. A nova web está disponível para experimentar, mas esta verificação e o resto do produto permanecem pendentes.
