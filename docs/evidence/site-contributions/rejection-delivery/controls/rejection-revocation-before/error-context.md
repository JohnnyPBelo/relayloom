# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site-contribution-rejection-runtime.spec.ts >> owner rejection authority block-and-reallow handles a retained policy reply without reviving revocation
- Location: tests/browser/site-contribution-rejection-runtime.spec.ts:411:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Test source

```ts
  437 |             "profile",
  438 |             1,
  439 |             [],
  440 |             payload,
  441 |             "public",
  442 |             3600000,
  443 |           );
  444 |           await owner.putBundle(source);
  445 |           const catalog = new r.BrowserContributionCatalog(visitor),
  446 |             q = {
  447 |               sequence: 1,
  448 |               operationId: crypto.randomUUID(),
  449 |               snapshotId: source.manifest.id,
  450 |               pageId: "entry",
  451 |               formId: "form",
  452 |               values: { name: "REJECTION_GUARD", count: 0, open: false },
  453 |               publicationScope: "public",
  454 |               ttlMs: 180000,
  455 |             },
  456 |             prepared = await catalog.prepare(q, async () => source, allow),
  457 |             signed = await catalog.sign(prepared, allow);
  458 |           await catalog.seal(signed, allow);
  459 |           const queued = await catalog.queue(signed, allow),
  460 |             proposal = await catalog.authorizedBundle(queued, allow);
  461 |           runtime = new r.BrowserContributionRuntime({
  462 |             profile: owner,
  463 |             policy: async () => {
  464 |               if (blocked) throw Error("fixture policy blocked");
  465 |             },
  466 |             copyPolicy: () => [],
  467 |             publish: (bundle: any) => sent.push(bundle),
  468 |             cancel: async (id: string) => {
  469 |               cancelled.push(id);
  470 |             },
  471 |           });
  472 |           await runtime.receive(proposal);
  473 |           const inbox = await runtime.command({ action: "inbox" });
  474 |           await runtime.command({
  475 |             action: "reject",
  476 |             id: queued.certificateId,
  477 |             revision: inbox.management.revision,
  478 |             reason: "Private authority decision",
  479 |           });
  480 |           await runtime.tick();
  481 |           const bundle = sent.find(
  482 |               (b) => b.manifest.kind === "site-contribution-rejection",
  483 |             ),
  484 |             positive = await runtime.canServe(bundle),
  485 |             transaction = owner.transactValues.bind(owner);
  486 |           let entered = () => {},
  487 |             holdNext = true;
  488 |           const reached = new Promise<void>((resolve) => {
  489 |               entered = resolve;
  490 |             }),
  491 |             held = new Promise<void>((resolve) => {
  492 |               release = resolve;
  493 |             });
  494 |           owner.transactValues = async (...args: any[]) => {
  495 |             const value = await transaction(...args);
  496 |             if (holdNext) {
  497 |               holdNext = false;
  498 |               entered();
  499 |               await held;
  500 |             }
  501 |             return value;
  502 |           };
  503 |           const pending = runtime.canServe(bundle);
  504 |           await reached;
  505 |           if (mode === "close") runtime.close();
  506 |           else {
  507 |             if (mode === "block-and-reallow") {
  508 |               blocked = true;
  509 |               await runtime.revokeInvalid();
  510 |               blocked = false;
  511 |             }
  512 |             runtime.nextRetry = 0;
  513 |             await runtime.tick();
  514 |           }
  515 |           release();
  516 |           const retained = await pending,
  517 |             fresh = await runtime.canServe(bundle);
  518 |           return {
  519 |             positive,
  520 |             retained,
  521 |             fresh,
  522 |             cancelled: cancelled.includes(bundle.manifest.id),
  523 |             sameBytes: sent
  524 |               .filter((b) => b.manifest.kind === "site-contribution-rejection")
  525 |               .every((item) => r.canonical(item) === r.canonical(bundle)),
  526 |           };
  527 |         } finally {
  528 |           release();
  529 |           runtime?.close();
  530 |           owner.close();
  531 |           visitor.close();
  532 |         }
  533 |       },
  534 |       { payload: formPayload(), mode },
  535 |     );
  536 |     expect(result.positive).toBe(true);
> 537 |     expect(result.retained).toBe(mode === "unchanged-retry");
      |                             ^ Error: expect(received).toBe(expected) // Object.is equality
  538 |     expect(result.fresh).toBe(mode !== "close");
  539 |     expect(result.cancelled).toBe(mode !== "unchanged-retry");
  540 |     expect(result.sameBytes).toBe(true);
  541 |   });
  542 | 
```