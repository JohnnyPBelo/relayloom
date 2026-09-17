# Estúdio com endereço e histórico — próxima integração

O marco browser de catálogo/API está integrado no principal e em gate de três motores em `.cache/site-browser-final` (sessão 31008). Não alterar fontes principais enquanto corre. Trabalho preparatório seguinte fica em `.cache/browser-site-parity`, que recebeu o commit Go por cherry-pick local **8bf95fc** (equivalente a 3f63f19). Não o confundir com uma publicação remota.

## Requisitos de comportamento

- O endereço estável de `profile` pertence à chave de assinatura. O histórico apresenta versões verificadas, disponibilidade real e conflitos; não escolhe uma revisão antiga por timestamp nem substitui uma cabeça sem bytes por um payload anterior.
- Cada rascunho novo guarda a base e sequência de publicação de quando a edição começou. Salvar/reabrir não actualiza essa base silenciosamente. Rascunho legado só adopta automaticamente a base se ainda não houver site versionado; caso contrário exige comparação/escolha explícita.
- Antes do primeiro envio, guardar UUID e digest do pedido juntamente com o rascunho cifrado. Uma resposta perdida procura o resultado da operação, retoma exactamente o pedido ou informa conflito. Não mudar UUID/conteúdo automaticamente. Bloquear alterações do rascunho enquanto há resultado por determinar; permitir resolução/cancelamento segundo a fase durável.
- Só mostrar publicação concluída para a fase ready. Quota, leitores bloqueados, preparação, expiração, cancelamento e resultado desconhecido são estados diferentes. Uma operação pronta ultrapassada por outra edição não permite adoptar a nova base sem revisão do utilizador.
- Ver uma versão antiga é leitura. Recuperá-la prepara um novo rascunho sobre a base confirmada e exige nova assinatura. Não atribuir autoria ao leitor, ao seeder ou a importações.
- Conflitos mostram todas as cabeças conhecidas e exigem confirmação explícita das mesmas; actualizações que cheguem depois são recusadas pelo CAS existente. Não simular merge automático.
- PT/EN/ES, teclado/toque, foco e feedback acessível, composição Liquid Glass consistente e zero controlos sem acção real. Endereço copiável, botão de actualização, histórico percorrível e pré-visualização verificada.

## Implementação prevista

Adicionar contexto opcional ao rascunho privado com validação partilhada TypeScript e equivalente Go: domínio, endereço do dono, base, sequência e pedido pendente ligado a um digest. Aplicar validação na admissão e leitura persistente em Node, Go e browser. As chaves ficam no worker/core; a UI só recebe o contexto do próprio rascunho.

Ligar o controlador do estúdio à API site-command existente e preservar os valores de rascunho em falhas. Integrar endereço/histórico/versão fixa/recuperação em leitura e escolha explícita da base. Esta nota é desenho do comportamento, não prova de funcionalidade implementada.

## Gates seguintes

Vectores positivos/negativos do contexto; gravação/leitura privada nos três motores; resposta de publicação perdida; edição concorrente entre duas instalações; interrupções antes/depois do commit; quotas; lock/reload; heads sem bytes; histórico e recuperação a nova versão. Testar a UI real em Node/Go e três engines web com contas distintas, Axe, captura e revisão visual. Depois gerar/verificar artefactos exactos, repetir regressões afectadas e publicar. A publicação pública actual mantém-se na fonte 0c6b58a / distribuição 45ecacdf até esse gate passar.

O contrato inteiro, Apple/hardware, grupos dinâmicos web, backup/rotação/keystore, dados/contribuições declarativas/ficheiros opcionais, todos os meios e revisão independente continuam obrigatórios. Recuperação sequencial, sem agentes/configurações/bridges/serviços externos.


## Candidata preparada durante a regressão browser

O gate do principal terminou e a correcção de selector passou nos três motores. A worktree acima tem agora o contexto opcional do rascunho ligado à persistência dos três runtimes e um componente de histórico/read/recuperação que chama a API real, com traduções PT/EN/ES. Este componente ainda não está montado no estúdio. Dois testes TypeScript de contexto, typecheck e TestEditingContextOwnerAndPendingShape em Go passaram. Faltam os vectores de paridade e testes de API da persistência, a ligação do controlador/publicação, resposta perdida, contexto legado e todos os percursos UI/Axe. Não copiar esses ficheiros por cima do principal validado antes dos gates.

Na próxima integração, carregar as operações pendentes pela API de estado do site; o resumo global sitePublishing é um estado em memória que só reflecte a recuperação depois da inicialização/tick. Não inferir ausência de trabalho durável a partir de um resumo inicial vazio.


## Integração activa sobre dc57316

Na continuação seguinte, a candidata de contexto/persistência/histórico foi copiada para o principal por 14 caminhos explícitos, depois de verificar ausência de WIP nesses alvos e a diferença do BrowserApplication face ao marco testado (apenas validação/persistência de editing). A worktree original fica conservada. Implementar agora o controlador e montar o painel no principal. O turno anterior foi progresso verificado, com código e198cenários consolidados, não um turno sem progresso. Nenhum teste local desse turno permanece activo.


## Estado após integração e primeiros percursos completos

