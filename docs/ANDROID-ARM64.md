# APK Android ARM64 experimental

Foi construído um APK para `arm64-v8a`, comum em telefones Android de64bits. **Ainda não foi executado num aparelho ARM64.** Os testes do emulador foram feitos com a variantex86_64; não validam a execução desta variante nem o comportamento de rádio, bateria ou segundo plano num telefone.

Artefacto local: `.cache/android/artifacts/relayloom-android-arm64-v8a-debug.apk` (16841791bytes).

SHA-256: `812339a7d716db41ab8fe26b1f4a83033575210547ad666b7c33abc507d83ed8`.

Reprodução, no projecto com a toolchain já preparada:

```sh
node scripts/android-bind.mjs --abi=arm64-v8a
python3 scripts/android-build.py --abi arm64-v8a
```

O build fixa Go1.26.8, x/mobile e NDK já usados pelo projecto. Foi verificada a máquinaELF183 (AArch64), os segmentosLOAD0x4000, o alinhamentoZIP, a assinatura de desenvolvimento e os assets iguais aos da variante testada. Os ficheiros e relatóriosx86_64 ficaram intactos. [Provas e comandos](evidence/android-arm64).

É uma assinatura local de desenvolvimento, não uma publicação em loja. Use apenas um método de instalação já autorizado no dispositivo; estes testes não requerem desactivar protecções do sistema. Não foi pedido acesso a contas, chaves de assinatura de produção ou ficheiros pessoais.

A instalação tem um perfil próprio. Pode criar uma identidade ou usar a recuperação por cofre nos percursos suportados. **O cofre recupera chaves; não contém todo o histórico.** Não apagar a versão web ou os seus dados para experimentar o APK. A retransmissão Android continua limitada ao funcionamento em primeiro plano, salvo a passagem temporária pelo selector de documentos descrita na matriz.

Testes físicos ARM64, media/permissões reais, integração/embalagem dos restantes meios e o resto de PROJECT-BRIEF.md continuam pendentes. A versãoweb permanece disponível sem instalação: https://johnnypbelo.github.io/relayloom/ .
