# Catálogo Go e envelopes privados recuperáveis

Código guardado em a1040a7 (criação com tempos fixos) e 16dbd6a (catálogos/envelopes). O gate começou em bd419cb com WIP; os mesmos 706 ficheiros foram comparados por hash antes/depois e guardados nos commits sem alterar bytes. gate.json contém comandos, fases e proveniência. **Este marco não implementa ainda envio/outbox/inbox/aprovação/UI de propostas.**

## O que passou

- **500 testes Node**, typecheck, build web e compilação do nó nativo.
- **18 testes reais de catálogo entre processos Node/Go**, incluindo retoma nos dois sentidos, assinatura/cifra exactas, quota, corrupção, bloqueio, prazo e seis pontos de interrupção.
- **21 percursos por browser** em Chromium/Firefox/WebKit: catálogos, tempos, worker, identidades/cofres, armazenamento, mensagens/recibos, páginas/social e recuperação offline. Zero falhas/skips/flaky no gate final.
- **Go core/sites com race**, na mesma fonte, incluindo reconstrução após limpar apenas a cache compilada do projecto.
- **53 vectores de journal**: 18 aceites/35 recusados, com resultados canónicos iguais em Node/portátil/Go. Subconjuntos e repetições não devem ser somados como cenários novos.

## Implementação e controlos

O catálogo Go preserva os mesmos pedidos, fases, fingerprints, contadores e assinaturas na mesma SQLite usada por Node. A política expirada durante o callback foi reproduzida em ambos; a verificação passou a usar o relógio actual e a recusar antes de assinar. O controlo a -1 ms continua válido e a 0 ms é recusado; não foi alterado o relógio do sistema nem a validade máxima.

createBundleAt conserva os tempos fixados pela intenção. Não torna a cifra determinística: novas criações ainda têm nonce/ID diferentes. Por isso os três catálogos guardam o envelope exacto no stage após assinar. Reabrir/alternar motor recupera esses bytes, nunca um envelope novo com prazo renovado. O formato antigo sem envelope permanece legível. O envelope é privado para visitante+dono, mesmo se a concessão permitir divulgação pública posterior; tipo, autor, leitores e tempos têm de coincidir com o certificado.

O teste concorrente reteve uma transacção Go, iniciou Node e confirmou que o segundo resultado não existia enquanto o writer estava retido. Depois de libertar o commit, os dois processos obtiveram o mesmo ID/bytes e não aumentaram o contador. Não é uma simulação de locking. Os processos de teste são próprios e foram encerrados normalmente, excepto nos pontos de falha deliberados.

Corrupção do envelope retido é recusada sem fallback para uma nova cifra. No browser, bloquear a identidade durante seal aborta a transacção; reabrir mantém a assinatura e permite selar uma vez. Reparar apenas os bytes de teste originais recupera o mesmo envelope. Os métodos de assinatura/selagem continuam fora do RPC; a interface não recebe chaves.

## Falhas preservadas

O primeiro driver Go de vectores transformava relógio negativo em 0; a fixture foi corrigida, mantendo o validador do produto. O primeiro controlo Go de expiração usava um fingerprint de TTL diferente e mascarava a causa; corrigido antes da reprodução negativa definitiva. O teste worker foi ampliado para cinco recusas mas ainda esperava três: o produto recusava os cinco métodos e só o oráculo estava desactualizado. Logs antes/depois estão identificados, sem reclassificar essas falhas como defeitos de rede.

O preflight do gate detectou tsconfig.json omitido na enumeração de fontes; nenhum hash existente mudou e nenhuma fase tinha arrancado. A enumeração foi alinhada. Também há auditorias das limpezas delimitadas de caches: AppImage, fontes/WIP, módulos, ferramentas e provas preservados; nada fora do projecto ou serviços foi alterado.

## Reprodução e pendentes

Comandos exactos em gate.json e driver run-final-gate.mjs, que recusa sobrescrever resultados e verifica reserva de 15 GiB/fonte a cada fase. Os logs dos 18 processos incluem cada ponto de recuperação. O controlo de concorrência tem log próprio; as observações de envelope dos três browsers são dados reais da execução.

Ainda faltam: API de submissão com política transaccional, cópia para transporte/outbox/inbox, recibos verificáveis, decisão do dono com CAS/reconciliação, proveniência e UI completa com três contas. Selado não significa enviado, recebido ou aprovado. O CI de bd419cb é anterior a estes commits; a web pública continua 7fdb76a/0fdbd1b9. Não inferir dispositivos/rádios físicos, iOS funcional, assinatura Apple, revisão independente ou produto concluído.
