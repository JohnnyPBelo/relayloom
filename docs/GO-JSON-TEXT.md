# Leitura de textos JSON extensos em Go

Marco delimitado: o parser copia sequências ASCII sem escapes em conjunto, depois de verificar os bytes. Mantém a interpretação de Unicode e surrogates escapados, a recusa de caracteres de controlo/UTF-8 inválido, os limites e uma cópia independente do buffer de entrada. Não altera formatos, assinaturas, cifra ou autorização.

A análise de um teste de recuperação de página grande identificou custo de escrita byte a byte. Na árvore de integração, o benchmark com race passou de 97,75 para 21,38 ms/op e de 37 para 8 alocações. O percurso de recuperação passou de 50,25 para 24,86 s. São medições desse host e dessa integração, não garantias gerais de desempenho.

Para validar este marco separadamente, foi extraído o núcleo do commit base 79570fd, com os ficheiros de módulo, runner e vector de assinatura desse commit. Só o parser e os novos testes foram sobrepostos. O core com race passou e os hashes da cópia isolada permaneceram iguais. Os helpers destinados a drivers externos ficam explicitamente identificados como skips na execução isolada; não são apresentados como testes entre processos passados.

```sh
node scripts/go.mjs test -race -p=1 -count=1 -v \
  -bench '^BenchmarkDecodeLargeJSONText$' -benchtime=3x -benchmem ./core
```

[Comando, fontes e limites](evidence/json-parser-20260928/report.json) · [Resultado completo](evidence/json-parser-20260928/core-output.txt)

A primeira preparação isolada omitiu o vector de assinatura e falhou. A fixture foi reposta exactamente a partir do commit base; essa falha não foi apagada. Este marco não publica a integração web, não verifica rádios ou dispositivos e não conclui o RelayLoom.
