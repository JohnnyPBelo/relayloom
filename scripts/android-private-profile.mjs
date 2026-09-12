// Post-gate verification of the synthetic profile in this project's sole AVD.
// Run after UI/transport gates: it stops only org.relayloom.android in that AVD.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tsImport } from 'tsx/esm/api';

const root = resolve(import.meta.dirname, '..'), cache = join(root, '.cache/android');
const evidence = resolve(root, process.argv[2] ?? '');
if (!evidence.startsWith(cache + '/evidence/')) throw new Error('Use a project Android evidence directory');
const baseline = JSON.parse(readFileSync(join(evidence, 'profile-before.json')));
const owned = JSON.parse(readFileSync(join(cache, 'emulator-process.json')));
assert.equal(owned.serial, 'emulator-5580');
assert.equal(owned.adbServerPort, 5047);
assert.equal(resolve(owned.avd), join(cache, 'avd/relayloom-api36.avd'));
const env = { ...process.env, ANDROID_USER_HOME: join(cache, 'user'), ANDROID_EMULATOR_HOME: join(cache, 'emulator-home'), ANDROID_AVD_HOME: join(cache, 'avd'), ADB_VENDOR_KEYS: join(cache, 'emulator-home/adbkey'), ADB_SERVER_PORT: '5047', ANDROID_ADB_SERVER_PORT: '5047', ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5047' };
function adb(args, maximum = 65536) {
  const r = spawnSync(join(cache, 'sdk/platform-tools/adb'), ['-P', '5047', '-s', 'emulator-5580', ...args], { cwd: root, env, timeout: 15000, maxBuffer: maximum });
  if (r.status !== 0) throw new Error('Owned emulator command failed: ' + (r.error?.message ?? r.stderr?.toString().slice(0, 1024)));
  return r.stdout;
}
function installedHash() {
  const path = adb(['shell', 'pm', 'path', 'org.relayloom.android']).toString().trim().replace(/^package:/, '');
  assert.match(path, /^\/data\/app\/[A-Za-z0-9_./=~+-]+\/base\.apk$/);
  return adb(['shell', 'sha256sum', path]).toString().trim().split(/\s+/)[0];
}
function profileFile(name, maximum) {
  const relative = 'files/core/' + name;
  const length = Number(adb(['exec-out', 'run-as', 'org.relayloom.android', 'stat', '-c', '%s', relative]).toString().trim());
  assert.ok(Number.isSafeInteger(length) && length > 0 && length <= maximum, 'bounded synthetic profile file');
  const bytes = adb(['exec-out', 'run-as', 'org.relayloom.android', 'cat', relative], maximum + 1024);
  assert.equal(bytes.length, length); return bytes;
}
const build = JSON.parse(readFileSync(join(cache, 'build-report.json')));
assert.equal(installedHash(), build.apkSha256, 'inspect the exact tested APK');
// The four preceding gates have completed; no operation is abandoned in flight.
adb(['shell', 'am', 'force-stop', 'org.relayloom.android']);
const { importVault, hash } = await tsImport('../packages/core/src/index.ts', import.meta.url);
const { decodeProfileBinding } = await tsImport('../packages/profile/src/binding.ts', import.meta.url);
const { ProfileDatabase } = await tsImport('../packages/profile/src/database.ts', import.meta.url);
const { ProfileOwnership } = await tsImport('../packages/profile/src/ownership.ts', import.meta.url);
const { parsePrivateState } = await tsImport('../apps/node/src/local-state.ts', import.meta.url);
const vault = profileFile('identity.vault', 8192), bindingBytes = profileFile('profile-binding.json', 2048), databaseBytes = profileFile('profile-state.sqlite', 96 * 1024 ** 2);
const identity = importVault(vault.toString(), 'relayloom_android_test_passphrase');
assert.equal(hash(vault), baseline.profileHashes['identity.vault'], 'upgrade preserves the original encrypted identity');
assert.equal(baseline.bindingBefore, false, 'this fixture really began with legacy storage');
const binding = decodeProfileBinding(bindingBytes, identity.public);
assert.equal(binding.body.phase, 'committed');
assert.equal(binding.body.sourceDigest, baseline.profileHashes['private-state.json']);
const legacyHash = adb(['exec-out', 'run-as', 'org.relayloom.android', 'sha256sum', 'files/core/private-state.json']).toString().trim().split(/\s+/)[0];
assert.equal(legacyHash, baseline.profileHashes['private-state.json'], 'migration preserves legacy ciphertext');

const directory = mkdtempSync(join(cache, 'private-profile-verification-'));
let lease, db;
try {
  writeFileSync(join(directory, 'profile-binding.json'), bindingBytes, { mode: 0o600 });
  writeFileSync(join(directory, 'profile-state.sqlite'), databaseBytes, { mode: 0o600 });
  lease = new ProfileOwnership(directory);
  db = ProfileDatabase.open(directory, identity, () => { throw new Error('A copied committed device profile must not use legacy fallback'); });
  assert.equal(db.store.storeId(), binding.body.storeId);
  const state = parsePrivateState(db.read().bytes, identity);
  const preview = Object.values(state.outbox ?? {}).map(record => record.preview).find(value => value.startsWith('Android native encrypted packet ') || value.startsWith('Android SAF attachment '));
  assert.ok(preview, 'positive control: a real fixture message remains in authenticated private state');
  assert.equal(databaseBytes.includes(Buffer.from(preview)), false, 'actual private preview is absent from SQLite ciphertext');
  assert.equal(bindingBytes.includes(Buffer.from(preview)), false);
  assert.equal(installedHash(), build.apkSha256);
  mkdirSync(evidence, { recursive: true });
  const report = { kind: 'ANDROID_PRIVATE_PROFILE_MIGRATION', status: 'PASSED', apkSha256: build.apkSha256, aarSha256: build.aarSha256, databaseSha256: hash(databaseBytes), bindingSha256: hash(bindingBytes), databaseBytes: databaseBytes.length, identityVaultUnchanged: true, legacyCiphertextUnchanged: true, beganWithoutBinding: true, committedBindingVerifiedByNode: true, androidSQLiteAuthenticatedByNode: true, actualPrivatePreviewPresentAfterDecryption: true, actualPrivatePreviewAbsentFromCiphertext: true, serial: 'emulator-5580', physicalDevice: false, limitations: ['synthetic profile in the existing API36x86_64 emulator, followed by host inspection of its copied encrypted SQLite', 'no physical power-loss, ARM64 hardware, radio, or complete-valid-backup rollback protection'], noPrivateKeysOrContentInReport: true };
  writeFileSync(join(evidence, 'private-profile-migration.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { try { db?.close(); } finally { lease?.close(); rmSync(directory, { recursive: true, force: true }); } }
