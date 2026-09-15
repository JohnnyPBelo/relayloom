# Matriz real de engines de browser

Base publicada f25598d. Candidato.cache/bm com quatro inputs em.cache/milestones/browser-matrix-inputs.json: configuração,runner e rótulos de evidência obtidos do engine real. Não inclui o iOSWIP. Dependências comuns são symlinks do projecto; não executar npmci. O runner não omite casos quando falta uma capacidade: lança a mesma suite browser completa.

Firefox155.0 instalado pelo Playwright do projecto em.cache/playwright (download109.5MiB). `node scripts/verify-browser-matrix.mjs firefox` passou: typecheck/build/CLI e28testes,2.1min. O probe registou engine/version reais,WebCryptoEd25519/X25519,IndexedDB,WebLocks,worker,serviceworker,RTC eWS. Fontes estáveis. Relatório.cache/bm/.cache/browser-matrix/firefox/report.json. Os ficheiros gerados neste run são arquivados pelo runner; relatórios antigos não são rotulados como Firefox.

WebKit26.6/revisão2359 está na fase de instalação project-scoped; depois lançar o mesmo runner comwebkit. Não instalar dependências do SO como root nem desactivar sandbox. Falhas de arranque/API devem ser registadas como bloqueio/falha real, nunca passeSafari. Actual Safari/iOS,dispositivos e restante paridade continuam obrigatórios e não inferidos de enginesLinux. Último disco24GiB antes deste download, reserva15GiB.

Depois: recolher WebKit, corrigir falhas possíveis dentro do projecto, arquivar matriz/hashes/logs/capturas, publicar o incremento de testes apenas após resultados. O registo de autoridade/grupos dinâmicos no browser continua a próxima integração de produto; estes testes não satisfazem a funcionalidade ainda ausente.


## WebKit e curvas portáveis — 2026-09-15

O WebKit instalado pediu libavif16/libmanette e três dependências. Cinco arquivosDeb foram descarregados com versões/hashes fixos e extraídos dentro de.cache/browser-libs, sem root, scripts de pacotes ou instalação noSO. O wrapper oficial substituiLD_LIBRARY_PATH; por isso a primeira tentativa falhou antes dos testes. O preparador agora acrescenta apenas bibliotecas ausentes ao sys/lib do bundle do browser, preservando binários e wrappers. Resoluçãoldd confirmada. O lock é específico desteUbuntu/glibc2.43, não uma promessa de portabilidade geral.

A primeira suiteWebKit executou27/28; o teste grande falhou antes de enviar bytes. O teste isolado passou sem alteração, pelo que não se inventou uma correcção. Probes limitados reproduziram generateKey(X25519),importKey(X25519) e, após portarX, generateKey(Ed25519) a falhar neste engine. O tamanho do conteúdo não era a causa estabelecida. O oracleNode de um probe descrevia a identidade anterior quando a geração seguinte falhava; esse registo foi rotulado, sem o atribuir à chave inexistente.

Portadas Ed25519 eX25519 para@noble/curves2.4.0 já fixado. CSPRNG continua crypto.getRandomValues; AES-GCM/HKDF/SHA256 continuamWebCrypto. DER/vault/wirev1 inalterados, dono da assinatura conferido, leitura e escrita continuam separados. Não se ignora um erro nem se regenera automaticamente uma identidade persistida. Novo teste512ciclos falhou antes; depois512ciclos, RFC7748, recusa de chave de leitura inválida e a transferência2.4MB+1.2MB passaram. O teste final também força falha das operações nativasEd/X para provar independência dessa implementação.

Gate final activo71487 em.cache/bm: runnerwebkit→firefox→chromium,30testes completos por engine,sequencial,8inputs congelados em.cache/milestones/browser-matrix-portable-inputs.json. Logs.cache/milestones/{webkit,firefox,chromium}-portable-final.log e relatórios internos.cache/browser-matrix/<engine>/report.json. Não alterarBM nem dependências enquanto decorre. Depois validar a UI/RNS afectada e arquivar provas antes de publicar. O registo de autoridade/grupos dinâmicos no browser e o restante contrato continuam pendentes.


## Observação de fecho RTC ainda aberta

O primeiro gate com curvas portáveis passou29/30 no WebKit, mas o caso de revogação observou a ligaçãoB-C fechada depois de entregar oSOS. Não há causa estabelecida. Dez repetições isoladas com diagnóstico passaram38.0s; a suite completa com diagnóstico passou30/30 em2.1min. Esses passes não demonstram uma correcção. Os diagnósticos estão em.cache/milestones/webkit-relay-diagnostics, e os logs failed/pass são preservados. Instrumentação só na cópiaBM foi removida após registo; router/RTC de produção continuam iguais ao publicado.

Próximo gate final repete WebKit/Firefox/Chromium com as fontes reais,30casos por engine e sem instrumentação. Conservar a observação anterior na matriz mesmo que passe. Não declarar estabilidadeWebKit ou produto concluído. Se voltar a falhar, registar/determinar a causa; não aumentar prazos ou retirar controlos.
