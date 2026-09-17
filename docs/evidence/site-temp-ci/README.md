# Fixtures independentes de caches anteriores

CI35178572305, fonte894d8f4:17testes falharam em cada um dos três jobs Node por `ENOENT` ao criar subdirectórios de `.cache/tmp`. A pasta existia no ambiente local, mas não num checkout novo. Os restantes jobs ficaram por executar devido à dependência dos jobs Node. Esta falha invalida a pretensão de reprodução limpa da fonte anterior; os passes locais foram reais, mas dependiam desse estado de ambiente.

`tests/project-temp.ts` cria o directório pai no projecto e depois um directório exclusivo por fixture. As fixtures afectadas usam o helper directamente. Não se removeu a cache existente, não se alteraram serviços/permissões nem se aumentaram prazos.

A correcção isolada, sem incluir a integração de API ainda não commitada, foi testada a partir da árvore de Git em [candidate.json](candidate.json): a pasta de fixtures não existia antes do ensaio; typecheck e18testes passaram. [Resultados](candidate-tests.log). A primeira cópia de verificação omitiu playwright.config.ts e falhou no typecheck antes dos testes; copiou-se esse ficheiro da mesma árvore e repetiu-se a verificação. Isso foi um erro do copiador da verificação, não uma alteração do produto.

Uma segunda cópia isolada da integração completa passou28testes, incluindo a API real e a retoma da aplicação após terminar um processo. [Relatório](integration-clean.json) e [resultados](integration-clean-tests.log). Estes testes correram em Linux; a repetição nos hosts Windows/macOS depende do novo CI.
