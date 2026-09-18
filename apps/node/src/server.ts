import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { LoomNode } from "./node.js";
import { constantEqual } from "../../../packages/core/src/index.js";

export async function serve(
  node: LoomNode,
  port = 0,
  token = randomBytes(32).toString("hex"),
  staticDir = resolve("dist/web"),
) {
  let origin = "";
  const rate = new Map<string, { n: number; start: number }>();
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      const json = (status: number, body: unknown) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(body));
      };
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return json(403, { error: "Origem não autorizada" });
      let url: URL;
      try {
        url = new URL(req.url ?? "/", origin);
      } catch {
        return json(400, { error: "Endereço inválido" });
      }
      if (url.pathname.startsWith("/api/")) {
        if (
          !constantEqual(
            req.headers.authorization?.replace(/^Bearer /, "") ?? "",
            token,
          )
        )
          return json(401, {
            error:
              "Sessão local inválida. Abra o endereço de arranque deste nó.",
          });
        const key = req.socket.remoteAddress ?? "local",
          limit = rate.get(key) ?? { n: 0, start: Date.now() };
        if (Date.now() - limit.start > 1000) {
          limit.n = 0;
          limit.start = Date.now();
        }
        limit.n++;
        rate.set(key, limit);
        if (limit.n > 60)
          return json(429, { error: "Demasiados pedidos; tente novamente" });
        try {
          if (req.method === "GET" && url.pathname === "/api/ui-preferences")
            return json(200, node.loadUIPreferences());
          if (req.method === "GET" && url.pathname === "/api/state")
            return json(200, node.state());
          if (req.method !== "POST")
            return json(405, { error: "Método inválido" });
          if (req.headers["content-type"] !== "application/json")
            return json(415, { error: "Apenas JSON" });
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const data of req) {
            size += data.length;
            if (size > 6 * 1024 * 1024) {
              json(413, { error: "Pedido demasiado grande" });
              req.destroy();
              return;
            }
            chunks.push(data);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          switch (url.pathname) {
            case "/api/ui-preferences":
              return json(200, node.updateUIPreferences(body));
            case "/api/setup":
              return json(
                200,
                node.setup(body.name, body.password, body.recovery),
              );
            case "/api/unlock":
              return json(200, node.unlock(body.password));
            case "/api/lock":
              node.lock();
              return json(200, { ok: true });
            case "/api/export":
              return json(200, { vault: node.export(body.password) });
            case "/api/contact":
              node.addContact(body.contact);
              break;
            case "/api/connect":
              node.connect(body.host, body.port);
              break;
            case "/api/web-peer":
              return json(200, await node.inviteWeb(body.origin));
            case "/api/web-peer-stop":
              await node.stopWebPeer();
              return json(200, { ok: true });
            case "/api/serial":
              node.connectSerial(body.path, body.baud ?? 115200);
              break;
            case "/api/reticulum-connect":
              node.connectReticulum(body.destination);
              return json(200, { ok: true });
            case "/api/site-draft-load":
              return json(200, node.loadDraft());
            case "/api/resource-command":
              return json(200, node.resourceCommand(body));
            case "/api/site-command":
              return json(200, node.siteCommand(body));
            case "/api/site-draft":
              node.saveDraft(
                body.blocks,
                body.theme,
                body.site,
                body.attachments,
                body.editing,
              );
              break;
            case "/api/collection":
              return json(200, node.collection(body));
            case "/api/group-command":
              return json(200, node.groupCommand(body));
            case "/api/retrieve":
              return json(200, node.retrieve(body.id));
            case "/api/history":
              return json(200, node.history(body.before));
            case "/api/attachment":
              return json(200, node.attachment(body.id, body.index));
            case "/api/publish":
              return json(
                200,
                node.publish(body.content, body.recipients, body.ttlMs),
              );
            case "/api/send":
              return json(
                200,
                node.send(
                  body.operationId,
                  body.content,
                  body.recipients,
                  body.ttlMs,
                ),
              );
            case "/api/outbox-retry":
              return json(200, node.retryOutbox(body.operationId));
            case "/api/action":
              node.localAction(
                body.action,
                body.target,
                body.value,
                body.reason,
              );
              break;
            case "/api/settings":
              node.settings(body);
              break;
            case "/api/view":
              return json(200, node.view(body.id));
            default:
              return json(404, { error: "Operação desconhecida" });
          }
          return json(200, { ok: true });
        } catch (error) {
          return json(400, {
            error: error instanceof Error ? error.message : "Pedido inválido",
          });
        }
      }
      if (req.method !== "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      let requested: string;
      try {
        requested = resolve(staticDir, "." + decodeURIComponent(url.pathname));
      } catch {
        return json(400, { error: "Endereço inválido" });
      }
      const file =
        requested.startsWith(resolve(staticDir) + "/") &&
        existsSync(requested) &&
        extname(requested)
          ? requested
          : join(staticDir, "index.html");
      if (!existsSync(file)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Compile a interface com npm run build.");
        return;
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(readFileSync(file));
    },
  );
  server.maxHeadersCount = 40;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const actualPort = (server.address() as { port: number }).port;
  origin = `http://127.0.0.1:${actualPort}`;
  return {
    server,
    token,
    url: origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
