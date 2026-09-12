# RelayLoom — retoma activa, 2026-09-12

Trabalhar APENAS em `/home/absint0o/projects/relayloom`, conforme todo o PROJECT-BRIEF.md. Produto incompleto. PT-PT; manter Astra/Copilot Ultra, providers/auth/bridge/serviços/permissões/segurança. Recuperação sequencial: nenhum agente novo ou retomado. Não criar checkpoint extra de manutenção (cancelado pelo utilizador). Commits/pushes normais autorizados; nunca force-push/merge PR. Caches no projecto, uma compilação pesada de cada vez,>=15GiB livres (última medição~120GiB). Não tocar noutros projectos/ficheiros pessoais.

## Publicado

Push normal confirmado até `e72af64019dcfd03eface39e1fcdab8ec753e583`:9c322a9 foundation privada;3fd9a33 migração Node/Go e gates;fffbc57 facade transaccional;777dfed tentativa de runtime iOS explícito; e72af64 polimento PT/UI. CI34693678391 está em curso: Node já passou Windows/Linux/macOS, Go em curso na última observação. `.cache/ci-e72af64-run.json`. Não presumir Apple/desktop posteriores.

Gates publicados: migração152 Node/77.381s,105 Go de topo race/379.168s (5 helpers executados via drivers),15 interop/145.127s,15 UI Node107.327s e15 UI Go101.522s, desktop Linux build/exec/pacote/exec passou;22 Axe actualizados sem violações. `docs/evidence/private-profile`.
Facade:81 Node36.565s,36 Go de topo/race169.094s (4 helpers executados via drivers),9 interop45.760s;5 controlos de scope por núcleo, abort mesmo se erro for apanhado, prefixo restritivo com cauda inválida, quota, morte real antes/depois de commit. `docs/evidence/group-transaction`. Biblioteca ainda NÃO usada na admissão/outbox/API/UI dinâmica.
UI passou a `index-C9JlHp94.js`, CSS `index-DwCp7KCv.css`;2 percursos existentes por núcleo19.582/19.209s, pacote Linux actualizado executado. `docs/evidence/ui/copy-polish`. Não há regressão completa nova de15 UI atribuída ao mero polimento posterior.

## Falha Android real e recuperação em curso

- AAR `d35824eff5f8e9c9562ed1503af8f9947e5985fa7ef0d07405de67b038ffe246`; APK `10878a5c9b37e8db6e6a3fe018dfe7538d843f292cbc590f66b3d3abeebfa884` compilado/alinhado/instalado no AVD existente, mas **crasha antes das asserções**, não é versão validada no dispositivo. Não publicar como passada.
- O script de build tinha `python` ausente após manutenção. `python3` existe e confirmou11.35GiB alocados Android e~120GiB livres. Corrigido apenas o launcher do script do projecto. Primeiro bind falhou0.033s; depois bind24.851s/APK4.083s passaram. Evidência em `.cache/android/evidence/private-profile-e72af64`.
- Gate documentos falhou uma vez em3.976s: `INSTRUMENTATION_RESULT: shortMsg=Process crashed`. Runner51733 terminou1; os gates de prazo/mensagens/relay/inspecção NÃO correram. Source hashes inalterados, sem timeout do supervisor. `documents-command.json`/`documents-output.txt`.
- Crash real: Android seccomp rejeitou syscall6/SIGSYS no x86_64. `modernc.org/libc@v1.75.6/libc_linux_amd64.go:110` chama SYS_LSTAT directamente; Go stdlib usa fstatat. Duas entradas no crash buffer: arranque automático depois da instalação e arranque da instrumentação; não são novos testes aprovados. `.cache/android/evidence/private-profile-e72af64/crash-buffer.txt`.
- **Não desactivar seccomp, não alterar permissões/serviços, não repetir APK inalterado.** Em implementação uma selecção de driver SQLite: `native/sqlitedriver` usa modernc nos alvos existentes e mattn/go-sqlite3v1.14.52 em Android, via Bionic, também seleccionável por tag de teste `relayloom_sqlite_cgo` no Linux. C driver exige `sqlite_omit_load_extension` no ConnectHook; binding Android passa essa tag. Módulo exacto consultado/descarregado com checksums/origem em cgo-driver-{module,download}.json na pasta da falha.
- `groupstore` e `profilelock` importam o selector. ProfileLock fornece DSNbusy=0 nos nomes dos dois drivers. Licença MIT retida; packaging Android inclui-a. go.mod/go.sum alterados. **Ainda não compilado/executado com êxito no Android.**
- Primeiro gate C driver host em sessão26323: `node scripts/go.mjs test -json -race -count=1 -p=1 -tags relayloom_sqlite_cgo,sqlite_omit_load_extension ./sqlitedriver ./groupstore ./profilelock ./profiledb ./profilestate`; log `.cache/android-sqlite/cgo-host-first.txt`. Recolher, não repetir por perder handle.

