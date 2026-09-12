# Integração Android posterior à medição sequencial — 2026-09-12

A medição de `SEQUENTIAL-CHECK.md` terminou com uma execução e um teste passado. A continuação do objectivo inicia esta fase separada, mantendo execução sequencial, sem criação/retoma de agentes e sem alterações ao harness.

## Âmbito

Integrar no APK o checker de prazo imutável já revisto e a interface final da outbox. Usar o AAR `7c9f60fe…` e os assets `index-Ct0M5tYK.js`/`index-BcajBo5I.css`, sem nova binding Go enquanto as fontes continuarem iguais. Reutilizar apenas o emulador `relayloom-api36`, adb 5047 e portas 5580/5581. Preservar identidade, cofre e dados sintéticos existentes. Não descarregar imagens.

## Sequência e evidência

1. Preservar o APK anterior `4de67c3e…` e relatório de compilação; registar hashes de Java, assets e AAR.
2. `python3 scripts/android-build.py`: passou em 5,931 s; assinatura/alinhamento e políticas host associadas passaram.
3. Arrancar o AVD existente, instalar por actualização e confirmar SHA-256 do APK efectivamente instalado.
4. Recompilar a instrumentação separada e executar, sequencialmente, SAF, prazo/lifecycle, mensagens e relay/seed. Não atribuir ao APK novo resultados de um hash anterior.
5. Guardar apenas evidência sanitizada, rever as capturas e parar AVD/adb próprios. Actualizar docs com resultados exactos e limitações.

## Resultado final observado

APK `27a71947f73e3a2622da6efbcb402d04260e53293cb6156e27f43ea3b3f8e5a2`, 11.765.440 bytes. O hash instalado coincidiu antes/depois dos gates; fontes Java, assets e AAR mantiveram os hashes. SAF 38 asserções/40,302 s; prazo 15/135,545 s; mensagens 16/16,706 s; relay 11/17,097 s. Todas as quatro execuções saíram 0, sem repetição. Prazo observado 121.264 ms; HOME 1.254 ms. Relatórios de bytes, autoria, partição e seed takeover passaram; três capturas reais foram revistas por root.

Instrumentação/provider de teste removidos; forwards vazios; AVD e adb próprios parados, mesma identidade preservada. Espaço livre final 127,54 GiB.

Os comandos, saídas e hashes ficam em `.cache/android/evidence/final-integration-20260912`; cópia sanitizada publicável em `docs/evidence/android/documents-27a71947`. Esta integração do APK está verificada no único emulador API36 x86_64. Hardware físico, ARM64, suspensão física, rádio e prontidão para catástrofes não são demonstrados por um emulador.
