import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function webSources() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (file) =>
        /^(apps\/web\/|packages\/|tests\/browser\/|scripts\/|docs\/licenses\/site-studio\/)/.test(
          file,
        ) ||
        /^(package.*\.json|.*config\.ts|tests\/conversation-id\.test\.ts)$/.test(
          file,
        ),
    );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((file) => [file, digest(readFileSync(file))]),
  );
}
export function webArtifacts() {
  const root = resolve("dist/public-web"),
    files = [];
  function visit(dir) {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const file = dir ? dir + "/" + name : name,
        stat = lstatSync(join(root, file));
      if (stat.isSymbolicLink())
        throw new Error("Public artifacts cannot be symlinks");
      if (stat.isDirectory()) {
        visit(file);
        continue;
      }
      if (
        !stat.isFile() ||
        !/^(index\.html|\.nojekyll|browser\/(index\.html|icon\.svg|manifest\.webmanifest|sw\.js|assets\.json|worker[-\w]+\.js)|assets\/site-studio-notices\.txt|assets\/[\w-]+\.(js|css|svg|png|woff2?|webmanifest))$/.test(
          file,
        )
      )
        throw new Error("Unexpected public artifact: " + file);
      files.push([
        file,
        { sha256: digest(readFileSync(join(root, file))), bytes: stat.size },
      ]);
    }
  }
  visit("");
  if (files.reduce((sum, [, file]) => sum + file.bytes, 0) > 16 * 1024 ** 2)
    throw new Error("Review public distribution size before publishing");
  return Object.fromEntries(files);
}
