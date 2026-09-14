# Avisos privados de grupo — codecs e journal

Os módulos `packages/groups/src/notices.ts` e `native/groupnotice` representam convites, consentimentos e saídas cifrados. Certificados, destinatário, cartão e parent/anchor são verificados; um envelope externo não concede assinatura ou adesão. O consentimento refere-se ao convite original exacto.

O journal participa na transacção protegida existente:64entradas,64saídas,8por emissor e256retirados. A memória de retirada é finita: depois do seu esquecimento, um aviso antigo pode reaparecer, mas isso nunca constitui consentimento local. A leitura de syncState inclui o cartão de convite e o pedido/cartão da saída para futura reconstrução pelo runtime, sem mudar autoridade.

Este marco foi aplicado sozinho sobre e095f2a numa cópia isolada do projecto. Passou build,18testesNode,5testesGo/race e1driver Node↔Go com processos/envelopes/ficheiros reais. A fixture auxiliar Go foi exercitada pelo driver, não contada como teste autónomo sem input. [Comandos e hashes](evidence/group-notice-codec/scope.json).

Transporte automático, caixa/UI e restantes adversariais são integrações separadas; o codec não activa estas funções na aplicação por si só. O contrato completo continua obrigatório.
