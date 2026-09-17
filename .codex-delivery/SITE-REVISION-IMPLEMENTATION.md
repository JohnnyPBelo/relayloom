# Revisões de sites — implementação em curso

O contrato completo mantém-se. Este incremento ainda não está integrado na aplicação nem publicado. Não chamar testes de certificados provas de persistência, transporte ou UI de revisões.

## Estado implementado em 17 de Setembro

O catálogo Node existe em `packages/sites/src/catalog.ts` e usa transacções SQLite reais através de `SitePrivateRecords`. Os modelos de conteúdo, registo e armazenamento já foram aplicados e testados; as candidatas em `.cache` estão desactualizadas e não devem ser reaplicadas. `finish()` foi substituído por commit/cancel/markReady/expire, com base persistida, separação da autorização e expiração terminal. A memoização de assinaturas é restrita a uma transição e não sobrevive a uma nova chamada.

Passaram 54 testes dirigidos e cinco ensaios com processos reais interrompidos antes/depois de commits e depois da cópia pública. Os detalhes, falhas e comandos estão em `RESUME.md` e `.cache/site-revisions`. A regressão completa Node passou384testes e Go sites/core passou comrace; sessão61405 recolhida. A correcção posterior de observações repetidas passou12testes afectados e typecheck. Provas em docs/evidence/site-revisions.

As bibliotecas Node/Go/browser de certificados passaram interoperabilidade. Apenas o catálogo Node tem a nova persistência; não existe ainda ligação às APIs, aos transportes ou à UI da aplicação. O método markReady pressupõe que o coordenador verificou a cópia pública; as pistas guardadas não provam que os bytes continuam disponíveis. Os pedidos privados nesta API inferior requerem o mesmo envelope para repetição segura. Go/browser, criação a partir de pedidos da UI, descoberta/resolução, quotas globais, migração e a revisão independente continuam pendentes.

Foram reproduzidos dois erros: tratar preparação expirada como corrupção e recusar recuperar o resultado de um pedido retido após expiração. Os helpers históricos autenticam a preparação para a terminar; a admissão e a leitura normal continuam a recusar conteúdo expirado. Uma preparação ainda não autorizada expira sem promover a cabeça; uma autorização expirada conserva a cabeça/contador e deixa de poder produzir novas cópias.

Os restantes parágrafos registam decisões e fases anteriores; não são resultados mais recentes.

## Decisão de protocolo

Cada revisão é um snapshot completo autorizado pela assinatura do proprietário, com domínio `relayloom/site-snapshot/1`, nome estável, sequência, IDs anteriores e hash do documento. O endereço é `relayloom:site:<ownerId>/<name>`; ownerId já deriva da chave de assinatura no protocolo existente, separadamente da chave de leitura. Mudar a chave de assinatura ainda exige o futuro protocolo de rotação/delegação.

A assinatura autoriza o snapshot inteiro; não é um patch que precise de todos os antecessores para ser legível. Isto permite obter/verificar o site de um seeder quando os dados antigos foram removidos. Os IDs anteriores permitem reconstruir e verificar o histórico disponível. Ligações conhecidas a outro proprietário/site ou para uma sequência igual/superior são recusadas. Ausência de histórico é explícita, não prova de novidade global.

A maior sequência assinada conhecida é a cabeça. Dois certificados diferentes com a mesma maior sequência são um conflito; chegada ou relógio não escolhem vencedor. Uma revisão superior é uma nova declaração completa do proprietário. A aplicação deverá exigir base observada/CAS e resolução explícita dos conflitos conhecidos antes de a criar. Cabeçalhos verificados devem persistir mesmo após expulsar o payload, para não promover uma reprodução antiga como actual. Não há garantia de descobrir uma revisão que nenhum par alcançável forneceu.

Esta decisão concretiza o rascunho anterior, conservado no histórico: a prova de autoridade é a assinatura do snapshot, e a genealogia disponível é verificada separadamente. Não se enfraquece a separação entre escrita, leitura e seeding.

## Código existente nesta etapa

