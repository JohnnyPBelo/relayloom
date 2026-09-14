# Revisão pelo implementador — não independente

Foram revistos os formatos de identidade/cofre/manifesto contra o núcleo existente, incluindo DER Ed25519/X25519, bytes canónicos, limites e campos exactos, derivação de wrapping e AAD. Testes cruzados executaram ambos os lados, em vez de inferirem compatibilidade a partir dos nomes dos algoritmos.

A validação async conserva snapshots próprios. O IndexedDB não executa crypto dentro de uma transacção que possa fechar durante await: prepara bytes, compara revisão e escreve objecto+índice em pedidos síncronos na mesma transacção. Web Locks coordena as escritas de dois separadores; a geração da sessão impede o desbloqueio de restaurar chaves depois de lock. Pins e dados anteriores sobrevivem à recusa de quota. O cofre nunca substitui um perfil existente durante recuperação.

O caminho RTC confirma depois de verificar e aceitar armazenamento. Os negativos usam frames reais para chegar à fronteira de recepção, e não apenas a validação do remetente. A falha de liveness foi corrigida no produto antes da repetição do teste. Há limites de fila, frame, reassemblagem, transferência, sinalização e controlos de presença. O ACK de uma contraparte maliciosa não constitui prova criptográfica de leitura; os recibos/autoridade/outbox do produto continuam por integrar.

Esta revisão não permite activar mensagens/grupos/routing na versão autónoma. Domínio/autoridade, worker/UI, inventário/retries/prioridades, crash/power loss, browser eviction, STUN/TURN e dispositivos permanecem pendentes. A instrução do proprietário mantém a delegação suspensa; não se atribui trabalho ou revisão a agentes novos.
