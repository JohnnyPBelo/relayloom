import { sanitize, sanitizeEvents } from './android-evidence.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), cache = resolve(root, '.cache/android');
const sdk = resolve(cache, 'sdk'), adb = resolve(sdk, 'platform-tools/adb');
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: resolve(cache, 'user'), ANDROID_EMULATOR_HOME: resolve(cache, 'emulator-home'), ANDROID_AVD_HOME: resolve(cache, 'avd'), ADB_VENDOR_KEYS: resolve(cache, 'emulator-home/adbkey'), ADB_SERVER_PORT: '5047', ANDROID_ADB_SERVER_PORT: '5047', ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5047' };
const command = (...args) => {
  const result = spawnSync(adb, ['-P', '5047', '-s', 'emulator-5580', ...args], { env, cwd: root, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim()); return result.stdout;
};
const password = 'relayloom_android_test_passphrase', nonce = randomBytes(6).toString('hex');
const directory = mkdtempSync(resolve(cache, 'host-peer-'));
const peer = spawn(process.execPath, ['--import', 'tsx', 'apps/node/src/cli.ts', '--data', directory, '--http-port', '0', '--tcp-port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let instrument, forward;
try {
  const ready = await new Promise((resolveReady, reject) => {
    let output = '', error = ''; const timer = setTimeout(() => reject(new Error('Host fixture startup timeout: ' + error)), 15_000);
    peer.stderr.on('data', data => { error += data; }); peer.on('exit', code => { clearTimeout(timer); reject(new Error('Host fixture exited ' + code)); });
    peer.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timer); resolveReady(JSON.parse(output.split('\n')[0])); } });
  });
  const url = new URL(ready.url), token = new URLSearchParams(url.hash.slice(1)).get('token');
  const call = async (path, body) => {
    const response = await fetch(url.origin + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
  };
  await call('setup', { name: 'AndroidHostPeer-' + nonce, password }); const host = (await call('state')).identity;
  command('install', '-r', resolve(cache, 'artifacts/relayloom-android-instrumentation.apk'));
  const args = ['-P', '5047', '-s', 'emulator-5580', 'shell', 'am', 'instrument', '-w', '-e', 'hostCard', Buffer.from(JSON.stringify(host)).toString('base64'), '-e', 'hostTcpPort', String(ready.tcpPort), '-e', 'password', password, '-e', 'nonce', nonce, 'org.relayloom.android.smoketests/org.relayloom.android.smoketests.NativeSmoke'];
  instrument = spawn(adb, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = '', ended = false, exitCode;
  instrument.stdout.on('data', data => { output += data; }); instrument.stderr.on('data', data => { stderr += data; }); instrument.on('exit', code => { ended = true; exitCode = code; });
  let outgoing, replySent = false; const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && !ended) {
    const portEvent=output.match(/"phase":"native-port-ready","details":\{"tcpPort":(\d+)/);
    if (!forward && portEvent) { forward=command('forward','tcp:0','tcp:'+portEvent[1]).trim();await call('connect',{host:'127.0.0.1',port:Number(forward)}); }
    const state = await call('state');
    outgoing ??= state.objects.find(o => o.kind === 'message' && o.content.text === 'Android native encrypted packet ' + nonce);
    if (outgoing && !replySent) {
      if (outgoing.public || outgoing.author.id === host.id) throw new Error('Invalid Android private author/content boundary');
      await call('contact', { contact: outgoing.author });
      await call('publish', { content: { type: 'message', text: 'Host reply to actual Android core ' + nonce }, recipients: [outgoing.author.id] }); replySent = true;
    }
    await delay(250);
  }
  if (!ended) { instrument.kill('SIGTERM'); throw new Error('Android instrumentation timed out: ' + output + stderr); }
  const evidenceAt = process.argv.indexOf('--evidence-dir');
  const evidence = evidenceAt >= 0 ? resolve(root, process.argv[evidenceAt + 1]) : resolve(cache, 'evidence');
  if (!evidence.startsWith(cache + '/evidence')) throw new Error('Evidence must remain in project Android evidence directory'); mkdirSync(evidence, { recursive: true }); writeFileSync(resolve(evidence, 'instrumentation-output.txt'), sanitizeEvents(output + stderr));
  if (exitCode !== 0 || !output.includes('Android native instrumentation passed') || !replySent) throw new Error('Instrumentation or real peer exchange failed: ' + output + stderr);
  const device = JSON.parse(command('exec-out', 'run-as', 'org.relayloom.android', 'cat', 'files/android-instrumentation-report.json'));
  const image = spawnSync(adb, ['-P', '5047', '-s', 'emulator-5580', 'exec-out', 'run-as', 'org.relayloom.android', 'cat', 'files/android-instrumentation-messenger.png'], { env, cwd: root, timeout: 15_000 });
  if (image.status === 0) writeFileSync(resolve(evidence, 'android-peer-messenger.png'), image.stdout);
  const build = JSON.parse(readFileSync(resolve(cache, 'build-report.json')));
  const report = sanitize({ ...device, apkSha256: build.apkSha256, hostPeerRuntime: 'Node.js actual local TCP peer', outgoingAndroidAuthor: outgoing.author.id, hostDecryptedExactPayload: true, replySentToAndroid: true, nonce, adbServerPort: 5047, deviceSerial: 'emulator-5580', noHostControlCapabilityInReport: true, preliminaryBuild: !process.argv.includes('--final') });
  writeFileSync(resolve(evidence, 'android-native-peer-exchange.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally {
  if(forward) command('forward','--remove','tcp:'+forward);
  if (instrument && instrument.exitCode === null) { instrument.kill('SIGTERM'); command('shell', 'am', 'force-stop', 'org.relayloom.android'); }
  if (peer.exitCode === null) { peer.kill('SIGTERM'); await new Promise(resolveExit => { peer.once('exit', resolveExit); setTimeout(resolveExit, 5000); }); }
  if (peer.exitCode === null) peer.kill('SIGKILL');
  rmSync(directory, { recursive: true, force: true });
}
