import { createServer } from "node:http";
import { build } from "esbuild";
export async function staticHarness() {
  const built = await build({
    entryPoints: ["tests/browser/harness.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    target: "es2022",
    format: "iife",
  });
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === "/engine.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(built.outputFiles[0].contents);
    } else if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="pt-PT"><title>Motor RelayLoom: teste real</title><script src="/engine.js"></script><body>Fixture de motor autónomo, sem API de daemon.</body></html>',
      );
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: "http://127.0.0.1:" + (server.address() as { port: number }).port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
