import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { rmSync, writeFileSync } from "node:fs";
import { launch, password, until, type Client } from "../helpers";

async function stubNotifications(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    const state: {
      created: StubNotification[];
      requests: number;
      response: NotificationPermission;
      defer: boolean;
      resolvePending: (() => void) | null;
      failConstruction: boolean;
    } = {
      created: [],
      requests: 0,
      response: "granted",
      defer: false,
      resolvePending: null,
      failConstruction: false,
    };
    w.__notificationTest = state;
    class StubNotification {
      static permission =
        sessionStorage.getItem("synthetic-notification-permission") ??
        "default";
      static async requestPermission() {
        state.requests++;
        if (state.defer)
          await new Promise<void>((resolve) => {
            state.resolvePending = resolve;
          });
        StubNotification.permission = state.response;
        sessionStorage.setItem(
          "synthetic-notification-permission",
          state.response,
        );
        return state.response;
      }
      title: string;
      options: NotificationOptions;
      closed = false;
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions = {}) {
        if (state.failConstruction)
          throw new Error("Synthetic constructor failure");
        if (StubNotification.permission !== "granted")
          throw new Error("Synthetic notification permission is not granted");
        this.title = title;
        this.options = structuredClone(options);
        state.created.push(this);
      }
      close() {
        this.closed = true;
        this.onclose?.();
      }
    }
    Object.defineProperty(window, "Notification", {
      value: StubNotification,
      configurable: true,
      writable: true,
    });
  });
}
async function boot(browser: Browser, clock = false) {
  const a = await launch(),
    b = await launch(),
    context = await browser.newContext(),
    page = await context.newPage();
  try {
    await stubNotifications(page);
    if (clock) await page.clock.install();
    await a.call("setup", { name: "Notification Alice", password });
    await b.call("setup", { name: "Notification Bruno", password });
    const alice = (await a.call("state")).identity,
      bob = (await b.call("state")).identity;
    await a.call("contact", { contact: bob });
    await b.call("contact", { contact: alice });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(
      () => a.call("state"),
      (state) => state.peers.some((p: any) => p.connected),
    );
    const existing = await b.call("publish", {
      content: {
        type: "message",
        text: "Existing private history must stay quiet",
      },
      recipients: [alice.id],
    });
    await until(
      () => a.call("state"),
      (state) => state.objects.some((o: any) => o.id === existing.id),
    );
    await page.goto(a.url + "/#token=" + a.token);
    await page.getByRole("button", { name: "Definições", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Notificações privadas" }),
    ).toBeVisible();
    return {
      a,
      b,
      page,
      alice,
      bob,
      async close() {
        await context.close();
        await a.stop();
        await b.stop();
        rmSync(a.dir, { recursive: true, force: true });
        rmSync(b.dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
    throw error;
  }
}
async function snapshot(page: Page, id: string) {
  await page.waitForResponse(async (response) => {
    if (
      new URL(response.url()).pathname !== "/api/state" ||
      response.status() !== 200
    )
      return false;
    return (await response.json()).objects.some((o: any) => o.id === id);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function privateMessage(
  sender: Client,
  receiverId: string,
  text: string,
) {
  return sender.call("publish", {
    content: { type: "message", text },
    recipients: [receiverId],
  });
}
async function notices(page: Page) {
  return page.evaluate(() =>
    (window as any).__notificationTest.created.map((notice: any) => ({
      title: notice.title,
      options: notice.options,
      closed: notice.closed,
    })),
  );
}
async function count(page: Page) {
  return (await notices(page)).length;
}

test("notification stubs verify explicit opt-in, private filtering, coalescing, privacy and persistence", async ({
  browser,
}, testInfo) => {
  const { a, b, page, alice, bob, close } = await boot(browser);
  try {
    expect(
      await page.evaluate(() => (window as any).__notificationTest.requests),
    ).toBe(0);
    expect(await count(page)).toBe(0);
    const before = await privateMessage(
      b,
      alice.id,
      "Received before opt-in must stay quiet",
    );
    await snapshot(page, before.id);
    expect(await count(page)).toBe(0);
    await page
      .getByRole("button", { name: "Activar notificações", exact: true })
      .click();
    await expect(page.locator(".notification-state")).toHaveText("Activadas");
    expect(
      await page.evaluate(() => (window as any).__notificationTest.requests),
    ).toBe(1);
    await expect(
      page.getByRole("button", {
        name: "Desactivar notificações",
        exact: true,
      }),
    ).toBeFocused();
    const own = await privateMessage(
      a,
      bob.id,
      "Own outgoing message must stay quiet",
    );
    await snapshot(page, own.id);
    const post = await b.call("publish", {
      content: { type: "post", text: "Public post must stay quiet" },
      recipients: "public",
    });
    await snapshot(page, post.id);
    expect(await count(page)).toBe(0);
    const secret = "PRIVATE_CONTENT_DO_NOT_SHOW_8742";
    const incoming = await privateMessage(b, alice.id, secret);
    await snapshot(page, incoming.id);
    await expect.poll(() => count(page)).toBe(1);
    for (let i = 0; i < 3; i++)
      await privateMessage(b, alice.id, "Burst private item " + i);
    const end = await privateMessage(b, alice.id, "Burst private item end");
    await snapshot(page, end.id);
    expect(await count(page)).toBe(1);
    await expect.poll(() => count(page), { timeout: 14_000 }).toBe(2);
    const emitted = await notices(page);
    expect(emitted[0].closed).toBe(true);
    for (const notice of emitted) {
      expect(notice.title).toBe("RelayLoom");
      expect(notice.options.body).toBe(
        "Tens novas mensagens privadas. Abre o RelayLoom para as ler.",
      );
      const serialized = JSON.stringify(notice);
      for (const value of [
        secret,
        "Notification Bruno",
        alice.id,
        bob.id,
        incoming.id,
      ])
        expect(serialized).not.toContain(value);
      expect(notice.options.tag).toBe("relayloom-private-message");
      expect(notice.options.silent).toBe(true);
    }
    expect(
      await page.evaluate(
        (id) => localStorage.getItem("relayloom-private-notifications:" + id),
        alice.id,
      ),
    ).toBe("on");
    const audit = await new AxeBuilder({ page })
      .include(".notification-settings")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("notification-settings-stub.png"),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole("button", { name: "Definições", exact: true }).click();
    await expect(page.locator(".notification-state")).toHaveText("Activadas");
    expect(await count(page)).toBe(0);
    expect(
      await page.evaluate(() => (window as any).__notificationTest.requests),
    ).toBe(0);
    const afterReload = await privateMessage(b, alice.id, "New after reload");
    await snapshot(page, afterReload.id);
    await expect.poll(() => count(page)).toBe(1);
    await page
      .getByRole("button", { name: "Desactivar notificações", exact: true })
      .click();
    expect((await notices(page)).every((x: any) => x.closed)).toBe(true);
    const afterOff = await privateMessage(
      b,
      alice.id,
      "Received after disable must stay quiet",
    );
    await snapshot(page, afterOff.id);
    expect(await count(page)).toBe(1);
    expect(
      await page.evaluate(
        (id) => localStorage.getItem("relayloom-private-notifications:" + id),
        alice.id,
      ),
    ).toBe("off");
    writeFileSync(
      testInfo.outputPath("notification-stub-evidence.json"),
      JSON.stringify(
        {
          mode: "NOTIFICATION API STUB — no native OS toast or permission request",
          realLocalPeerNodes: 2,
          explicitPermissionCalls: 1,
          genericNotices: emitted,
          burstItemsCoalesced: 4,
          cooldownMs: 10_000,
          permissionPreferenceReloaded: true,
          existingHistorySilent: true,
          outgoingAndPublicSilent: true,
          disableClosesNotices: true,
          scopedAxeViolations: audit.violations,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
});

test("lock, identity switch and cancelled permission close notices and invalidate pending work", async ({
  browser,
}, testInfo) => {
  const { b, page, alice, bob, close } = await boot(browser, true);
  try {
    await page.evaluate(() => {
      (window as any).__notificationTest.defer = true;
    });
    await page
      .getByRole("button", { name: "Activar notificações", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancelar activação" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar activação" }).click();
    await page.evaluate(() =>
      (window as any).__notificationTest.resolvePending(),
    );
    await expect(page.locator(".notification-state")).toHaveText(
      "Desactivadas",
    );
    expect(
      await page.evaluate(
        (id) => localStorage.getItem("relayloom-private-notifications:" + id),
        alice.id,
      ),
    ).toBe("off");
    await page
      .getByRole("button", { name: "Activar notificações", exact: true })
      .click();
    await expect(page.locator(".notification-state")).toHaveText("Activadas");
    const first = await privateMessage(
      b,
      alice.id,
      "Close this generic notice on lock",
    );
    await snapshot(page, first.id);
    await expect.poll(() => count(page)).toBe(1);
    const pending = await privateMessage(
      b,
      alice.id,
      "Cancel this queued generic notice on lock",
    );
    await snapshot(page, pending.id);
    expect(await count(page)).toBe(1);
    await page
      .getByRole("button", { name: "Bloquear identidade", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Entrar na minha rede" }),
    ).toBeVisible();
    expect((await notices(page)).every((x: any) => x.closed)).toBe(true);
    await page.clock.runFor(12_000);
    expect(await count(page)).toBe(1);
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar na minha rede" }).click();
    await page.getByRole("button", { name: "Definições", exact: true }).click();
    await expect(page.locator(".notification-state")).toHaveText("Activadas");
    expect(await count(page)).toBe(1);
    const next = await privateMessage(
      b,
      alice.id,
      "A fresh notification after unlock",
    );
    await snapshot(page, next.id);
    await expect.poll(() => count(page)).toBe(2);
    // Controlled display-state fixture exercises a different verified public identity without
    // replacing any node's vault or claiming that identity migration was tested.
    await page.route("**/api/state", async (route) => {
      const response = await route.fetch(),
        value = await response.json();
      value.identity = bob;
      await route.fulfill({ response, json: value });
    });
    await expect(page.locator(".identity-card h3")).toHaveText(
      "Notification Bruno",
    );
    await expect(page.locator(".notification-state")).toHaveText(
      "Desactivadas",
    );
    expect((await notices(page)).every((x: any) => x.closed)).toBe(true);
    writeFileSync(
      testInfo.outputPath("notification-lifecycle-stub.json"),
      JSON.stringify(
        {
          mode: "NOTIFICATION API STUB",
          pendingPermissionCancellation: true,
          lockClosesOwnedNotice: true,
          queuedNoticeSuppressedWhileLocked: true,
          unlockHistorySilent: true,
          identitySwitchDisplayStateFixture: true,
          preferencesNotInheritedByOtherIdentity: true,
          nativeOSToastTested: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
});

test("denied, unavailable and failed notification APIs remain honest inactive states", async ({
  browser,
}) => {
  const { b, page, alice, close } = await boot(browser);
  try {
    await page.evaluate(() => {
      (window as any).__notificationTest.response = "denied";
    });
    await page
      .getByRole("button", { name: "Activar notificações", exact: true })
      .click();
    await expect(page.locator(".notification-status")).toContainText(
      "bloqueou",
    );
    await expect(
      page.getByRole("button", { name: "Activar notificações", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => (window as any).__notificationTest.requests),
    ).toBe(1);
    await page.evaluate(() => {
      (Notification as any).permission = "granted";
      (window as any).__notificationTest.failConstruction = true;
      window.dispatchEvent(new Event("focus"));
    });
    await page
      .getByRole("button", { name: "Activar notificações", exact: true })
      .click();
    const incoming = await privateMessage(
      b,
      alice.id,
      "Constructor failure fixture",
    );
    await snapshot(page, incoming.id);
    await expect(page.locator(".notification-status")).toContainText(
      "não conseguiu criar",
    );
    await expect(page.locator(".notification-state")).toHaveText(
      "Desactivadas",
    );
    expect(await count(page)).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(window, "Notification", {
        value: undefined,
        configurable: true,
      });
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.locator(".notification-support")).toContainText(
      "não disponibiliza notificações",
    );
    await expect(
      page.getByRole("button", { name: "Activar notificações", exact: true }),
    ).toBeDisabled();
  } finally {
    await close();
  }
});