## Processos / perfil preservado

O único AVD do projecto está activo: PID234013, serial emulator-5580, adb isolado5047, portas5580/5581. Registo `.cache/android/emulator-process.json`. Não parar/alterar outros processos. A app de teste crashou; não há teste Android em curso depois de51733. Preservar o mesmo AVD/identidade. Antes de instalar, `profile-before.json` registou hashes do cofre/JSON legado e confirmou binding ausente. Esses hashes devem manter-se após corrigir/migrar; não sobrescrever esse baseline.

Instrumentação recompilada: APKtesteSHAae7e9a2ba51004fde8c4dcfaefa58deedd4a98cb347ac72b61589c8f847ee31c. `.cache/android/private-profile-gates.py` executa documentos38, deadline15, mensagens16, relay11 e depois nova inspecção. A primeira pasta tem resultados falhados; criar pasta nova da correcção e copiar o baseline original, nunca apagar a falha/repetir sobre os mesmos command.json.

Novo `scripts/android-private-profile.mjs` ainda não executado: depois dos quatro gates, force-stop só da app sintética, hash do APK, assinatura do binding e digest do ciphertext legado, preservação do cofre e leitura no Node de cópia cifrada SQLite Android com preview privado real presente após decifrar e ausente do ciphertext. Não contém dados privados no relatório; remove cópia temporária. Ainda requer validação real.

## Próxima execução

1. Recolher gate C driver host, corrigir falhas concretas; testar compatibilidade/lock/corrupção/quota e processos Node↔Go com esse driver, mantendo controlos positivos/negativos. Actualizar todos os digests relevantes para incluir `native/sqlitedriver`. Confirmar que deps Android excluem modernc, sem modificar o cache das dependências.
2. Completar notices/documentação do driver; rebuild AAR/APK uma vez com fontes congeladas, confirmar hash instalado e identidade/baseline preservados. Executar os quatro gates existentes + inspecção do SQLite no AVD existente. Falhas ficam bloqueadas até resolução; build não é device-test.
3. Observar CI34693678391 pelo commit e72af64. iOS26.5 permanece bloqueado em addmedia60.651s no CI90cb649; versão26.4.1 foi pedida explicitamente porque constava do inventário real.17 host/static passaram; fotografia/XCTest/prazos preservados, sem fallback/download. Nenhuma execução Apple nova ainda observada.
4. Continuar runtime de grupos: facade está pronta, mas admissão/IDs aceites, quarentena, audiências original/actual, superseded imutável, carriers/sync e API/UI ainda faltam. Não aumentar documento privado para persistir barreira em quota cheia; consultar autoridade antes de retry. Grupos do produto continuam fixos.
5. Continuar keystore/rotação/pesquisa integral/social/media/templates/notificações e revisão independente quando agentes forem autorizados. Hardware/radios/assinatura/leitorde ecrã físico permanecem limitados/bloqueados. Backup integral válido anterior continua indetectável sem testemunha monotónica.

Histórico em `.codex-delivery/history/RESUME-before-android-driver-recovery.md`; referências docs/PROFILE-PERSISTENCE.md, GROUP-RUNTIME-BOUNDARY.md, docs/STATUS.md, docs/AGENTS.md. As caches de staging da facade/UI/iOS já foram aplicadas e ficaram desactualizadas: NÃO copiá-las por cima das correcções actuais.


## Actualização após a correcção do driver Android

Sessão26323 terminou1: quatro pacotes C passaram, mas ProfileLock não convertia o erro busy que o C driver devolve já em db.Conn. A classificação passou a usar códigos tipados em sqlitedriver.IsBusy e cobre abertura + BEGIN. Gates dirigidos passaram com ambos os drivers (sessão82045 terminal).

O controlo negativo sem sqlite_omit_load_extension foi executado uma vez e falhou como exigido (a ligação recusa esse build), em `.cache/android-sqlite/extension-control-negative.*`. O gate completo posterior em sessão45965 terminou0: build5.191s; Go C/race328.663s; CLI C36.814s;16 interoperabilidade172.630s;15 UI Go C106.961s. Tudo com inputs registados inalterados em `.cache/android-sqlite/final`. Ainda não equivale a Android. O binário `.cache/native-app/relayloom` actual é o build C usado nesses testes; `npm run native:build` restaura o backend por omissão se necessário.

Novo AAR9e2fb77f9938721c9df7ef82df19e357ab02ff0c417ec40061a82e0f27004585/APK136a5103c82c4c87f6865aa2b68daa5eb60796ac4d420aa8f09d5fea5fd4e2a5: bind35.603s e APK4.025s passaram. O argumento gomobile -tags=sqlite_omit_load_extension é explícito, pois o wrapper gere tags próprias. Hash instalado confirmado e cofre/JSON legado continuam idênticos ao baseline original. O APK com SIGSYS foi guardado apenas na cache em `.cache/android/artifacts/history/10878a5c...apk`.

