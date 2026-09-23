# Revisão própria da entrega de recibos — 23 de Setembro

Esta revisão é do autor da implementação. Não substitui a revisão independente ainda obrigatória; execução sequencial sem novos/retomados agentes.

## Autoridade e transacção

O visitante só aceita o recibo após autenticar o dono do endereço e ligar contributorId, certificateId, UUID, destino e prazos à sua operação persistida. transport.copied tem de ser verdadeiro. Uma assinatura preparada ou um ACK físico não chega. Guardar receipt e retirar o payload privado acontecem na mesma transacção; interrupções antes/depois e escritores Node/Go concorrentes foram exercitados. cancelled/expired mantêm o seu estado, com facto histórico separado; received nunca volta à fila. Janela retirada não é recriada.

O dono prepara/assina/sela/copia a partir do journal já comprometido. Envelopes e IDs são reutilizados. Bloqueio, retirada, sessão e prazo continuam a controlar publicação e seeding próprios. O lote rotativo de 8 limita o trabalho, incluindo cópias recusadas por quota; a recuperação da cache limita 32 candidatos, e no browser evita carregar media grandes. Verificar a cópia não significa que o visitante recebeu o recibo.

## Defeitos encontrados e controlos

1. Recibo recebido antes de unlock ficava cifrado em cache e não concluía a operação depois. O teste real com partição/seeder e dono offline reproduziu a falha. A recuperação percorre a cache limitada, reautentica e aplica o facto a uma operação correspondente; não confia apenas no tipo ou ID.
2. Um recibo autêntico sem histórico local fechava RTC como frame inválido. O controlo real falhou antes, passou depois. UnmatchedContributionReceipt identifica apenas recusa de vínculo local após validar registo e assinatura. O browser consome esse controlo sem o guardar ou alterar a fila. Corrupção de assinatura/índice e erro comum com mensagem igual continuam a propagar-se. O ACK físico que termina esse frame não é confirmação de admissão da operação.
3. Um retry idêntico deve preservar a referência de autorização enquanto uma leitura está retida; bloqueio/reautorização cria outra referência. Os controlos do recibo confirmam normal retry, bloqueio/desbloqueio e fecho de sessão, com consulta fresca positiva onde permitido.

Os casos de rede incluem envelopes públicos, leitores extra, autor exterior trocado, assinatura interior errada, outro certificado/UUID/dono, tempos alterados, campos extra, tamanho excessivo, bytes corrompidos e assinatura exterior errada. Cada recusa tem tráfego positivo no mesmo canal e conserva a proposta pendente. Um envelope opaco sem a chave local pode ficar emcache, mas nunca vira recibo admitido. Uma reembalagem válida repete o primeiro facto sem o substituir.

## Âmbito e limites

Controlos dirigidos passaram; o gate integral de757 fontes está em execução e deve terminar antes de declarar o incremento verificado. Nenhum teste de WebKit equivale a iPhone físico. A entrega não é decisão de aprovação/publicação. Continuam recusa assinada, CAS/reconciliação/proveniência e UI completa de três contas, além do restante PROJECT-BRIEF.

Falhas da fixture são separadas dos defeitos: relógio capturado antes de simular expiração; falta de engine na invocação de matriz; guard de tipo depois de filter; patch de teste recusado por indentação. Os controlos foram corrigidos sem mudar deadlines do produto ou declarar passes não executados.
