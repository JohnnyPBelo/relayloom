# Liquid Glass — implementação autorizada, 2026-09-13

O proprietário pediu UI/UX Liquid Glass e o contrato funcional completo. Esta iteração prioriza a interface real, sem substituir transporte, armazenamento ou segurança por simulação. Execução sequencial sem agentes novos, mantendo Astra/Copilot Ultra.

## Direcção e aceitação

- Superfícies translúcidas com luz difusa, arestas especulares e profundidade; base pérola/teal, modo escuro profundo. Conteúdo de leitura permanece legível, e o site publicado conserva a sua paleta declarativa.
- Navegação, conversas, feed, editor, guardados, rede, definições, onboarding e diálogos coerentes; alvos >=44px e uso confortável desde320px e janelas desktop pequenas.
- Pesquisa/comandos reais por Ctrl/Cmd+K, navegação por teclado e retorno de foco; pesquisa limitada explicitamente às mensagens da vista carregada, sem alegar pesquisa integral ainda não implementada.
- Preferência local de efeitos; modo económico, contraste alto e preferência de transparência reduzida suprimem blur. Movimento reduzido respeitado; fallback opaco quando backdrop-filter não existe. Nenhuma dependência/CDN/serviço externo novo.
- Diálogos adaptam-se à área visível/teclado e mantêm semântica nativa; campos, rascunhos, recuperação e bloqueio preservam privacidade.
- Testes reais de todos os fluxos UI Node e Go, novos controlos de comandos/privacidade/efeitos/viewport, Axe, capturas e desktop. Rever/corrigir antes de publicar. Não confundir CSS inspirado em Liquid Glass com material nativo privado Apple.

## Limites que continuam no contrato

Grupos por épocas têm API de envio/recibos, mas composição/gestão dinâmica e carriers ainda precisam de integração. Eventos, pesquisa integral, keystore/rotação, social/media/templates adicionais, notificações reais, gates móveis e revisão independente não se tornam concluídos por um redesign. Manter README/STATUS exactos e continuar estas fases.

## Browser

A skill browser foi lida; o bootstrap browser-client com backend iab falhou por ausência de backend. A validação prossegue pelo harness Playwright existente do projecto e revisão de capturas, sem alterar bridges/configuração.

## Implementação e controlo — 2026-09-13

`appearance.ts`, `commands.tsx`, `liquid-glass.css` e integração no App já implementados. Paleta real com pesquisa sem acentos, páginas/conversas/acções, mensagem focada e consulta desmontada após lock; rascunho conservado entre áreas. Barra móvel com destinos reais, reduzida durante conversa/teclado. Preferências locais e estado lowPower da API controlam os efeitos. Sem dependências novas.

Testes dirigidos passaram2 casos15.2s após correcções: selecção de elementos da fixture passou a limitar-se à paleta, preferências assíncronas esperam o estado real; contraste transitório de texto durante animação de opacidade foi substituído por deslocamento; toast ganhou foreground correcto. Medição obrigatória de44px detectou43/40px em regras antigas: mínimo aplicado aos botões.6 áreas×6 larguras passam sem overflow. Fotografias e conteúdo são sintéticos, mas transporte/API/armazenamento são reais.

Gate sequencial `node scripts/verify-ui.mjs`, sessão35910: typecheck3.987s/web1.603s/CLI Go0.813s e19 testes UI Node132.826s passaram. Go/desktop ainda em execução; nenhum passe presumido. Fontes congeladas e hashes289. Depois de terminar, compactar a vista de conversa móvel identificada pela revisão da captura320px, preservando todos os controlos, e voltar a validar as áreas afectadas. Não interromper o gate em curso.

CI f37067f/run34757307906 terminou: Node3OS/Go/3desktop passaram; iOS arrancou1 teste41.627s mas addmedia excedeu60.306s antes do fluxo funcional. Artefactos sanitizados em docs/evidence/ios/f37067f. Não repetir cegamente a importação nem aumentar prazos; hardware/Apple continuam limites explícitos.


Gate35910 terminou0 com19 testes em cada motor, desktop Linux/AppImage/execução,289 fontes inalteradas. Após a revisão, o cabeçalho geral foi ocultado na conversa móvel, aumentando a área do histórico para>450px a320×844;2 dirigidos passaram14.6s. Gate final15179 activo em .cache/ui-verification/report.json. Não modificar fontes antes de terminar. Arquivo preparado por .cache/liquid-glass/archive.py, que exige todos os passes, hashes iguais,19 testes sem skips/flaky por motor e62 Axe (31 por motor) sem violações; a contagem deve ser confirmada pelo script, não presumida.


Gate15179 terminou1:18/19 Node141.958s; a compactação escondia o botão Estado dos envios após reinício móvel. Falha/controlo preservados em .cache/liquid-glass/gate-mobile-outbox-regression. Controlo compacto recolocado no topbar;6 dirigidos passaram37.6s (56464). Gate final74981 agora activo, sem alterações de fontes até conclusão.


## Gate final concluído

74981 terminou0:19 Node142.211s/19 Go127.734s;typecheck3.959s/web1.551s/CLI0.138s;desktop build0.110s/execução1.694s/AppImage10.049s/pacote descompactado executado0.768s.62 Axe sem violações e289 fontes inalteradas.102 artefactos arquivados/verificados em docs/evidence/liquid-glass/final; falhas separadas no directório irmão. Toda a fonte dos núcleos permaneceu igual. Sem testes/preview pendentes. Rever e publicar marco normal em main; observar novo CI, continuar todos os requisitos. Produto incompleto.
