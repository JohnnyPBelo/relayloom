# Recursos opcionais — incremento isolado, ainda não integrado

Base59c9bd1, branch codex/site-optional-resources. A candidata das tabelas e o seu gate público correm no principal; não alterar essa candidata a partir desta árvore. Sem agentes novos, sem alterações a modelos/bridges/serviços. Não executar testes ou builds pesados em paralelo com o gate público. Tudo continua dentro de RelayLoom.

Objectivo: um site pode anunciar tabelas e ficheiros por referências cobertas pela assinatura da página; o leitor obtém apenas o que escolhe e pode servir a cópia verificada a outro leitor. Ausência, falta de acesso e corrupção são estados distintos. Abrir um manifesto não faz automaticamente download de recursos grandes. Disponibilidade exige pares que conservem os bytes. Não acrescentar scripts, HTML activo, SQL ou módulos remotos.

Primeiro passo nesta árvore: contrato portátil de payload/referência, limites e comparação com metadados de um envelope já autenticado. A referência prende ID de bundle, autor, tipo, nome, MIME, tamanho e hash canónico. A comparação é posterior à verificação de assinatura/chunks e desencriptação; o parser nunca concede autoridade. O hash refere-se ao payload canónico completo, não ao ficheiro binário isolado. Audiência privada não pode tornar-se pública só porque se acrescenta uma referência. A política aceita uma audiência igual ou mais estreita do site do que a do recurso.

Limites iniciais: ficheiro até2MiB descodificados, tabela mantém64KiB/256linhas/12colunas, nome até150unidadesUTF-16, tiposMIME enumerados. Os ficheiros são downloads; HTML/SVG/JavaScript não são renderizados. Mantém-se o orçamento do bundle4MiB e o documento128KiB. MIME/nome não são um caminho nem uma URL. Nenhum parser escreve no sistema de ficheiros ou faz pedidos de rede.

Passos seguintes obrigatórios antes de entrega: portGo e vectores negativos/positivos; tipo site-resource na validação e nos runtimes, criação idempotente/armazenamento/quota; documento v3 e referências limitadas, compatibilidade explícita; API que lê a referência de um snapshot verificado (sem aceitar metadados arbitrários do chamador), pede oID exacto e valida autor/hash/audiência; UI de anexar/descarregar/abrir tabela e estado de disponibilidade; transferência opcional com fonteoffline, corrupção/autorização/partição-heal/restart e testesUI emNode/Go/3browsers. Contribuições/formulários assinados permanecem previstos depois desta camada, com assinatura do visitante e aprovação separada pelo dono.

Estado inicial: contratos TS/Go, cinco casos de domínio e um oráculo TS→processoGo preparados. O oráculo compara recursos/referências e audiências, incluindo nomesUnicode/surrogates, limites exactos, base64não-canónico e tipos executáveis. Não ligado à aplicação, não testado, não commitado nem publicado. Não confundir esta fundação com funcionalidade disponível.

## Dependência de transporte a resolver

O inventário actual pode provocar obtenção automática dos IDs que um par anuncia. Não basta acrescentar um botão «descarregar» na UI: isso não tornaria o recurso opcional. A criação de recursos deve guardar localmente sem transmitir todos os bytes e anunciar uma disponibilidade limitada; inventário/sincronização não devem pedir recursos opcionais sem interesse explícito ou política de cache/relay consentida. Um novo leitor que só abre o site tem de demonstrar ausência dos bytes antes da escolha. Peers que encaminham um pedido de outro leitor podem continuar a retransmitir/cachear os pacotes segundo a política consentida. Não confundir esse tráfego de trânsito com um download iniciado pela página.

Os anúncios são pistas de disponibilidade, nunca prova de autoria ou acesso. A referência deve vir do snapshot assinado e a resposta passar verificação integral. Um par já pode omitir um ID; não confiar em hints para autorizar conteúdo, mudar audiência, promover uma versão ou concluir entrega. Qualquer evolução de inventário requer limites, compatibilidade clara e portNode/Go/browser com controlos positivos/negativos. Não adaptar apenas um dos motores nem fingir opcionalidade com conteúdos já descarregados pela sincronização antiga.

Expiração também deve ser explícita: referenciar um bundle que expira não lhe estende o prazo. O estúdio deve informar/validar a disponibilidade e oferecer republicação pelo dono quando necessário; não substituir silenciosamente umID expirado por outro payload, mesmo que tenha o mesmo nome. Retenção/pinning nunca promete conservação por terceiros.


## Primeiro gate executado

Em18/09, o typecheck passou e `node --import /home/absint0o/projects/relayloom/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 tests/site-resource.test.ts tests/site-resource-interop.test.ts` passou6casos em15,02s. O oráculo executou Go real e concordou nos42recursos (13aceites/29recusados), referências/hashes e13vectores de audiência. Inclui fronteira2MiB, Unicode/surrogates e falhas de integridade/autor/base64. Logs `.cache/site-resource-typecheck.log`, `.cache/site-resource-first.log` e `.cache/site-resource-vectors.json`. Sessão79565 terminada/recolhida. Isto verifica a fundação, não a aplicação, rede ouUI.

