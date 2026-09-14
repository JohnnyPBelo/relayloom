# Certificados partilhados e perfil de chaves — gate completo

Base2d4d12c;457fontes estáveis,22inputs do incremento em inputs.json. Comando: `node scripts/verify-group-browser.mjs`, terminou0. O relatório inclui cada comando, ambiente e duração.

- 281testesNode,zero falhas/omissões.
- SuiteGo integral com-race-count=1-p=2 nos16pacotes; app416.988s, dentro600s. Os logs não enumeram cada subteste; não se infere uma contagem a partir do código.
- Contrato SQLiteC nos5pacotes com-race-count=1-p=1 e tags existentes.
- 58testes de interoperabilidade Node/Go,zero falhas/omissões.
- Reticulum:perfis,processos reais,autorizações,partição/heal e UI nativa/autónoma;PTY não é rádio.
- 28testes Chromium, incluindo48vectores de chaves e certificados nos três motores.
- 25UI Node+25UI Go e desktopLinux build/run/package/run.

Doze auditorias Axe novas da aplicação autónoma/convites/RNS não tiveram violações. O manifesto identifica os ficheiros; as capturas gerais sobrescritas entre motores não são contadas duas vezes. Isto não é revisão independente, leitor de ecrã ou teste de dispositivo.

Falhas anteriores preservadas: Node/Go aceitavam cartão de chave neutra antes do filtro; import equalBytes apontava para o pacote errado; import JSON no carregador Playwright impedia o arranque do teste. A correcção do envelope/persistência já pertence à base2d4d12c e o seu caso passou novamente entre os58interop.

A extensão posterior da rota com um browser intermediárioRTC, o incrementoUIKit e as respectivas alterações deCI não fazem parte desta árvore. O domínio completo de grupos no browser (autoridade,armazenamento,quotas,outbox,replay eUI) continua obrigatório. Não confundir os certificados com paridade funcional completa.
