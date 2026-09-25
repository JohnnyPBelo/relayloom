# Validação local, sem GitHub Actions

Por instrução do dono em 25 de Setembro de 2026, RelayLoom não usa GitHub Actions. A árvore activa não contém workflows executáveis em `.github/workflows`. O GitHub recebe commits normais de versões testadas; não enviar trabalho por testar, não fazer force-push nem juntar PRs sem autorização.

O contrato de `PROJECT-BRIEF.md` mantém a cobertura integral: criptografia e autorização, armazenamento, rede real entre processos, partição/recuperação, transportes heterogéneos, relay e seeding, simulação identificada, interface com várias contas, acessibilidade, idiomas, plataformas e revisão independente. Retirar a execução no GitHub não transforma requisitos pendentes em concluídos.

## Comandos existentes

Executar a partir da raiz da worktree escolhida, com dependências e caches do projecto, pelo menos 15 GiB livres e uma execução pesada de cada vez. Guardar os comandos exactos, saídas e hashes da fonte em pastas de prova novas; conservar tentativas falhadas. Estes comandos são entradas dos respectivos gates, não uma afirmação de que todos passaram na fonte actual.

| Âmbito | Entrada |
| --- | --- |
| Tipos e interface web | `npm run build` |
| Motor Go usado pelos testes de interoperabilidade/UI | `npm run native:build` |
| Testes Node | `npm test` |
| Go, incluindo detector de corridas | `npm run test:native` e `npm run test:native:cgo-storage` |
| Interoperabilidade entre processos | `npm run test:interop` |
| UI com motor Node | `npm run test:e2e` |
| UI com motor Go | `RELAYLOOM_TEST_BACKEND=native npm run test:e2e` |
| Web autónoma | `npm run test:browser`; os gates registados executam Chromium, Firefox e WebKit sequencialmente |
| Reticulum | `npm run test:reticulum` e `npm run verify:reticulum` |
| Simulação | `npm run simulate` |
| Distribuição web | `npm run web:build` e `npm run web:verify` |
| Desktop local | `npm run desktop:build`, `npm run desktop:package` e `npm run desktop:packaged-smoke` |

Na shell de outro sistema, usar a sintaxe equivalente para a variável de ambiente. Os scripts de plataformas em `scripts/` e as instruções específicas de Android/iOS continuam a exigir os respectivos SDKs, dispositivos ou simuladores autorizados. Cross-compilar não valida execução no sistema de destino. Sem host Apple/assinatura ou rádios físicos disponíveis, esses resultados permanecem pendentes ou bloqueados. Não os substituir por um passe Linux/WebKit.

## Envio e evidência

Antes de cada envio, isolar o marco, verificar exactamente a fonte e os artefactos que serão enviados e preservar o restante WIP. Confirmar que a árvore candidata não introduz workflows de Actions. Os relatórios em `docs/evidence` indicam o âmbito e as limitações de cada gate; resultados antigos não validam automaticamente fontes posteriores.

O HTML público existente conserva a sua versão já publicada. Não iniciar deployments que dependam de Actions como alternativa ao CI retirado. Uma futura publicação web tem de respeitar esta instrução e ter os seus próprios gates de distribuição e execução.

As configurações antigas são apenas referências históricas. A cópia local integral do workflow retirado, incluindo alterações ainda não commitadas, foi preservada em `.codex-delivery/history/github-actions-ci-before-owner-disable-20260925.yml`, fora do caminho de execução do GitHub. A auditoria local guarda o respectivo tamanho e SHA-256. Nenhuma configuração de modelos, bridges, autenticação ou segurança foi alterada.
