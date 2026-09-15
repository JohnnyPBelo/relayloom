import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
export async function appHost(options: { cacheProbe?: boolean } = {}) {
  const publicBuild = process.env.RELAYLOOM_PUBLIC_BUILD === "1",
    prefix = publicBuild ? "/relayloom" : "",
    root = resolve(publicBuild ? "dist/public-web" : "dist/web"),
    requests: string[] = [];
  let unavailable = false;
  if (!existsSync(resolve(root, "browser/index.html")))
    throw new Error("Build the autonomous web entry first");
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    requests.push(path);
    if (unavailable) {
      res.writeHead(503);
      res.end("Fixture code distribution unavailable");
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (options.cacheProbe && path === prefix + "/__fixture__/cache.html") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      res.end(
        "<!doctype html><html lang='en'><title>Cache fixture</title><body>Independent cache owner</body></html>",
      );
      return;
    }
    if (path === prefix + "/") {
      res.writeHead(302, { Location: prefix + "/browser/index.html" });
      res.end();
      return;
    }
    if (!path.startsWith(prefix + "/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = resolve(
      root,
      "." + decodeURIComponent(path.slice(prefix.length)),
    );
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = readFileSync(file);
      res.writeHead(200, {
        "Content-Type":
          extname(file) === ".js"
            ? "text/javascript"
            : extname(file) === ".css"
              ? "text/css"
              : extname(file) === ".svg"
                ? "image/svg+xml"
                : extname(file) === ".webmanifest"
                  ? "application/manifest+json"
                  : "text/html",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}${prefix}`,
    requests,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
