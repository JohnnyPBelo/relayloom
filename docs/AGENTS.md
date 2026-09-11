# Actual delegation evidence

2026-09-11, this Codex graphical task, with the existing model selection inherited and no override.

| Actual agent/task | Exclusive assignment | Observed result |
| --- | --- | --- |
| `/root/crypto_store` | `packages/core/**`, core tests | Spawn accepted, execution failed `unsupported_input`; follow-up failed `encrypted_input` |
| `/root/transport` | `packages/transport/**`, transport tests/docs, PTY fixture | Spawn accepted, execution failed `unsupported_input`; follow-up failed `encrypted_input` |
| `/root/core_engineering` | Fresh context (`fork_turns=none`), cryptography/store | Spawn accepted, execution failed `encrypted_input` |
| `/root/transport_engineering` | Fresh context, TCP/serial routing | Spawn accepted, execution failed `encrypted_input` |

No agent authored files or produced engineering/review results in these attempts. These are real failed task attempts, not successful multi-agent evidence. Independent review remains blocked on working delegation or another reviewer; root self-review cannot fulfil that gate. Provider/authentication/bridge/safety settings were not changed.

## Delegation recovered during implementation

A subsequent fresh-context task `/root/security_review` started successfully and delivered actual code review findings: malformed HTTP URL crash, missing inbound ACL/receipt semantics, unbounded ACK output. It is a read-only review; root owns server/domain fixes. Earlier failures remain recorded and are not rewritten as successes.

Two complementary fresh-context tasks were then dispatched: `/root/transport_hardening` owns only `packages/transport/**` and transport tests (bounded ACKs, fragmentation fairness, adversarial tests); `/root/design_review` is read-only review of rendered screenshots and UI/accessibility. Results remain pending until received. No model/provider override or setting change occurred.

## Results integrated

- `/root/security_review`: reviewed cryptography/ACL/storage/HTTP, then owned `packages/core/**` and core tests. Added object count cap, verified metadata cache, safe quota planning and optional LRU touch. Reported 10/10 core tests and typecheck passed. Root regression tests cover its server/semantic/journal findings.
- `/root/transport_hardening`: owned only transport package and transport tests. Implemented bounded ACK writer, fragment priority/fairness, capped retry/assembly/flood state and consent pause queue cancellation. Reported 16/16 transport tests and typecheck passed. Root adopted its fourth `relayOnly` broadcast argument.
- `/root/design_review`: inspected real onboarding/messenger screenshots plus source, identified recipient-draft leakage, search/selection, missing announcements/delivery text/semantic states and unsaved editor drafts. Root fixed these and added e2e checks. The same agent then received a separate simulation task, exclusively `packages/simulation/**`, simulation test/script/docs.
- Root integrated the branches by explicit file ownership in the shared repository, reviewed changed interfaces and ran the combined suite: 41 tests and one broad two-client browser e2e passed. No child changed providers, authentication, bridge or safety settings, installed dependencies, or committed.

The independent design review was not a physical device or screen-reader test; simulation remains a distinct evidence class.

Simulation task completed: `/root/design_review` produced the bounded virtual-time engine, scenario/test suite and explicit evidence boundaries. Its 9/9 tests and all 16 baseline/control assessments passed. `/root/security_review` independently read the simulation and found its broken controls meaningful, while noting that model bundle acceptance is not application decryption/display; SIMULATION.md now states that scope directly.

Subsequent work dispatched to `/root/transport_hardening`: secure desktop shell, exclusive ownership of `apps/desktop/**`, desktop scripts/docs. It is not part of the baseline verified code until integrated and tested; no native desktop result is yet claimed.
