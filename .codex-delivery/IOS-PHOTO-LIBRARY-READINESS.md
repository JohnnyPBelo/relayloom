# Importação de fotografia no simulador — diagnóstico e próxima verificação

Ainda bloqueado no gate funcional Apple. Três resultados diferentes têm de ficar separados: f3f32fc confirmou mensagem e falhou no selector; 1a53620 compilou o selector e falhou no importador; 14457fd voltou a compilar/arrancar e falhou na importação após60,364 s. Nenhum destes resultados aprova o anexo/resposta/recuperação. Não é HTTP408 do Copilot. A última execução também confirmou os dois shards de browser com sucesso.

O log do simulador próprio mostra inicialização/migração de assetsd e pedido PhotoKit, sem explicar definitivamente a espera. Não aumentar deadlines, repetir importação incerta em ciclo, executar resets de serviços ou mudar permissões. O próximo controlo pode abrir a aplicação Photos do simulador acabado de criar e observar a grelha antes da única importação. Isso é uma hipótese de preparação pela UI normal, não prova de resolução.

Há um rascunho em `.cache/ios-photo-warmup-draft/NativeSimulatorTests.swift`. Não está nas fontes nem foi compilado/executado. O teste exige SIMULATOR_UDID igual ao UUID gerado para este run; não aceita dispositivo físico nem biblioteca pessoal do host. Lança apenas Photos nesse simulador, espera um estado visível limitado, guarda screenshot e termina a aplicação que abriu. Não considera abertura/importação equivalentes ao percurso funcional: a fotografia continua a ter de ser seleccionada/enviada, descifrada pelo Node e recuperada.

Antes de integrar: confirmar que o identificador da grelha existe também na aplicação Photos (foi observado no picker, ainda não nessa app). Se faltar, recolher AX/screenshot do simulador próprio; não inventar sucesso por tempo decorrido. Ligar o teste entre startup comprovado e addmedia, persistir o resultado XCTest e copiar o screenshot. Incluir simulatorUDID nas fixtures geradas, actualizar testes host de ordem/falhas e exportação de provas, mantendo limites existentes de cada operação. Só então enviar num marco claro para execução Apple. A nova etapa só pode afirmar “biblioteca aberta”, não “pronta” sem evidência da importação posterior.

Enquanto decorre o gate local de entrega de recibos, não alterar os ficheiros que ele cobre. O rascunho não muda a cobertura nem remove o bloqueio Apple. Todo o PROJECT-BRIEF mantém-se.


O rascunho inclui agora ios-simulator.mjs com XCTest/summary separado antes do único addmedia, UUID do simulador na fixture e exportação limitada do screenshot. Ainda não foi integrado ou executado; testes host de ordem/falha/semfoto e compilação Apple continuam obrigatórios. O deadline global20 min e os limites existentes das chamadas mantêm-se; uma abertura da biblioteca não dá passe ao percurso funcional.
