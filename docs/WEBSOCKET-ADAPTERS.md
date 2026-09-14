# Adaptadores WebSocket Node e Go

Os runtimes Node e Go têm um listener de dados WebSocket separado da API de controlo. Usa o framing de pacotes existente e pode encaminhar para os outros adaptadores do router. Os objectos continuam cifrados e assinados; a ligação não concede leitura, autoria ou acesso à API local.

A API autenticada `POST /api/web-peer` recebe uma origem web exacta e emite um convite de transporte de 256 bits, com prazo limitado. Um pedido inválido conserva o convite anterior. A origem, capacidade, caminho, Host e prazo são verificados antes da ligação. Há limites de sessões, sockets pendentes, frames e bytes. `POST /api/web-peer-stop` retira explicitamente o convite e fecha as ligações que lhe pertencem.

Bloquear a identidade limpa as chaves e impede leitura privada, assinatura e emissão de novos convites. Não retira automaticamente o consentimento separado para retransmitir dados cifrados. O convite existente termina por expiração ou revogação explícita; desbloquear não recria um convite revogado. Isto mantém a separação entre posse de chaves e participação como relay.

O caminho da aplicação escuta apenas em loopback. A biblioteca permite WSS com certificados fornecidos pelo operador e recusa WS em texto simples fora de loopback. Isso não demonstra configuração LAN/Internet, confiança de certificados em browsers reais ou funcionamento em dispositivos móveis. A ligação nativa a browsers fora deste caminho continua em desenvolvimento.

O cancelamento de pacotes trata fragmentos em voo e envia o controlo de abandono pela fila limitada do adaptador. Em Go, o callback sob o mutex do router não faz I/O de rede. Cancelar não pode retirar bytes que já tenham sido entregues ao sistema operativo.

## Evidência verificada

Gate sequencial sobre `9866889`, terminado a 2026-09-14T07:25:38.592Z: 380 fontes estáveis. Passaram typecheck/build/CLI, 278 testes Node (364.627 s), 89 testes Go de topo com race detector (125 com subtestes; dois helpers omitidos; 425.749 s) e 58 testes de interoperabilidade (434.301 s). Passaram também a UI dos dois motores e o desktop Linux real, incluindo execução empacotada (330.996 s). Comandos, hashes e saídas em [evidência do marco](evidence/websocket/milestone).

A primeira fixture da API assumiu que bloquear chaves retirava consentimento de relay; os dois motores recusaram essa premissa. Foi corrigida para testar a política existente e acrescentou negação de leitura/assinatura privada e revogação explícita. Nenhuma regra de produção foi relaxada.

A CI34815555671 do commit de base passou Node nos três SO, Go/race, interoperabilidade, UI Linux e empacotamento desktop. A execução da UI no simulador iOS falhou; não se atribui a este marco um passe iOS. A consolidação dos módulos browser e a integração Reticulum prosseguem separadamente. PTY não é rádio físico; a paridade web não está concluída.

As dependências são `ws` 8.21.3 (MIT), `@types/ws` 8.18.1 (desenvolvimento) e `github.com/coder/websocket` v1.8.15 (ISC). Os avisos e hashes estão em `docs/licenses/websocket`. Não se instalou uma autoridade certificadora nem se alteraram definições de segurança do sistema.
