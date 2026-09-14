import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, createWriteStream, statfsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../rn');
const expected = JSON.parse(readFileSync(resolve(import.meta.dirname, 'reticulum-inputs.json')));
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (base !== expected.baseCommit) throw new Error('Candidate base changed');
const digest = name => createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
for (const [name, value] of Object.entries(expected.files)) if (digest(name) !== value) throw new Error(`Input changed: ${name}`);
const files = execFileSync('rg', ['--files', 'native', 'apps', 'packages', 'scripts', 'tests', 'adapters', 'docs/licenses/reticulum'], { cwd: root, encoding: 'utf8' }).trim().split('\n').concat(['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts']).sort();
const inputs = Object.fromEntries(files.map(name => [name, digest(name)]));
const report = { baseCommit: base, candidate: root, startedAt: new Date().toISOString(), status: 'RUNNING', inputs, checks: [] };
const save = () => writeFileSync(resolve(import.meta.dirname, 'reticulum-report.json'), JSON.stringify(report, null, 2) + '\n');
const unchanged = () => Object.entries(inputs).every(([name, value]) => digest(name) === value);
save();
async function run(name, args) {
  if (!unchanged()) throw new Error('Sources changed during gate');
  const disk = statfsSync(root);
  if (disk.bavail * disk.bsize < 15 * 1024 ** 3) throw new Error('Disk reserve below15GiB');
  const check = { name, command: process.execPath, args, cwd: root, startedAt: new Date().toISOString() };
  report.checks.push(check); save(); console.log(`START ${name}`);
  const log = createWriteStream(resolve(import.meta.dirname, `reticulum-final-${name}.log`));
  const start = performance.now();
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  await new Promise(accept => log.end(accept));
  Object.assign(check, { exit: code, elapsedMs: Math.round(performance.now() - start), finishedAt: new Date().toISOString() });
  save(); console.log(`END ${name}: ${code} (${check.elapsedMs}ms)`);
  if (code !== 0) throw new Error(`${name} failed; inspect before retrying`);
}
try {
  await run('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
  await run('web-build', ['node_modules/vite/bin/vite.js', 'build']);
  await run('native-build', ['scripts/native-build.mjs']);
  await run('reticulum', ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/reticulum/authorization.test.ts', 'tests/reticulum/heterogeneous.test.ts']);
  await run('node-all', ['--import', 'tsx', '--test', '--test-concurrency=1', ...files.filter(name => /^tests\/[^/]+\.test\.ts$/.test(name))]);
  await run('go-race', ['scripts/go.mjs', 'test', '-json', '-race', '-count=1', '-p=1', './core', './transport', './webpeer', './app', './groups', './groupstore', './groupauthority', './groupaccess', './groupcontrol', './groupnotice', './groupledger', './profilelock', './profilestate', './profilebinding', './profiledb', './sqlitedriver']);
  await run('interop-all', ['--import', 'tsx', '--test', '--test-concurrency=1', ...files.filter(name => /^tests\/native\/[^/]+\.test\.ts$/.test(name))]);
  await run('ui-desktop', ['scripts/verify-ui.mjs']);
  report.sourcesStable = unchanged();
  if (!report.sourcesStable) throw new Error('Final source comparison failed');
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.error = String(error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
}