O principal contém SitePublisher/SiteEditor/SiteHistory/SiteVisit e os controlos montados. O contexto persiste recipients/ttlMs além da base/seq/UUID/digest; a recuperação conserva leitores e exige preview verificado antes de substituir o rascunho. Leitura normal segue novas versões observadas e a escolha histórica fica fixa. A privacidade está num painel recolhível depois da primeira revisão visual. Os novos textos têmPT/EN/ES.

8testes de controlador/contexto (processosNode/Go incluídos) passaram. O primeiro percursoUI existente passou. DoisnovospercursosUI ficaram completos emChromium: privacidade/histórico/recuperação/reload com3contas e fork deidentidade recuperada pelaUI. A primeira candidata falhou na fixture de navegação antes de unlock; a espera explícita pela heading de conversas corrigiu-a sem alterar timeout. A repetição passou21s. FaltamFirefox/WebKit,Node/GoUI,oráculosmetadados,edgecases/teclado,toque,Axe final e regressão. A correcção posterior de onActionError ainda não tem testeUI.

Uma revisão identificou o caso a reproduzir a seguir: chega um fork entre preflight e publish, muda a base mas a sequência pendente pode continuar por consumir. O controlador não deve congelar o rascunho para sempre, nem afirmar cancelamento de resultado desconhecido. Demonstrar comprocessosreais que uma base monotónica diferente e ausência doUUID pendente impedem admissão tardia, antes de alterar o abandono seguro. Testar também settleRetained e feedback de validação local, que agora é delegado ao painel sem deixar uma mensagem antiga de sucesso.

## Verificação seguinte — progressos e correcções

O fork tardio foi reproduzido com Node/Go eTCP: mudava a base sem consumir a sequência e impedia encerrar o rascunho. pendingCannotBeAdmitted usa a base autenticada monotónica ou contador consumido, e ausência de operação pendente com esseUUID; nunca afirma cancelamento de resultado desconhecido. A repetição passou10casos. Uma fixture excedeu60pedidos/s; foi espaçada em25ms porpedido, semretries ou alteração da limitação do produto.

O problema de reload foi reproduzido localmente com a imagem grande: screen/flags confirmam erro de outroperfilaberto após pagehide/terminate. O worker agora aguarda até2s pela libertação normal doWebLock; nunca força libertação ou toma um perfil activo. Um teste com lock real em encerramento e o controlo de outroseparador vivo passaram. O foco do botão também foi corrigido após guardar, preservando interacções entretanto feitas pelo utilizador. Gate dirigido de5casos PASS em43,3s. O conjunto expandido do controlador/contexto/selecção de motor passou13casos; quota mínimaNode/Go é1MiB e a fixture usaGIF válido comcomentários para a exceder, não o limite1KiB do browser.

Corrigida a atribuição histórica de UI Go em dois drivers locais: usavam envgo e executavamNode. Os relatórios originais mantêm-se, com errata em docs/evidence/site-ui-runtime-correction. O runner/helper rejeitam valores desconhecidos; positivo consulta nativeRuntime=Go. Novo percurso UI privacidade/histórico/autoroffline passou efectivamente emNode eGo. Foi depois acrescentada recuperação de rascunho à mesmafixture, a validar no gate completo.

Matriz dirigida em curso: .cache/site-editor/check-browser-matrix.mjs, relatório browser-matrix/report.json, sessão14438. Fontes congeladas. Inclui estúdio, runtimeworker, imagemgrande e arranque emChromium/Firefox/WebKit, maisChrome comoCI com3repetiçõesdeimagem/lease. Não modificar fontes nem repetir casos concluídos enquanto corre.

Uma candidata de diagnósticoiOS está apenas em .cache/site-editor/ios-picker-diagnostic.patch: captura XCUIScreen antes da consulta de células que falhou. Ainda não aplicada, compilada ou executada. Não corrige nem valida o selector; pretende obter a imagem correcta do picker no próximoCI, mantendo gestos/prazos/permissões.

Revisão visual durante a matriz: o campo do endereço fica demasiado estreito dentro do diálogo, apesar de haver espaço no viewport. O breakpoint actual mede o viewport e não o espaço do componente. Correcção pendente (não aplicada durante fontes congeladas): .cache/site-editor/address-layout.patch, com flex-wrap e base mínima legível para o label. Acrescentar uma asserção de largura do campo no diálogo EN/ES/compacto e repetir esses percursos. As imagens observadas são .cache/site-editor/ui/chromium-en-GB-history.png e chromium-editor.png; Axe por si só não detectou esta falha de composição.


A regressão actual passouUI Go32 eChromium73. Firefox passou72/73; a asserção que exigia manter o mesmo canalRTC aberto após pausa de relay recebeuclosed=true, embora o SOS próprio tivesse chegado. Falha preservada em .cache/site-editor/full/firefox-first-failure. Cinco repetições dirigidas e depois8casos do ficheiro routing passaram com diagnóstico limitado de metadados/closeReason, sem trocar prazos/assertivas/runtime. Não foi identificada a causa: não chamar corrigida nem apagar a ocorrência. Os dados não contêm payloads ou chaves; ficam em .cache/site-editor/full/relay-debug. A próxima passagem integralFirefox com diagnóstico deve procurar o contexto e terminar os restantes gates; a incerteza continua explícita até haver causa comprovada.
