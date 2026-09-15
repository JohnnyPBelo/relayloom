import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, join } from "node:path";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
function browserOffline(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "relayloom-offline-assets",
    apply: "build",
    configResolved(value) {
      config = value;
      if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value.base))
        throw new Error(
          "Use an absolute local base path, for example /relayloom/",
        );
    },
    closeBundle() {
      const root = resolve(config.root, config.build.outDir),
        browser = join(root, "browser");
      mkdirSync(browser, { recursive: true });
      for (const name of ["icon.svg", "manifest.webmanifest"])
        copyFileSync(resolve("apps/web/browser", name), join(browser, name));
      const paths = [
        "browser/index.html",
        "browser/icon.svg",
        "browser/manifest.webmanifest",
        ...readdirSync(browser)
          .filter((name) => /^worker.*\.js$/.test(name))
          .map((name) => "browser/" + name),
        ...readdirSync(join(root, "assets"))
          .filter((name) => /\.(js|css|woff2?|svg|png|webmanifest)$/.test(name))
          .map((name) => "assets/" + name),
      ].sort();
      const assets = paths.map((path) => ({
        path: config.base + path,
        sha256: createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex"),
      }));
      const template = readFileSync(
        resolve("apps/web/src/browser/service-worker.js"),
        "utf8",
      );
      const version = createHash("sha256")
        .update(JSON.stringify(assets) + template)
        .digest("hex");
      const source = template
        .replace("__RELAYLOOM_ASSETS__", JSON.stringify(assets))
        .replace("__RELAYLOOM_VERSION__", JSON.stringify(version));
      writeFileSync(join(browser, "sw.js"), source);
      writeFileSync(
        join(browser, "assets.json"),
        JSON.stringify({ version, assets }, null, 2),
      );
      if (config.mode === "public-web") {
        // The public root never loads the native daemon/control client.
        writeFileSync(
          join(root, "index.html"),
          `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><meta http-equiv="refresh" content="0;url=./browser/index.html"><title>RelayLoom</title></head><body><a href="./browser/index.html">Abrir RelayLoom</a></body></html>\n`,
        );
        writeFileSync(join(root, ".nojekyll"), "");
      }
    },
  };
}
export default defineConfig(({ mode }) => ({
  root: "apps/web",
  plugins: [react(), browserOffline()],
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "browser/worker-[hash].js",
        chunkFileNames: "browser/worker-chunk-[hash].js",
      },
    },
  },
  build: {
    outDir: mode === "public-web" ? "../../dist/public-web" : "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        ...(mode === "public-web"
          ? {}
          : { app: resolve("apps/web/index.html") }),
        browser: resolve("apps/web/browser/index.html"),
      },
    },
  },
  server: { host: "127.0.0.1" },
}));
