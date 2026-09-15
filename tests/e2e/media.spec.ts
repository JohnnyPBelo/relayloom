import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { rmSync, writeFileSync } from "node:fs";
import { launch, password, until } from "../helpers";

// Controlled getUserMedia stub, generated Web Audio stream, real browser MediaRecorder.
// The fake-device flag is defense in depth; tests never call the native microphone API.
// Native fake-device capture was separately attempted and rejected with NotSupportedError.
test.use({
  launchOptions: {
    chromiumSandbox: true,
    args: ["--use-fake-device-for-media-stream"],
  },
});

async function observeCapture(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__syntheticCapture = {
      calls: 0,
      tracks: [],
      recorders: [],
      delayNext: false,
      releasePending: null,
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      w.__syntheticCapture.calls++;
      if (constraints?.video)
        throw new Error("The test must not request a camera");
      const audio = new AudioContext(),
        oscillator = audio.createOscillator(),
        gain = audio.createGain(),
        destination = audio.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.1;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      await audio.resume();
      const stream = destination.stream;
      let released = false;
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          if (!released) {
            released = true;
            oscillator.stop();
            void audio.close();
          }
        };
      }
      w.__syntheticCapture.tracks.push(...stream.getTracks());
      if (w.__syntheticCapture.delayNext) {
        w.__syntheticCapture.delayNext = false;
        await new Promise<void>((resolve) => {
          w.__syntheticCapture.releasePending = resolve;
        });
      }
      return stream;
    };
    const Recorder = window.MediaRecorder;
    if (typeof Recorder === "function")
      window.MediaRecorder = class extends Recorder {
        constructor(stream: MediaStream, options?: MediaRecorderOptions) {
          super(stream, options);
          w.__syntheticCapture.recorders.push(this);
        }
      };
  });
}
async function boot(browser: Browser) {
  const a = await launch(),
    b = await launch();
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  try {
    await observeCapture(pa);
    await a.call("setup", { name: "Synthetic Alice", password });
    await b.call("setup", { name: "Synthetic Bruno", password });
    const alice = (await a.call("state")).identity,
      bob = (await b.call("state")).identity;
    await a.call("contact", { contact: bob });
    await b.call("contact", { contact: alice });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(
      () => a.call("state"),
      (s) => s.peers.some((p: any) => p.connected),
    );
    await pa.goto(a.url + "/#token=" + a.token);
    await pb.goto(b.url + "/#token=" + b.token);
    await pa
      .getByRole("button", { name: "Nova conversa", exact: true })
      .click();
    await pa
      .getByRole("dialog")
      .getByRole("button", { name: /Synthetic Bruno/ })
      .click();
    await pa
      .getByLabel("Escrever mensagem")
      .fill("Conversa para testar multimédia sintético.");
    await pa.getByRole("button", { name: "Enviar mensagem" }).click();
    await pb
      .getByRole("button", { name: /Synthetic Alice.*Conversa para testar/ })
      .click();
    await expect(
      pa.getByRole("button", { name: "Gravar mensagem de voz", exact: true }),
    ).toBeVisible();
    return {
      a,
      b,
      pa,
      pb,
      async close() {
        await ca.close();
        await cb.close();
        await a.stop();
        await b.stop();
        rmSync(a.dir, { recursive: true, force: true });
        rmSync(b.dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await ca.close();
    await cb.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
    throw error;
  }
}
async function allTracksEnded(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__syntheticCapture.tracks.every(
          (track: MediaStreamTrack) => track.readyState === "ended",
        ),
      ),
    )
    .toBe(true);
}
function syntheticWav() {
  const sampleRate = 8000,
    samples = 2400,
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 4000),
      44 + i * 2,
    );
  return buffer;
}
async function generatedVisuals(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#214c3e";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#fff";
    ctx.fillRect(20, 12, 24, 40);
    const image = canvas.toDataURL("image/png").split(",")[1];
    const stream = canvas.captureStream(10),
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" }),
      chunks: Blob[] = [];
    const video = await new Promise<string>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () =>
        reject(new Error("Synthetic canvas recording failed"));
      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
      };
      recorder.start();
      setTimeout(() => {
        ctx.fillStyle = "#d2dcad";
        ctx.fillRect(5, 5, 14, 14);
      }, 150);
      setTimeout(() => recorder.stop(), 450);
    });
    return { image, video };
  });
}

