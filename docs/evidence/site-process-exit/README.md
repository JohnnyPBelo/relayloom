# Fim do processo por código ou por sinal

O CI35215212384 (fonte16ae953) passou Node em Linux/macOS, mas Windows falhou um teste porque exitCode era null depois de terminar o autor. ChildProcess regista a terminação por sinal em signalCode; a asserção antiga ignorava esse estado. A execução não chegou aos jobs dependentes, incluindo iOS; não há novo resultado do selector da fotografia.

O teste agora termina deliberadamente o processo de publicação por SIGKILL, espera o evento exit com prazo de8s e aceita apenas exitCode ou signalCode terminais. Continua a exigir recusa da porta TCP do autor e entrega posterior ao novo leitor pelo seeder. Não usa a propriedade killed como prova de fim nem remove o controlo de ausência. O percurso de série aceita igualmente os dois estados terminais.

Passaram5casos dirigidos de aplicação/TCP/série; após acrescentar o prazo explícito, passou novamente o caso afectado. [Resultados](targeted.log), [espera limitada](bounded-exit.log) e [erroWindows](windows-failure.txt). A correcção ainda precisa da repetição emWindows. Nenhum processo do utilizador foi terminado: são nós de fixture criados pelos testes.
