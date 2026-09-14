# Correcção Go — gate integral no host

Sobre60f514c,5inputsGo.173 testesGo de topo/225comsubtestes passaram,13helpersomitidos;45SQLiteC/61comsubtestes passaram,5helpersomitidos;57interop e23UIGo passaram. Helpersomitidos não contam como passes. O report contém comandos, tempos e hashes, e scope lista35Axe sem violações. O testeapp manteve o limite600s e-p=2, terminando413.181s.

O cenário de perfil manteve-race e todos os controlos:37.881s antes/26.780s depois. A primeira compilação da fixture usava dois valoresde retorno deTx.Delete; o erro foi corrigido antes dos testes. Perfis/binários completos permanecem na cache local, sem alteração a serviços de debug ou sistema.

Logs públicos normalizam espaços finais quando indicado pelos hashes originais em scope. Não é passeCI,teste dehardware,assinatura ou revisão independente. Node e a UI com esse motor não mudaram nesta correcção; a sua evidência anterior está no marco60f514c.
