// Host-only runner/fixture checks. These do not run Swift, Xcode, WebKit or iOS.
import test from 'node:test';
import { fork } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { startupBeforePhoto, sanitize, selectSimulator, requestedSimulatorVersion, validateOwnedContainer, assertTestSummary, verifySyntheticContainer, removeMatchingRunRecord, requireInactiveCleanupOwner, stopOwnedProcessGroup, stopOwnedAfterFailure, annotatePhotoFailure, recordPeerDiagnostics, recordUIPhases, needsPhotoDiagnostics } from '../../../scripts/ios-simulator.mjs';

test('bounded UI phase diagnostics preserve failed status, reject arbitrary text and select only the incomplete photo stage', () => {
  const report = { status: 'FAILED', error: 'Owned command failed: execute-ui-test', photoAttachmentRequested: true };
  recordUIPhases(report, 'a'.repeat(4000) + '\nIOS_SIMULATOR_PHASE private-message-saved\nIOS_SIMULATOR_PHASE photo-picker-requested\n');
  recordUIPhases(report, 'IOS_SIMULATOR_PHASE photo-picker-requested\nIOS_SIMULATOR_PHASE secret-form-value\n');
  assert.deepEqual(report.uiPhases, ['private-message-saved', 'photo-picker-requested']);
  assert.equal(report.lastUIPhase, 'photo-picker-requested');
  assert.equal(needsPhotoDiagnostics(report), true);
  assert.equal(report.status, 'FAILED');
  assert.equal(report.error, 'Owned command failed: execute-ui-test');
  recordUIPhases(report, 'IOS_SIMULATOR_PHASE photo-picker-ready\nIOS_SIMULATOR_PHASE photo-attachment-saved\nIOS_SIMULATOR_PHASE completed\n');
  assert.equal(needsPhotoDiagnostics(report), false);
  assert.equal(report.status, 'FAILED', 'diagnostic completion cannot grant a test pass');
  assert.equal(needsPhotoDiagnostics({ error: 'Owned command failed: seed-synthetic-photo' }), true);
  assert.equal(needsPhotoDiagnostics({ error: 'execute-ui-test', photoAttachmentRequested: true, uiPhases: ['identity-created'] }), false);
  assert.equal(needsPhotoDiagnostics({ error: 'execute-ui-test', photoAttachmentRequested: false, uiPhases: ['photo-picker-requested'] }), false);
});

test('select only compatible installed iOS runtimes, never unavailable or other platforms', () => {
  const runtime = (identifier, version, available) => ({ identifier: 'com.apple.CoreSimulator.SimRuntime.' + identifier, version, isAvailable: available });
  const selected = selectSimulator({ runtimes: [runtime('iOS-28-0', '28.0', false), runtime('visionOS-30-0', '30.0', true), runtime('iOS-26-6', '26.6', true), runtime('iOS-18-0', '18.0', true)] }, { devicetypes: [
    { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', name: 'iPhone 17', minRuntimeVersion: 26 * 65536, maxRuntimeVersion: 0xffffffff },
    { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-99', name: 'iPhone 99', minRuntimeVersion: 99 * 65536 },
    { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro', name: 'iPad Pro' },
  ] });
  assert.equal(selected.runtime.version, '26.6'); assert.equal(selected.deviceType.name, 'iPhone 17');
  assert.throws(() => selectSimulator({ runtimes: [runtime('iOS-28-0', '28.0', false)] }, { devicetypes: [] }), /already-installed/);
});

test('runtime advertised compatibility is honored instead of guessing a device', () => {
  const runtime = { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-6', version: '26.6', isAvailable: true, supportedDeviceTypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16' }] };
  const types = { devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', name: 'iPhone 17' }, { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16', name: 'iPhone 16' }] };
  assert.equal(selectSimulator({ runtimes: [runtime] }, types).deviceType.name, 'iPhone 16');
  assert.throws(() => selectSimulator({ runtimes: [{ ...runtime, supportedDeviceTypes: [] }] }, types));
});

