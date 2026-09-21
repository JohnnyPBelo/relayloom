# Limite cumulativo do job nativo — 21 de Setembro de 2026

A execução35413693543/15c1dbc passou Node Windows/macOS/Linux, testes Go comrace e contratoSQLiteC. Foi cancelada duranteinterop porque excedeu25minutos; a anotação doGitHub confirma o motivo. Os jobsdependentes nãoexecutaram.

O workflow passa a ter native-go → native-interop → native-ui, em sequência, com25minutos porjob Go/interop. Conserva os comandos/testes/prazos internos, permissões, concorrência e restantesjobs. A validação aqui éestrutural; o novoCI ainda deve executar. Não é aumento dos deadlines dos testes nem prova deMac/iOS/radios físicos.
