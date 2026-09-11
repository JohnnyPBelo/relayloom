import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  canonical, createIdentity, createBundle, exportVault, ContentStore,
  type Identity, type Bundle,
} from '../packages/core/src/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export interface InteropResult {
  nodeIdentityVerified: boolean; loneIdentityVerified: boolean; nodeVaultRecovered: boolean;
  nodePrivatePayload: unknown; nodePublicPayload: unknown; unauthorizedRejected: boolean;
  readerForgeryRejected: boolean; corruptionRejected: boolean; canonicalCases: string[];
  goIdentity: Identity; goVault: string; goPrivate: Bundle; goPublic: Bundle;
  nodeStoreRead: boolean; goStore: { count: number; pinned: number };
}

export function runNativeInterop() {
  const cache = join(root, '.cache', 'native-interop'); mkdirSync(cache, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(cache, 'vectors-'));
  const binary = join(dir, process.platform === 'win32' ? 'interop.exe' : 'interop');
  const built = spawnSync(process.execPath, [join(root, 'scripts', 'go.mjs'), 'build', '-p=2', '-o', binary, './core/cmd/interop'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  if (built.error || built.status !== 0) throw new Error('Native interop build failed: ' + (built.error?.message ?? built.stderr));
  const nodeIdentity = createIdentity('Node & <bridge> 🚀\u2028'), readerIdentity = createIdentity('Reader'), eveIdentity = createIdentity('Unprivileged seeder'), loneIdentity = createIdentity('Lone \ud800 unit');
  const password = 'generated interop vault passphrase';
  const payload = JSON.parse('{"type":"message","text":"Private <>& 🚀\\u2028\\u2029","count":3,"\\ue000":"BMP","\\ud83d\\ude80":"astral","lone":"\\ud800"}');
  payload.attachments = [{ name: 'fixture.bin', mime: 'application/octet-stream', data: randomBytes(90_000).toString('base64') }];
  const nodePrivate = createBundle(nodeIdentity, 'message', payload, [readerIdentity.public]);
  const nodePublic = createBundle(nodeIdentity, 'post', payload, 'public');
  const numbers: number[] = [-0, 1e-7, 1e-6, 1e20, 1e21, 1e23, Number.MIN_VALUE, Number.MAX_VALUE];
  while (numbers.length < 1500) { const value = randomBytes(8).readDoubleLE(); if (Number.isFinite(value)) numbers.push(value); }
  const canonicalCases = [
    '{"z":1,"a":"<>&\\u2028\\u2029"}',
    '{"\\ue000":1,"\\ud83d\\ude80":2,"\\ud800":3,"\\udc00":4}',
    '{"__proto__":{"x":1},"x":0,"x":2}',
    '[-0,0.000001,1e-7,1e20,1e21,1.2345678901234567]',
    JSON.stringify(numbers),
  ];
  const nodeStoreDir = join(dir, 'node-store'), goStoreDir = join(dir, 'go-store');
  const nodeStore = new ContentStore(nodeStoreDir, 8 * 1024 * 1024); nodeStore.put(nodePrivate, true);
  const fixture = { nodeIdentity, readerIdentity, eveIdentity, loneIdentity, password, payload, nodePrivate, nodePublic, nodeVault: exportVault(nodeIdentity, password), canonicalCases, nodeStoreDir, goStoreDir };
  const requestFile = join(dir, 'request.json'); writeFileSync(requestFile, canonical(fixture), { mode: 0o600 });
  const response = spawnSync(binary, [], { cwd: root, input: readFileSync(requestFile), encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (response.error || response.status !== 0) throw new Error('Native interop execution failed: ' + (response.error?.message ?? response.stderr));
  writeFileSync(join(dir, 'response.json'), response.stdout, { mode: 0o600 });
  return { dir, fixture, result: JSON.parse(response.stdout) as InteropResult };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = runNativeInterop();
  console.log(JSON.stringify({ fixtures: output.dir, nodeIdentityVerified: output.result.nodeIdentityVerified, nodeVaultRecovered: output.result.nodeVaultRecovered, unauthorizedRejected: output.result.unauthorizedRejected, corruptionRejected: output.result.corruptionRejected, mobileRuntime: 'not built or run' }));
}
