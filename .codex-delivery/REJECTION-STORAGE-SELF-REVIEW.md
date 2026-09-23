# Revisão própria da persistência de recusa

Revisão do autor, não independente. Trabalho sequencial por instrução do proprietário.

A intenção vem de uma proposta já autenticada na inbox privada. A decisão usa a revisão actual da inbox e o certificado/UUID/destino/prazos originais; persiste o card público do destinatário antes de remover a prova. A decisão e a limpeza usam o mesmo commit. A existência de um recibo anterior é preservada; recusar uma candidata sem origem não afirma que essa origem foi verificada. Descartar localmente permanece uma operação diferente.

Uma repetição com o mesmo motivo devolve a intenção original, incluindo timestamp e prazo. Alterar o motivo, usar uma revisão futura, decidir sobre uma vista desactualizada, uma candidata expirada/descartada ou uma prova adulterada é recusado. O prazo da recusa é finito e não prolonga a concessão. A fase rejected conserva-se após expirar a preparação; expiração/retenção nunca recriam a proposta.

Node e Go cifram as preparações no novo namespace contribution-rejection, com domínio de derivação/AAD separado. O browser usa os valores privados existentes, associados à sessão e chave lógica. Não se alteram os formatos ou segredos dos namespaces anteriores. Os índices exigem correspondência exacta com as preparações: órfãos, falta de stage e corrupção fazem falhar a leitura/limpeza. A cópia só se regista para o envelope original relido e verificado; não prova entrega ao visitante.

Os métodos do browser verificam a sessão após awaits. Preparar a decisão volta a verificar a política antes de escrever e depois de preparar a remoção. Bloqueio e retirada da política impedem emissão; descarte local continua disponível. Helpers de assinatura/selagem ficam internos ao perfil, fora da RPC. O gate do worker de produção é obrigatório antes de afirmar esse último controlo executado.

A limpeza browser soma o custo das provas, recibos e recusas ao limite existente de128 por commit. Até256 entradas com as duas preparações e até64 provas cabem nas seis passagens existentes; nenhuma transacção aumenta o máximo de192 chaves. O controlo de129 recusas guarda assinaturas reais e perde a resposta entre os dois commits para verificar retoma e ausência de órfãos.

## Estado dos testes nesta revisão

Protocolo da2d174: gatePASS com64 vectores novos e regressão dos recibos; Go/race e2 casos por cada engine. Operações:70 vectores Node/portátil/GoPASS.

Primeira regressão de armazenamento:75/77PASS. As duas falhas eram da nova fixture Node, que reutilizava a instância fechada após um erro de integridade deliberado. A fixture passou a exigir essa falha, reabrir a base autenticada e comprovar que o envelope original sobreviveu. O erro não justificou relaxar a verificação de integridade. Log original preservado.

Primeiro driver browser parou no typecheck, antes de executar testes: variável signed duplicada na fixture e resultado opcional sem assert de presença. As duas verificações foram corrigidas; não são falhas observadas no browser. Driver dirigido posterior73110 emcurso, com testes de crash/concorrência novos e matrizes reais; recolher resultado antes de declarar este armazenamento verificado.

Faltam a admissão/entrega da recusa, a UI completa de revisão e publicação, reconciliação/proveniência e toda a restante matriz do contrato. Nenhum passe local equivale a rádio/dispositivo físico, segurança certificada ou produto concluído.

## Resultado final neste âmbito

627ad6c foi commitado após revisão terminalPASS:535Node,17Go/race,167casos únicos entre processos e120porengine, builds e768hashes conferidos. A revisão preserva oFAILoriginal de cinco arranques sem reserva, repete o ficheiro afectado após recuperar espaço e herda apenas fases de fontes idênticas. Provas curadas em docs/evidence/site-contributions/rejection-storage,41 artefactos. Isto verifica persistência, não entrega/UI nem revisão independente.
