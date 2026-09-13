# Correcção do acesso nativo a controlos — host apenas

Após evidência93f24f1, o XCTest procura controlos semânticos de concluir/ocultar teclado entre botões e teclas; na ausência deles faz até3 gestos nativos para tornar o anchor conhecido visível. Continua a exigir teclado ocultado. Em falha regista apenas metadados limitados de botões/teclas da fixture, sem valores de campos, URL/capacidade ou dump completo. Não há JS/API da app, alteração de preferências do simulador, bridge, isolamento ou prazos.

O marcador de identidade desbloqueada passa a ser Pesquisar e navegar (exclusivo da shell). A recuperação confirma uma conversa já seleccionada pelo destinatário e compositor visíveis; se necessário regressa à lista pelo controlo real. As provas de post, mensagem, fotografia, resposta Node, background/relaunch e dados recuperados foram preservadas.

22 testes host passaram, comando1.833s; estática0.030s. **Swift não compilado e simulador não executado nesta máquina.** A validade Apple e o fluxo funcional completo permanecem por confirmar no CI. O gate completo de eventos foi executado antes desta única alteração de fonte iOS, no commit5d24a16.