- `packages/sites/src/protocol.ts`: endereço, certificados limitados, hash de payload, verificação da assinatura/owner/site/documento, ligações de histórico, conflitos e cabeças conhecidas.
- Adaptadores Node/portátil usam as primitivas mantidas já usadas pelos grupos. A extracção de `certificate-crypto` não pretende mudar formatos/algoritmos de grupos.
- `native/sites` e `native/core/certificate.go`: port Go com decoder de schema fechado, crypto mantida, limites e classificação.
- `tests/fixtures/site-revisions.json`: vectores assinados públicos, sem segredos, incluindo assinaturas válidas sobre domínios/ordens/números inválidos.
- Testes Node/portátil passaram22 (incluindo regressão de grupos/admissão de chaves). Typecheck inicialmente falhouTS2775; os verificadores passaram a devolver o valor validado e o typecheck passou.
- Go-race sites/core passou. Chromium real passou3casos: grupos existentes e certificados Node→browser→Go→Node/browser. Firefox em execução na última nota; WebKit pendente. Não são testes da UI final nem de transferência de sites pela rede.

## Integração obrigatória seguinte

1. Payload de site validado, sem o certificado circular, ligado ao seu documentHash; o bundle externo também tem de ser verificado e pertencer ao mesmo proprietário. Nenhum rótulo/contador recebido sem assinatura estabelece autoridade.
2. Catálogo persistente limitado de cabeçalhos verificados e bundles disponíveis. A cabeça conhecida não desaparece por perder os bytes; mostrar indisponível/histórico parcial. Actualizações não devem apagar formatos antigos/cofres/rascunhos.
3. Publicação com operationId, fingerprint, base de cabeças e intenção persistida antes de transmissão. Reservar sequência, preparar bundle, guardar, confirmar catálogo e resultado; recuperar interrupções sem perda nem dupla revisão. Rascunho stale exige decisão na UI.
4. Node, Go e worker/browser devem aplicar o mesmo contrato; pedidos de endereço recebem apenas pistas de peers e os certificados/documentos são sempre verificados. Sem servidor central obrigatório.
5. UI de URL estável, revisão fixa, histórico e recuperação de revisão antiga como nova publicação. PT/EN/ES, teclado/touch, várias identidades e capturas/Axe.
6. Grupos/dados de contribuição autorizada e ficheiros opcionais seguem esta base e continuam obrigatórios. Só dados/blocos declarativos; sem scripts/HTML/SQL arbitrário.

## Gates restantes

Persistência e migração, CAS/concorrência/replay/crash, limites/quota, Node↔Go↔browser em processos reais, A–B–C/partição/heal, autor offline e seeder novo, escrita/leitura indevida e corrupção. UI completa e artefactos/apps por plataforma; revisão independente permanece pendente sob a recuperação sequencial pedida pelo proprietário.

Manter Astra/Copilot Ultra, sem novos agentes, alterações a bridges/modelos/permissões/serviços. Só RelayLoom. Próximos comandos/resultados em RESUME.md.


## Revisão de integração de 17 de Setembro — decisão ainda por implementar

A recuperação sequencial permite revisão pelo agente principal, não revisão independente. O exame do modelo encontrou uma fronteira que tem de ser fechada antes de ligar o catálogo à rede: `finish()` não pode simultaneamente autorizar e pressupor que o bundle já está no store público. É necessário guardar `expectedBase` na intenção e revalidá-la quando se autoriza, incluindo concorrência assinada com a mesma sequência, não apenas uma sequência superior.

Estados previstos: `prepared` guarda certificado/bundle exclusivamente no armazenamento privado e não promove cabeça; `committed` é autorização durável irreversível de disseminação, com a cabeça persistida mesmo se a cópia pública ainda não existe; `ready` confirma disponibilidade da cópia. Cancelar só tem efeito antes de committed. Uma falha depois de committed retoma a mesma cópia/resultado; a UI não deve oferecer cancelar algo cuja assinatura já pode ter sido partilhada. Uma observação posterior pode mudar a cabeça conhecida, mas não revoga retroactivamente uma publicação autorizada. Ausência dos bytes de uma cabeça não promove uma revisão anterior.

