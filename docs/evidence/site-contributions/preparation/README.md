# Preparação privada de propostas — marco local ainda sem envio na aplicação

A fonte final passou **494 testes Node**, typecheck/build, Go sites/race e os testes dirigidos de catálogo nos três browsers. O gate repetido contém os 102 ficheiros da suite original, confirmados por comparação exacta, sem falhas/skips. A primeira suite terminou 493/494 por tradução Formulário em falta; esse resultado e a sua fonte permanecem em original-node-i18n-failure.txt e original-source-and-failed-full-gate.json. Depois foram corrigidas a tradução e a validação da sequência retida. gate.json regista a fonte final e comandos; summary.json explica sobreposições e diferenças.

## Implementação

- Pedido fechado e fingerprint de intenção, sequência monotónica, UUIDv4, até 128 resultados/1 MiB e uma preparação activa. Prepared/signed/cancelled/expired são estados internos; nenhum deles significa envio ou aprovação.
- Node e browser guardam pedido+snapshot cifrado de origem antes de assinar. Só uma segunda transacção guarda o certificado do visitante. Repetição/reabertura conserva UUID, valores, audiência e tempos, sem recorrer a uma versão posterior da página. O stage nunca entra no inventário público.
- O namespace privado contribution tem domínio/AAD próprios em Node/Go. As chaves de leitura não desencriptam o stage. Interoperabilidade real SQLite, seis direcções de transplante entre namespaces e troca entre stores têm positivos/negativos. O codec Go não é ainda o catálogo/máquina de estados Go.
- Verificação de submissão separada da concessão de publicação, com 57 vectores TS/Go (14 aceites/43 recusados). Uma proposta privada pode ir ao dono de um site público, mas não pode ser divulgada publicamente sem concessão compatível. Isso não equivale a aprovação/CAS.

## Falhas e controlos

O validador inicial aceitava um registo sintético com uma operação intermédia em falta. O controlo antes/depois conserva o positivo e mostra a lacuna agora recusada. Os catálogos verificam a integridade antes de expirar/remover stages; quotas fazem rollback sem consumir a sequência. A retenção tem de conter exactamente a janela final contígua, incluindo quando chega a 128.

O teste inicial de chave de leitura foi corrigido para reabrir o storage depois da falha de integridade, pois essa falha fecha deliberadamente a sessão. Um teste de browser comparava ordem textual de JSON em vez da estrutura completa. As falhas dessas fixtures são distintas da falha real de tradução e do controlo de parser; todas estão preservadas.

Os processos Node foram terminados com SIGKILL nas fronteiras antes/depois do commit da intenção e depois do commit da assinatura. Reabrir a SQLite recuperou a ausência/estado esperado e o mesmo certificado. No Windows a fixture usa exit 86 imediato sem limpeza JavaScript; essa variante ainda aguarda CI. Browser: assinatura retida seguida de lock aborta a transacção, mantém prepared e permite retomar depois de unlock; estágio ausente/corrupto, prazo e bloqueio são recusados.

## Âmbito exacto das execuções

O catálogo Node tem dez casos; a suite conjunta de armazenamento/catálogo/interop teve 28. São subconjuntos/repetições, não cenários adicionais aos 494. Cada browser teve quatro casos catálogo/contexto/cripto; depois da correcção de retenção, os dois casos de catálogo voltaram a passar em cada engine. Os workers de produção e os novos controlos de concessão têm suplementos próprios. O log terminal de quatro WebKit está preservado, mas o JSON original foi sobrescrito pela execução seguinte; não foi recriado nem apresentado como original.

Os hashes de sources/sourcesAfter estão em gate.json. O driver de reprodução é run-consolidated-gate.mjs e recusa sobrepor relatórios; os comandos individuais permitem repetir apenas o caso pretendido. Nenhum novo dispositivo/rádio físico, iOS funcional, distribuição HTTPS ou revisão independente é inferido.

**Pendentes:** catálogo/máquina de estados Go e retoma Node↔Go, API de preparação/submissão, envelope com identidade/prazo persistentes, outbox/inbox, aprovação/rejeição/reconciliação, proveniência e UI PT/EN/ES com três contas reais. A paleta continua oculta. [Contrato e estado funcional](../../../SITE-CONTRIBUTIONS.md).