test('logs remove launch capabilities, authorization headers and standalone secret tokens', () => {
  const token = 'ab'.repeat(32);
  const log = sanitize(`http://127.0.0.1:40000/#token=${token}\nAuthorization: Bearer ${token}\n{"token":"${token}"}\n${token}`);
  assert.equal(log.includes(token), false); assert.match(log, /redacted/);
  assert.equal(sanitize('IOS_SIMULATOR_PHASE identity-created'), 'IOS_SIMULATOR_PHASE identity-created');
});

test('container reads are limited to the created simulator application container', () => {
  const device = randomUUID(), application = randomUUID();
  const path = `/Users/runner/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Data/Application/${application}`;
  assert.equal(validateOwnedContainer(path, device), path);
  for (const invalid of ['/Users/owner/Documents', path + '/Library', path.replace(device, randomUUID()), 'relative/' + path, path.replace('/Application/', '/Shared/')]) assert.throws(() => validateOwnedContainer(invalid, device));
});

test('empty, skipped or partially failed XCTest output cannot pass the execution gate', () => {
  assertTestSummary({ status: 'Passed', passedTests: 1, failedTests: 0, skippedTests: 0, totalTestCount: 1 });
  assertTestSummary({ result: 'Passed', passedTests: 1, failedTests: 0, skippedTests: 0, totalTestCount: 1 });
  assert.throws(() => assertTestSummary({ result: 'Failed', status: 'Passed', passedTests: 1, failedTests: 0 }));
  for (const summary of [{ status: 'Passed', passedTests: 0, failedTests: 0 }, { status: 'Skipped', passedTests: 1, failedTests: 0 }, { status: 'Passed', passedTests: 1, failedTests: 1 }, { status: 'Passed', passedTests: 1, failedTests: 0, skippedTests: 1 }, { status: 'Passed', passedTests: 2, failedTests: 0 }]) assert.throws(() => assertTestSummary(summary));
});

test('refusing concurrent cleanup preserves the active owner record and fixture namespace', t => {
  const cache = resolve('.cache/ios-runner-contracts'); mkdirSync(cache, { recursive: true });
  const temp = mkdtempSync(join(cache, 'ownership-')); t.after(() => rmSync(temp, { recursive: true, force: true }));
  const ownerRun = randomUUID(), cleanupRun = randomUUID();
  const owner = { pid: process.pid + 10000, runID: ownerRun, udid: randomUUID(), name: 'RelayLoom-CI-' + ownerRun };
  const path = join(temp, 'run-fixtures.json'); writeFileSync(path, JSON.stringify(owner));
  assert.throws(() => requireInactiveCleanupOwner(owner, () => true), /still running/);
  assert.equal(removeMatchingRunRecord(path, cleanupRun), false);
  assert.equal(JSON.parse(readFileSync(path)).runID, ownerRun);
  assert.equal(requireInactiveCleanupOwner(owner, () => false), owner);
  assert.equal(removeMatchingRunRecord(path, ownerRun), true);
});

test('owned group escalation continues when a TERM-resistant descendant outlives its leader', async () => {
  let running = true; const signals = [], waits = [];
  await stopOwnedProcessGroup(12345, { alive: () => running, signal: value => { signals.push(value); if (value === 'SIGKILL') running = false; }, wait: async ms => { waits.push(ms); } });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); assert.equal(waits.length, 40);
  await assert.rejects(stopOwnedProcessGroup(0), /Invalid owned/);
});

test('owned group supervision stops without KILL once the whole group disappears', async () => {
  let checks = 0; const signals = [];
  await stopOwnedProcessGroup(12345, { alive: () => checks++ < 3, signal: value => signals.push(value), wait: async () => {} });
  assert.deepEqual(signals, ['SIGTERM']);
});

