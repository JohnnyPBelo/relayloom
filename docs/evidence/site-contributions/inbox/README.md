# Inbox privada de propostas

Implementação: **a3e09fd** (journal/catálogos/armazenamento) e **55b0d4e** (recepção e API). O workflow foi separado em **eb2a5b4** após o cancelamento por orçamento do CI anterior. Esta é uma inbox de candidatas verificadas, **não o fluxo completo de aprovação ou recibos**. A paleta continua oculta e o HTML público não foi actualizado.

## Fonte e gates

`gate.json` identifica a fonte antes da revisão final: **514 testes Node, 17 pacotes Go/race, 66 testes entre processos, builds e 60 percursos por browser** passaram. Go reutilizou resultados em cache de pacotes inalterados; app/sites foram executados. Não somar repetições como cenários únicos.

Uma revisão posterior encontrou ocupação indevida de quota por contribuidores não autorizados para um formulário disponível. A correcção e os novos controlos alteraram oito ficheiros, enumerados em `reviewed/gate.json`. Esse gate passou **20 Node afectados, Go app/sites com race, 41 testes entre processos, builds e 19 casos por engine**, sem falhas/skips/flaky. Os resultados anteriores conservam a sua proveniência. Os 732 ficheiros de fonte foram comparados antes/depois de cada gate e contra o código commitado.

Os relatórios contêm os comandos exactos, ambiente, tempos e hashes. Os drivers guardados recusam sobrescrever provas e verificam a reserva mínima de15GiB. Para reproduzir o driver de revisão num checkout novo, copiar primeiro `gate.json` para `.cache/contribution-inbox-final/report.json`, preservando esse original; depois executar `node docs/evidence/site-contributions/inbox/reviewed/run-gate.mjs`. O driver amplo pode ser executado directamente num checkout sem os seus relatórios de cache; na fonte final incluirá também os controlos acrescentados depois da primeira execução.

## O que foi demonstrado

- Node, implementação portátil e Go concordaram em **61 vectores canónicos**, 25 aceites e36recusados: fases, replay, conflitos, prazos, retenção e quotas.
- O armazenamento é privado e deriva da chave de assinatura, com namespace/AAD separados da fila. Leituras/escritas Node↔Go na mesma SQLite, transposições de domínio/store e tentativas com chave de leitura têm controlos positivos/negativos. Browser usa IndexedDB cifrado e guarda a geração da sessão.
- O envelope e a fonte original sobrevivem à reabertura. Reempacotar o mesmo certificado não substitui bytes; outro certificado do mesmo autor/UUID não cria outra candidata nem decisão. Os descritores de conflito são limitados. Expiração remove provas privadas e conserva metadados por uma janela finita, sem expulsar pendentes.
- Processos Go realmente terminam antes/depois dos commits de admissão e de anexação da fonte; o processo seguinte recupera o estado correspondente. A corrupção é recusada, sem regeneração silenciosa.
- A aplicação recebe e regista antes de o dono abrir a inbox. Os processos Node/Go foram parados, os dois ficheiros de cache da fixture removidos e o remetente mantido offline com recusa TCP comprovada; a candidata continuou verificável após reabrir. No browser, a cache foi expulsa pelas operações reais de quota depois de fechar o emissor RTC; a prova privada sobreviveu.
- Uma proposta sem fonte fica sem valores apresentados como autorizados. A chegada posterior do snapshot real promove-a, com o mesmo certificado/envelope. Esse teste recupera uma fonte presente na cache de outro par, não uma fonte guardada apenas na fila privada.
- Propostas atravessam **browser↔Node e browser↔Go**, nos dois sentidos, por RTC e WebSocket através de uma terceira identidade sem chave de leitura. Há verificação de topologia, autoria, dados exactos e recusa de leitura pelo relay. O contexto é HTTP/WS loopback; não demonstra HTTPS/WS ou rádios entre dispositivos físicos.
- Worker de produção, identidade/setup/reabertura pela UI, mensagens, sites/recursos, relay e armazenamento existentes passaram na regressão. A composição/revisão de formulários pela UI continua pendente.

## Falhas conservadas

Os primeiros testes tiveram dois erros de oráculo: tipo inferido demasiado estreito de UUID e texto de fecho esperado em inglês; a corrupção já era recusada. A comparação browser da fonte usava ordem de JSON.stringify em vez de canonical. As falhas e os passes posteriores estão em `controls/`.

O primeiro ensaio da quota usou `wire.close`, que não existe, e impediu o restante teardown. Os dois processos dessa fixture e o seu worker foram identificados por árvore/cwd e encerrados, sem tocar em outros serviços; a auditoria está guardada. Esse resultado não foi usado como prova de defeito do produto.

Com teardown corrigido, **os dois controlos Node/Go falharam**: 64 propostas não permitidas ocupavam a quota privada; o post positivo chegava pelo mesmo canal, mas a proposta legítima não entrava. A correcção verifica uma fonte já disponível antes de reservar espaço. Passaram os negativos/positivos após corrigir, incluindo browser com oito envelopes mantidos na cache e zero entradas privadas indevidas. As propostas cuja fonte ainda falta continuam sujeitas a limites; isto não é uma garantia geral contra spam ou sybil.

## Limites ainda abertos

Não há recibo assinado pelo dono, aprovação/rejeição/CAS/reconciliação/proveniência ou UI completa de formulários. Faltam recusa/purga controlada e gestão de pressão das candidatas sem fonte verificável. Também falta recuperar uma fonte que só existe na fila privada do visitante, incluindo com relay para terceiros pausado.

Os testes não substituem hardware, rádios, assinatura Apple, leitor de ecrã ou revisão independente. O restante PROJECT-BRIEF.md mantém-se integralmente activo. Nenhuma prontidão para catástrofes é afirmada.
