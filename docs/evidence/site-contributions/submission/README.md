# Fila e transporte privado de propostas

Gate sobre **f69eb2442c3db373a81748c20cd87470f020ef37 + WIP**, identificado pelos hashes antes/depois em `gate.json`. Esta integração implementa fila, API de envio e candidatos verificáveis. **Não implementa ainda decisões duráveis, aprovação, recibos ou UI completa de formulários.**

Código guardado em **5a1921c** (fila privada) e **07b509e** (API/transporte e correcção final de autorização). `committed-source.json` confirma que os 720 ficheiros de fonte coincidem com o estado final testado.

## Gate amplo executado

- **505 testes Node**, sem falhas, skips ou cancelamentos.
- **17 pacotes Go com race**, incluindo a aplicação completa e storage.
- **35 testes entre processos**: catálogos, crashes/retoma Node↔Go, admissão, consultas, envio privado, reinícios, partição/heal, relay/seed e rede mista.
- Typecheck, build nativo e build web.
- **49 percursos em cada engine** Chromium/Firefox/WebKit, sem falhas/skips/flaky: identidade, mensagens/recibos, outbox, contactos, relay, social/páginas, storage/offline, recursos, propostas e worker de produção.

Os comandos exactos, ambientes, tempos e fonte estão em `gate.json`; `run-gate.mjs` reproduz as fases sequenciais e recusa sobrescrever relatórios ou executar abaixo de15 GiB livres. Não somar repetições e subconjuntos como cenários únicos.

## Controlos concretos

A fila privada conserva certificado, fonte e envelope antes de copiar para transporte, liberta o único slot de preparação na mesma transacção e limita32 operações/32 MiB. Reabrir conserva bytes/ID/criação/expiração. Cópia só é marcada depois de reler o envelope real. Corrupção e quotas não renovam a proposta.73 vectores de journal concordam em Node/portátil/Go (29 aceites / 44 recusados).

Os testes de admissão recusam envelope público, leitores adicionais, assinaturas/autor/prazo diferentes e publicação pelo endpoint genérico. Um contribuidor não autorizado não aparece como candidato. Reempacotar o mesmo certificado não duplica a lista; ainda falta replay durável por autor/UUID.

O percurso heterogéneo usa remetente Node ou Go → TCP → relay Node → serial PTY → dono Node, sem listener TCP no dono e sem ligação directa. A primeira proposta prova dois saltos. Depois da partição, o relay conserva os mesmos bytes cifrados e falha ao ler/desencriptar. O remetente é terminado, o socket recusa ligações, o caminho cura e uma mensagem própria positiva comprova a ligação enquanto relay está pausado. A proposta só chega depois de reactivar o relay, com autoria/bytes originais. **Go não ganhou serial directo; PTY não é rádio físico.**

O worker compilado foi exercitado com duas contas criadas pela UI e ligação RTC configurada pela UI. A submissão usa RPC da aplicação porque a paleta continua oculta. Fechar a ligação/reabrir a shell offline conserva a proposta, e a ligação seguinte entrega-a sem ressuscitar a segunda proposta cancelada. Nenhuma chamada `/api/` a daemon ou chave privada apareceu nas respostas. `copied` permanece cópia local, não entrega/aprovação.

## Falhas preservadas e correcções

Em `controls/`: cancelar novamente uma operação antiga apagava o stage seguinte emBrowser/Go; corrigido e repetido. Node classificava uma recusa operacional normal como erro de integridade; corrigido, mantendo a invalidação por corrupção. A primeira invocação de browsers usou config sem projectos e não executou testes. A primeira fixture heterogénea tentou serial Go indisponível; corrigida a topologia para o adaptador Node existente, sem mascarar a limitação.

Uma revisão **posterior ao gate amplo** acrescentou o controlo de autorização retida: cancelamento e expiração durante a espera ainda permitiam resposta `true`; fechar o runtime era correctamente recusado. Os logs anterior/posterior conservam **2 FAIL / 1 PASS** e **3 PASS**. A correcção browser volta a verificar a entrada de permissão e o prazo depois do await.

O gate final em `reviewed/gate.json` passou typecheck, novo build e **16 casos afectados em cada browser**, sem falhas/skips/flaky. Apenas `packages/browser/src/contribution-runtime.ts`, o export de teste em `tests/browser/harness.ts` e o teste novo mudaram depois do gate amplo. Node/Go e os testes não afectados conservam a proveniência anterior; não são execuções novas depois desse ajuste. Os hashes antes/depois conferem nos dois gates.

## UI e limites

`chromium-ui/` conserva três capturas e os respectivos resultados Axe do gate amplo. A captura desktop de mensagem pendente foi inspeccionada pelo implementador: controlos legíveis, estado de ausência de pares visível e composição sem sobreposição. Os testes também verificaram a interface móvel, teclado/estado e a ausência de violações Axe. Isso não é teste de leitor de ecrã ou revisão independente.

Fonte histórica da fila ainda não tem recuperação automática pelo dono; inbox é lista de candidatos, não journal de decisões. Faltam recibos, CAS/reconciliação, aprovação/rejeição, proveniência e UI PT/EN/ES completa. Permanecem todos os requisitos de grupos web, recuperação/rotação/keystore, plataformas/rádios físicos e revisão independente. O HTML público continua 7fdb76a/0fdbd1b9. Nenhum teste é prova de prontidão para catástrofes.
