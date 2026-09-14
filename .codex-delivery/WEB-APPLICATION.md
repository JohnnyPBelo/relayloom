# W3/W4 — aplicação autónoma real, em implementação

Manter o contrato integral, incluindo toda a paridade web/nativa, e preservar C2/C3/transportes locais. Sem subagentes novos/retomados, sem modelos/bridges/serviços externos alterados.

## Arquitectura e sequência

- Reutilizar a UI Liquid Glass via uma porta API comum; index.html conserva o cliente de daemon. browser.html é uma entrada estática autónoma, sem chamar /api de um daemon.
- Worker dedicado possui identidade, cofre e estado cifrado IndexedDB, validação/projecção de conteúdo, metadados sociais, rascunhos e outbox. Janela possui RTC/WebSocket, necessários noWindow, e troca apenas bundles cifrados/public metadata com o motor. A UI recebe plaintext só para apresentação. Isto não protege contra XSS/extensão/origem comprometida.
- Um lease de aplicação por perfil/origem evita duas instâncias de domínio com caches concorrentes; o bloqueio/destruição impede operações tardias. Nenhum worker termina outro separador para ganhar propriedade.
- Gravar bundle+índice+outbox/alterações de metadados numa única transacçãoIDB. Reservas de outbox impedem expulsão até confirmação/expiração. UUID/fingerprint idempotente e histórico finito; resultado incerto nunca dispara uma nova publicação automática.
- Portar/reutilizar o mesmo contrato de conteúdo, ACLs, autoria de eventos, fixed-reader groups, confirmações, social/colecções/site; não conceder autoria por posse de read keys. A autoridade de grupos dinâmicos ainda requer integração própria completa; não simular sucesso nem activar controlos sem suporte. O requisito continua obrigatório.
- UI de ligação permite oferta/resposta RTC e conviteWS; criação/aceitação/erro/fecho reais, com teclado e feedback. Receber um convite não altera grupos/contactos automaticamente.
- Depois ligar grupos/authority/outbox completa e restanteparidade, arranque estático/cacheoffline/serviceworker/PWA opcional, actualizações seguras, limites de plataforma e todososgates.

## Gates

Interoperabilidade comdaemons Node/Go, dois browsers reais sem /api, recarregar/lock/unlock/export/recovery, enviooffline/retoma/idempotência/recibos, leitura semautoria, publicação social/site, safe-rendering/temas/mobile/Axe e revisão visual. Negativos de corrupção, leitura/edição erradas, estado perdido, reserva/quota, concorrência, grupos não suportados recusados e chave privada fora da janela. Não converter passes dekernel emparidade deproduto. Registar o que está ligado/testado e o que ainda não está.


## Implementação e provas dirigidas

Entrada/browser/index.html funcional comworker eUIpartilhada. Foram executados DM/outbox/RTC/recibos/reload, social/colecções/sites, resposta perdida semduplicação, lease pororigem, falhacifrada semreset, cacheofflinehost503, rejeição deassetcorrompido e abortoIDB. Gruposdinâmicos continuam recusados/enintegração. Erros reais: mensagemvazia DOMException era tratada como sucesso; workerfora scopeSW bloqueavaoffline; nomeacessível deConversas incluía contagemmutável. Corrigidos comcontrolo e repetição, semremovercobertura.

Gateconjunto `node scripts/verify-autonomous.mjs` sessão43995 estáactivo com403fontes congeladas; não editarantes de recolher. Novo serviço de ficheiros não foi publicado nem mantido embackground. Bootstrap inicial requeracessoao código; depois a recargaoffline foi testada seminstalarPWA.


## Marco da aplicação autónoma verificado

`node scripts/verify-autonomous.mjs` terminou0:271Node/26browser/21UI pormotor/desktopLinuxbuild+run+package+run,403fontesestáveis,72Axe semviolações. Evidência docs/evidence/browser-application. SemAPIde daemon no cliente/browser/index.html; worker/IndexedDB/RTC/WS/SW reais. FonteGo não mudou desdepasse89race anterior. Gruposdinâmicos e toda arestanteparidade/gates dehardware/revisão continuam obrigatórios. Previewestáticolocal4174activosessão49020; nenhumcommit/pushnovo.


## Consolidação browser sobre 5e049f1 — 2026-09-14

A sessão3463 terminou0. Gate `node scripts/verify-autonomous.mjs`:279 Node,26 browser,23 UI por motor e desktop Linux build/run/package/run,442 fontes estáveis. Evidência em docs/evidence/browser-application/milestone. A paridade dinâmica continua obrigatória e pendente. O CI5e049f1 passou Node3SO/Go/RNS/desktop e falhou iOS no fecho do teclado; incremento Apple preservado separadamente. Próximo: rota web autónoma↔Reticulum com controlos/UI, grupos dinâmicos e restante contrato.