test('photo failure diagnostics read only bounded logs from the recorded simulator', async () => {
  const runID = randomUUID(), udid = randomUUID(), owned = { runID, udid, name: 'RelayLoom-CI-' + runID };
  const report = { status: 'FAILED', error: 'Owned command timed out: seed-synthetic-photo' }, calls = [];
  await annotatePhotoFailure(report, owned, async (...args) => { calls.push(args); return { code: 0 }; });
  assert.equal(calls.length, 1);
  const [label, command, args, timeout, options] = calls[0];
  assert.equal(label, 'photo-fixture-diagnostics'); assert.equal(command, 'xcrun');
  assert.deepEqual(args.slice(0, 9), ['simctl', 'spawn', udid, 'log', 'show', '--last', '2m', '--style', 'compact']);
  assert.equal(timeout, 15000); assert.deepEqual(options, { allowFailure: true });
  assert.equal(report.photoDiagnostics.captured, true); assert.equal(report.status, 'FAILED');
  assert.equal(report.error, 'Owned command timed out: seed-synthetic-photo');
  await assert.rejects(annotatePhotoFailure(report, { ...owned, name: 'not-owned' }, async () => { throw new Error('must not execute'); }), /Invalid owned/);
});

test('diagnostic timeout preserves the primary photo failure and sanitizes its own error', async () => {
  const runID = randomUUID(), owned = { runID, udid: randomUUID(), name: 'RelayLoom-CI-' + runID };
  const original = 'Owned command timed out: seed-synthetic-photo', report = { status: 'FAILED', error: original };
  const secret = 'ab'.repeat(32);
  await annotatePhotoFailure(report, owned, async () => { throw new Error('diagnostic unavailable Bearer ' + secret); });
  assert.equal(report.error, original); assert.equal(report.status, 'FAILED');
  assert.equal(report.photoDiagnostics.captured, false); assert.equal(report.photoDiagnostics.error.includes(secret), false);
});

const core = await tsImport('../../../packages/core/src/index.ts', import.meta.url);
const local = await tsImport('../../node/src/local-state.ts', import.meta.url);
const protectedPrivate = await tsImport('../../node/src/protected-private.ts', import.meta.url);
const { ProfileOwnership } = await tsImport('../../../packages/profile/src/ownership.ts', import.meta.url);
function fixture(t, withPhoto = false) {
  const cache = resolve('.cache/ios-runner-contracts'); mkdirSync(cache, { recursive: true });
  const temp = mkdtempSync(join(cache, 'fixture-')); t.after(() => rmSync(temp, { recursive: true, force: true }));
  const device = randomUUID(), container = join(temp, 'Devices', device, 'data/Containers/Data/Application', randomUUID());
  const directory = join(container, 'Library/Application Support/RelayLoom/core'); mkdirSync(join(directory, 'store/objects'), { recursive: true });
  const sender = core.createIdentity('iOS Simulator Sender'), recipient = core.createIdentity('iOS Simulator Recipient');
  const fixtures = { senderName: sender.public.name, passphrase: 'public synthetic fixture passphrase', message: 'synthetic private message', post: 'synthetic public post', reply: 'synthetic peer reply', attachmentMessage: 'synthetic selected photo', photoAttachment: withPhoto };
  const conversation = 'dm:' + core.hash([sender.public.id, recipient.public.id].sort().join(':'));
  const members = [sender.public, recipient.public];
  const payload = text => ({ type: 'message', text, members, conversation });
  const message = core.createBundle(sender, 'message', payload(fixtures.message), [recipient.public]);
  const post = core.createBundle(sender, 'post', { type: 'post', text: fixtures.post }, 'public');
  const reply = core.createBundle(recipient, 'message', payload(fixtures.reply), [sender.public]);
  const bundles = [message, post, reply], outgoing = [message];
  const peer = { senderID: sender.public.id, recipientID: recipient.public.id, messages: [{ id: message.manifest.id }] };
  if (withPhoto) {
    const photo = readFileSync(resolve('apps/ios/Tests/Fixtures/synthetic-photo.png'));
    const image = core.createBundle(sender, 'message', { ...payload(fixtures.attachmentMessage), attachments: [{ name: 'synthetic-photo.png', mime: 'image/png', data: photo.toString('base64') }] }, [recipient.public]);
    bundles.push(image); outgoing.push(image); peer.messages.push({ id: image.manifest.id, attachmentBytes: photo.length, attachmentSha256: core.hash(photo) });
  }
  for (const bundle of bundles) writeFileSync(join(directory, 'store/objects', bundle.manifest.id + '.json'), core.canonical(bundle));
  writeFileSync(join(directory, 'identity.vault'), core.exportVault(sender, fixtures.passphrase));
  const outbox = {};
  for (const bundle of outgoing) {
    const operationId = randomUUID(), now = Date.now();
    outbox[operationId] = { operationId, fingerprint: core.hash(operationId), id: bundle.manifest.id, author: sender.public.id, conversation, preview: core.decryptBundle(bundle, sender).text, created: bundle.manifest.created, expires: bundle.manifest.expires, priority: 'normal', bytes: Buffer.byteLength(core.canonical(bundle)), phase: 'ready', attempts: 1, lastAttemptAt: now, nextAttemptAt: now + 2200, lastError: '', manualPin: false, confirmations: { [recipient.public.id]: { receivedAt: now } } };
  }
  local.writePrivateState(join(directory, 'private-state.json'), { mutations: {}, outbox }, sender);
  const lease = new ProfileOwnership(directory);
  try { protectedPrivate.openPrivateProfile(directory, sender).database.close(); } finally { lease.close(); }
  return { device, container, directory, fixtures, peer, message, sender };
}

