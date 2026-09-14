import { defineConfig, type Plugin } from "vite";
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
  return {
    name: "relayloom-offline-assets",
    apply: "build",
    closeBundle() {
      const root = resolve("dist/web"),
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
        path: "/" + path,
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
    },
  };
}
export default defineConfig({
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
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve("apps/web/index.html"),
        browser: resolve("apps/web/browser/index.html"),
      },
    },
  },
  server: { host: "127.0.0.1" },
});
