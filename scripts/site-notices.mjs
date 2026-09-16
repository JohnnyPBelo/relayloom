// Preserve notices for the actual installed Markdown dependency graph, without fetching code.
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const found = new Map();
function visit(path) {
  if (found.has(path)) return;
  const metadata = JSON.parse(
    readFileSync(join(root, path, "package.json"), "utf8"),
  );
  const files = readdirSync(join(root, path)).filter((f) =>
    /^licen[sc]e(?:\..*)?$/i.test(f),
  );
  if (!files.length) throw new Error("Missing license: " + path);
  const notices = files.map((f) => ({
    file: f,
    text: readFileSync(join(root, path, f), "utf8"),
  }));
  found.set(path, {
    name: metadata.name,
    version: metadata.version,
    license: metadata.license,
    integrity: lock.packages[path]?.integrity,
    notices,
  });
  for (const name of Object.keys({
    ...metadata.dependencies,
    ...metadata.peerDependencies,
  })) {
    let dir = join(root, path),
      candidate;
    while (dir.startsWith(root)) {
      const p = join(dir, "node_modules", name);
      if (existsSync(join(p, "package.json"))) {
        candidate = relative(root, p).split("\\").join("/");
        break;
      }
      if (dir === root) break;
      dir = dirname(dir);
    }
    if (candidate) visit(candidate);
    else if (!metadata.peerDependenciesMeta?.[name]?.optional)
      throw new Error("Missing dependency: " + name);
  }
}
visit("node_modules/react-markdown");
const entries = [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
const notice = entries
  .map(
    ([, v]) =>
      `${v.name} ${v.version} (${v.license})\n${v.notices.map((n) => n.text).join("\n")}`,
  )
  .join("\n\n----------------\n\n");
const output = join(root, "docs/licenses/site-studio");
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "NOTICE.txt"), notice + "\n");
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(
    entries.map(([path, { notices, ...v }]) => ({
      path,
      ...v,
      notices: notices.map((n) => ({
        file: n.file,
        sha256: createHash("sha256").update(n.text).digest("hex"),
      })),
    })),
    null,
    2,
  ) + "\n",
);
console.log(`${entries.length} dependency notices retained`);
