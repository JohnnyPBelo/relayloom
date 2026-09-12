// Real production Node engine in an owned child process. Its local API
// capability travels only over the private parent IPC channel, never a log,
// runtime.json, launch argument, test resource or iOS application environment.
import { tsImport } from 'tsx/esm/api';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const allowed = resolve(root, '.cache/ios/simulator/raw');
const directory = resolve(process.argv[2] ?? '');
const rel = relative(allowed, directory);
if (!process.send || !rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Owned simulator peer requires a private IPC parent and its isolated fixture directory');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const began = process.hrtime.bigint();
const phase = name => process.stderr.write('RELAYLOOM_PEER_PHASE ' + name + ' ' + Number((process.hrtime.bigint() - began) / 1000000n) + 'ms\n');
phase('importing-engine');
const { LoomNode } = await tsImport('../../node/src/node.ts', import.meta.url);
phase('engine-imported');
const { serve } = await tsImport('../../node/src/server.ts', import.meta.url);
phase('server-imported');
const node = new LoomNode(directory);
phase('profile-opened');
await node.start(0, '127.0.0.1');
phase('transport-listening');
const api = await serve(node, 0);
phase('api-listening');
process.send({ kind: 'ready', origin: api.url, token: api.token, tcpPort: node.tcpPort });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  // A vanished supervisor must not leave an indefinite test peer behind.
  const hardStop = setTimeout(() => process.exit(1), 5000);
  try { await api.close(); await node.stop(); process.exit(0); }
  catch { process.exit(1); }
  finally { clearTimeout(hardStop); }
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