**Teste Android activo: sessão18358**, `.cache/android/private-profile-cgo-gates.py`, evidência `.cache/android/evidence/private-profile-cgo`. Executa os quatro gates existentes e a inspecção final. Não editar inputs, reinstalar nem interromper o AVD enquanto correr. Consultar command.json/outputs antes de repetir. O AVD234013/adb5047 permanece activo e pertence a este projecto.

CI34693678391/e72af64 terminou: Node3OS, Go e3 desktop passaram. iOS26.4.1 arrancou em326.346s, mas o par Node não anunciou prontidão no prazo20s; fotografia e XCUITest não foram alcançados. Não conclui nada sobre addmedia26.4.1. Artefactos em `.cache/ci-e72af64-ios` (report.json/evidence.zip). Stderr era recolhido mas descartado pelo runner. Correcção local posterior: Node bootstrap antes de criar/arrancar o simulador, fases sem segredos e stderr limitado/redigido guardado mesmo em falha; deadline20s intacto.19 testes host passaram2.449s, incluindo processo Node real/IPC/API401/200 e preservação do erro primário; static passou. Sessão69379 terminal. Nova execução Apple ainda pendente; não foi alterada segurança/permissão/serviço.


## Revisão visual Android e gate final em curso

A sessão18358 terminou0:38 SAF37.288s,15 deadline134.370s,16 mensagens15.097s,11 relay15.144s, inspecção privada0.721s. O Node autenticou o SQLite Android e a ligação, preservando cofre/JSON legado. Porém root inspeccionou a imagem nativa e detectou que mostrava contactos apesar do DOM indicar diálogo; NÃO considerar essa imagem prova visual do diálogo. A imagem WebView.draw estava vazia e não é substituto do compositor.

Foi acrescentado `tests/e2e/long-dialog.spec.ts` (45 contactos, scroll profundo, autor desligado, geometria/foco/fecho), que passou em Chromium2.5s sem mudar produção. A instrumentação Android passou a exigir :modal, geometria dentro do viewport e hit-test. Um relay dirigido passou com o mesmo APK136a5103 e produziu imagem correcta, revista por root. Depois acrescentou-se validação de pixels da superfície e backdrop na captura nativa, com espera limitada por frames. O controlo rejeita a imagem anterior e aceita a imagem válida (`.cache/android/evidence/dialog-visibility-after/pixel-controls.json`). Não houve alteração ao UI de produção; fortaleceu-se o gate de captura. O relay passa agora13 asserções.

**Sessão activa2292**, `.cache/android/private-profile-cgo-final-gates.py`, pasta `.cache/android/evidence/private-profile-cgo-final`: repete38+15+16+13=82 asserções e a inspecção privada com o mesmo APK136a5103 e a instrumentação final. Não editar inputs ou interromper. AVD actualPID385815 / adb5047, mesmo perfil. O AVD anterior234013 foi encerrado após os primeiros gates; este arranque teve uma consulta getprop demasiado cedo (device offline), corrigida com espera limitada; nenhum relay foi lançado nessa falha de preparação. A sessão60613 passou o relay com geometria;19208 passou com controlo de pixels.

Depois de2292: recolher todos os command.json, conferir hash instalado/inputs, rever a captura final, remover apenas pacote de instrumentação/forwards e parar só AVD/adb próprios, preservando identidade. Verificar typecheck do novo teste Playwright. Consolidar evidência pública e docs; commits/push normais pendentes para driver Android, testes/inspecção e diagnóstico iOS. CIe72af64 já terminou, pelo que novo push não o interrompe. Não declarar o produto concluído; grupos dinâmicos na app, pesquisa integral, keystore/rotação e restantes critérios continuam abertos.


## Último ponto seguro desta continuação

2292 terminou0:82 asserções (38/15/16/13) + inspecção0.768s, todos os inputs inalterados. Captura final foi revista e mostra a página offline; hash instalado136a5103 confirmado. Cofre/JSON legado preservados, SQLite/binding autenticados em Node. Emulador385815/adb5047 parados e instrumentação removida; nenhum forward ou teste local em curso. Typecheck e checks de sintaxe passaram;18 casos direccionados do backend por omissão passaram em sqlitedriver/groupstore/profilelock/profiledb. Artefactos públicos em docs/evidence/android-sqlite, incluindo falha10878a5c, controlo da captura e execução final136a5103; source/commands detalhados permanecem na cache.

O próximo passo imediato é commit/push normal dos marcos correctivos ainda locais e observar a nova CI por commit exacto. O e72af64 anterior está terminado e não será interrompido. Depois continuar o contrato integral, começando pela integração runtime de grupos indicada acima; não declarar completude a partir desta fase de persistência/plataforma. Não repetir os testes terminados por handles antigos. Não criar/retomar agentes enquanto a recuperação sequencial se mantiver.
