# Encaminhamento e persistência são controlos separados

O CI `34897998431` da base `a49e4a4` passou os três jobs Node e o Go/race, mas falhou um dos 58 testes de interoperabilidade. O destino já tinha recebido o envelope; a fixture consultou o ficheiro do relay antes da gravação do consumidor assíncrono Go.

A fixture mantém os limites existentes e passa a esperar pela persistência como um controlo separado. Também volta a verificar a ausência de cada envelope inválido depois do testemunho válido seguinte. Nenhuma regra de autorização, assinatura, dimensão ou prazo foi retirada.

Os dois percursos Node/Go passaram, sequencialmente, numa cópia com o código de execução equivalente a `b514ead`. Comando, hash e resultado em `report.json`; falha original e novo log preservados. A regressão integral de interoperabilidade volta a correr no incremento criptográfico seguinte. Este commit só altera a fixture.
