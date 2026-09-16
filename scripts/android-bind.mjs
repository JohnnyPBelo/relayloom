import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(root, '.cache/android');
const jdk = resolve(root, '.cache/toolchains/jdk17');
const sdk = resolve(cache, 'sdk');
const goHome = resolve(root, '.cache/toolchains/go1.26.8');
const go = resolve(goHome, 'bin/go');
const gobin = resolve(root, '.cache/go/bin');
const gomobile = resolve(gobin, 'gomobile');
const pinnedMobile = 'v0.0.0-20260908204917-8b95e45f8d3e';
const options = process.argv.slice(2);
if (options.length > 1 || options.some(value => !['--abi=x86_64', '--abi=arm64-v8a'].includes(value))) throw new Error('Usage: node scripts/android-bind.mjs [--abi=x86_64|--abi=arm64-v8a]');
const abi = options[0]?.slice('--abi='.length) ?? 'x86_64';
const architecture = abi === 'arm64-v8a' ? 'arm64' : 'amd64';
const aarName = abi === 'arm64-v8a' ? 'relayloom-core-arm64.aar' : 'relayloom-core.aar';
const reportName = abi === 'arm64-v8a' ? 'aar-build-report-arm64-v8a.json' : 'aar-build-report.json';
const output = resolve(cache, 'artifacts', aarName);
const lock = resolve(cache, 'gomobile-bind.lock');
const env = {
  ...process.env,
  PATH: [resolve(goHome, 'bin'), gobin, resolve(jdk, 'bin'), process.env.PATH ?? ''].join(':'),
  JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_NDK_HOME: resolve(sdk, 'ndk/28.2.13676358'),
  ANDROID_USER_HOME: resolve(cache, 'user'), ANDROID_AVD_HOME: resolve(cache, 'avd'),
  XDG_CACHE_HOME: resolve(cache, 'xdg-cache'), XDG_CONFIG_HOME: resolve(cache, 'xdg-config'), XDG_DATA_HOME: resolve(cache, 'xdg-data'),
  GOTOOLCHAIN: 'local', GOROOT: goHome, GOPATH: resolve(root, '.cache/go'), GOCACHE: resolve(root, '.cache/go-build'), GOMODCACHE: resolve(root, '.cache/go-mod'), GOFLAGS: '-p=2 -tags=sqlite_omit_load_extension',
  JAVA_TOOL_OPTIONS: `-Djava.util.prefs.userRoot=${resolve(cache, 'java-prefs')} -Djava.util.prefs.systemRoot=${resolve(cache, 'java-system-prefs')} -Xmx1024m`,
  TMPDIR: resolve(cache, 'tmp'), TMP: resolve(cache, 'tmp'), TEMP: resolve(cache, 'tmp'),
};
mkdirSync(dirname(output), { recursive: true }); mkdirSync(env.TMPDIR, { recursive: true });
for (const path of [go, gomobile, resolve(gobin, 'gobind'), resolve(jdk, 'bin/javac'), resolve(sdk, 'platforms/android-36/android.jar')]) {
  if (!existsSync(path)) throw new Error(`Required pinned tool is not installed: ${path}`);
}
const space = spawnSync('python3', [resolve(root, 'scripts/android-toolchain.py'), 'status'], { cwd: root, encoding: 'utf8' });
if (space.status !== 0) throw new Error('Android resource budget check failed: ' + (space.error?.message ?? space.stderr.trim().slice(0, 4096)));
const before = JSON.parse(space.stdout);
if (before.freeBytes < 17 * 1024 ** 3 || before.androidAllocatedBytes > 23 * 1024 ** 3) throw new Error('Insufficient reserved capacity for one Android binding');
const versions = {};
for (const name of ['gomobile', 'gobind']) {
  const result = spawnSync(go, ['version', '-m', resolve(gobin, name)], { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.includes(`golang.org/x/mobile\t${pinnedMobile}`)) throw new Error(`${name} does not match the pinned x/mobile revision`);
  versions[name] = result.stdout.trim();
}
const descriptor = openSync(lock, 'wx', 0o600); writeFileSync(descriptor, String(process.pid));
try {
  const args = ['bind', '-tags=sqlite_omit_load_extension', '-target=android/' + architecture, '-androidapi=24', '-o', output, './mobile'];
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(gomobile, args, { cwd: resolve(root, 'native'), env, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', (code, signal) => resolveStatus({ code, signal }));
  });
  if (status.code !== 0) throw new Error(`gomobile bind failed: ${JSON.stringify(status)}`);
  const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
  const report = { kind: 'ANDROID_AAR_BUILD', status: 'BUILT_NOT_DEVICE_TESTED', target: 'android/' + architecture, abi, minApi: 24, go: 'go1.26.8', xMobile: pinnedMobile, aar: '.cache/android/artifacts/' + aarName, sha256, bytes: readFileSync(output).length, toolMetadata: versions, resourceBefore: before, command: ['gomobile', ...args.map(value => value.replace(root + '/', ''))] };
  writeFileSync(resolve(cache, reportName), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ kind: report.kind, status: report.status, aar: report.aar, sha256, bytes: report.bytes }, null, 2));
} finally { closeSync(descriptor); unlinkSync(lock); }
