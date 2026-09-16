import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const permitted = ['--simulator', '--device-unsigned', '--policy-test', '--bind-only', '--skip-bind'];
for (const argument of args) if (!permitted.includes(argument)) throw new Error('Supported options: ' + permitted.join(' '));
if (process.platform !== 'darwin') throw new Error('iOS requires a real macOS host with Xcode. No Apple build was attempted on this host.');
const cache = join(root, '.cache', 'ios'), gobin = join(cache, 'go', 'bin');
const xMobile = 'v0.0.0-20260908204917-8b95e45f8d3e';
for (const path of [cache, gobin, join(cache, 'tmp'), join(cache, 'go-build'), join(cache, 'go-mod'), join(cache, 'artifacts')]) mkdirSync(path, { recursive: true });
const env = { ...process.env, PATH: [gobin, process.env.PATH ?? ''].join(':'), GOTOOLCHAIN: 'local', GOPATH: join(cache, 'go'), GOBIN: gobin, GOCACHE: join(cache, 'go-build'), GOMODCACHE: join(cache, 'go-mod'), GOFLAGS: '-p=2', TMPDIR: join(cache, 'tmp'), TMP: join(cache, 'tmp'), TEMP: join(cache, 'tmp') };
function run(command, argv, cwd = root, capture = false) {
  const result = spawnSync(command, argv, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 25 * 60_000, maxBuffer: 12 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? 'no exit'}): ${result.error?.message ?? result.stderr ?? ''}`);
  return result.stdout?.trim() ?? '';
}
function reserve() { const s = statfsSync(root); const bytes = s.bavail * s.bsize; if (bytes < 17 * 1024 ** 3) throw new Error('iOS build requires at least 17 GiB free to preserve the 15 GiB reserve.'); return bytes; }
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function files(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(join(directory, item.name)) : [join(directory, item.name)]); }

const xcode = run('xcodebuild', ['-version'], root, true);
if (args.has('--policy-test')) {
  const binary = join(cache, 'policy-tests');
  run('xcrun', ['swiftc', '-swift-version', '5', '-o', binary, 'apps/ios/RelayLoom/OriginPolicy.swift', 'apps/ios/RelayLoom/RuntimeCoordinator.swift', 'apps/ios/RelayLoom/NativeText.swift', 'apps/ios/Tests/NativeTextTests.swift', 'apps/ios/Tests/PolicyTests.swift']);
  const output = run(binary, [], root, true);
  writeFileSync(join(cache, 'policy-report.json'), JSON.stringify({ kind: 'IOS_HOST_POLICY_TEST', xcode, output, iosDevice: 'not executed', webView: 'not executed' }, null, 2));
  console.log(output);
  if (![...args].some(arg => ['--simulator', '--device-unsigned', '--bind-only'].includes(arg))) process.exit(0);
}

reserve();
const goVersion = run('go', ['version'], root, true);
if (!/^go version go1\.26\.8 darwin\/(arm64|amd64)$/.test(goVersion)) throw new Error(`Use patched Go 1.26.8 on this macOS runner; observed ${goVersion}`);
const framework = join(cache, 'artifacts', 'Mobile.xcframework');
const simulatorArch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null;
if (!simulatorArch) throw new Error('Unsupported simulator host architecture');
if (!args.has('--skip-bind')) {
  for (const name of ['gomobile', 'gobind']) {
    const executable = join(gobin, name);
    const metadata = existsSync(executable) ? run('go', ['version', '-m', executable], root, true) : '';
    if (!metadata.includes(`golang.org/x/mobile\t${xMobile}`)) run('go', ['install', `golang.org/x/mobile/cmd/${name}@${xMobile}`], join(root, 'native'));
  }
  // gomobile internally builds target slices concurrently; GOFLAGS caps each
  // compiler to two packages and this script launches only this binding build.
  run(join(gobin, 'gomobile'), ['bind', '-target=ios/arm64,iossimulator/' + simulatorArch, '-iosversion=15.0', '-o', framework, './mobile'], join(root, 'native'));
}
if (!existsSync(join(framework, 'Info.plist'))) throw new Error('Generated Mobile.xcframework is missing');
const headers = files(framework).filter(path => path.endsWith('Mobile.objc.h'));
if (!headers.length || headers.some(path => !readFileSync(path, 'utf8').includes('MobileStart(') || !readFileSync(path, 'utf8').includes('MobileStop(') || !readFileSync(path, 'utf8').includes('MobileVersion('))) throw new Error('Generated Go binding does not expose the required Start/Stop/Version functions');
writeFileSync(join(cache, 'binding-report.json'), JSON.stringify({ kind: 'IOS_XCFRAMEWORK_BUILD', status: 'BUILT_NOT_DEVICE_TESTED', xcode, goVersion, xMobile, targets: ['ios/arm64', 'iossimulator/' + simulatorArch], framework: '.cache/ios/artifacts/Mobile.xcframework', files: files(framework).map(path => ({ path: path.slice(framework.length + 1), sha256: hash(path) })) }, null, 2));
if (args.has('--bind-only')) process.exit(0);

const web = join(root, 'dist', 'web');
if (!existsSync(join(web, 'index.html'))) throw new Error('Build the actual bundled web interface first: npm run build');
const staged = join(cache, 'stage', 'web'); rmSync(staged, { recursive: true, force: true }); cpSync(web, staged, { recursive: true });
cpSync(join(root, 'docs', 'licenses', 'websocket'), join(staged, 'notices', 'websocket'), { recursive: true });
const device = args.has('--device-unsigned');
const sdk = device ? 'iphoneos' : 'iphonesimulator';
const destination = device ? 'generic/platform=iOS' : 'generic/platform=iOS Simulator';
const derived = join(cache, 'DerivedData'); reserve();
run('xcodebuild', ['-project', 'apps/ios/RelayLoom.xcodeproj', '-scheme', 'RelayLoom', '-configuration', 'Debug', '-sdk', sdk, '-destination', destination, '-derivedDataPath', derived, '-jobs', '2', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'ARCHS=' + (device || process.arch === 'arm64' ? 'arm64' : 'x86_64'), 'build']);
const application = join(derived, 'Build', 'Products', 'Debug-' + sdk, 'RelayLoom.app');
if (!existsSync(join(application, 'RelayLoom')) || !existsSync(join(application, 'web', 'index.html'))) throw new Error('Native app or bundled local UI is missing from build output');
const output = join(cache, 'artifacts', device ? 'RelayLoom-device-unsigned.app' : 'RelayLoom-simulator.app');
rmSync(output, { recursive: true, force: true }); cpSync(application, output, { recursive: true });
const report = { kind: 'IOS_APP_BUILD', status: device ? 'UNSIGNED_DEVICE_BUILD_NOT_INSTALLABLE' : 'SIMULATOR_APP_BUILT_NOT_EXECUTED', xcode, goVersion, xMobile, sdk, destination, app: output.slice(root.length + 1), executableSha256: hash(join(output, 'RelayLoom')), bundledWebSha256: hash(join(output, 'web', 'index.html')), signing: 'disabled; no identities/profiles/accounts requested', physicalDevice: 'not executed', simulatorExecution: 'not executed' };
writeFileSync(join(cache, device ? 'device-build-report.json' : 'simulator-build-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
