# Rascunhos web grandes — correcção publicada e verificada

O editor aceitava imagens até 2 MiB no total, mas o perfil web guardava todo o estado privado num índice de 1 MiB. O teste com um PNG sintético válido de cerca de 1,3 MiB falhou ao guardar com «Estado privado excede o limite». A [captura anterior](large-draft-before.png) e o [erro original](large-draft-before.log) foram preservados antes de reconstruir.

`BrowserProfile` mantém o índice de 1 MiB e passa a guardar os valores em blobs cifrados privados, ligados ao proprietário, à chave lógica e ao identificador do blob. Os limites são 8 MiB por valor, 32 MiB de valores cifrados e 4096 referências. Índice, valores e alterações a bundles partilham a transacção IndexedDB. O formato legado continua legível; a migração ocorre ao escrever cada valor. Os blobs privados não aparecem no inventário e não podem ser obtidos como bundles. O editor limpa a confirmação da acção anterior quando começa outra gravação/publicação.

| Verificação no Linux | Resultado |
| --- | --- |
| Fundação, valores privados e imagem grande na UI | 13 por motor Chromium/Firefox/WebKit; 39 PASS |
| Interface completa da candidata por defeito | 22 por motor; 66 PASS |
| Distribuição pública sob `/relayloom/`, incluindo integridade/cache | 24 por motor; 72 PASS |
| Chromium e Firefox em processos independentes | 1 PASS |
| Estúdio e páginas nos núcleos Node e Go | 2 por núcleo; 4 PASS |
| Restante cobertura de API, encaminhamento, transportes nativos, certificados e curvas | 18 por motor; 54 PASS |
| Endereçamento de conversas | 2 oráculos PASS |
| Linux desktop | Compilação, execução, pacote e execução empacotada PASS |
| Acessibilidade do estúdio | 36 relatórios Axe, sem violações detectadas |

São **236 execuções de testes de browser/UI**, além dos dois oráculos e das verificações de compilação/pacote. Incluem controlos positivos e negativos, perda/corrupção/troca de blobs, atomicidade com falha injectada, coordenação entre separadores, chaves de leitura sem autoria, partição/reconexão, percursos por vários adaptadores e seeding com o autor desligado. O ensaio da imagem recarrega e desbloqueia a aplicação, comparando o projecto e os bytes exactos. As imagens sintéticas variam por execução; os hashes estão nos relatórios `large-draft-*.json`.

Relatórios: [principal](main-report.json), [público](public-report.json), [complementar](supplement-report.json), [manifesto de artefactos](artifact-manifest.json). Os ficheiros de fonte permaneceram estáveis durante os gates. Comandos de reprodução a partir da raiz do repositório:

```sh
npm run build
RELAYLOOM_MATRIX_ENGINE=webkit node scripts/e2e.mjs --config tests/browser/matrix.config.ts tests/browser/private-values.spec.ts tests/browser/foundation.spec.ts tests/browser/large-site-draft.spec.ts
node docs/evidence/private-values/run.mjs
node docs/evidence/private-values/supplement.mjs
```

Os scripts usam dependências/caches locais e uma única sequência de testes/builds. O primeiro gate foi executado pelo mesmo runner em `.cache/private-values-final/run.mjs`; a cópia versionada ajusta apenas o caminho relativo do import. As verificações HTTPS usam `uiHost` e conferem o URL real; os testes do harness de armazenamento/crypto são apenas provas locais. Antes de publicar, `verify-committed.mjs` deve demonstrar que o commit produz exactamente os assets testados. Depois da publicação, `verify-live.mjs` confere hashes HTTP e executa os percursos no URL público. Ambos passaram: [compilação isolada](committed-build.json) e [HTTPS](live/report.json). Fonte `0c6b58a9a27d3f3707c73ba65ea4639a9a5756e7`, distribuição `45ecacdf06ebacd4572620a6eb0ea5869ed45821`, Pages `35174450966` concluído com sucesso. O ensaio público passou 17 hashes HTTP e 13 percursos: 12 de UI e um entre processos Chromium/Firefox.

Root reviu as capturas de desktop e móvel; não é revisão independente. WebKit/Linux não é Safari/iOS nem dispositivo físico. Não foram testados rádios físicos ou os dois dispositivos do proprietário. O iOS da fonte anterior terminou com falha na preparação da fotografia, antes do fluxo funcional: [diagnóstico](../ios-visible-navigation/ci-1ecbe79). Endereços permanentes/revisões, contribuições e ficheiros opcionais continuam sem integração no produto. Todo o contrato permanece aberto.
