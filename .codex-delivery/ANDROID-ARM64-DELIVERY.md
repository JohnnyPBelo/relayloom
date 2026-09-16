# Android ARM64 — artefacto para telefones, por implementar

Estado: opções de ABI e validação de máquina ELF implementadas;4testes de cabeçalho passaram. Bind2028 e build50443 terminaram e foram recolhidos. APK812339a7d716db41ab8fe26b1f4a83033575210547ad666b7c33abc507d83ed8 construído (16841791bytes). AAR694df3a3d54c7cf7d27981f2f8a2d7e476b9ce0376b7de0bc00e460b5f71e59f. ELF/assinatura/alinhamento/assets verificados; x86preservado. Sem execuçãoARM64. Provas docs/evidence/android-arm64 e guia docs/ANDROID-ARM64.md. O APK x86_64 é para o emulador e não deve ser apresentado como instalável num telefone ARM64.

A toolchain NDK existente já contém os compiladores necessários. Não descarregar outra imagem de SO nem criar outro emulador. Conservar o APK/AAR/relatórios x86_64 verificados e o AVD actual.

Alterações necessárias depois do gate público em curso:

1. `scripts/android-bind.mjs`: aceitar explicitamente um único alvo `android/arm64`, mantendo `android/amd64` como predefinição. Reutilizar o lock de exclusão, o Go/x-mobile/NDK fixados e as reservas de disco. Usar nomes de AAR e relatório distintos para ARM64.
2. `scripts/android-build.py`: aceitar `--abi arm64-v8a`; seleccionar `jni/<abi>`, verificar a máquina ELF e os alinhamentos antes de empacotar. Usar staging, APK e relatório próprios para não invalidar a prova x86_64 usada pelos testes existentes.
3. Verificar build, conteúdo, assinatura de desenvolvimento, manifesto, ABI e hash. Comparar os assets com a interface exacta testada. Não inferir teste de execução ARM64 nem suporte físico a páginas de16KiB apenas do alinhamento/cross-compilação.
4. Preparar instruções de instalação experimental e recuperação de identidade. O cofre exportado contém chaves, não uma cópia completa das conversas; não prometer migração integral ainda inexistente.
5. Dispositivo ARM64 real, microfone/câmara, Bluetooth/radio e funcionamento em segundo plano continuam a precisar dos respectivos testes e limites. Não alterar permissões do SO, serviços externos, bridges ou autenticação para os contornar.

Esta entrega complementa o trabalho de sites e todas as restantes aplicações; não reduz a paridade web nem o contrato completo.
