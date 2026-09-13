# RelayLoom — retoma activa,2026-09-13

## Contrato e restrições preservados

Continuar TODO o PROJECT-BRIEF.md, exclusivamente em /home/absint0o/projects/relayloom. Manter Astra/Copilot Ultra e recuperação sequencial: não criar/retomar agentes até instrução diferente do proprietário. Não alterar providers, autenticação, bridges, modelos, serviços, permissões ou segurança. Commits/pushes normais autorizados, sem force-push nem merge. Dependências/caches no projecto, uma compilação pesada de cada vez, pelo menos15GiB livres (99GiB observados). Sem ficheiros pessoais/outros projectos/compras/root. Checkpoint extra de manutenção foi cancelado. Produto incompleto, sem afirmação disaster-ready nem todas as plataformas testadas.

## Marco corrente: Liquid Glass funcional

Pedido mais recente do proprietário: UI/UX incrível com Liquid Glass, tudo funcional e avançado. Foi implementada a camada visual real, pesquisa/comandos Ctrl/Cmd+K, barra móvel, conversa compacta, preferências/baixo consumo/contraste/transparência e alvos44px. Content ownership, cifra, transporte e paleta declarativa dos sites foram preservados. Ver docs/LIQUID-GLASS.md e .codex-delivery/LIQUID-GLASS.md. A pesquisa abrange apenas mensagens autorizadas carregadas, não todo o arquivo.

Base publicada anterior: f37067f27460261b1fb4348bce2acce0d938b7cc. Fontes verificadas desta fase identificadas em docs/evidence/liquid-glass/final/report.json (289 hashes, incluindo testes/scripts). As fontes dos núcleos Node/Go/crypto/transporte não mudaram. O marco é preparado para commit/push normal em main; confirmar HEAD/origin e CI na retoma, sem presumir o seu estado a partir deste ficheiro.

**Todos os testes locais lançados terminaram.** Gate final74981 terminou0, comando `node scripts/verify-ui.mjs`. Typecheck3.959s;web1.551s;CLI Go0.138s;19 E2E Node142.211s e19 Go127.734s,0 skips/flaky;desktop Linux build0.110s/execução1.694s/AppImage10.049s/execução do pacote descompactado0.768s.62 Axe sem violações,289 fontes inalteradas. Arquivo público docs/evidence/liquid-glass/final, incluindo comandos/logs/capturas e102 artefactos verificados por hash. O AppImage foi construído; executou-se o pacote descompactado, não a montagem do AppImage.

Falhas e correcções: contraste transitório por fade, foreground do toast, alvos móveis40/43px, selecção ambígua da fixture e preferência remota assíncrona. Após compactar a conversa móvel, a regressão completa detectou acesso à outbox oculto no reinício: controlo reposto no topbar mantendo o teste original.6 dirigidos37.6s e o gate final completo passaram. Falhas preservadas em docs/evidence/liquid-glass/failures. Não repetir suites por perda de handles. Não há preview/servidor de demonstração lançado nem processo de teste pendente; os runners terminaram os seus próprios processos normalmente.

## Plataformas e CI

CI anterior f370/run34757307906 terminou: Node nos três OS, Go e três jobs de pacote desktop passaram.1 XCTest de arranque iOS41.627s (comando94.457s) passou; importar fotografia excedeu60.306s antes do teste funcional. A alteração de Done/captura não foi exercitada. Nenhum fluxo funcional iOS completo passou. Artefactos sanitizados em docs/evidence/ios/f37067f. Não repetir cegamente a importação, aumentar prazos nem relaxar isolamento; a causa do timeout de addmedia continua sem prova.

Android anterior APK136a5103/AAR9e2fb77f:82 asserções no único emulador API36x86_64 e leitura cifrada Node passaram. AVD/adb próprios parados/preservados. Esse artefacto não contém grupos/Glass actuais. Apple signing, dispositivos/rádios, notificações OS, teclado OS/leitor de ecrã manual e revisão independente desta UI estão pendentes/bloqueados conforme STATUS. Chromium em viewports móveis/media emulada não é um dispositivo real.

## Próxima execução concreta

1. `git status --short` e `git log -3 --oneline`; ler este ficheiro e PROJECT-BRIEF.md sem descartar alterações. Confirmar push/CI do SHA completo: `gh run list --repo JohnnyPBelo/relayloom --commit "$(git rev-parse HEAD)" --json databaseId,status,conclusion,headSha`; consultar resultado, não reexecutar por ausência de handles.
2. Se CI falhar, ler o erro/captura exactos e corrigir uma causa demonstrada; logs *.log exigem `rg --files --no-ignore`. Preservar a cobertura inteira, sem relaxar segurança/prazos nem inferir resultados móveis de compilação.
3. Continuar integração de **eventos de grupos**, carriers automáticos de provas/controlo e composição/gestão dinâmica na UI. As APIs de texto/anexos/replies/recibos por épocas estão implementadas/testadas, mas a UI ainda usa grupos fixos e as fixtures transportam provas explicitamente. messaging/outbound continuam false para a capacidade completa. Preservar audiência original, admissão antes de rede, rollback/bytes exactos, receipts históricos após close e recusa de autores/leitores indevidos.
4. Exercer partição/add/remove/rekey/reentrada/close, provas fora de ordem, multi-adapter/multi-hop e seeder com autor desligado. Gate completo de Node/Go race, SQLite C, interoperabilidade e UI após mudanças nos núcleos. Implementar pesquisa integral, keystore/rotação, restante social/media/templates e notificações reais.
5. Recompilar/revalidar Android actual reutilizando o AVD; iOS só em Apple real/CI disponível. Fechar revisão independente quando autorizada a retoma de agentes, com propriedade de ficheiros e respostas reais; root não cumpre esse gate sozinho. Auditar todo o contrato antes de declarar conclusão.

Histórico integral preservado em history/RESUME-liquid-glass-iterations.md, incluindo os gates anteriores de grupos, recuperação e manutenção. O goal mantém-se activo. Não houve timeout upstream novo nesta fase.