test("synthetic image, audio, video and fake-microphone voice arrive at a real peer", async ({
  browser,
}, testInfo) => {
  const { a, b, pa, pb, close } = await boot(browser);
  try {
    const errors: string[] = [];
    pa.on("pageerror", (error) => errors.push(error.message));
    pb.on("pageerror", (error) => errors.push(error.message));
    const visual = await generatedVisuals(pa),
      wav = syntheticWav();
    await pa.locator("input[type=file]").setInputFiles([
      {
        name: "synthetic-map.png",
        mimeType: "image/png",
        buffer: Buffer.from(visual.image, "base64"),
      },
      { name: "synthetic-tone.wav", mimeType: "audio/wav", buffer: wav },
      {
        name: "synthetic-motion.webm",
        mimeType: "video/webm",
        buffer: Buffer.from(visual.video, "base64"),
      },
    ]);
    expect(
      await pa.evaluate(() => (window as any).__syntheticCapture.calls),
    ).toBe(0);
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect
      .poll(() =>
        pa.evaluate(() => ({
          calls: (window as any).__syntheticCapture.calls,
          error: (window as any).__syntheticCapture.lastError ?? null,
        })),
      )
      .toEqual({ calls: 1, error: null });
    await expect(
      pa.getByRole("button", { name: "Parar e anexar", exact: true }),
    ).toBeFocused();
    await expect(
      pa.getByLabel("Duração da gravação", { exact: true }),
    ).toContainText("00:01");
    const audit = await new AxeBuilder({ page: pa })
      .include(".voice-panel")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await pa.setViewportSize({ width: 390, height: 844 });
    await pa.screenshot({
      path: testInfo.outputPath("synthetic-voice-mobile.png"),
      fullPage: true,
    });
    const panel = await pa.locator(".voice-panel").boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
    await pa
      .getByRole("button", { name: "Parar e anexar", exact: true })
      .click();
    await expect(pa.locator(".voice-panel [role=status]")).toContainText(
      "Voz adicionada",
    );
    await allTracksEnded(pa);
    // Appending a local draft does not publish before the explicit Send action.
    expect(
      (await a.call("state")).objects.filter((o: any) => o.kind === "message")
        .length,
    ).toBe(1);
    await pa
      .getByLabel("Escrever mensagem")
      .fill("Quatro anexos sintéticos para teste.");
    await pa.getByRole("button", { name: "Enviar mensagem" }).click();
    const message = pb
      .locator(".message")
      .filter({ hasText: "Quatro anexos sintéticos para teste." });
    await expect(
      message.getByRole("img", { name: "synthetic-map.png" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        message
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(64);
    await expect
      .poll(() =>
        message
          .locator('audio[aria-label="synthetic-tone.wav"]')
          .evaluate((audio: HTMLAudioElement) => audio.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() =>
        message
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    await expect(message.locator("audio")).toHaveCount(2);
    await expect
      .poll(() =>
        message
          .locator('audio[aria-label^="voz-"]')
          .evaluate((audio: HTMLAudioElement) => audio.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    const received = (await b.call("state")).objects.find(
      (o: any) =>
        o.kind === "message" &&
        o.content.text === "Quatro anexos sintéticos para teste.",
    );
    const local = (await a.call("state")).objects.find(
      (o: any) =>
        o.kind === "message" &&
        o.content.text === "Quatro anexos sintéticos para teste.",
    );
    const receivedFull = await b.call("view", { id: received.id });
    const localFull = await a.call("view", { id: local.id });
    received.content = receivedFull.content;
    local.content = localFull.content;
    expect(received.content.attachments).toHaveLength(4);
    expect(received.content.attachments).toEqual(local.content.attachments);
    expect(received.content.attachments[0].data).toBe(visual.image);
    expect(received.content.attachments[1].data).toBe(wav.toString("base64"));
    expect(received.content.attachments[2].data).toBe(visual.video);
    const voice = received.content.attachments[3];
    expect(voice.mime).toMatch(/^audio\/(webm|ogg|mp4)$/);
    expect(Buffer.from(voice.data, "base64").length).toBeGreaterThan(0);
    expect(Buffer.from(voice.data, "base64").length).toBeLessThanOrEqual(
      2_000_000,
    );
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(
      pa.getByRole("button", { name: "Parar e anexar" }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "Cancelar gravação" }).click();
    await allTracksEnded(pa);
    await expect(pa.locator(".attachment-preview")).toHaveCount(0);
    await pa.setViewportSize({ width: 1440, height: 1000 });
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(
      pa.getByRole("button", { name: "Parar e anexar" }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "A praça", exact: true }).click();
    await allTracksEnded(pa);
    expect(errors).toEqual([]);
    writeFileSync(
      testInfo.outputPath("synthetic-media-evidence.json"),
      JSON.stringify(
        {
          input:
            "SYNTHETIC BROWSER INPUT — controlled getUserMedia stub returning generated Web Audio; real MediaRecorder encoding; generated canvas PNG/WebM and PCM WAV; no physical microphone/camera",
          nativeFakeMicrophone:
            "Separate attempt rejected NotSupportedError: Not supported; not claimed as passed",
          realPeerNodes: 2,
          attachmentTypes: received.content.attachments.map((x: any) => x.mime),
          voiceBytes: Buffer.from(voice.data, "base64").length,
          componentAxeViolations: audit.violations,
          cancellationAndUnmountTracksEnded: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
});

test("microphone denial and unsupported recording are explicit and do not add attachments", async ({
  browser,
}) => {
  const { pa, close } = await boot(browser);
  try {
    await pa.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException(
          "Synthetic permission denial",
          "NotAllowedError",
        );
      };
    });
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(pa.locator(".voice-error")).toContainText(
      "não foi autorizado",
    );
    await expect(pa.locator(".attachment-preview")).toHaveCount(0);
    await pa.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException(
          "Synthetic unsupported environment",
          "NotSupportedError",
        );
      };
    });
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(pa.locator(".voice-error")).toContainText(
      "não é suportada neste navegador ou ambiente",
    );
    await pa.addInitScript(() => {
      Object.defineProperty(window, "MediaRecorder", {
        value: undefined,
        configurable: true,
      });
    });
    await pa.reload();
    await pa.locator(".conversation").first().click();
    await expect(
      pa.getByRole("button", { name: "Gravar mensagem de voz", exact: true }),
    ).toBeDisabled();
    await expect(pa.locator(".voice-unavailable")).toContainText(
      "não permite gravar voz",
    );
  } finally {
    await close();
  }
});

test("late permission, recording error, byte cap and virtual duration cap release synthetic tracks", async ({
  browser,
}, testInfo) => {
  const { pa, close } = await boot(browser);
  try {
    await pa.evaluate(() => {
      (window as any).__syntheticCapture.delayNext = true;
    });
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect
      .poll(
        () =>
          pa.evaluate(() => ({
            release: typeof (window as any).__syntheticCapture.releasePending,
            error: (window as any).__syntheticCapture.lastError ?? null,
          })),
        { timeout: 5000 },
      )
      .toEqual({ release: "function", error: null });
    await pa.getByRole("button", { name: "Cancelar gravação" }).click();
    await pa.evaluate(() =>
      (window as any).__syntheticCapture.releasePending(),
    );
    await allTracksEnded(pa);
    await expect(pa.locator(".attachment-preview")).toHaveCount(0);
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(
      pa.getByRole("button", { name: "Parar e anexar" }),
    ).toBeVisible();
    await pa.evaluate(() =>
      (window as any).__syntheticCapture.recorders
        .at(-1)
        .dispatchEvent(new Event("error")),
    );
    await expect(pa.locator(".voice-error")).toContainText("A gravação falhou");
    await allTracksEnded(pa);
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(
      pa.getByRole("button", { name: "Parar e anexar" }),
    ).toBeVisible();
    await pa.evaluate(() => {
      const recorder = (window as any).__syntheticCapture.recorders.at(
        -1,
      ) as MediaRecorder;
      recorder.dispatchEvent(
        new BlobEvent("dataavailable", {
          data: new Blob([new Uint8Array(2_000_001)], {
            type: recorder.mimeType,
          }),
        }),
      );
    });
    await expect(pa.locator(".voice-error")).toContainText("excedeu o limite");
    await allTracksEnded(pa);
    await expect(pa.locator(".attachment-preview")).toHaveCount(0);
    await pa.clock.install();
    await pa
      .getByRole("button", { name: "Gravar mensagem de voz", exact: true })
      .click();
    await expect(
      pa.getByRole("button", { name: "Parar e anexar" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        pa.evaluate(
          () => (window as any).__syntheticCapture.recorders.at(-1).state,
        ),
      )
      .toBe("recording");
    // Virtual elapsed time tests the cap; this is not a two-minute hardware recording.
    await pa.clock.runFor(120_000);
    await expect(pa.locator(".voice-panel [role=status]")).toContainText(
      "Limite de duração atingido",
    );
    await allTracksEnded(pa);
    await expect(pa.locator(".attachment-preview")).toBeVisible();
    writeFileSync(
      testInfo.outputPath("synthetic-limits-evidence.json"),
      JSON.stringify(
        {
          input: "SYNTHETIC BROWSER INPUT",
          latePermissionCancellation: true,
          injectedRecorderError: true,
          injectedOversizeBlobBytes: 2_000_001,
          virtualDurationMilliseconds: 120_000,
          hardwareDurationTested: false,
          tracksEnded: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await close();
  }
});
