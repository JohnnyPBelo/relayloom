# Private profile transaction integration — local gates passed

Root owns this sequential phase. No new/resumed agents or provider/bridge/services/settings changes. Full owner contract remains active. Published HEAD90cb649. This continuation is uncommitted; both applications now import the new private database.

## Implemented

- Node `packages/profile/src/state.ts` and Go `native/profilestate`: canonical private document16MiB/32 chunks512KiB inside the encrypted, locally signed SQLite transaction; exact set/length/hash checks, digest CAS, shrink cleanup and rollback with other metadata.
- `binding.ts`/`native/profilebinding`: signed exact-schema identity/store/nonce/source-ciphertext-digest, prepared and committed phases. Generic stores accept a preassigned ID only for exclusive new creation. Source digest hashes legacy ciphertext, never exposed private plaintext.
- `database.ts`/`native/profiledb`: staged initialization, protected marker, validated import and crash recovery. Committed binding never falls back to JSON. Missing, unbound, corrupt or replaced initialized database is refused without reset. Wrapper checks marker/document around transactions.
- `apps/node/src/protected-private.ts`/`native/app/protected_private.go` plus engine lifecycle/persistence: vault first, migration on setup/unlock, SQL CAS writes, authenticated reopen after uncertain commit, locked state if readback fails, close before releasing profile ownership. Legacy ciphertext is preserved, not deleted.
- Root semantic review found Node accepted malformed legacy mutations. Failing control recorded; Node now validates mutations/collections/draft before migration using the shared declarative-content validator and bounds the file read before allocation. No remote scripts/HTML added.

## Observed tests

- State/binding Node6; Go state/binding/storage17 top-level with race15.547s.
- Factory Node8 including actual process exits after prepared/imported/committed boundaries; Go factory4 top-level and subcases with race1.837s.
- Actual factory Node↔Go interop6.729s: identical binding/chunked Unicode document, process deaths before/after SQL commit, cross-runtime initialization completion. `.cache/profile-foundation` records sources/output.
- Initial app integration: Node outbox/security/profile25 passed15.194s; Go app with race196.134s (199.031s supervisor), exit0. `.cache/private-runtime-first`.
- Semantic migration regression failed before fix (mutations array accepted), passed after; production build/typecheck passed. `.cache/private-migration-review`.
- Gate completo concluído: build/typecheck,152 Node/77.381s,105 testes Go de topo com race/379.168s (cinco helpers omitidos em unitários e executados pelos drivers),15 interoperabilidade/145.127s,15 UI Node/107.327s e15 UI Go/101.522s. Desktop Linux: preparação0.239s, execução0.982s, pacote5.161s, execução empacotada0.766s.22 relatórios Axe actualizados, zero violações. As fontes registadas não mudaram durante o gate. Evidência pública em `docs/evidence/private-profile`; produto, grupos dinâmicos e plataformas móveis continuam incompletos.

Existing outbox tests retain uncertain write/readback, exact pending ID, ACL, expiry, pin and corruption controls. Ciphertext inspections/corruption target SQLite now. Tests explicitly constructing legacy import data still use JSON. Content-file fsync failures remain covered separately from new SQL post-commit failures. Go tests use a per-node writer seam; production code always uses the database writer.

## Explicit limits / next work

Restoring the complete valid earlier initialization state (prepared intent, absent database and unchanged ciphertext) remains indistinguishable from that legitimate earlier state without a trusted monotonic witness. This rollback limit is demonstrated, not claimed fixed. Process kill tests are not physical power-loss tests. The chunk document shares the existing64MiB ordinary metadata budget; it does not add an invisible quota.

Application private state now has a common transactional substrate, but group authority/admission/outbox decisions are NOT yet unified. Next expose a transaction-scoped authority facade without nesting standalone transactions, preserve valid proof prefixes on rejected tails, and delay receipts/display/network transmission until the outer commit. Then sync/admission/quarantine/API/UI and full network controls. Android/iOS must rebuild and execute corresponding artifacts; older mobile evidence does not cover these imports. Independent review of this code remains pending while agents are prohibited.
