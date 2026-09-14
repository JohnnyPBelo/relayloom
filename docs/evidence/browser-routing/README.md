# Encaminhamento no browser — gate parcial de produto

`node scripts/verify-browser.mjs --routing` passou com372fontes inalteradas: typecheck4.746s, build1.885s,22Node transporte19.305s,16Node núcleo/segurança3.575s e12Chromium28.320s. Ver final/report.json para comandos/hashes. Base526d75a; código local não commitado.

Depois foram acrescentados2controlos: corrupção de um payload num pacote exterior válido recusada ANTES de armazenar/encaminhar; revogação real do BrowserMesh durante fragmentação, mantendo um SOS próprio na mesma ligação. Ambos passaram4.3s. Foi corrigido o caminho do reporter, que estava relativo a tests/browser e não à raiz esperada pelo CI. A suite conjunta14Chromium passou29.652s e o JSON foi recolhido na raiz. scope.json confirma que nenhuma fonte de produção mudou desde o gate: só o ficheiro de testes e a configuração de reporting mudaram.

Uma execução anterior teve4passes/1falha: o canal não abriu em15s antes de medir prioridades. expanded.log conserva essa falha. A instrumentação de estado ICE/canal foi acrescentada; o teste dirigido passou3.0s e os gates seguintes passaram. Não se afirma causa ou correcção da falha de ligação, nem se aumentou o prazo. O erro TypeScript findLastIndex/ES2022 foi resolvido com map/lastIndexOf sem alterar o alvo de compilação.

Mesh real em4contextos: A–B–C, controlo positivo da ligação B–C com relayB desligado e envio próprio permitido, partição/heal, autor fechado e leitor B recarregado a servir D automaticamente por inventário/pedidos. Sem ligação directa A–C; autoria e bytes verificados. Os contextos não são apresentados como processosOS independentes.

O teste de pacotes usa2routers TCP reais nativos e Chromium. É prova do formato do pacote e validação, NÃO de uma ponte de transporte implementada entre browser e daemon. UI autónoma, grupos/outbox, adaptadores nativos, browsers/dispositivos e revisão independente continuam pendentes.
