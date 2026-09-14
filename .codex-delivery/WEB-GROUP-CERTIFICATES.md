# Paridade dos grupos no browser — certificados portáveis

Base: marco web a49e4a4. O incremento web/RNS permanece isolado em.cache/wr; não inclui este refactor.

O registo nativo exige callbacks síncronos para que uma decisão de autoridade e as suas escritas pertençam à mesma transacção. Converter apenas algumas verificações em promises quebraria essa garantia. Separar o protocolo (formas, hashes canónicos, provas/épocas/consentimento/saída e transições) de um pequeno adaptador criptográfico síncrono evita duplicar as regras. Node conserva node:crypto. Para o browser, avaliar e fixar @noble/curves2.4.0 com verificação Ed25519 estrita; já usa @noble/hashes2.4.0. Nenhuma primitiva será inventada.

Implementado em root, ainda NÃO TESTADO: certificate-protocol.ts e wrapper certificates.ts conservando18 operações públicas. Não publicar nem activar grupos no browser apenas por existir o verificador. A dependência ainda não foi instalada: aguardar a conclusão do gate web/RNS antes de alterar node_modules partilhado. Metadata npm consultada: MIT, Node>=20.19, integridade SHA512 P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew==.

Próximos controlos: testes existentes Node/Go de certificados sem retirar casos; interop browser↔Node/Go para criação/convite/consentimento/remoção/reentrada/saída/fecho, cartões/chaves errados, formas/tamanhos inválidos, corrupção e divergência. Verificar compatibilidade dos DER Ed25519/X25519 emitidos pelos três motores; não aceitar chaves ou assinaturas não canónicas por usar o modo ZIP215 permissivo. Depois integrar autoridade/armazenamento IndexedDB com reserva4MiB, CAS/fences, outbox e replay completos. A UI de grupos dinâmicos fica desactivada até esse domínio estar integrado e testado.


## Progresso posterior

A dependência2.4.0 foi instalada com --ignore-scripts depois de terminar o gate web/RNS, acrescentando apenas um pacote. Corrigido um import de equalBytes (exportado por curves/utils, não hashes/utils), após falha de typecheck preservada. Passaram12testesNode de certificados e o primeiro percursoChromium↔Node↔Go, incluindo10recusas, remoção/reentrada e Unicode.

O controlo do ponto neutro reproduziu aceitação do cartão fraco em Node e Go; os testes falharam antes do filtro. Implementado perfil comum de admissãoSPKI/pontos depequenaordem/canonicalidade em Node/browser/Go, sem nova primitiva. Primeiro controlo correctivo:13Node+Go-race dirigido passaram. Novosvectores8+40 comgeração positiva/imutabilidade e controloChromium emvalidação. Detalhes docs/SIGNING-KEY-PROFILE.md.

O CI remotoa49e4a4 passou Node3SO e Go/race masfalhou1/58interop: group-control-envelope.ts verificava ficheiro imediatamente após entrega, antes de o consumidorGo gravar. Afixtureagora espera persistência comolimiteexistente e verificaausênciadosrejeitados também depoisdopositivoseguinte. Nenhum prazo oucoberturaretirado. O registo de CI está em.cache/milestones/ci-a49e4a4-failed.log.

Gate dirigido activo98732:build; certificados/perfil/envelopesNode+Go; Go-racecore/grupos;2testesbrowser. O primeiro blocoNode deste comando não explicitou test-concurrency=1; não o designar comoprova sequencial. O gate final terá todososblocosestritamentesequenciais. Ainda não declarar este conjunto pronto/publicado.


## Gate integral concluído

A sessão89503 terminou0,457fontes estáveis.281Node,16pacotesGo-race,5SQLiteC,58interop,28browser,25UI por motor e pacoteLinux passaram. DozeAxe novos sem violações. Evidência em docs/evidence/group-certificate-profile. A extensãoRTC posterior e o iOSWIP não pertencem ao candidatoGC. Próximo domínio obrigatório: autoridade/persistência/outbox/replay eUI de grupos dinâmicos no browser.
