import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** Only structural flags and a screenshot of this isolated synthetic fixture.
 * No vault, key, password, storage contents, full DOM or network token is dumped. */
export async function recordReloadFailure(page: Page, info: TestInfo) {
  const directory = join(
    ".cache/browser-reload-diagnostics",
    info.project.name || "chromium",
  );
  mkdirSync(directory, { recursive: true });
  const evidence: Record<string, unknown> = {
    phase: "after-reload-before-unlock",
    project: info.project.name || "chromium",
    closed: page.isClosed(),
    at: new Date().toISOString(),
  };
  try {
    await page.screenshot({
      path: join(directory, "screen.png"),
      timeout: 4000,
    });
    evidence.screenshot = true;
  } catch (e) {
    evidence.screenshot = false;
    evidence.screenshotError = (e as Error).name;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    Object.assign(
      evidence,
      await Promise.race([
        page.evaluate(() => {
          const text = document.body?.innerText ?? "",
            box = (selector: string) => {
              const e = document.querySelector(selector) as HTMLElement | null;
              return (
                !!e &&
                e.getBoundingClientRect().width > 0 &&
                e.getBoundingClientRect().height > 0
              );
            };
          return {
            documentReadyState: document.readyState,
            path: location.pathname,
            secureContext: isSecureContext,
            passwordInputs: document.querySelectorAll('input[type="password"]')
              .length,
            passwordVisible: box('input[type="password"]'),
            applicationNavigation: box(".sidebar"),
            duplicateProfileMessage: text.includes(
              "Este perfil já está aberto noutro separador",
            ),
            unavailableLocksMessage: text.includes(
              "não permite proteger o perfil entre separadores",
            ),
            unlockHeading: text.includes("Bom ter-te de volta"),
            signupHeading: text.includes("Como te chamas"),
            loadingMessage:
              text.includes("A iniciar") || text.includes("A abrir"),
            alertCount: document.querySelectorAll('[role="alert"]').length,
            serviceWorkerControlled: !!navigator.serviceWorker?.controller,
          };
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("diagnostic deadline")), 2000);
        }),
      ]),
    );
  } catch (e) {
    evidence.domDiagnosticError = (e as Error).name;
  } finally {
    clearTimeout(timer);
  }
  writeFileSync(
    join(directory, "report.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
