import { test, expect } from "@playwright/test";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { staticHarness } from "./static-harness";

test("portable curves match RFC 7748, reject invalid reading keys and work when native curve operations fail", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        hex = (s: string) =>
          Uint8Array.from(s.match(/../g)!, (pair) => parseInt(pair, 16)),
        encoded = (bytes: Uint8Array) =>
          Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      // Public RFC 7748 §6.1 test scalars, also present in Go's crypto/ecdh tests.
      const privateDER = r.b64(
          hex(
            "302e020100300506032b656e0422042077076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
          ),
        ),
        peerDER = r.b64(
          hex(
            "302a300506032b656e032100de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
          ),
        );
      const derived = encoded(r.un64(r.boxPublicKey(privateDER)).slice(12)),
        shared = encoded(r.boxSharedSecret(privateDER, peerDER));
      let lowOrderDenied = false,
        malformedDenied = false;
      try {
        r.boxSharedSecret(
          privateDER,
          r.b64(hex("302a300506032b656e032100" + "00".repeat(32))),
        );
      } catch {
        lowOrderDenied = true;
      }
      try {
        r.boxSharedSecret(privateDER, peerDER + "AAAA");
      } catch {
        malformedDenied = true;
      }
      for (const name of [
        "generateKey",
        "importKey",
        "deriveBits",
        "exportKey",
        "sign",
        "verify",
      ]) {
        const subtle = crypto.subtle as any,
          original = subtle[name].bind(subtle);
        subtle[name] = (...args: any[]) => {
          const algorithm =
            name === "importKey"
              ? args[2]
              : name === "exportKey"
                ? args[1]?.algorithm
                : args[0];
          if (
            ["Ed25519", "X25519"].includes(
              typeof algorithm === "string" ? algorithm : algorithm?.name,
            )
          )
            return Promise.reject(
              new DOMException(
                "Native curve operations intentionally unavailable",
                "OperationError",
              ),
            );
          return original(...args);
        };
      }
      const author = await r.createIdentity("Portable author"),
        reader = await r.createIdentity("Portable reader"),
        outsider = await r.createIdentity("Unrelated reader");
      const bundle = await r.createBundle(
        author,
        "post",
        { text: "Private portable agreement" },
        [reader.public],
      );
      const plaintext = await r.decryptBundle(bundle, reader);
      let outsiderDenied = false,
        wrongPrivateDenied = false;
      try {
        await r.decryptBundle(bundle, outsider);
      } catch {
        outsiderDenied = true;
      }
      try {
        await r.checkIdentity({ ...reader, boxSecret: author.boxSecret });
      } catch {
        wrongPrivateDenied = true;
      }
      const vault = await r.exportVault(
          reader,
          "portable browser recovery phrase",
        ),
        restored = await r.importVault(
          vault,
          "portable browser recovery phrase",
        );
      return {
        derived,
        shared,
        lowOrderDenied,
        malformedDenied,
        outsiderDenied,
        wrongPrivateDenied,
        plaintext,
        restoredID: restored.public.id,
        originalID: reader.public.id,
      };
    });
    expect(result.derived).toBe(
      "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
    );
    expect(result.shared).toBe(
      "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
    );
    expect([
      result.lowOrderDenied,
      result.malformedDenied,
      result.outsiderDenied,
      result.wrongPrivateDenied,
    ]).toEqual([true, true, true, true]);
    expect(result.plaintext).toEqual({ text: "Private portable agreement" });
    expect(result.restoredID).toBe(result.originalID);
  } finally {
    await host.close();
  }
});

test("identity lifecycle remains valid across 512 generated and reimported signing/reading key pairs", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl;
      let completed = 0,
        stage = "",
        failure: unknown;
      const samples = [];
      for (let i = 0; i < 512; i++) {
        try {
          stage = "create identity";
          const identity = await r.createIdentity("Lifecycle " + i);
          stage = "validate public card and reimport private keys";
          await r.checkIdentity(identity);
          stage = "create signed bundle";
          await r.createBundle(
            identity,
            "post",
            { text: "small positive control" },
            "public",
          );
          if (i % 64 === 0) samples.push(identity);
          completed++;
        } catch (e) {
          failure = {
            stage,
            name: (e as Error).name,
            message: (e as Error).message,
          };
          break;
        }
      }
      // Fresh synthetic keys cross to the test's Node oracle only. They are
      // never written into published evidence or returned by the application.
      return { completed, failure, samples };
    });
    expect({ completed: result.completed, failure: result.failure }).toEqual({
      completed: 512,
      failure: undefined,
    });
    for (const identity of result.samples) {
      const derived = createPublicKey(
        createPrivateKey({
          key: Buffer.from(identity.boxSecret, "base64"),
          format: "der",
          type: "pkcs8",
        }),
      )
        .export({ format: "der", type: "spki" })
        .toString("base64");
      expect(derived).toBe(identity.public.boxKey);
      const signing = createPublicKey(
        createPrivateKey({
          key: Buffer.from(identity.signSecret, "base64"),
          format: "der",
          type: "pkcs8",
        }),
      )
        .export({ format: "der", type: "spki" })
        .toString("base64");
      expect(signing).toBe(identity.public.signKey);
    }
  } finally {
    await host.close();
  }
});
