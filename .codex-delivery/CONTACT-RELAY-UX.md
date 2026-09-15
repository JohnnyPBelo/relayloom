# Contactos e participação como relay — 2026-09-15

Pedido do proprietário: cartão importado não aparece nas conversas; como participar como relay pela web usando os meios disponíveis. Contrato completo e recuperação sequencial preservados; sem agentes novos/retomados.

Reproduzir com identidades sintéticas, mostrar contactos persistidos sem inventar mensagens, reutilizar a conversa DM quando existir, manter pesquisa/bloqueio/rascunhos. Acrescentar autorização de relay na área A rede com estado real de ligações, controlo de pausa e explicação das capacidades. Não activar automaticamente o consentimento, fingir descoberta nem anunciar Bluetooth directo inexistente. WebRTC usa a rede IP alcançável; outros meios dependem de adaptadores/pares compatíveis.

Validação: controlo antes/depois do cartão, persistência/pesquisa/primeiro envio sem linha duplicada; três browsers A–B–C sem A–C e autorização B pela UI, negativo em pausa/positivo após activar, contadores reais e leitura recusada ao relay. Regressão web nos três motores, UI Node/Go e Linux, publicar os assets exactos e verificar o URL. Disco inicial18GiB, mínimo15GiB; sem downloads pesados.

Base2d06c7e. CI34940755521 terminou failure apenas em ios-simulator-build; não atribuir uma causa nova sem recolher esse artefacto. iOS e alterações locais anteriores preservados. Tentativa de leitura da UI actual pela skill Browser falhou: backend iab não descoberto; nenhuma alteração ao separador do proprietário.


## Correcções e controlos dirigidos

O teste original confirmou contacto guardado mas ausente na lista. As linhas locais de contacto agora usam desde o início o endereço DM canónico (SHA-256 dos IDs de leitores ordenados, pelo Noble já instalado), validado pelos motores existentes. Não há publicação de mensagens vazias. A primeira tentativa com contact: temporário alterava o conteúdo usado na repetição e duplicava um envio quando se perdia a resposta; a regressão existente reproduziu2 mensagens em vez de1. Endereço estável e destinatários ordenados corrigiram; o mesmo teste passou22.4s.

A nova área A rede permite consentimento/pausa, confirma a gravação e distingue falta de pares. Estado intermédio visível evita que o checkbox pareça ignorar o clique enquanto grava. Controlos de contacto/persistência/pesquisa/rascunho/primeiro DM e de3browsers A–B–C passaram; o relay recusa leitura privada pela UI. Uma asserção de placeholder coincidia com o texto da mensagem, e os selectores globais de contacto passaram a coincidir com lista+diálogo: ajustados ao elemento/contexto exactos, sem retirar casos. Falhas preservadas em.cache/contact-relay.

O gate completo está em curso após a correcção:2oráculos do endereço,24UI no build existente,30UI/controlos no build público e1percurso entre processos. Depois UI Node/Go/Linux e RNSUI; não publicar antes de terminar. Nenhum adaptadorBluetooth foi implementado ou anunciado como disponível.


## Concluído neste incremento, produto completo ainda aberto

Código `9abbf20`; publicação estática `5bc5895…`, Pages `35025782233` concluído. Passaram 2 oráculos, 55 casos web, 25 UI Node e 25 Go, pacote Linux executado e 9 UI-RNS. Depois da publicação passaram os 3 testes do URL HTTPS (1 entre processos + 2 contactos/relay), além da conferência dos ficheiros por hash/tamanho. Evidência em docs/evidence/contact-relay. Não houve execução de Bluetooth, rádios ou dispositivos físicos nem alteração de bridges/modelos/configuração.

O último verificador tratava uma opção de URL vazia como endereço: corrigida a interpretação para usar a fixture local. A etiqueta de grupos vazios foi preservada, reservando «Contacto guardado» para contactos. O gate final completo foi repetido com fontes estáveis. Os erros anteriores continuam arquivados; nenhuma candidata falhada foi publicada.
