# Armazenamento privado de sites Node/Go

Implementado em Go o formato de registos privados que protege preparações com uma chave derivada da assinatura, ligado a proprietário, storeID e chave lógica. Usa as primitivas mantidas AES-GCM/HKDF e a base transaccional existente; não altera o formato legado dos grupos. O novo getter StoreID respeita a duração da transacção e devolve contexto autenticado, sem expor o índice mutável.

`node scripts/go.mjs test -race -p=1 ./sites ./groupstore` passou. Os controlos exercitam valor de2MiB/reinício, chave de leitura insuficiente, handles expirados, quota/rollback, ausência e troca de ciphertext. A verificação final inclui o getter de contexto depois do fim da transacção.

`node --import tsx --test --test-concurrency=1 tests/native/site-private-storage.test.ts` passou2casos: um processo Go real leu os mesmos dados que Node tinha escrito na mesmaSQLite e escreveu outro valor lido depois por Node; inclui Unicode e surrogate isolado. A cópia do ciphertext para outra base autenticada com o mesmo proprietário foi recusada. Os controlos usam identidades temporárias; nenhum segredo foi incluído nesta evidência. Typecheck passou.

[Go](go-tests.log), [verificação final](go-final.log), [interoperabilidade](interop.log) e [fontes](sources.json). Isto ainda não é o catálogo, API ou UI de revisões Go: esses componentes continuam por implementar. Não houve teste de rádio/dispositivo físico ou corte de energia.
