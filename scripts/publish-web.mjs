// Publish exactly the locally verified static artifacts, never the working tree.
// Default is a reviewable local plan. --publish explicitly performs the push
// and initial GitHub Pages setup for this repository only.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { webSources, webArtifacts, digest } from "./web-artifact.mjs";

if (process.argv.slice(2).some((arg) => arg !== "--publish"))
  throw new Error("Usage: node scripts/publish-web.mjs [--publish]");
const repository = "JohnnyPBelo/relayloom",
  branch = "codex/web-pages";
const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", ...options }).trim();
const origin = git(["remote", "get-url", "origin"]);
if (
  ![
    "https://github.com/JohnnyPBelo/relayloom.git",
    "https://github.com/JohnnyPBelo/relayloom",
    "git@github.com:JohnnyPBelo/relayloom.git",
  ].includes(origin)
)
  throw new Error("Unexpected repository origin");
const gate = JSON.parse(
  readFileSync(".cache/public-web/gate/report.json", "utf8"),
);
if (
  gate.status !== "PASS" ||
  !isDeepStrictEqual(gate.sources, webSources()) ||
  !isDeepStrictEqual(gate.artifacts, webArtifacts())
)
  throw new Error(
    "Run the public web gate against these exact sources and artifacts first",
  );
const commit = git(["rev-parse", "HEAD"]),
  artifacts = webArtifacts();
const plan = {
  repository,
  branch,
  sourceCommit: commit,
  verifiedArtifacts: artifacts,
  gateFinished: gate.finished,
  target: "https://johnnypbelo.github.io/relayloom/browser/index.html",
  status: "PREPARED",
};
mkdirSync(".cache/public-web", { recursive: true });
const save = () =>
  writeFileSync(
    ".cache/public-web/deployment.json",
    JSON.stringify(plan, null, 2) + "\n",
  );
save();
if (process.argv.includes("--publish")) {
  const index = resolve(".cache/public-web/publish-index-" + randomUUID());
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(["read-tree", "--empty"], { env });
    const entries = [];
    for (const file of Object.keys(artifacts)) {
      const hash = git(["hash-object", "-w", "--stdin"], {
        input: readFileSync("dist/public-web/" + file),
      });
      entries.push(`100644 ${hash}\t${file}\n`);
    }
    const release = {
      sourceCommit: commit,
      gateFinished: gate.finished,
      artifactManifestSha256: digest(JSON.stringify(artifacts)),
      experimental: true,
    };
    entries.push(
      `100644 ${git(["hash-object", "-w", "--stdin"], { input: JSON.stringify(release, null, 2) + "\n" })}\trelease.json\n`,
    );
    git(["update-index", "--index-info"], { env, input: entries.join("") });
    const tree = git(["write-tree"], { env });
    const remote = git(["ls-remote", "origin", "refs/heads/" + branch]);
    const parent = remote ? remote.split(/\s/)[0] : undefined;
    if (parent) git(["fetch", "origin", "refs/heads/" + branch]);
    const deploymentCommit = git([
      "commit-tree",
      tree,
      ...(parent ? ["-p", parent] : []),
      "-m",
      "Publish verified RelayLoom web from " + commit,
    ]);
    git(["push", "origin", deploymentCommit + ":refs/heads/" + branch]);
    plan.deploymentCommit = deploymentCommit;
    plan.status = "PUSHED";
    save();
    const gh = (args, options = {}) =>
      execFileSync("gh", args, { encoding: "utf8", ...options });
    let pages;
    try {
      pages = JSON.parse(gh(["api", `repos/${repository}/pages`]));
    } catch (error) {
      // Only absence permits initial setup. Auth/network errors are blockers.
      if (!String(error.stderr).includes("HTTP 404")) throw error;
      pages = JSON.parse(
        gh(
          [
            "api",
            "--method",
            "POST",
            `repos/${repository}/pages`,
            "--input",
            "-",
          ],
          {
            input: JSON.stringify({
              source: { branch, path: "/" },
              build_type: "legacy",
            }),
          },
        ),
      );
    }
    if (
      pages.source?.branch !== branch ||
      pages.source?.path !== "/" ||
      pages.build_type !== "legacy"
    )
      throw new Error("Existing Pages source differs; not replacing it");
    plan.pagesUrl = pages.html_url;
    plan.status = "DEPLOYMENT_REQUESTED";
    save();
  } catch (error) {
    plan.error = error.message;
    save();
    throw error;
  } finally {
    rmSync(index, { force: true });
  }
}
console.log(JSON.stringify(plan, null, 2));