test('host fixture verification authenticates encrypted vault/journal and signed private bundle', async t => {
  const f = fixture(t);
  const proof = await verifySyntheticContainer(f.container, f.device, f.fixtures, f.peer, core);
  assert.equal(proof.identityRecoveredFromEncryptedVault, true); assert.equal(proof.postRecovered, true); assert.equal(proof.nodeReplyRecovered, true); assert.equal(proof.signedBundlesVerified.length, 3);
  assert.equal('simulatorExecuted' in proof, false); // Host fixture is not Apple execution evidence.
});

test('host fixture rejects a mismatched real-peer identity and changed encrypted bytes', async t => {
  const f = fixture(t);
  await assert.rejects(verifySyntheticContainer(f.container, f.device, f.fixtures, { ...f.peer, senderID: '0'.repeat(64) }, core), /identity observed/);
  const path = join(f.directory, 'store/objects', f.message.manifest.id + '.json');
  const tampered = JSON.parse(readFileSync(path)); tampered.manifest.signature = 'A'.repeat(88); writeFileSync(path, JSON.stringify(tampered));
  await assert.rejects(verifySyntheticContainer(f.container, f.device, f.fixtures, f.peer, core));
});

test('host fixture compares exact attachment bytes across the encrypted store and peer proof', async t => {
  const f = fixture(t, true);
  const proof = await verifySyntheticContainer(f.container, f.device, f.fixtures, f.peer, core);
  assert.equal(proof.attachmentExactAcrossIOSAndNode, true);
  f.peer.messages[1].attachmentSha256 = '0'.repeat(64);
  await assert.rejects(verifySyntheticContainer(f.container, f.device, f.fixtures, f.peer, core), /differs from/);
});


test('host fixture refuses missing initialized SQLite even when valid legacy data remains', async t => {
  const f = fixture(t);
  rmSync(join(f.directory, 'profile-state.sqlite'));
  await assert.rejects(verifySyntheticContainer(f.container, f.device, f.fixtures, f.peer, core), /ausente/);
  assert.equal(readFileSync(join(f.directory, 'profile-binding.json'), 'utf8').includes('committed'), true);
});

