# Integração de revisões na aplicação

O contrato completo permanece activo. Recuperação sequencial, só RelayLoom, sem novos agentes nem alterações a modelos/bridges/serviços/permissões. A etapa anterior é progresso verificado; não é conclusão do produto.

1. Acrescentar pedido de criação lógico ao catálogo, com sequência, UUID, base observada, documento validado, cartões exactos dos leitores e prazo. Guardar o fingerprint do pedido juntamente com a operação, antes de qualquer cópia pública. Repetição retorna o mesmo resultado mesmo depois de eliminar o staging; não gerar outra cifra/revisão para responder a um pedido antigo.
2. Ligar um serviço de sites ao perfil/ContentStore/router Node. Ingerir revisões verificadas antes da recuperação dos pedidos pendentes. Validar o certificado e autor antes de renderizar/admitir uma página versionada; a publicação genérica não pode contornar a nova fronteira. Falta de payload conserva a cabeça conhecida.
3. APIs autenticadas para estado, publicação, operação, cancelamento, histórico e resolução por endereço/revisão. A recuperação usa o mesmo bundle preparado. A integração inicial usa a distribuição e inventários reais já existentes; a ausência de uma revisão desconhecida é explícita e não é uma prova de frescura global. Pedidos por endereços ainda desconhecidos não inventam IDs nem dependem de servidor central.
4. Testes de API com processos reais, autor offline/novo leitor, bases concorrentes, quotas/corrupção/autorização, perda de resposta e reinício. Não tratar testes da biblioteca como testes da aplicação.
5. Implementar persistência/API equivalentes em Go e browser e depois ligar o estúdio partilhado: endereço, histórico, revisão fixa, restauração como nova publicação, conflito e recuperação em PT/EN/ES; UI com várias identidades, teclado/toque/Axe/capturas e matriz completa. A paridade mantém-se obrigatória. Contribuições, dados declarativos e ficheiros opcionais seguem esta base.

O CI894d8f4 está em curso: confirmar antes de push. A web publicada0c6b58a/45ecacdf já foi verificada e não deve ser confundida com esta integração ainda em implementação.


## Resultado local

Criado o serviçoSiteRuntime e a rota autenticadasite-command no nó real. Os pedidos lógicos incluem fingerprint de documento/leitores/prazo/base e confirmação explícita de conflitos. Recepção/renderização verificam a ligação ao certificado e proprietário. Recuperação após falha de gravação/cópia e após saída real do processo foi testada. A cabeça sem bytes continua pendente e há selecção explícita de revisão antiga.

Gate66071 terminouPASS; o handle deixou de existir após continuação, mas o relatório final e a ausência de processos confirmaram o fim, sem repetir o gate.397Node/31UI Node/31UI Go/2interop legado eLinuxbuild/run/package/run. Fontes estáveis durante o gate; só o testeXCTest mudou depois, num incremento separado. Provas docs/evidence/site-api.

CI894 revelou17falhas porhost pela pasta de fixtures emfalta. O helperproject-temp foi verificado emcópia limpa da árvoreGit,18testes+typecheck, e passou depois nos três hosts noCIa1. A integração completa passou28casos emoutra cópia limpa. Os erros do driverAPI (until/Router.close) e a cópia incompleta deplaywright.config do verificador foram preservados; os passes referem-se às repetições corrigidas.

Seguem Go/browser e UI real de revisões. Não reduzir o contrato nem chamar os resultados presentes uma entrega completa do editor.
