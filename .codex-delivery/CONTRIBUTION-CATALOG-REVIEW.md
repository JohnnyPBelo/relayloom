# Revisão local do journal de preparação — implementador, 22 de Setembro

Não é revisão independente nem conclusão do produto. A revisão obrigatória por outra pessoa/agente permanece aberta sob a restrição do proprietário de execução sequencial.

## Implementação existente nesta candidata

- `contribution-operations.ts`: pedido fechado, fingerprint da intenção completa e do visitante, sequência monotónica, UUIDv4, 128 resultados/1MiB, uma preparação activa, prepared/signed/cancelled/expired. O pedido antigo com sequência retirada é recusado. A janela finita não promete recordar para sempre um UUID reutilizado com uma sequência nova.
- `NodeContributionCatalog` e `BrowserContributionCatalog`: primeiro commit de intenção+snapshot cifrado de origem, sem certificado do visitante; assinatura numa transacção posterior, após revalidar a fonte e a política local. Origem, valores, concessão e tempos fixam o certificado. O snapshot não é recarregado de uma cabeça posterior numa retoma. O stage fica separado do inventário público.
- O prazo efectivo é o menor entre o prazo pedido e o snapshot, com pelo menos1s restante no início. A preparação usa o relógio novamente depois da política. Fonte histórica armazenada é autenticada antes de expirar/remover o stage. O clock-skew do envelope continua300000ms; não foi alterado o relógio do sistema.
- O domínio privado contribution foi acrescentado em Node/Go sem alterar os domínios existentes. Testes de SQLite entre processos verificam bytes exactos, seis direcções de transplante entre namespaces e recusa de transplante entre stores. No browser a chave contribution faz parte do AAD e os private values derivam da posse de assinatura.
- Cancelar/expirar conserva o resultado e remove o stage. Isso não revoga cópias de um certificado já obtido internamente; não há ainda mensagem de retirada/decisão enviada ao dono.
- `verifyForSubmission` valida o contexto original e a assinatura sem obrigar a concessão a cobrir os leitores do site. `verifyPublicationScope` valida a concessão para uma audiência escolhida e exige o dono entre leitores privados; não constitui aprovação/CAS/prazo. `verifyForForm` conserva a composição antiga das duas verificações.57vectores TS/Go verificam a distinção, incluindo privado→público recusado.

## Resultados e falhas úteis

Passaram o catálogo Node com processos abruptamente terminados em três fronteiras, quota/rollback, reabertura e corrupção; e catálogos em Chromium/Firefox/WebKit com assinatura retida, lock/rollback, reabertura, expiração e stage ausente. Um erro de integridade fecha a sessão de ProtectedGroupStore; o primeiro teste de chave de leitura tentou continuar nessa sessão e foi corrigido para reabrir com o dono legítimo, comprovando preservação. Outro teste comparava JSON.stringify de registos canonicamente equivalentes em ordem diferente; passou a comparar a estrutura completa. Falhas originais preservadas.

O helper de assinatura do perfil browser é interno e não foi acrescentado ao RPC. A consulta de formulário no worker continua a exigir snapshot autenticado e os testes de setup/unlock/recarga mantiveram ausência de fuga de chaves. Os valores do formulário são conteúdo privado, não metadados de estado; o estado do journal devolve fingerprint/IDs/tempos/fase sem o texto das células.

## Próximo código obrigatório

1. Portar a máquina de estados e o catálogo para Go; o codec privado Go implementado ainda não é esse catálogo. Exigir os mesmos vectores e retoma Node↔Go sobre a mesma SQLite, incluindo morte de processos antes/depois dos commits.
2. Ligar prepare/sign à API apenas depois de as políticas de bloqueio/retirada serem fornecidas pelo runtime e revalidadas na mesma transacção. Não receber source/context/ACL do cliente. `contribution-command` actualmente só tem a consulta form; os catálogos ainda não estão expostos como envio.
3. Envelope privado com identidade própria retida, validade fixa, confirmação de cópia e outbox/inbox. Os catálogos actuais param em signed; não chamá-los enviados/entregues. Resolver os tempos fixos do envelope Node/browser de forma explícita, sem TTL artificial e sem renovar prazo.
4. Aprovação/rejeição pelo dono, CAS de revisão, reconciliação, recibos verificáveis e proveniência. Os helpers de grant não são aprovação.
5. UI completa e três contas reais; apenas então activar a paleta. Regressão integral, testes de todos os motores, distribuição/publicação, plataformas/rádios e revisão independente continuam exigidos.

## Controlo adicional encontrado durante a regressão completa

`.cache/contribution-retention-control.ts` validou uma sequência sintética1,2,3 com nextSequence4 e depois removeu a operação2. Ambas foram aceites pelo validador actual, apesar de o algoritmo só retirar entradas mais antigas quando excede128. A área privada protege bytes contra adulteração por leitores, mas o validador deve também recusar esse estado logicamente impossível. Não chamar isto uma exploração de armazenamento nem perda real de propostas: só o parser foi exercitado com dados sintéticos.

Depois de terminar o gate Node actual72078 (fonte congelada em.cache/contribution-journal-final-source.json), exigir exactamente min(nextSequence-1,128) resultados e sequências contíguas que terminem emnextSequence-1. Acrescentar controlos de lacuna, remoção do primeiro/último e contador adiantado, preservando positivo e retenção de128. Repetir catálogo Node/browser e tipos; registrar a diferença de fonte em vez de atribuir o passe do gate antigo à fonte corrigida.

O gate completo também detectou em tests/i18n.test.ts a entrada `Formulário` em falta no catálogo de idiomas. O rótulo vem do modelo v4 já commitado, embora a paleta permaneça oculta. Acrescentar EN/ES (Form/Formulario) depois da execução actual, executar a verificação de catálogo e preservar este FAIL como evidência; não o atribuir à rede nem saltar o teste.


Os dois pontos de revisão acima foram corrigidos. O controlo sintético conserva contiguousAccepted=true e agora missingRetainedOperationAccepted=false. A segunda suite integral terminou494/494 PASS, seguida de build e catálogoFirefox/WebKit; Chromium dirigido também PASS. Não inferir revisão independente nem UI completa. Gate76653 terminado e recolhido0, provas em docs/evidence/site-contributions/preparation.
