# Continuidade dos sites — próxima implementação

Estado: **DESIGN_ONLY_NOT_IMPLEMENTED**. Complementa o estúdio publicado e o incremento de idiomas; não constitui prova de funcionalidade. O contrato integral e a separação entre autoria, leitura e seeding mantêm-se.

## Base confirmada no código

- `packages/content/src/site.ts` e `native/app/site.go` validam o documento v1: 12 páginas,128blocos,3níveis,4imagens/2MiB; não aceitam código de sites.
- `packages/content/src/types.ts` separa o documento do envelope assinado. As publicações actuais são imutáveis e endereçadas pelo conteúdo.
- `apps/web/src/site/model.ts`, `studio.tsx` e `renderer.tsx` suportam edição, navegação e visualização de um documento completo. O slug ainda não é um endereço externo estável.
- A praça escolhe a publicação disponível do autor. Isso não prova que seja a revisão mais recente globalmente, nem detecta por si só uma bifurcação assinada pelo mesmo autor.

## Ordem de implementação

1. Endereço estável e cadeia de revisões assinadas, interoperáveis em TS/Go/browser. Usar primitivas e serialização canónica existentes. O endereço deve identificar o site e o seu dono, separadamente do hash de uma revisão. Não usar carimbo temporal ou nome editável como autoridade. Decidir o formato versionado e a compatibilidade antes de escrever persistência.
2. Resolução local por revisão verificada e por melhor revisão conhecida, com distinção explícita entre conteúdo guardado, falta de antecessor e conflito de autoria. Um anúncio de um seeder é uma pista para obter conteúdo, não uma autorização para actualizar a página.
3. Publicação transaccional a partir da revisão de base observada. Um rascunho desactualizado não pode substituir silenciosamente alterações publicadas noutro dispositivo. Conservar a versão publicada ao reabrir e permitir seleccionar uma revisão anterior para criar uma nova alteração assinada.
4. UI de endereço partilhável, histórico e recuperação de revisão. URL de revisão fixa continua a mostrar exactamente esse conteúdo; URL do site mostra a revisão verificável conhecida e a sua disponibilidade. Importação de outro projecto conserva a separação entre copiar e editar a obra original.
5. Depois desta base: módulos de dados declarativos e contribuições assinadas por utilizadores com permissões específicas, revogação para o futuro, índices locais limitados e política de moderação do proprietário. Não importar a capacidade de executar JavaScript/HTML/SQL arbitrário do ZeroNet.
6. Ficheiros opcionais: manifestos/hash/tamanho/tipo assinados; obtenção individual com quotas, prioridade de mensagens/SOS, consentimento e apresentação de indisponibilidade. Actualmente imagens integram o bundle completo, pelo que metadados resumidos não podem ser descritos como esta funcionalidade.

## Invariantes a validar antes de integrar

- Só uma assinatura de autoridade do site pode estabelecer uma revisão. Quem descodifica, visualiza ou retransmite não recebe permissão de editar.
- A cadeia não aceita outro dono, outro site, revisão repetida com antecessor diferente, saltos sem prova, apontadores cíclicos ou comprimento/provas acima do orçamento. Aceitação fora de ordem é limitada e não dá origem a renderização antecipada.
- Dois dispositivos com a mesma chave podem produzir ramos válidos distintos. Detectar a bifurcação e apresentar uma resolução autorizada; nunca declarar um ramo correcto apenas por chegar primeiro ou ter hora maior.
- Os documentos de formato antigo continuam legíveis. Uma actualização não deve reinicializar rascunhos, cofres ou sites já em cache.
- A rotação da chave de assinatura ainda não está implementada. Não prometer continuidade de endereço depois de mudar a chave sem uma cadeia de delegação/rotação especificada e testada.
- Quotas contam revisões, dependências retidas e ficheiros. Pruning não pode apagar a única prova necessária para verificar a cabeça ou transformar falta de espaço num avanço de autoridade.

## Provas obrigatórias

- Vectores partilhados TS/Go; validação de schema/limites, leitura vs escrita, assinatura, ordem, bifurcação e adulteração. Controlo que demonstre recusa sem a chave do dono.
- Node→Go, Go→Node e browsers independentes. A→B→C, sem caminho directo A–C, revisão nova retida durante partição e obtida após heal. Encerrar realmente A; novo C obtém documento/cadeia de B e conserva autoria.
- Persistência/reinício e conteúdo pré-existente; publicação simultânea/stale-base; falha transaccional e ausência de revisão parcialmente publicada. Nenhuma eliminação do perfil para fazer o teste passar.
- UI: duas identidades, pelo menos três páginas, link de revisão fixa, link estável, histórico, autora offline, tentativa de escrita do leitor recusada, mensagens de erro/indisponibilidade, PT/EN/ES, teclado/touch e Axe/capturas.
- Gates afectados de domínio/interop/browser/UI e artefactos nativos após integração. Não substituir testes de rádio/Apple físicos por simulação ou cross-compilação.

A implementação começa só depois de terminar o gate de publicação activo, para conservar a proveniência dos assets. Não encerrar os processos de testes em curso nem alterar bridges/modelos/configurações externas. Próximo estado exacto em RESUME.md.
