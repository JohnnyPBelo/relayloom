# RelayLoom — retoma após inbox durável

**Objectivo integral activo. Produto não concluído.** Preservar PROJECT-BRIEF.md: messenger/social cifrado, sites expressivos inspirados no ZeroNet, cinco plataformas e web autónoma com paridade, meios agnósticos/Reticulum, setup/idiomas PT-PT/EN/ES e Liquid Glass. Só este projecto. Manter Astra/Copilot Ultra e execução sequencial: **não criar nem retomar agentes**. Não alterar providers/bridges/autenticação/permissões/serviços. Checkpoint adicional de manutenção cancelado.

## Repositório e fonte

- Worktree activa: `/home/absint0o/projects/relayloom/.cache/site-optional-resources`, branch `codex/site-optional-resources`.
- Principal: `/home/absint0o/projects/relayloom`, branch `codex/setup-languages`, HEAD1e83db22ff9b7b9a65a400601b891312a3188960. WIP histórico separado e preservado.
- Marco anterior publicado no Git:2948284c8795d2504234ea7433a12333e298ecc7 (fila/envio privados).
- Novos commits locais: **a3e09fd** journal/catálogos/storage, **55b0d4e** API/recepção, **eb2a5b4** divisão do CI. Consultar git log para o commit posterior de provas/documentação. Push novo ainda por confirmar nesta gravação.
- Fontes apps/packages/native/tests e workflow guardados. Capturas/JSON históricos, symlink node_modules e outros WIP anteriores preservados. Nunca git add -A, reset, force-push ou merge de PR sem aprovação.
- Última reserva cerca de34GiB; mínimo15GiB. Revalidar antes de builds. Dependências/caches apenas no projecto; uma execução pesada local de cada vez.

## O que existe

Fila de envio Node/Go/browser: intenção→assinatura→selagem→queued→cópia relida,32operações/32MiB. Mesmos bytes/ID/prazos nas retomas. API form/state/submit/operation/resume/cancel/inbox. Envelope privado para visitante+dono mesmo com concessão pública. Pausa de relay não impede envio próprio; bloqueio/retirada/lock/cancelamento invalidam emissões, incluindo resposta de política retida. Cópia local não é recibo do dono.

Inbox durável nos três motores, integrada na recepção automática antes da cache normal. Guarda envelope e fonte autenticada em namespace signing-owned separado (`contribution-inbox`), com AAD/HKDF próprio em Node/Go e o mecanismo privado existente no browser.256entradas/64pendentes/32porcontribuidor/4conflitos/32MiB de provas, mais quotas globais reais. Expiração apaga provas e conserva metadados por janela finita30dias após maior prazo observado.

Reempacotar certificado não o substitui. Outro certificado do mesmo autor+UUID é conflito limitado, mesmo entre sites da identidade dona. Missing-source não concede valores como candidata verificada; fonte que chega depois pode promovê-la. Uma fonte já disponível é autenticada/verificada ANTES de reservar quota privada, para não ocupar a inbox com pedidos já recusáveis. API retorna durable:true e continua scope:candidates.

A fonte privada da inbox sobrevive à perda/expulsão da cache e reabertura com remetente offline. Bloqueio/retirada/prazo/sessão continuam aplicados. Fonte de site alheio não percorre inbox do utilizador. Valores não vão para estado periódico. **Não há ainda recibos, decisões/aprovação ou UI de formulários. Paleta oculta.**

## Próxima implementação obrigatória

Ler `.codex-delivery/CONTRIBUTION-INBOX-IMPLEMENTATION.md`, `CONTRIBUTION-INBOX-NEXT.md` e docs/SITE-CONTRIBUTIONS.md.

1. Obter fonte que só está na fila privada do visitante. Actualmente o teste de fonte tardia usa a cache normal/gossip do visitante com relay reactivado. Não afirmar recuperação dessa área privada nem conclusão com relay pausado nessa condição.
2. Gestão de recusa/purga e pressão de candidatas cuja origem não se consegue verificar. A pré-verificação corrigida cobre source já disponível; não é defesa universal contra spam/sybil. Preservar pendentes válidas e definir explicitamente o tratamento de não admitidas/expiradas.
3. Recibos assinados do dono, vinculados a certificado/autor/UUID/destino, diferentes de ACK físico e aprovação. Persistir antes de assinar/enviar, repetir os mesmos bytes; esclarecer recibo tardio sem renovar proposta ou concessão.
4. Decisão do dono com CAS/reconciliação da base/esquema/audiência, validade no ponto de commit e conclusão recuperável. Proveniência conserva assinatura original; alterações do dono não se atribuem ao visitante.
5. Só depois UI completa PT/EN/ES, composição/envio/revisão/aceitar/rejeitar/reconciliar, três contas reais, teclado/toque/Axe/desenho e worker de produção. Manter o resto do contrato (grupos web, backup/rotação/keystore, plataformas/rádios e revisão independente).