A leitura da sincronização identificou uma opção mais simples a avaliar: excluir `site-resource` do inventário automático e usar a referência assinada na página como anúncio. O pedido explícito porID já pode percorrer a rede e ser servido por um cache consentido; pode não ser necessário inventário novo. Confirmar em todos os runtimes, impedindo também broadcast automático na criação. Não implementar botões de opcionalidade sem provar ausência de pedidos/bytes antes do clique e presença depois, com origem desligada e seeder reiniciado.


## Integração de transporte e registo local — 18 de Setembro

O controlo real inicial falhou como esperado: um processoNode anunciava osrecursos no inventário. Node,Go eBrowser passam a excluí-los da sincronização automática, mantendo pedidos explícitos e seeding consentido. Recursos legíveis são validados antes de admitir/encaminhar; cópias privadas sem chave continuam opacas. Resumos periódicos contêm metadados, sem bytes/tabelas. Publicação genérica e announce não podem difundir recursos; a criação dedicada ainda não está ligada.

`tests/native/site-resource-routing.test.ts` passou2percursos com processos reais, assinatura inicial numa fixture separada, origem terminada/porta recusada, seeder reiniciado, witness normal automático, recurso ausente até pedido, pausa negativa e bytes/cifra/autoria exactos. A primeira repetição falhou apenas porque a árvore não tinha dist/web; depois do build os mesmos controlos passaram. Logs antes/after/built preservados.

Admissão/contrato/interop passou8casos: inválidos públicos e privados legíveis recusados, opaco sem leitura, bloqueio e corrupção após reinício. O motorBrowser passou as rotas RTC/WS paraNode eGo; a primeira matriz falhou no helper que só encaminhava request e não block. O helper agora chama o setBlocked real, sem contornar o controlo. A matriz actual (sessão18286) corre11casos porengine, incluindo transportes existentes/sitesv1v2. Chromium11 eFirefox11PASS; WebKit emcurso. Recolher handle e `.cache/site-resource-matrix-fixed/*.json` antes de repetir.

`packages/sites/src/resource-operations.ts` acrescenta a máquina de estados local para criação: sequência monotónica,128resultados retidos,umacópia pendente, UUID/fingerprint, conclusão comhash exacto e expiração sem reassinatura automática. Seis testes desse registo passaram; conjunto recursos/admissão/registo14PASS. Ainda não tem catálogo persistente, portGo nem API.

O armazenamento privado existente ganhou wrappers separados runResource/RunResourcePrivate e prefixo resource, com derivação/AAD própria, sem alterar o domínio/keyformat site. Node/Go trocaram2MiB na mesmaSQLite, recusaram transplante entrestores e a chave deleitura não desencripta assinaturas preparadas. Nove testes de armazenamento passaram, mantendo os controlos antigos. Falta testar troca de namespace e ligar catálogo/commit/cópia/recuperação com morte real deprocessos.

Todoeste código posterior ad3b7cad é WIP apenas nesta árvore. Nada foi integrado/publicado. A versão principal1e83db2/web59c9bd1 mantém-se separada. Próximo: terminar matriz,curar provas,implementar portGo do registo e catálogo persistente/criação idempotente,documentov3,API de referência verificada e UI. Não reduzir o contrato a uma biblioteca ou a um teste de transporte.


## Gate de transporte concluído

Sessão18286 terminada e recolhida:11PASS emChromium,11emFirefox,11emWebKit. Inclui novosrecursos e regressão dos caminhosWS/RTC/TCP/sériePTY e sitesv1/v2. Sessão88391 terminada:6casos expandidos de interoperabilidade de armazenamentoPASS, incluindo transplante entre namespaces; Go./sites comracePASS em13,959s. Nenhuma delas é UIdecriação ou catálogo de operações persistente. Provas curadas emdocs/evidence/site-optional-resources.

Próximo: implementar o catálogo decriação sobre o espaço resource protegido, com operação/fingerprint/counter antes decopiar para oContentStore; exact-copy/ready só depois deverificar osbytes copiados. PortGo da máquina deestados ainda falta. Perfisweb já derivam achave dosvalores privados da chavedeassinatura; usartransactValues, geração desessão e um único stagependente. Não misturar osíndices resource/site. A API deve devolver resultadosretidos para pedidosantigos, nunca gerar novoid silenciosamente após perda deresposta ou expiração. Depois documento3/referências/API ligadaao snapshotverificado eUI; testar quotas, morte deprocessos, reinício,privacidade, autoroffline e pedidos explícitos pelaUI.