test('host fixture rejects a tampered encrypted private row with an otherwise valid legacy copy', async t => {
  const f = fixture(t), path = join(f.directory, 'profile-state.sqlite');
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare('SELECT slot,payload FROM records LIMIT 1').get();
    const payload = Buffer.from(row.payload); payload[payload.length - 1] ^= 1;
    db.prepare('UPDATE records SET payload=? WHERE slot=?').run(payload, row.slot);
  } finally { db.close(); }
  const before = readFileSync(path);
  await assert.rejects(verifySyntheticContainer(f.container, f.device, f.fixtures, f.peer, core));
  assert.deepEqual(readFileSync(path), before);
});


test('an exact installed-runtime probe never falls back to another version or platform', () => {
  const phone = { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', name: 'iPhone 17' };
  const runtime = version => ({ identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-' + version.replaceAll('.', '-'), version, isAvailable: true, supportedDeviceTypes: [phone] });
  const runtimes = { runtimes: [runtime('26.5'), runtime('26.4.1')] }, types = { devicetypes: [phone] };
  assert.equal(selectSimulator(runtimes, types).runtime.version, '26.5');
  assert.equal(selectSimulator(runtimes, types, '26.4.1').runtime.version, '26.4.1');
  assert.throws(() => selectSimulator(runtimes, types, '26.2'), /already-installed/);
  assert.throws(() => selectSimulator({ runtimes: [{ ...runtime('26.4.1'), isAvailable: false }, runtime('26.5')] }, types, '26.4.1'), /already-installed/);
  assert.throws(() => selectSimulator(runtimes, types, '../26.4.1'), /Invalid/);
});

test('runtime option is explicit, bounded and unambiguous', () => {
  assert.equal(requestedSimulatorVersion([]), undefined);
  assert.equal(requestedSimulatorVersion(['--runtime=26.4.1']), '26.4.1');
  for (const argv of [['--runtime='], ['--runtime=26.4.1', '--runtime=26.5'], ['--runtime=../../private'], ['--runtime=26.4.1;command'], ['--runtime=26666']]) assert.throws(() => requestedSimulatorVersion(argv));
});


test('failed peer diagnostics stay bounded/redacted and never replace the primary error', t => {
  const cache = resolve('.cache/ios-runner-contracts'); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, 'peer-diagnostic-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = 'ab'.repeat(32), report = { error: 'Owned Node peer startup timed out' };
  recordPeerDiagnostics(report, dir, 'é'.repeat(80000) + '\nRELAYLOOM_PEER_PHASE engine-imported 40ms\nAuthorization: Bearer ' + token);
  const bytes = readFileSync(join(dir, 'peer-stderr.txt'));
  assert.ok(bytes.length <= 65536); assert.equal(bytes.includes(Buffer.from(token)), false); assert.match(bytes.toString(), /engine-imported/);
  assert.equal(report.peerDiagnostics.captured, true); assert.equal(report.error, 'Owned Node peer startup timed out');
  recordPeerDiagnostics(report, join(dir, 'absent'), token);
  assert.equal(report.peerDiagnostics.captured, false); assert.equal(report.error, 'Owned Node peer startup timed out');
});

test('real simulator peer bootstraps through private IPC and enforces its authenticated API', { timeout: 30000 }, async t => {
  const cache = resolve('.cache/ios/simulator/raw'); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, 'host-peer-contract-'));
  const child = fork(resolve('apps/ios/Tests/SimulatorPeer.mjs'), [join(dir, 'peer')], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-65536); });
  const ended = new Promise(resolveExit => child.once('close', resolveExit));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.kill('SIGTERM'); await ended; clearTimeout(force);
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Peer contract startup timeout: ' + sanitize(stderr))), 20000);
    child.once('message', value => { clearTimeout(timer); resolveReady(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Peer contract exited: ' + sanitize(stderr))); });
  });
  assert.equal(ready.kind, 'ready'); assert.equal(new URL(ready.origin).hostname, '127.0.0.1'); assert.ok(/^[a-f0-9]{64}$/.test(ready.token));
  const denied = await fetch(ready.origin + '/api/state', { signal: AbortSignal.timeout(5000) }); assert.equal(denied.status, 401); await denied.arrayBuffer();
  const allowed = await fetch(ready.origin + '/api/state', { headers: { Authorization: 'Bearer ' + ready.token }, signal: AbortSignal.timeout(5000) });
  assert.equal(allowed.status, 200); assert.equal((await allowed.json()).locked, true);
  assert.match(stderr, /RELAYLOOM_PEER_PHASE api-listening/); assert.equal(stderr.includes(ready.token), false);
});