## Gates completos e processos

**Nenhum teste/processo local deste incremento está vivo.** Handles13269 (amplo),44836 (revisão) e restantes controlos foram recolhidos. Não repetir suites por falta de handle; relatórios são terminais.

- `.cache/contribution-inbox-final/report.json`: **514Node**,17pacotesGo/race,66processos,builds e60casos porengine PASS. Go reutilizou cache de pacotes inalterados; app/sites foram executados.
- Depois da revisão de quota: `.cache/contribution-inbox-reviewed/report.json`: **20Node afectados**,Go app/sites-race,41processos,builds e19casos porengine PASS. Oito fontes diferem do gate amplo, enumeradas.732hashes finais correspondem aos commits; não apresentar testes anteriores como execuções posteriores.
-61vectores Node/portátil/Go (25aceites/36recusados) concordam canonicamente. Go/Node lêem e escrevem na mesma SQLite; crashes reais antes/depois de admissão/anexar fonte, corrupção, bloqueio, prazo e namespaces têm negativos/positivos.
- API em processos: recepção antes de abrir inbox; perda de dois ficheiros de cache depois de parar processos; remetente offline/socket ECONNREFUSED; reabertura mantém candidata. Browser usa expulsão real por quota e fecha o emissorRTC.
- Propostas browser↔Node/Go nos dois sentidos porRTC→WS através de uma terceira identidade sem chave; topologia/autoria/leitura recusada verificadas. Não é HTTPS/WS entre aparelhos físicos nemrádio.
- Worker compilado/setup/unlock/reload e UI existente passaram. Composição/aprovação de formulários pela UI não foi feita porque ainda não existe.

Provas curadas: **docs/evidence/site-contributions/inbox** e **docs/evidence/ci-2948284-budget**. Scripts/logs/JSON/hashes e fontes exactas. Capturas históricas continuam fora destes commits, salvo artefactos explicitamente curados.

## Falhas corrigidas com evidência

Primeiro typecheck: inferência template UUID nafixture, corrigida anotação string. Primeiro teste de corrupção esperava closed e recebeu Registo fechado; a defesa já funcionava. Browser comparava ordem JSON.stringify; corrigido para canonical, sem mudar produto.

Revisão posterior:64propostas autenticadas de dois contribuidores não autorizados para um formulário disponível ocupavam a quota. Post positivo chegava, proposta permitida não. Controlo correcto2FAIL Node/Go; preflight checkSource corrigiu e gate final passou. Primeira tentativa desse controlo teve wire.close inexistente no teardown: mascarou a asserção e deixou só processos dafixture; foram identificados/encerrados por PID/cwd, perfis/logs preservados e auditoria guardada. Nenhum serviço alheio tocado. Não confundir esse erro dafixture com o defeito reproduzido depois.

## CI, web e plataformas

CI35753597485/2948284 terminouCANCELLED. AnotaçãoGitHub confirma máximo15min acumulados; Ubuntu505Node+34UI PASS antes do cancelamento, Windows/macOSsucesso, jobs posterioresSKIPPED. Não é HTTP408 nem causa de concorrência demonstrada. Eb2a5b4 separa os mesmos testes UI Node/Linux num jobsequencial depois da matriz e antes deGo; novos15min próprios, limites existentes e deadlines dos testes preservados. O novo workflow ainda precisa deCI remoto.

CI35676434531/f69eb24: todos os jobs excepto iOS PASS,115browser. iOS26.4.1/Xcode26.6 passou build/install/startup/seed de fotografia e mensagem privada verificada peloNode; falhou missing seeded synthetic photo na linha308. Captura mostra fixture, AX expõe imagensPXGGridLayout-Info enquanto teste procura células. Anexo/resposta/recuperação continuam por validar; não alterar permissões/serviços para contornar. Provas docs/evidence/ci-f69eb24.

Web pública **inalterada**: https://johnnypbelo.github.io/relayloom/ — runtime7fdb76a5de5869efa6ebdd721bc7e8f5efac68af, distribuição0fdbd1b9563540a5bc28c74d669668e948aa7667. Sem formulários. Publicação nova exige build do commit exacto, gate da distribuição e HTTPS. Builds locais WIP não são releases.

Nunca afirmar todos os SO/aparelhos, rádios físicos, assinaturaApple, revisão independente ou prontidão para catástrofes. Objectivo integral activo.
