# Autoridade da outbox — gate completo no host

211 testes Node passaram179.064s;141 testes Go de topo com race476.758s (10 helpers omitidos isoladamente e executados pelos drivers);26 casos de interoperabilidade243.460s; fronteira SQLite C75.323s;17 UI Node115.845s e17 UI Go109.616s. Build5.524s;22 testes iOS host1.842s e verificação estática0.032s. Desktop Linux: preparação0.336s, execução1.507s, pacote10.029s e execução empacotada1.280s.26 relatórios Axe actualizados, zero violações. Fontes inalteradas durante os gates.

Comandos exactos, limites e sobreposições de ambiente estão em report.json e desktop-report.json. Cada fase tem log .txt; source-hashes.json identifica as fontes executadas. O baseCommit fde529e antecede a integração então não commitada; os hashes, e não uma suposição de checkout limpo, delimitam esta evidência.

Node/Go executaram processos reais, trocas de perfil, partições, TCP/série por PTY, seeders offline e controlos de autorização/corrupção da suite. O novo driver provocou saídas81/82 antes/depois do commit de autoridade e reabriu no outro motor.256 bundles/intentos reais passaram por128 stops+128 pendentes, reabrindo Node→Go→Node e terminando com256 stops sem reactivar retries. A fixture instala o bundle/intenção inicial: criação/envio dinâmico pela API continua por implementar.

A optimização de reservas e do snapshot de stops reduziu o cenário observado de93.339s para cerca33s (32.668s medidos dentro da fixture final). Consultas Go desta fixture:0.487s e0.672s. Não é garantia universal de desempenho; preenchimento frio e paragem de128 intenções ainda têm custos finitos registados nas fases.

A interface nova foi exercitada com processos Node e Go reais; screenshots separados em ../ui-node e ../ui-go. Root reviu as capturas; não é revisão independente nem teste de leitor de ecrã/dispositivo físico. Os26 relatórios Axe detectaram zero violações nas páginas verificadas.

Nenhum passe Apple ou Android pertence a este gate. Os22 testes de iOS são host-only, e a verificação estática não compila Swift. O CI anterior fde529e, com a fotografia falhada, tem evidência própria em ../../ios/fde529e. Não declarar conclusão do produto, prontidão para catástrofes ou todos os OS testados.
