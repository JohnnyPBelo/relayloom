import { sanitize, sanitizeEvents } from './android-evidence.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), cache = resolve(root, '.cache/android'), sdk = resolve(cache, 'sdk');
const evidenceAt = process.argv.indexOf('--evidence-dir');
const adb = resolve(sdk, 'platform-tools/adb'), evidence = evidenceAt >= 0 ? resolve(root, process.argv[evidenceAt + 1]) : resolve(cache, 'evidence');
if (!evidence.startsWith(cache + '/evidence')) throw new Error('Evidence must remain in project Android evidence directory');
mkdirSync(evidence, { recursive: true });
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: resolve(cache, 'user'), ANDROID_EMULATOR_HOME: resolve(cache, 'emulator-home'), ANDROID_AVD_HOME: resolve(cache, 'avd'), ADB_VENDOR_KEYS: resolve(cache, 'emulator-home/adbkey'), ADB_SERVER_PORT: '5047', ANDROID_ADB_SERVER_PORT: '5047', ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5047' };
function command(args, binary = false) {
  const value = spawnSync(adb, ['-P', '5047', '-s', 'emulator-5580', ...args], { env, cwd: root, encoding: binary ? undefined : 'utf8', timeout: 120_000 });
  if (value.status !== 0) throw new Error(String(value.stderr)); return value.stdout;
}
const nonce = randomBytes(6).toString('hex'), password = 'relayloom_android_test_passphrase';
const directories = [], peers = [];
async function startPeer(name, directory, tcp = 0) {
  directory ??= mkdtempSync(resolve(cache, 'relay-peer-')); if (!directories.includes(directory)) directories.push(directory);
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/node/src/cli.ts', '--data', directory, '--http-port', '0', '--tcp-port', String(tcp)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = await new Promise((resolveReady, reject) => {
    let output = '', errors = ''; const timer = setTimeout(() => reject(new Error('Peer start timed out: ' + errors)), 15_000);
    child.stderr.on('data', data => { errors += data; }); child.on('exit', code => { clearTimeout(timer); reject(new Error('Peer start failed: ' + code)); });
    child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timer); resolveReady(JSON.parse(output.split('\n')[0])); } });
  });
  const origin = new URL(ready.url), token = new URLSearchParams(origin.hash.slice(1)).get('token');
  const call = async (path, body) => {
    const response = await fetch(origin.origin + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
  };
  const current = await call('state'); await call(current.initialized ? 'unlock' : 'setup', current.initialized ? { password } : { name, password });
  const peer = { child, directory, ready, call, identity: (await call('state')).identity, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await new Promise((resolveExit, reject) => { const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Peer did not stop')); }, 8000); child.once('exit', () => { clearTimeout(timer); resolveExit(); }); }); } };
  peers.push(peer); return peer;
}
async function until(fn, predicate, label, timeout = 25_000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (predicate(value)) return value; await delay(150); } throw new Error('Timed out: ' + label); }
const require = (value, label) => { if (!value) throw new Error(label); };
let instrumentation, forwardPort, stdout = '', stderr = '', finished = false;
try {
  const a = await startPeer('AndroidPublisher-' + nonce), initialC = await startPeer('AndroidReader-' + nonce, undefined, -1); let c = initialC;
  const events = new Map(); let buffered = '';
  const args = ['-P', '5047', '-s', 'emulator-5580', 'shell', 'am', 'instrument', '-w', '-e', 'mode', 'relay', '-e', 'hostCard', Buffer.from(JSON.stringify(a.identity)).toString('base64'), '-e', 'readerCard', Buffer.from(JSON.stringify(c.identity)).toString('base64'), '-e', 'hostTcpPort', String(a.ready.tcpPort), '-e', 'password', password, '-e', 'nonce', nonce, 'org.relayloom.android.smoketests/org.relayloom.android.smoketests.NativeSmoke'];
  command(['install', '-r', resolve(cache, 'artifacts/relayloom-android-instrumentation.apk')]);
  instrumentation = spawn(adb, args, { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  instrumentation.stdout.on('data', data => { stdout += data; buffered += data; const lines = buffered.split('\n'); buffered = lines.pop(); for (const line of lines) if (line.startsWith('INSTRUMENTATION_STATUS: event=')) { const event = JSON.parse(line.slice('INSTRUMENTATION_STATUS: event='.length)); events.set(event.phase, event.details); } });
  instrumentation.stderr.on('data', data => { stderr += data; }); instrumentation.on('exit', () => { finished = true; });
  const phase = name => until(async () => { if (finished && !events.has(name)) throw new Error('Instrumentation ended before ' + name + ': ' + stdout + stderr); return events.get(name); }, value => value !== undefined, name, 45_000);
  const paused = await phase('relay-paused'), android = paused.identity;
  await a.call('contact', { contact: android }); await a.call('contact', { contact: c.identity }); await c.call('contact', { contact: android }); await c.call('contact', { contact: a.identity });
  // Only the Android peer transport is forwarded. Its authenticated control API is not forwarded.
  forwardPort = command(['forward', 'tcp:0', 'tcp:' + paused.tcpPort]).trim(); require(/^\d+$/.test(forwardPort), 'Expected isolated transport forward port');
  await a.call('connect', { host: '127.0.0.1', port: Number(forwardPort) });
  await c.call('connect', { host: '127.0.0.1', port: Number(forwardPort) });
  const cTopology = await until(() => c.call('state'), state => state.peers.filter(p => p.connected).length === 1, 'C only link to Android');
  const aTopology = await until(() => a.call('state'), state => state.peers.filter(p => p.connected).length === 1, 'A only link to Android');
  require(cTopology.tcpPort === -1, 'C must have no transport listener'); require(cTopology.peers[0].address === '127.0.0.1:' + forwardPort, 'C must connect only to Android transport');
  const negative = await a.call('publish', { content: { type: 'message', text: 'paused-relay-control ' + nonce }, recipients: [android.id, c.identity.id] });
  await phase('negative-received-at-B'); const start = Date.now();
  while (Date.now() - start < 4000) { require(!(await c.call('state')).objects.some(o => o.id === negative.id), 'Paused Android relayed the negative-control packet'); await delay(200); }
  await phase('relay-healed');
  const bytes = Buffer.from('Encrypted multi-hop Android attachment ' + nonce + '\n' + 'relayloom\n'.repeat(1200));
  const positive = await a.call('publish', { content: { type: 'message', text: 'relay-attachment-positive ' + nonce, attachments: [{ name: 'android-relay-proof.txt', mime: 'text/plain', data: bytes.toString('base64') }] }, recipients: [android.id, c.identity.id] });
  const received = await until(() => c.call('state'), state => state.objects.some(o => o.id === positive.id), 'A to Android to C encrypted object');
  const full = await c.call('view', { id: positive.id }); require(full.content.attachments[0].data === bytes.toString('base64'), 'Multi-hop attachment bytes changed'); require(full.author.id === a.identity.id && !full.public, 'Original author/private ACL changed');
  await phase('positive-received-at-B');
  await c.stop();
  const post = await a.call('publish', { content: { type: 'post', text: 'publisher-offline-seed ' + nonce }, recipients: 'public' });
  const site = await a.call('publish', { content: { type: 'site', theme: 'sand', blocks: [{ id: 'hero', type: 'hero', title: 'Native offline page ' + nonce, body: 'Published by A, retained and served by actual Android B.' }] }, recipients: 'public' });
  const cached = await phase('seed-cached-at-B'); require(cached.postId === post.id && cached.siteId === site.id, 'Android cached unexpected author objects');
  await a.stop(); require(a.child.exitCode !== null, 'Original publisher A must be stopped');
  require(initialC.child.exitCode !== null, 'Reader C must have been stopped throughout fixture publication');
  require(!existsSync(resolve(initialC.directory, 'store/objects', post.id + '.json')) && !existsSync(resolve(initialC.directory, 'store/objects', site.id + '.json')), 'Stopped reader C already stores offline seed fixtures');
  c = await startPeer('unused-existing-name', initialC.directory, -1);
  // The persisted sole peer may reconnect immediately on startup. Verify prior absence on disk
  // while C is stopped, then avoid a duplicate connection if that automatic recovery has begun.
  const beforeSeed = await c.call('state');
  if (!beforeSeed.peers.some(p => p.connected)) await c.call('connect', { host: '127.0.0.1', port: Number(forwardPort) });
  await until(() => c.call('state'), state => state.objects.some(o => o.id === post.id) && state.objects.some(o => o.id === site.id), 'Android seeds previously unseen post and site after A stops', 40_000);
  const seededPost = await c.call('view', { id: post.id }), seededSite = await c.call('view', { id: site.id });
  require(seededPost.author.id === a.identity.id && seededPost.content.text === post.content.text, 'Seeder became author or changed post'); require(seededSite.author.id === a.identity.id && seededSite.content.blocks[0].title === site.content.blocks[0].title, 'Seeded site changed');
  await c.call('publish', { content: { type: 'message', text: 'publisher-stopped-reader-seeded ' + nonce }, recipients: [android.id] });
  await phase('author-offline-site-rendered'); await until(async () => finished, Boolean, 'Instrumentation completed', 10_000);
  require(stdout.includes('Android relay instrumentation passed'), 'Relay instrumentation did not pass');
  const device = JSON.parse(command(['exec-out', 'run-as', 'org.relayloom.android', 'cat', 'files/android-relay-report.json']));
  const report = sanitize({ ...device, apkSha256: JSON.parse(readFileSync(resolve(cache, 'build-report.json'))).apkSha256, preliminaryBuild: !process.argv.includes('--final'), topology: { aConnectedPeers: aTopology.peers.length, cConnectedPeers: cTopology.peers.length, cTransportListener: -1, onlyAdbForward: 'Android TCP transport', noDirectACLink: true }, pausedNegativeWindowMs: Date.now() - start >= 4000 ? 4000 : 0, negativeDeliveredToCWhilePaused: false, healedPositiveObjectId: positive.id, attachmentBytes: bytes.length, attachmentSha256: createHash('sha256').update(bytes).digest('hex'), exactAttachmentBytesAtC: true, originalPublisherStopped: true, readerDidNotPreviouslyHavePostOrSite: true, seededPostId: post.id, seededSiteId: site.id, authorSignatureIdentityPreserved: true, deviceSerial: 'emulator-5580', adbServerPort: 5047 });
  writeFileSync(resolve(evidence, 'android-multihop-seed.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(evidence, 'android-offline-site.png'), command(['exec-out', 'run-as', 'org.relayloom.android', 'cat', 'files/android-offline-site.png'], true)); console.log(JSON.stringify(report, null, 2));
  writeFileSync(resolve(evidence, 'android-offline-site-webview.png'), command(['exec-out', 'run-as', 'org.relayloom.android', 'cat', 'files/android-offline-site-webview.png'], true));
} finally {
  writeFileSync(resolve(evidence, 'relay-instrumentation-output.txt'), sanitizeEvents(stdout + stderr));
  if (instrumentation && instrumentation.exitCode === null) { instrumentation.kill('SIGTERM'); command(['shell', 'am', 'force-stop', 'org.relayloom.android']); }
  for (const peer of peers) await peer.stop().catch(() => {});
  if (forwardPort) command(['forward', '--remove', 'tcp:' + forwardPort]);
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
}
