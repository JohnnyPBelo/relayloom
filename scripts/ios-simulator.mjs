import { spawn, fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, statfsSync, realpathSync, existsSync, rmSync, openSync, closeSync, readSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, '.cache/ios/simulator');
const bundleID = 'org.relayloom.ios';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reserveBytes = 15 * 1024 ** 3;
const maxLogBytes = 2 * 1024 ** 2;
const testName = 'NativeSimulatorTests/testNativeCoreUIAndRecovery';

export function sanitize(value) {
  return String(value).replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|capability)["']?\s*[:=]\s*["']?)[^\s"'&#<>]+/gi, '$1[redacted]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[redacted-64-hex]');
}
function version(value) {
  if (!/^\d+(?:\.\d+){0,2}$/.test(String(value))) return -1;
  const [major, minor = 0, patch = 0] = String(value).split('.').map(Number);
  return major * 65536 + minor * 256 + patch;
}
export function requestedSimulatorVersion(argv) {
  const values = argv.filter(arg => arg.startsWith('--runtime='));
  if (values.length > 1) throw new Error('Request exactly one installed iOS runtime');
  const value = values[0]?.slice('--runtime='.length);
  if (value !== undefined && !/^\d{1,2}(?:\.\d{1,2}){0,2}$/.test(value)) throw new Error('Invalid installed iOS runtime version');
  return value;
}
export function selectSimulator(runtimeInventory, typeInventory, requestedVersion) {
  if (requestedVersion !== undefined && (typeof requestedVersion !== 'string' || !/^\d{1,2}(?:\.\d{1,2}){0,2}$/.test(requestedVersion))) throw new Error('Invalid installed iOS runtime version');
  const runtimes = (runtimeInventory.runtimes ?? []).filter(r => r.isAvailable === true && /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-/.test(r.identifier) && version(r.version) >= version('15.0') && (requestedVersion === undefined || r.version === requestedVersion)).sort((a, b) => version(b.version) - version(a.version));
  for (const runtime of runtimes) {
    const phones = (typeInventory.devicetypes ?? []).filter(t => /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-/.test(t.identifier) &&
      (t.minRuntimeVersion === undefined || version(runtime.version) >= t.minRuntimeVersion) &&
      (t.maxRuntimeVersion === undefined || version(runtime.version) <= t.maxRuntimeVersion) &&
      (!Array.isArray(runtime.supportedDeviceTypes) || runtime.supportedDeviceTypes.some(d => d.identifier === t.identifier)))
      .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
    if (phones.length) return { runtime, deviceType: phones[0] };
  }
  throw new Error('No compatible already-installed iOS simulator runtime and iPhone device type. No runtime was downloaded.');
}
export function validateOwnedContainer(path, deviceID) {
  if (!uuid.test(deviceID) || !isAbsolute(path)) throw new Error('Invalid owned simulator container');
  const parts = path.split('/');
  const index = parts.findIndex(part => part.toLowerCase() === deviceID.toLowerCase());
  if (index < 1 || parts[index - 1] !== 'Devices' || parts.slice(index + 1, index + 5).join('/') !== 'data/Containers/Data/Application' || parts.length !== index + 6 || !uuid.test(parts[index + 5])) throw new Error('Container is outside the simulator created by this test');
  return path;
}
export function assertTestSummary(summary) {
  const result = summary.result ?? summary.status;
  if ((summary.result !== undefined && summary.status !== undefined && summary.result !== summary.status) || result !== 'Passed' || summary.passedTests !== 1 || summary.failedTests !== 0 || (summary.skippedTests ?? 0) !== 0 || (summary.totalTestCount ?? 1) !== 1) throw new Error('XCTest did not execute and pass exactly the required UI test');
  return result;
}
export function removeMatchingRunRecord(path, runID) {
  if (!uuid.test(runID) || !existsSync(path)) return false;
  const record = JSON.parse(boundedRead(path, 8192));
  if (record.runID !== runID) return false;
  rmSync(path); return true;
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export function requireInactiveCleanupOwner(owned, alive = processAlive) {
  if (!owned || !uuid.test(owned.runID) || !uuid.test(owned.udid) || owned.name !== 'RelayLoom-CI-' + owned.runID || !Number.isInteger(owned.pid) || owned.pid < 1) throw new Error('Invalid simulator cleanup ownership record');
  if (owned.pid !== process.pid && alive(owned.pid)) throw new Error('Recorded simulator gate is still running; refusing concurrent cleanup');
  return owned;
}
export async function stopOwnedProcessGroup(pid, controls = {}) {
  if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid owned process group');
  const alive = controls.alive ?? (() => processAlive(-pid));
  const signal = controls.signal ?? (value => { try { process.kill(-pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  const wait = controls.wait ?? delay;
  if (!alive()) return;
  signal('SIGTERM');
  for (let i = 0; i < 40; i++) { if (!alive()) return; await wait(100); }
  if (!alive()) return;
  signal('SIGKILL');
  for (let i = 0; i < 20; i++) { if (!alive()) return; await wait(100); }
  if (alive()) throw new Error('Owned process group did not stop after escalation');
}
export async function annotatePhotoFailure(report, owned, tool) {
  // This is the in-memory record returned by this gate's simctl create. Never
  // inspect the host's Photos library, another simulator, or change services.
  if (!owned || !uuid.test(owned.udid) || !uuid.test(owned.runID) || owned.name !== 'RelayLoom-CI-' + owned.runID) throw new Error('Invalid owned simulator diagnostics record');
  try {
    const result = await tool('photo-fixture-diagnostics', 'xcrun', [
      'simctl', 'spawn', owned.udid, 'log', 'show', '--last', '2m', '--style', 'compact',
      '--predicate', 'process == "photolibraryd" OR process == "assetsd" OR process == "mstreamd"',
    ], 15_000, { allowFailure: true });
    report.photoDiagnostics = { captured: result.code === 0 && !result.failure, exitCode: result.code,
      ...(result.failure ? { error: sanitize(result.failure.message) } : {}) };
  } catch (error) {
    // Diagnostics must not replace the original failed stage or skip cleanup.
    report.photoDiagnostics = { captured: false, error: sanitize(error.message) };
  }
}
function hashBuffer(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function recordPeerDiagnostics(report, directory, stderr) {
  try {
    const bytes = Buffer.from(sanitize(stderr)).subarray(-64 * 1024);
    writeFileSync(join(directory, 'peer-stderr.txt'), bytes, { mode: 0o600 });
    report.peerDiagnostics = { captured: true, bytes: bytes.length };
  } catch (error) {
    report.peerDiagnostics = { captured: false, error: sanitize(error.message) };
  }
}
function boundedRead(path, maximum) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maximum) throw new Error('Evidence input is not a bounded regular file');
  return readFileSync(path);
}
function hashFile(path, maximum = 512 * 1024 ** 2) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maximum) throw new Error('Artifact is not a bounded regular file');
  const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024), fd = openSync(path, 'r');
  try { for (;;) { const count = readSync(fd, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0, count)); } }
  finally { closeSync(fd); }
  return hash.digest('hex');
}
function regularFiles(directory, cap = 1000) {
  const result = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink in owned evidence directory');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) { result.push(target); if (result.length > cap) throw new Error('Evidence file count exceeded'); }
    }
  }
  walk(directory); return result.sort();
}
function writeJSON(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); }
function diskFree() { const stat = statfsSync(root); return stat.bavail * stat.bsize; }
function staticCheck() {
  const project = readFileSync(join(root, 'apps/ios/RelayLoom.xcodeproj/project.pbxproj'), 'utf8');
  const definitions = [...project.matchAll(/^\s*([A-F0-9]{24}) = \{/gm)].map(match => match[1]);
  const references = new Set(project.match(/\b[A-F0-9]{24}\b/g));
  if (new Set(definitions).size !== definitions.length || references.size !== definitions.length || definitions.some(id => !references.has(id))) throw new Error('Invalid Xcode project object references');
  const source = readFileSync(join(root, 'apps/ios/UITests/NativeSimulatorTests.swift'), 'utf8');
  const scheme = readFileSync(join(root, 'apps/ios/RelayLoom.xcodeproj/xcshareddata/xcschemes/RelayLoomSimulator.xcscheme'), 'utf8');
  if (!project.includes('com.apple.product-type.bundle.ui-testing') || !project.includes('run-fixtures.json') || !scheme.includes('parallelizeBuildables="NO"') || !scheme.includes('selectedDebuggerIdentifier=""') || !source.includes('testNativeCoreUIAndRecovery') || !source.includes('XCUIDevice.shared.press(.home)') || !source.includes('photoSelectedViaSystemPicker')) throw new Error('Simulator target, lifecycle or fixture contract is incomplete');
  if (/evaluateJavaScript|URLSession|RLStartCore|MobileStart|isInspectable\s*=\s*true/.test(source)) throw new Error('UI test bypasses the production interface');
  const host = readFileSync(join(root, 'apps/ios/RelayLoom/RelayViewController.swift'), 'utf8');
  if (!host.includes('web.isInspectable = false') || !host.includes('.nonPersistent()')) throw new Error('Production WebView isolation changed');
  return { kind: 'IOS_SIMULATOR_STATIC_CHECK', status: 'STATIC_ONLY_PASSED', projectObjects: definitions.length, swiftCompiled: false, simulatorExecuted: false, physicalDeviceExecuted: false };
}

export async function verifySyntheticContainer(container, deviceID, fixtures, peerEvidence, core) {
  validateOwnedContainer(realpathSync(container), deviceID);
  const directory = join(container, 'Library/Application Support/RelayLoom/core');
  const vaultBytes = boundedRead(join(directory, 'identity.vault'), 8192);
  const identity = core.importVault(vaultBytes.toString('utf8'), fixtures.passphrase);
  if (identity.public.name !== fixtures.senderName || identity.public.id !== peerEvidence.senderID) throw new Error('UI-created vault does not recover the identity observed by the real peer');
  const privatePath = join(directory, 'profile-state.sqlite');
  // Verification must never create a migration that the tested app did not do.
  const bindingBytes = boundedRead(join(directory, 'profile-binding.json'), 2048);
  if (JSON.parse(bindingBytes).body?.phase !== 'committed') throw new Error('Native profile migration was not committed');
  const { tsImport } = await import('tsx/esm/api');
  const { ProfileOwnership } = await tsImport('../packages/profile/src/ownership.ts', import.meta.url);
  const { openPrivateProfile } = await tsImport('../apps/node/src/protected-private.ts', import.meta.url);
  const lease = new ProfileOwnership(directory);
  let loaded;
  try { loaded = openPrivateProfile(directory, identity); }
  finally { try { loaded?.database.close(); } finally { lease.close(); } }
  const privateState = loaded.state;
  const privateBytes = boundedRead(privatePath, 96 * 1024 ** 2);
  if (privateBytes.includes(Buffer.from(fixtures.message)) || privateBytes.includes(Buffer.from(fixtures.attachmentMessage))) throw new Error('Private message leaked in the journal envelope');
  const objectsPath = join(directory, 'store/objects');
  const paths = regularFiles(objectsPath, 64);
  const verified = [], outgoing = new Map();
  let foundPost = false, foundReply = false;
  for (const path of paths) {
    if (!/^[a-f0-9]{64}\.json$/.test(basename(path))) throw new Error('Unexpected bundle path in the isolated test profile');
    const raw = boundedRead(path, 6 * 1024 ** 2), bundle = JSON.parse(raw);
    core.verifyBundle(bundle);
    const content = core.decryptBundle(bundle, identity);
    if (content.type === 'post' && content.text === fixtures.post && bundle.manifest.author.id === identity.public.id) foundPost = true;
    if (content.type === 'message' && content.text === fixtures.reply && bundle.manifest.author.id === peerEvidence.recipientID) foundReply = true;
    if (content.type === 'message' && [fixtures.message, fixtures.attachmentMessage].includes(content.text)) {
      const readers = bundle.manifest.keys.map(k => k.reader).sort();
      if (bundle.manifest.publicKey !== null || bundle.manifest.author.id !== identity.public.id || JSON.stringify(readers) !== JSON.stringify([identity.public.id, peerEvidence.recipientID].sort()) || raw.includes(Buffer.from(content.text))) throw new Error('Outgoing UI message is not privately encrypted to the exact synthetic readers');
      const observed = peerEvidence.messages.find(item => item.id === bundle.manifest.id);
      if (!observed) throw new Error('Stored iOS message was not verified by the real Node peer');
      if (content.text === fixtures.attachmentMessage) {
        if (!Array.isArray(content.attachments) || content.attachments.length !== 1) throw new Error('Selected photo did not survive native storage');
        const attachment = content.attachments[0], bytes = Buffer.from(attachment.data, 'base64');
        if (!/^image\//.test(attachment.mime) || bytes.length === 0 || bytes.length > 2 * 1024 ** 2 || hashBuffer(bytes) !== observed.attachmentSha256 || bytes.length !== observed.attachmentBytes) throw new Error('Node peer attachment differs from the encrypted iOS bundle');
      }
      outgoing.set(content.text, bundle.manifest.id);
    }
    verified.push({ id: bundle.manifest.id, kind: bundle.manifest.kind, bytes: raw.length, sha256: hashBuffer(raw) });
  }
  if (!foundPost || !foundReply || !outgoing.has(fixtures.message) || (fixtures.photoAttachment && !outgoing.has(fixtures.attachmentMessage))) throw new Error('Required UI-authored/replied content is absent after process recovery');
  const entries = Object.values(privateState.outbox ?? {});
  for (const id of outgoing.values()) {
    const record = entries.find(entry => entry.id === id);
    if (!record || record.phase !== 'ready' || !record.confirmations[peerEvidence.recipientID]?.receivedAt) throw new Error('Native encrypted outbox lacks the real recipient confirmation');
  }
  return { identityVaultSHA256: hashBuffer(vaultBytes), privateJournalSHA256: hashBuffer(privateBytes), privateBindingSHA256: hashBuffer(bindingBytes), privateJournalFormat: 'protected-sqlite-v1', identityRecoveredFromEncryptedVault: true, privateJournalAuthenticated: true, privateMessagePlaintextAbsentFromEnvelopes: true, nativeOutboxRecipientConfirmed: true, signedBundlesVerified: verified, postRecovered: foundPost, nodeReplyRecovered: foundReply, attachmentExactAcrossIOSAndNode: fixtures.photoAttachment ? true : 'not requested' };
}

async function main(argv) {
  const options = new Set(argv), requestedVersion = requestedSimulatorVersion(argv);
  for (const arg of options) if (!['--check', '--without-photo', '--cleanup-owned'].includes(arg) && !arg.startsWith('--runtime=')) throw new Error('Options: --check, --without-photo, --cleanup-owned, --runtime=VERSION');
  if (options.has('--check')) { console.log(JSON.stringify(staticCheck())); return; }
  if (process.platform !== 'darwin') throw new Error('Real simulator execution requires macOS with an installed Xcode runtime. This Linux/other host did not execute Swift, iOS or a simulator. Use --check for source checks only.');
  const xcodeArch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null;
  if (!xcodeArch) throw new Error('Unsupported Apple simulator host architecture');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const ownershipPath = join(base, 'owned-device.json'), lockPath = join(base, 'runner-lock.json'), cleanupLockPath = join(base, 'cleanup-lock.json');
  const cleanupOnly = options.has('--cleanup-owned');
  // A cleanup attempt gets its own evidence/raw namespace. Refusing an active
  // recorded process must never overwrite or remove that process's resources.
  const runID = randomUUID();
  const evidence = join(base, 'evidence', runID), raw = join(base, 'raw', runID);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  mkdirSync(raw, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 20 * 60_000;
  const context = { abort: null, tools: [], logBytes: 0, owned: null, peer: null, watchStop: false, watch: null };
  const report = { kind: 'IOS_REAL_SIMULATOR_GATE', runID, requestedRuntimeVersion: requestedVersion ?? 'newest-installed', status: 'NOT_EXECUTED', simulatorExecuted: false, physicalDeviceExecuted: false, photoAttachmentRequested: !options.has('--without-photo'), signing: 'disabled; no accounts, identities or profiles requested', webViewDebugging: false, extraAppControlPort: false, cleanup: {}, commands: context.tools };
  const stopSignal = signal => { context.abort = new Error('Simulator gate interrupted by ' + signal); };
  const onTerm = () => stopSignal('SIGTERM'), onInt = () => stopSignal('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);

  async function tool(label, command, args, timeout = 60_000, { cleanup = false, allowFailure = false, logOutput = true } = {}) {
    if (!cleanup && (context.abort || Date.now() > deadline || diskFree() < reserveBytes)) throw context.abort ?? new Error('Simulator timeout or 15 GiB disk reserve reached');
    const started = Date.now();
    const child = spawn(command, args, { cwd: root, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let size = 0, stdout = [], stderr = [], failure, groupStop, observation = '', finishAborted;
    const aborted = new Promise(resolveAbort => { finishAborted = resolveAbort; });
    const kill = reason => {
      if (failure) return; failure = reason;
      // Continue supervising the owned group after the leader exits. A child
      // which ignores TERM must not survive merely because xcodebuild closed.
      groupStop = stopOwnedProcessGroup(child.pid).catch(error => { failure = error; }).finally(() => {
        child.stdout.destroy(); child.stderr.destroy(); finishAborted(-1);
      });
    };
    const collect = target => data => {
      size += data.length;
      if (label === 'execute-ui-test') {
        observation = (observation + data.toString()).slice(-2048);
        if (observation.includes('IOS_SIMULATOR_PHASE identity-created')) report.simulatorExecuted = true;
      }
      if (size > maxLogBytes) kill(new Error('Bounded tool output exceeded')); else target.push(data);
    };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
    const guard = setInterval(() => {
      if (Date.now() - started > timeout) kill(new Error('Owned command timed out: ' + label));
      else if (!cleanup && (context.abort || Date.now() > deadline || diskFree() < reserveBytes)) kill(context.abort ?? new Error('Simulator timeout or 15 GiB disk reserve reached'));
    }, 1000);
    let drainTimer;
    const closed = new Promise(resolveExit => {
      child.on('error', error => { failure = error; resolveExit(-1); });
      child.on('close', resolveExit);
      child.on('exit', code => {
        // A detached descendant cannot hold this parent's pipe forever after
        // the command itself exits. Normal buffered output has time to drain.
        drainTimer = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); resolveExit(code); }, 1000);
      });
    });
    const code = await Promise.race([closed, aborted]);
    clearInterval(guard);
    clearTimeout(drainTimer);
    if (groupStop) await groupStop;
    const output = Buffer.concat(stdout).toString('utf8'), errors = Buffer.concat(stderr).toString('utf8');
    const sanitized = sanitize(output + errors);
    const record = { label, exitCode: code, elapsedMs: Date.now() - started };
    if (logOutput && context.logBytes + Buffer.byteLength(sanitized) <= 8 * 1024 ** 2) {
      const name = String(context.tools.length + 1).padStart(2, '0') + '-' + label + '.log';
      writeFileSync(join(evidence, name), sanitized, { mode: 0o600 }); context.logBytes += Buffer.byteLength(sanitized); record.log = name;
    }
    context.tools.push(record);
    if ((failure || code !== 0) && !allowFailure) throw failure ?? new Error('Owned command failed: ' + label + ' (see sanitized evidence)');
    return { output, code, failure };
  }
  async function cleanupDevice(owned) {
    if (!owned || !uuid.test(owned.udid) || !uuid.test(owned.runID) || owned.name !== 'RelayLoom-CI-' + owned.runID || !/^com\.apple\.CoreSimulator\.SimRuntime\.iOS-/.test(owned.runtime)) throw new Error('Invalid simulator ownership; refusing cleanup');
    const inventory = JSON.parse((await tool('cleanup-inventory', 'xcrun', ['simctl', 'list', 'devices', '--json'], 30_000, { cleanup: true, logOutput: false })).output);
    const device = Object.values(inventory.devices ?? {}).flat().find(d => d.udid.toLowerCase() === owned.udid.toLowerCase());
    if (!device) return { udid: owned.udid, absent: true, deleted: true, onlyCreatedDeviceTouched: true };
    if (device.name !== owned.name) throw new Error('Simulator name does not match the exact owned run; refusing cleanup');
    await tool('shutdown-owned', 'xcrun', ['simctl', 'shutdown', owned.udid], 30_000, { cleanup: true, allowFailure: true });
    await tool('delete-owned', 'xcrun', ['simctl', 'delete', owned.udid], 30_000, { cleanup: true });
    return { udid: owned.udid, deleted: true, onlyCreatedDeviceTouched: true };
  }
  let lockOwned = false, cleanupLockOwned = false, failure;
  try {
    if (cleanupOnly) {
      const lock = openSync(cleanupLockPath, 'wx', 0o600); writeFileSync(lock, JSON.stringify({ pid: process.pid, runID })); closeSync(lock); cleanupLockOwned = true;
      if (existsSync(lockPath)) {
        const active = JSON.parse(boundedRead(lockPath, 4096));
        if (!Number.isInteger(active.pid) || active.pid < 1 || processAlive(active.pid)) throw new Error('A simulator supervisor is active or ambiguous; refusing cleanup');
      }
      if (!existsSync(ownershipPath)) { report.status = 'NO_OWNED_SIMULATOR'; return; }
      const owned = requireInactiveCleanupOwner(JSON.parse(boundedRead(ownershipPath, 4096)));
      report.cleanup = { ...await cleanupDevice(owned), ownerRunID: owned.runID };
      removeMatchingRunRecord(ownershipPath, owned.runID);
      removeMatchingRunRecord(lockPath, owned.runID);
      removeMatchingRunRecord(join(base, 'run-fixtures.json'), owned.runID);
      rmSync(join(base, 'raw', owned.runID), { recursive: true, force: true });
      report.status = 'OWNED_SIMULATOR_CLEANED'; return;
    }
    staticCheck();
    if (existsSync(cleanupLockPath)) throw new Error('Simulator cleanup is active or has an unresolved lock; refusing a concurrent run');
    if (existsSync(ownershipPath)) throw new Error('An earlier owned simulator record remains; run --cleanup-owned before starting another test');
    const lock = openSync(lockPath, 'wx', 0o600); writeFileSync(lock, JSON.stringify({ pid: process.pid, runID })); closeSync(lock); lockOwned = true;
    if (existsSync(cleanupLockPath)) throw new Error('Simulator cleanup acquired ownership during startup; refusing a concurrent run');
    if (diskFree() < reserveBytes + 2 * 1024 ** 3) throw new Error('Simulator gate requires 17 GiB free to preserve the 15 GiB reserve');
    const framework = join(root, '.cache/ios/artifacts/Mobile.xcframework');
    const stagedWeb = join(root, '.cache/ios/stage/web/index.html');
    if (!existsSync(join(framework, 'Info.plist')) || !existsSync(stagedWeb)) throw new Error('Build the current framework and bundled app first: node scripts/ios-build.mjs --simulator');
    report.xcode = (await tool('xcode-version', 'xcodebuild', ['-version'])).output.trim();
    report.sourceHashes = {
      runner: hashFile(fileURLToPath(import.meta.url)),
      peerFixture: hashFile(join(root, 'apps/ios/Tests/SimulatorPeer.mjs')),
      uiTest: hashFile(join(root, 'apps/ios/UITests/NativeSimulatorTests.swift')),
      project: hashFile(join(root, 'apps/ios/RelayLoom.xcodeproj/project.pbxproj')),
      scheme: hashFile(join(root, 'apps/ios/RelayLoom.xcodeproj/xcshareddata/xcschemes/RelayLoomSimulator.xcscheme')),
    };
    report.sourceCommit = (await tool('source-commit', 'git', ['rev-parse', 'HEAD'])).output.trim();
    report.workingTreeDirty = (await tool('source-cleanliness', 'git', ['diff', '--quiet', '--', 'apps/ios', 'apps/web', 'apps/node', 'native', 'packages'], 30_000, { allowFailure: true })).code !== 0;
    const runtimes = JSON.parse((await tool('installed-runtimes', 'xcrun', ['simctl', 'list', 'runtimes', '--json'])).output);
    const types = JSON.parse((await tool('installed-device-types', 'xcrun', ['simctl', 'list', 'devicetypes', '--json'])).output);
    const selected = selectSimulator(runtimes, types, requestedVersion);
    report.runtime = { identifier: selected.runtime.identifier, version: selected.runtime.version, buildVersion: selected.runtime.buildversion, deviceType: selected.deviceType.identifier, downloaded: false };
    // Verify the required host peer before booting a costly simulator. Keep the
    // same startup deadline; record phases/stderr if the prerequisite fails.
    const { tsImport } = await import('tsx/esm/api');
    const core = await tsImport('../packages/core/src/index.ts', import.meta.url);
    const peer = fork(join(root, 'apps/ios/Tests/SimulatorPeer.mjs'), [join(raw, 'peer')], { cwd: root, env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    context.peer = peer;
    context.peerErrors = '';
    peer.stderr.on('data', data => { context.peerErrors = (context.peerErrors + data.toString()).slice(-128 * 1024); });
    const ready = await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned Node peer startup timed out')), 20_000);
      peer.once('error', () => { clearTimeout(timer); reject(new Error('Owned Node peer failed to launch')); });
      peer.once('exit', () => { clearTimeout(timer); reject(new Error('Owned Node peer exited during startup')); });
      peer.once('message', value => { clearTimeout(timer); resolveReady(value); });
    });
    const origin = new URL(ready.origin);
    if (ready.kind !== 'ready' || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || !/^[a-f0-9]{64}$/.test(ready.token) || !Number.isInteger(ready.tcpPort) || ready.tcpPort < 1 || ready.tcpPort > 65535) throw new Error('Owned peer bootstrap is invalid');
    async function call(operation, body) {
      const response = await fetch(origin.origin + '/api/' + operation, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + ready.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      const value = await response.json(); if (!response.ok) throw new Error('Owned Node peer API failed: ' + operation); return value;
    }
    const passphrase = 'relayloom ios simulator synthetic passphrase';
    await call('setup', { name: 'iOS Simulator Recipient', password: passphrase });
    await call('settings', { relay: false });
    const candidate = (await call('state')).identity;
    const recipient = { id: candidate?.id, name: candidate?.name, signKey: candidate?.signKey, boxKey: candidate?.boxKey, proof: candidate?.proof };
    if (!core.validateIdentity(recipient)) throw new Error('Node fixture did not provide a valid public identity card');
    const fixtures = { runID, senderName: 'iOS Simulator Sender', passphrase, recipientName: recipient.name, recipientCard: JSON.stringify(recipient), peerTCPPort: ready.tcpPort, message: 'iOS simulator private message ' + runID, post: 'iOS simulator public post ' + runID, attachmentMessage: 'iOS simulator selected photo ' + runID, reply: 'Node peer reply to iOS ' + runID, photoAttachment: !options.has('--without-photo') };
    writeJSON(join(base, 'run-fixtures.json'), fixtures);
    const name = 'RelayLoom-CI-' + runID;
    const created = await tool('create-owned', 'xcrun', ['simctl', 'create', name, selected.deviceType.identifier, selected.runtime.identifier], 60_000, { allowFailure: true });
    let udid = created.output.trim();
    if (!uuid.test(udid)) {
      // A tool timeout after creation can lose its response. Resolve only the
      // unpredictable name generated by this run; never adopt another device.
      const inventory = JSON.parse((await tool('recover-created-id', 'xcrun', ['simctl', 'list', 'devices', '--json'], 30_000, { cleanup: true, logOutput: false })).output);
      const matches = (inventory.devices?.[selected.runtime.identifier] ?? []).filter(device => device.name === name);
      if (matches.length === 1) udid = matches[0].udid;
    }
    if (!uuid.test(udid)) throw new Error('simctl did not return one valid created simulator UDID');
    context.owned = { runID, name, udid, runtime: selected.runtime.identifier, pid: process.pid };
    writeJSON(ownershipPath, context.owned); report.udid = udid;
    if (created.failure || created.code !== 0) throw created.failure ?? new Error('Simulator creation reported an uncertain failure');
    await tool('boot-owned', 'xcrun', ['simctl', 'boot', udid]);
    // The observed first boot on the Apple runner was still migrating
    // LaunchServices/CoreLocation data at 180 seconds. Wait for that same
    // owned device, with a finite cold-boot budget and the existing global
    // deadline/disk guards; never restart it or skip boot readiness.
    report.firstBootBudgetMs = 600_000;
    await tool('wait-owned-boot', 'xcrun', ['simctl', 'bootstatus', udid, '-b'], report.firstBootBudgetMs);
    report.simulatorBooted = true;


    const derived = join(root, '.cache/ios/DerivedData');
    const common = ['-project', 'apps/ios/RelayLoom.xcodeproj', '-scheme', 'RelayLoomSimulator', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'id=' + udid, '-destination-timeout', '90', '-derivedDataPath', derived, '-jobs', '2', '-disableAutomaticPackageResolution', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'ARCHS=' + xcodeArch];
    await tool('build-for-testing', 'xcodebuild', [...common, 'build-for-testing'], 8 * 60_000);
    const app = join(derived, 'Build/Products/Debug-iphonesimulator/RelayLoom.app');
    report.app = { executableSHA256: hashFile(join(app, 'RelayLoom')), webIndexSHA256: hashFile(join(app, 'web/index.html')), uiTestSourceSHA256: hashFile(join(root, 'apps/ios/UITests/NativeSimulatorTests.swift')), bindingReportSHA256: hashFile(join(root, '.cache/ios/binding-report.json')) };
    await tool('install-owned-app', 'xcrun', ['simctl', 'install', udid, app]);
    if (fixtures.photoAttachment) await tool('seed-synthetic-photo', 'xcrun', ['simctl', 'addmedia', udid, join(root, 'apps/ios/Tests/Fixtures/synthetic-photo.png')]);
    const peerEvidence = { runtime: 'real production Node engine in owned child process', relayForOthers: false, recipientID: recipient.id, senderID: null, messages: [], replyReadConfirmed: false };
    let replyID;
    context.watch = (async () => {
      while (!context.watchStop && Date.now() < deadline) {
        const state = await call('state');
        for (const object of state.objects) {
          if (object.kind !== 'message' || ![fixtures.message, fixtures.attachmentMessage].includes(object.content.text) || peerEvidence.messages.some(previous => previous.id === object.id)) continue;
          if (object.public || object.author.id === recipient.id || object.author.name !== fixtures.senderName || object.readers.length !== 2 || !object.readers.includes(recipient.id) || !object.readers.includes(object.author.id)) throw new Error('Real peer received an unexpected author or reader scope');
          peerEvidence.senderID = object.author.id;
          const observed = { id: object.id, type: object.content.text === fixtures.message ? 'private-message' : 'photo-attachment', signatureAndReaderScopeVerifiedByNode: true };
          if (observed.type === 'photo-attachment') {
            const attachment = await call('attachment', { id: object.id, index: 0 });
            const bytes = Buffer.from(attachment.data, 'base64');
            if (!/^image\//.test(attachment.mime) || !bytes.length || bytes.length > 2 * 1024 ** 2) throw new Error('Node peer did not decrypt the selected photo');
            Object.assign(observed, { attachmentBytes: bytes.length, attachmentSha256: hashBuffer(bytes), mime: attachment.mime });
          }
          peerEvidence.messages.push(observed);
          await call('contact', { contact: object.author });
        }
        if (!replyID && peerEvidence.messages.length === (fixtures.photoAttachment ? 2 : 1)) replyID = (await call('send', { operationId: randomUUID(), content: { type: 'message', text: fixtures.reply }, recipients: [peerEvidence.senderID] })).id;
        if (replyID && state.outbox.some(entry => entry.id === replyID && entry.status === 'read')) peerEvidence.replyReadConfirmed = true;
        await delay(1500);
      }
    })().catch(error => { context.abort = error; });
    const result = join(raw, 'ui-results.xcresult');
    report.status = 'RUNNING'; report.testCommandStarted = true;
    await tool('execute-ui-test', 'xcodebuild', [...common, '-resultBundlePath', result, '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1', '-maximum-parallel-testing-workers', '1', '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '360', '-maximum-test-execution-time-allowance', '420', '-only-testing:RelayLoomUITests/' + testName, 'test-without-building'], 8 * 60_000);
    const summary = JSON.parse((await tool('xctest-summary', 'xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', result], 60_000)).output);
    const testResult = assertTestSummary(summary);
    report.simulatorExecuted = true;
    report.xctest = { result: testResult, passedTests: summary.passedTests, failedTests: summary.failedTests, skippedTests: summary.skippedTests ?? 0 };
    for (let i = 0; i < 12 && !peerEvidence.replyReadConfirmed && !context.abort; i++) await delay(1000);
    if (context.abort || !peerEvidence.replyReadConfirmed) throw context.abort ?? new Error('Real Node peer did not receive iOS signed read confirmation for its reply');
    await tool('stop-owned-app', 'xcrun', ['simctl', 'terminate', udid, bundleID], 30_000, { allowFailure: true });
    const container = (await tool('owned-app-container', 'xcrun', ['simctl', 'get_app_container', udid, bundleID, 'data'], 30_000, { logOutput: false })).output.trim();
    report.storage = await verifySyntheticContainer(container, udid, fixtures, peerEvidence, core);
    report.peer = peerEvidence;
    report.status = 'PASSED';
  } catch (error) {
    failure = error; report.status = 'FAILED'; report.error = sanitize(error.message);
    if (context.owned && report.simulatorBooted && report.error.includes('seed-synthetic-photo')) {
      // Keep this diagnostic inside the original global deadline and reserve;
      // no restart, timeout inflation, permission grant or service mutation.
      if (Date.now() + 20_000 < deadline && diskFree() >= reserveBytes + 4 * 1024 ** 2) {
        await annotatePhotoFailure(report, context.owned, tool);
      } else report.photoDiagnostics = { captured: false, reason: 'original deadline or disk reserve' };
    }
  } finally {
    context.watchStop = true;
    if (context.watch) await context.watch;
    if (context.peer) {
      context.peer.kill('SIGTERM');
      await Promise.race([new Promise(resolveExit => { if (context.peer.exitCode !== null) resolveExit(); else context.peer.once('exit', resolveExit); }), delay(5000)]);
      if (context.peer.exitCode === null) context.peer.kill('SIGKILL');
    }
    if (context.peer) recordPeerDiagnostics(report, evidence, context.peerErrors ?? '');
    const result = join(raw, 'ui-results.xcresult');
    if (existsSync(result)) {
      const exportPath = join(raw, 'attachments');
      try {
        await tool('export-test-attachments', 'xcrun', ['xcresulttool', 'export', 'attachments', '--path', result, '--output-path', exportPath], 60_000, { cleanup: true });
        let copied = 0, bytes = 0;
        for (const path of regularFiles(exportPath, 200)) {
          if (/\.(json|txt)$/i.test(path) && lstatSync(path).size <= 64 * 1024) {
            try {
              const value = JSON.parse(boundedRead(path, 64 * 1024));
              if (value.kind === 'IOS_REAL_SIMULATOR_UI' && value.runID === runID) {
                const required = ['identityCreatedViaUI', 'postCreatedViaUI', 'privateMessageCreatedViaUI', 'nodePeerConnectedViaUI', 'nodeReplyReadViaUI', 'backgroundResumeRequiresUnlock', 'processRelaunchRequiresUnlock', 'restoredContentsVisible'];
                if (required.every(key => value[key] === true) && value.photoSelectedViaSystemPicker === report.photoAttachmentRequested && value.appAPIOrCapabilityAccess === false && value.javascriptInjection === false) {
                  writeJSON(join(evidence, 'ui-checks.json'), { kind: value.kind, runID, ...Object.fromEntries(required.map(key => [key, true])), photoSelectedViaSystemPicker: value.photoSelectedViaSystemPicker, appAPIOrCapabilityAccess: false, javascriptInjection: false });
                  report.uiChecksExported = true;
                }
              }
            } catch { /* Other tool attachments are not our safe report schema. */ }
          }
          if (!path.toLowerCase().endsWith('.png')) continue;
          const image = boundedRead(path, 4 * 1024 ** 2);
          if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
          bytes += image.length; if (++copied > 12 || bytes > 24 * 1024 ** 2) throw new Error('Bounded simulator screenshot export exceeded');
          if (diskFree() - image.length < reserveBytes) throw new Error('Screenshot export would consume the 15 GiB disk reserve');
          writeFileSync(join(evidence, 'ui-' + String(copied).padStart(2, '0') + '.png'), image, { mode: 0o600 });
        }
        report.screenshotsExported = copied;
      } catch (error) { report.screenshotExportError = sanitize(error.message); }
    }
    if (report.status === 'PASSED' && ((report.screenshotsExported ?? 0) < 4 || !report.uiChecksExported)) {
      failure ??= new Error('Executed UI test lacks its required safe screenshots or checkpoint report'); report.status = 'FAILED'; report.error = failure.message;
    }
    if (context.owned) {
      try { report.cleanup = await cleanupDevice(context.owned); removeMatchingRunRecord(ownershipPath, runID); }
      catch (error) { report.cleanup.error = sanitize(error.message); report.status = 'FAILED'; failure ??= error; }
    }
    if (lockOwned) removeMatchingRunRecord(lockPath, runID);
    if (existsSync(join(base, 'run-fixtures.json'))) {
      try { if (JSON.parse(boundedRead(join(base, 'run-fixtures.json'), 8192)).runID === runID) rmSync(join(base, 'run-fixtures.json')); } catch {}
    }
    // Upload only the sanitized evidence directory. Raw xcresult diagnostics,
    // the synthetic peer profile and test resources are deliberately removed.
    rmSync(raw, { recursive: true, force: true });
    report.completedAt = new Date().toISOString(); report.diskFreeBytesAtEnd = diskFree();
    writeJSON(join(evidence, cleanupOnly ? 'cleanup-report.json' : 'simulator-report.json'), report);
    writeJSON(join(evidence, 'artifact-hashes.json'), regularFiles(evidence).filter(path => basename(path) !== 'artifact-hashes.json').map(path => ({ file: relative(evidence, path), bytes: lstatSync(path).size, sha256: hashFile(path) })));
    if (cleanupLockOwned) removeMatchingRunRecord(cleanupLockPath, runID);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
    console.log(JSON.stringify({ kind: report.kind, status: report.status, simulatorExecuted: report.simulatorExecuted, physicalDeviceExecuted: false, evidence: relative(root, evidence), cleanup: report.cleanup }));
  }
  if (failure) throw new Error('iOS simulator gate failed: ' + sanitize(failure.message));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(sanitize(error.message)); process.exitCode = 1; });