test('startup XCTest must pass exactly once before photo import and cannot satisfy the functional gate', async () => {
  const calls = [], report = { simulatorExecuted: false, status: 'NOT_EXECUTED' };
  const tool = async (label, command, args, timeout) => {
    calls.push({ label, command, args, timeout });
    return { output: label === 'startup-xctest-summary' ? JSON.stringify({result:'Passed',passedTests:1,failedTests:0,skippedTests:0,totalTestCount:1}) : '' };
  };
  await startupBeforePhoto(tool, {common:['-destination','id=owned-device'],result:'owned-startup.xcresult',udid:'owned-device',photoPath:'synthetic.png'}, report);
  assert.deepEqual(calls.map(c=>c.label),['execute-startup-test','startup-xctest-summary','seed-synthetic-photo']);
  assert.ok(calls[0].args.includes('-only-testing:RelayLoomUITests/NativeSimulatorTests/testStartupBeforeMedia'));
  assert.ok(calls[0].args.includes('test-without-building'));
  assert.equal(calls[0].timeout,8*60_000);
  assert.deepEqual(calls[2].args,['simctl','addmedia','owned-device','synthetic.png']);
  assert.equal(report.appStartup.result,'Passed');
  assert.equal(report.simulatorExecuted,false);
  assert.equal(report.status,'NOT_EXECUTED');
});

test('startup command failure or empty/failed summary stops before photo import and retains the failure', async () => {
  for (const mode of ['command','empty','failed']) {
    const calls=[], report={simulatorExecuted:false};
    const original = new Error('startup failure');
    const tool=async label=>{ calls.push(label); if(mode==='command')throw original;
      return {output:JSON.stringify({result:mode==='empty'?'Passed':'Failed',passedTests:0,failedTests:mode==='failed'?1:0})}; };
    await assert.rejects(startupBeforePhoto(tool,{common:[],result:'owned.xcresult',udid:'owned',photoPath:'synthetic.png'},report),mode==='command'?error=>error===original:/exactly/);
    assert.equal(calls.includes('seed-synthetic-photo'),false);
    assert.equal(report.simulatorExecuted,false);
    assert.equal(report.appStartup,undefined);
  }
});

test('photo failure preserves a separately confirmed startup but does not pass the functional gate', async () => {
  const report={simulatorExecuted:false}, failure=new Error('photo fixture timeout');
  const tool=async label=>{if(label==='seed-synthetic-photo')throw failure;
    return {output:JSON.stringify({result:'Passed',passedTests:1,failedTests:0,skippedTests:0,totalTestCount:1})};};
  await assert.rejects(startupBeforePhoto(tool,{common:[],result:'owned.xcresult',udid:'owned',photoPath:'synthetic.png'},report),error=>error===failure);
  assert.equal(report.appStartup.result,'Passed');assert.equal(report.simulatorExecuted,false);
});


test('a denied stop preserves the original owned-command failure and records the denial separately', async () => {
  const original = new Error('Owned command timed out: install-owned-app');
  const denial = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
  const calls = [];
  const result = await stopOwnedAfterFailure(12345, original, async pid => { calls.push(pid); throw denial; });
  assert.deepEqual(calls, [12345]);
  assert.equal(result.failure, original);
  assert.equal(result.stopFailure, denial);
  assert.equal(result.failure.message, 'Owned command timed out: install-owned-app');
});

test('a successful stop cannot turn the preceding command failure into success', async () => {
  const original = new Error('Bounded tool output exceeded');
  const result = await stopOwnedAfterFailure(12345, original, async () => {});
  assert.equal(result.failure, original);
  assert.equal(result.stopFailure, undefined);
});