Node/Go devem guardar registo e bundle preparado na mesma transacção da base privada já existente, com blocos de até512KiB para respeitar o limite de registo. Browser usa referências cifradas privadas, sem entrada no inventário, e a transacção conjunta `updateValues`. A cópia pública só acontece depois da autorização retornada da transacção. Exigir validação do envelope externo, autor, schema declarativo e hash do documento, além da assinatura do certificado. Listar intenções recuperáveis pelo catálogo limitado; nunca depender apenas de um timer em memória.

O pedido de publicação deve transportar a base observada e uma sequência/operação estável; repetição com resposta perdida devolve o resultado retido, sem assinar uma nova revisão. IDretirado não concede autorização para repetir. O desenho da UI deve manter endereço estável, versão fixa, histórico disponível, conflito explícito, indisponibilidade e rascunho desactualizado em PT/EN/ES. Não mostrar bundleIDs ou fases internas na composição normal.

Gates específicos seguintes: alteração de base entre prepare/commit, assinatura concorrente de igual número, morte real antes/depois da autorização e depois da cópia pública, replay após perda de resposta, autor offline/novo seeder, corrupções de catálogo e staged data, pressão de quota e autorização indevida. Esta secção não é prova de código executado nem de funcionalidade publicada.


A revisão encontrou ainda uma razão para não guardar assinaturas preparadas directamente nos registos genéricos: a base privada Node/Go existente cifra as suas linhas com a chave de leitura e autentica o índice por assinatura. Para sites preparados, usar uma camada privada adicional derivada da chave de assinatura, ligada a dono/store/chave lógica. Não alterar o formato legado nem a derivação dos grupos. No browser, os valores privados novos já usam a derivação da chave de assinatura. Controlos obrigatórios: observador com chave de leitura correcta mas chave de assinatura alheia não extrai prepared; troca de ciphertext entre chaves e entre stores falha; transacção abortada não deixa fragmentos nem índice parcial.

Candidatas preparadas durante o gate congelado encontram-se apenas em .cache/site-revisions/{registry,content,private-storage}-candidate.ts e site-registry-candidate.test.ts. NÃO foram integradas nem testadas; rever/aplicar depois de concluir o gate privado. O módulo de registos privados precisa de fechar o handle no fim do callback e impedir uso assíncrono antes de ser testado.


## Revisão durante a regressão completa

Não alterar fontes enquanto o gate61405 corre. Antes da integração de rede, acrescentar um controlo para observações idênticas: actualmente observe volta a cifrar/gravar o registo mesmo quando a revisão e o bundle já constam do catálogo. Evitar escrita repetida é relevante para desgaste e custo de floods; o resultado de autoridade deve permanecer igual. Ainda não foi medido nem corrigido nesta nota.

O serviço deve ser exercitado com ProfileDatabase real, dois escritores/conexões a disputar a mesma base e os limites do catálogo, além dos testes actuais de armazenamento/reinício/falhas. Go e browser precisam do mesmo contrato de transacção/expiração. Na integração, confirmar a gravação do catálogo antes de confirmar admissão; uma falta de capacidade não deve ser apresentada como versão aceite. Resolver disponibilidade consultando bytes e assinaturas reais, sem converter bundleHints em disponibilidade garantida.


## Resultado da revisão posterior

O controlo das observações repetidas reproduziu revisão de armazenamento9 em vez de1. A condição de igualdade antes de save corrigiu a escrita excessiva, mantendo verificação criptográfica e autoridade. O teste de ProfileDatabase usa a lease real do perfil, importa um rascunho legado válido, conserva bytes/digest da aplicação e reabre sem fallback ao legado. A primeira fixture inválida foi preservada como falha de teste. Os12casos finais passaram e os gates foram recolhidos. Não há ainda disputa simultânea de escritores, nem ligação à aplicação/rede/UI de revisões.
