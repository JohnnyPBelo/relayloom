# Dados declarativos nos sites

Extensão publicada em https://johnnypbelo.github.io/relayloom/, fonte59c9bd1/distribuiçãof6758222. [Verificação HTTPS e percursos reais](evidence/site-data/live). [Comandos, resultados e falhas corrigidas](evidence/site-data). O estado da execução está em `.codex-delivery/SITE-DATA-NEXT.md` e nos relatórios do gate `scripts/verify-site-data.mjs`. As limitações globais permanecem em [STATUS](STATUS.md).

O bloco **Tabela** permite construir directórios, inventários e registos dentro de um site. A autora escolhe colunas de texto, número, sim/não, data ISO ou ligação HTTPS. Os leitores pesquisam, ordenam e paginam os dados no próprio dispositivo; estas operações não alteram a publicação. Não há um servidor de base de dados nem consultas fornecidas pelo autor a executar.

O estúdio permite acrescentar linhas/colunas e mudar tipos. Mantém os números como texto durante a digitação, incluindo `1,25` e expoentes incompletos; confirma a conversão ao sair da célula ou premir Enter. Um valor inválido continua visível e impede guardar/publicar/exportar. Campos ausentes mantêm `null` quando muda o tipo. A eliminação e a substituição por ficheiro pedem confirmação e entram no histórico de desfazer do estúdio.

## Ficheiros e limites

JSON conserva IDs, tipos e campos ausentes. CSV com vírgulas aceita aspas, aspas escapadas e texto com várias linhas; todas as colunas importadas começam como texto, para preservar códigos como `001`. CSV não conserva a distinção entre `null` e texto vazio. Na exportação CSV, textos que uma folha de cálculo interpretaria como fórmulas recebem um apóstrofo de protecção; os dados assinados não são alterados. JSON é o formato de exportação sem essa perda de informação.

| Recurso | Limite |
| --- | --- |
| Colunas | 1–12, com IDs únicos e nome até 80 caracteres |
| Linhas | Até 256, IDs únicos |
| Texto | Até 1000 unidades UTF-16 por célula |
| Número | Finito, valor absoluto até 9007199254740991; sem precisão decimal arbitrária |
| Data | `AAAA-MM-DD` válido no calendário ISO |
| Ligação | HTTPS segundo a mesma política lexical TS/Go do estúdio |
| Tabela assinada | 64 KiB de JSON canónico UTF-8 |
| Documento completo | 128 KiB, incluindo todas as tabelas |
| Ficheiro para importação | 128 KiB, texto UTF-8 válido; o resultado tem também de caber nos limites da tabela |
| Pesquisa | Literal, até 160 caracteres; sem regex/SQL/código |
| Paginação no leitor | 10, 25 ou 50 linhas |

Os limites são aplicados no protocolo, e não apenas nos controlos do editor. Ordenar deixa os valores ausentes no fim; empates usam o ID da linha. Ligações abrem apenas por acção do leitor, em contexto separado, sem acesso à janela de origem.

## Assinatura e compatibilidade

As tabelas pertencem ao documento **versão 2** e ao snapshot assinado do proprietário. Alterar uma célula muda o digest do conteúdo. Uma chave de leitura permite ler; servir os bytes permite semear; nenhum destes actos permite assinar revisões como a autora. Os validadores recusam campos extra, getters, listas esparsas, tipos inválidos, datas impossíveis e URLs executáveis.

Documentos versão 1 continuam válidos. Clientes anteriores a esta extensão recusam documentos versão 2: o excerto legado não dá compatibilidade completa nem edição segura. Todos os participantes que pretendam ler estas tabelas precisam de actualizar. O estúdio apresenta este aviso ao acrescentar uma tabela.

Nesta etapa os dados seguem dentro do bundle do site. Ficheiros opcionais, datasets descarregáveis separadamente, contribuições de terceiros e formulários declarativos permanecem por implementar. A inspiração ZeroNet é a publicação assinada, distribuição pelos leitores e exploração local dos dados; não há interoperabilidade com o protocolo ZeroNet nem execução de sites HTML/JavaScript arbitrários.

## Verificação

Com dependências do projecto instaladas, executar `node scripts/verify-site-data.mjs`. O driver compila ambos os motores, verifica o contrato/persistência/assinaturas, executa processos reais, UI de páginas Node/Go e a selecção documentada de testes nos três engines. Conserva comandos, PIDs, códigos de saída, duração, hashes e fonte inicial/final em `.cache/site-data-gate`. Pode receber nomes de fases, mas o relatório só abrange as fases realmente executadas.

Estas verificações no Linux não equivalem a dispositivos físicos, rádios, Safari/iOS, assinaturas de distribuição ou revisão independente. A aplicação continua experimental e o objectivo integral não está concluído.
