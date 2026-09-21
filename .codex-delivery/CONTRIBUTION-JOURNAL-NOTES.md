# Próxima integração de propostas — notas técnicas, ainda não implementadas

O contexto autenticado já foi ligado à consulta contribution-command/form em Node/Go/browser. A resposta é descrição para a UI, não uma capacidade de autorização. Criar uma proposta terá de resolver novamente a referência pelo motor. Não aceitar um ContributionFormContext enviado pelo cliente.

## Fronteiras a implementar

1. Pedido fechado: sequência, UUID, snapshotId/pageId/formId, valores, concessão máxima de publicação e prazo escolhido. O motor deriva endereço/revisão/esquema/autor/tempos e valida o visitante a partir do snapshot real. O hash do pedido inclui toda a intenção; resposta perdida repete a mesma intenção e consulta o resultado, não gera outro UUID/data/nonce.
2. Persistir a intenção **antes de assinar**. Estados separados de preparação e cópia/entrega; não imitar o catálogo de recursos como se a sua única transacção após assinar já cumprisse essa exigência. Guardar a cópia autenticada do snapshot de origem na área privada permite retomar após expulsão do cache público. Não usar metadados avulsos do cliente como substituto dessa prova.
3. Área privada com namespace e domínio próprios, derivados da posse da chave de assinatura. Node/Go podem estender SitePrivateRecords/PrivateRecords, mantendo domínios e bytes de site/resource inalterados. No browser, usar transactValues e chaves contribution:...; nunca reentrar profile.getValue/data dentro da transacção exclusiva. O catálogo deve rejeitar record ausente com stage existente, corrupção, chave de leitura como autoridade, sessão antiga e falha de quota, sem regenerar silenciosamente dados.
4. Registos finitos: contador monotónico, janela de resultados, uma preparação pendente, limite de bytes e contrapressão. Um pedido retirado com a sua sequência antiga nunca se torna novo. Documentar o âmbito temporal de dedupe; não prometer memória infinita de UUIDs. A inbox deve conservar propostas/decisões ainda válidas e recusar excesso, sem expulsar decisões pendentes para abrir espaço.
5. Fixar tempos ao preparar a intenção. O certificado pode ser determinístico para esse corpo, mas o envelope tem nonce aleatório e deve ser retido exactamente. Não renovar validade numa retoma. Go tem CreateBundleAt; Node/browser têm apenas createBundle(...ttlMs), usando Date.now internamente. Resolver essa diferença explicitamente, com validação e testes dos relógios, antes de tentar usar um ttl restante que cai abaixo do mínimo de1s ou aumenta o prazo original. Não mudar o relógio do sistema, não alongar limites para passar testes.
6. O transporte da proposta é privado para visitante+dono, separado da concessão máxima assinada para publicação futura. Uma assinatura do visitante nunca é aprovação nem revisão do dono. A nova espécie de conteúdo precisa de validação/admissão em todos os motores e trânsito opaco onde faltam chaves; não a fazer passar como mensagem comum só para evitar integrar a inbox.
7. Em browser, obter contexto fora da transacção exclusiva, depois verificar política actual na mesma revisão privada que recebe a intenção. O snapshot é imutável; bloqueio/retirada/sessão/prazo são mutáveis. A consulta actual lê blocked+mutations juntos numa transactValues. Lock invalida a geração; criação/cópia tem de manter esses fences.

## Separar submissão de divulgação

O método actual verifyForForm verifica a concessão contra a audiência do snapshot, além de autoria/contexto/prazo/esquema. Isso é útil para provar que uma contribuição pode ser publicada com essa audiência, mas não deve obrigar toda proposta privada para um site público a consentir divulgação pública.

Antes do journal, separar a verificação de **submissão** da verificação de **audiência de publicação**. Preservar os controlos existentes de recusa de promoção privada→pública. Acrescentar positivo de proposta cifrada e com concessão privada enviada ao dono de um site público; adoptar esses dados requer depois uma nova audiência compatível e reconciliação explícita. A API não pode falsificar o contexto original para tornar essa aprovação válida. A verificação da audiência, por si só, não é aprovação, prazo válido, CAS nem permissão de editar o site.

## Depois da preparação

Ligar envio/outbox e inbox privados; decisão do dono durável antes de publicar; revisão aprovada com CAS e prova da contribuição na linha. Mudança de base/esquema/audiência exige reconciliação, com concessão do visitante preservada. Edição posterior do dono não se apresenta como assinatura do visitante sobre valores novos. O visitante deve receber estado verificável; uma etiqueta local não basta.

Só activar a paleta/UI após esses caminhos funcionarem. Testar três contas pela interface, offline, perda de resposta/restart, processos Node↔Go, browsers, assinatura/leitura distintas, adulteração, quotas e concorrência. Os limites de hardware, Apple, grupos web, recuperação/rotação/keystore e revisão independente continuam no contrato integral.
