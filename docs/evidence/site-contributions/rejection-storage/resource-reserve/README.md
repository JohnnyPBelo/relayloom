# Reserva e restauro de dependências

Os relatórios registam a queda da reserva e a recuperação com arquivos verificados. Fontes, WIP, perfis e userdata do AVD foram preservados. O Chromium headed removido era cache regenerável; a matriz headless continuou com a mesma versão do headless-shell, Firefox e WebKit.

Os arquivos grandes permanecem apenas na cache local do projecto. Não foram incluídos no repositório público.

- Instaladores históricos: `python3 -m tarfile -e /home/absint0o/projects/relayloom/.cache/archives/desktop-history-20260923.tar.xz /home/absint0o/projects/relayloom`.
- Antes do próximo emulador Android: `python3 /home/absint0o/projects/relayloom/.cache/android/archives/restore-system-image.py`. Exige margem para manter15GiB e confirma SHA256/tamanho; userdata não é alterada. O restauro ainda não foi executado nesta fase.
- A cópia restore-system-image.py nesta pasta é registo do código, não o ponto de execução: o script original usa os metadados e arquivo da sua pasta na cache Android.
- Worktree limpa site-ci-clean: recriar com o SHA registado em recovery.json e devolver os itens de `.cache/retired-worktree-support/site-ci-clean` aos caminhos originais. site-data-next e todas as worktrees com WIP permaneceram intactas.

Revalidar o espaço antes de restaurar/compilar; não substituir o limite de reserva nem apagar dados de outros projectos.
