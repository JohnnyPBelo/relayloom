import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(repository, "dist", "desktop"),
  app = join(output, "app"),
  daemon = join(output, "daemon");
if (!existsSync(join(repository, "dist", "web", "index.html")))
  throw new Error("Build the web interface first: npm run build");
rmSync(output, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
mkdirSync(daemon, { recursive: true });
const manifest = JSON.parse(
  readFileSync(join(repository, "package.json"), "utf8"),
);
await build({
  entryPoints: [join(repository, "apps/desktop/main.ts")],
  outfile: join(app, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  legalComments: "external",
});
await build({
  entryPoints: [join(repository, "apps/desktop/daemon.ts")],
  outfile: join(daemon, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["serialport"],
  sourcemap: false,
  legalComments: "external",
});
cpSync(join(repository, "dist", "web"), join(daemon, "dist", "web"), {
  recursive: true,
});
cpSync(join(repository, "LICENSE"), join(app, "LICENSE"));
writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "relayloom-desktop",
      version: manifest.version,
      private: true,
      description: "Experimental encrypted peer-to-peer communication",
      author: "RelayLoom contributors",
      license: "MIT",
      main: "main.cjs",
    },
    null,
    2,
  ),
);

// Copy installed native/runtime dependencies with their exact nested resolution.
// This uses the existing lockfile installation and never downloads or runs install hooks.
const included = new Map();
function copyDependency(name, from, destinationParent, ancestry = new Set()) {
  const requireFrom = createRequire(join(from, "package.json"));
  let entry = requireFrom.resolve(name),
    source = dirname(entry),
    metadata;
  while (true) {
    const path = join(source, "package.json");
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed.name === name) {
        metadata = parsed;
        break;
      }
    }
    const parent = dirname(source);
    if (parent === source)
      throw new Error("Cannot locate installed package: " + name);
    source = parent;
  }
  if (ancestry.has(source)) return;
  const destination = join(
    destinationParent,
    "node_modules",
    ...name.split("/"),
  );
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      path === source ||
      !path
        .slice(source.length + 1)
        .split(/[\\/]/)
        .includes("node_modules"),
  });
  included.set(metadata.name + "@" + metadata.version, {
    name: metadata.name,
    version: metadata.version,
    license: metadata.license ?? "See package license",
  });
  const next = new Set(ancestry);
  next.add(source);
  for (const dependency of Object.keys(metadata.dependencies ?? {}))
    copyDependency(dependency, source, destination, next);
}
copyDependency("serialport", repository, daemon);
writeFileSync(
  join(daemon, "dependency-notices.json"),
  JSON.stringify(
    [...included.values()].sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ),
);
writeFileSync(
  join(output, "build.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      version: manifest.version,
      host: process.platform,
      arch: process.arch,
      daemonEntry: "apps/node/src/cli.ts",
      ui: "dist/web",
      dependencies: included.size,
      nativeRadioHardware: "not tested",
    },
    null,
    2,
  ),
);
console.log("Desktop app and existing local daemon staged in dist/desktop.");
