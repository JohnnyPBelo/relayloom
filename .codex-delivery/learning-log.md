# Learning log

## Prevention rules

- Treat a task spawn response as dispatch only; require actual agent outputs/files before claiming delegated work.
- Keep tests and all runtime data within project .cache/.runtime.
- Review cryptographic signatures on received and displayed content, not just initial publication.
- Serial PTY evidence does not prove radio or mobile behavior.

## 2026-09-11 — setup and delegation

Four actual agent tasks accepted but immediately failed: unsupported_input/encrypted_input. Retrying minimal prompts and fresh contexts did not produce engineering output. Preserve provider/authentication as instructed; continue root engineering and record independent-review gate as unmet.

## 2026-09-11 — real transport and UI review

- Initial crypto/socket/process gates passed. Three processes verified TCP-to-serial PTY, partition/heal and offline publisher takeover. This is real OS transport evidence, not physical radio evidence.
- First UI audit found small-text contrast failures. Light tokens were darkened; dark mode also needed the root foreground/background to use theme variables. Failed axe reports were used to fix the actual elements, then rerun.
- An ambiguous group checkbox locator matched a reply control too; tests now identify the checkbox role exactly.
- Same-document launch links after a node restart did not re-read the new capability fragment. A hashchange handler now updates local authentication; recovery test preserves the current page and navigates explicitly.
- Independent design review found cross-recipient drafts and name-only search hiding the selected conversation. Drafts are now keyed by recipient, selection is independent from filtering, and search includes message content. The editor has encrypted local draft save/recovery.
- Independent security review found unauthenticated malformed-path crashes, receipt/public-message semantic bypass, queued ACK amplification, quota/count work amplification and deletion resurrection after cache loss. Root and dedicated agents implemented regressions and fixes. Exact current gates are tracked in STATUS; no completion claim follows from review alone.
