import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rpcRoot = (process.argv[2] || 'http://127.0.0.1:9105').replace(/\/$/, '');

async function rpc(command) {
  const response = await fetch(rpcRoot + '/' + encodeURIComponent(command));
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function instructionScript(iterations) {
  const commands = ['LET x = 0'];
  for (let index = 0; index < iterations; index += 1) {
    commands.push('LET x = x + 1');
  }
  commands.push('RETURN TRUE');
  return commands.join(' ');
}

function summarizeRunScript(envelope) {
  const result = envelope.response || {};
  const trace = String(result.trace || '');
  const instructionMatch = [...trace.matchAll(/Contract instructions : (\d+)/g)].at(-1);
  const errorMatch = [...trace.matchAll(/Execution Error[^\r\n]*/g)].at(-1);
  return {
    parseok: result.parseok,
    success: result.success,
    monotonic: result.monotonic,
    instructions: instructionMatch ? Number(instructionMatch[1]) : null,
    executionError: errorMatch ? errorMatch[0] : null,
  };
}

const probes = [
  { id: 'baseline', script: 'RETURN TRUE' },
  { id: 'blsverify', script: 'RETURN BLSVERIFY(0x00 0x00 0x00)' },
  { id: 'pairing', script: 'RETURN PAIRING(0x00 0x00)' },
  { id: 'ecrecover', script: 'RETURN ECRECOVER(0x00 0x00 0x00 0x00)' },
  { id: 'checksig', script: 'RETURN CHECKSIG(0x00 0x00 0x00)' },
  { id: 'proof', script: 'RETURN PROOF(0x00 0 0x00 0 0x00)' },
  { id: 'instruction-pass', script: instructionScript(255), iterations: 255 },
  { id: 'instruction-fail', script: instructionScript(256), iterations: 256 },
];

const statusEnvelope = await rpc('status');
const status = statusEnvelope.response;
const observations = [];

for (const probe of probes) {
  const command = `runscript script:"${probe.script}"`;
  const envelope = await rpc(command);
  observations.push({
    id: probe.id,
    iterations: probe.iterations ?? null,
    command,
    scriptSha256: sha256(probe.script),
    scriptBytes: Buffer.byteLength(probe.script, 'utf8'),
    verdict: summarizeRunScript(envelope),
    envelope,
  });
}

const source = await readFile(fileURLToPath(import.meta.url));
const capturedAt = new Date();
const stamp = capturedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const evidenceDir = join(here, 'evidence');
const evidencePath = join(evidenceDir, `minima-runtime-probe-${stamp}.json`);

const evidence = {
  schema: 'minima-zk-runtime-probe/v1',
  capturedAtUtc: capturedAt.toISOString(),
  rpcRoot,
  safety: {
    commandsUsed: ['status', 'runscript'],
    signed: false,
    posted: false,
    createdToken: false,
    movedFunds: false,
  },
  harness: {
    file: basename(fileURLToPath(import.meta.url)),
    sha256: sha256(source),
  },
  node: {
    version: status.version,
    locked: status.locked,
    megammr: status.megammr,
    chainBlock: status.chain?.block,
    chainHash: status.chain?.hash,
    chainTime: status.chain?.time,
    chainLength: status.chain?.length,
    chainWeight: status.chain?.weight,
    cascadeStart: status.chain?.cascade?.start,
    cascadeLength: status.chain?.cascade?.length,
    cascadeWeight: status.chain?.cascade?.weight,
    rpcPort: status.network?.rpc?.port,
  },
  observations,
};

await mkdir(evidenceDir, { recursive: true });
const serialized = JSON.stringify(evidence, null, 2) + '\n';
await writeFile(evidencePath, serialized, { flag: 'wx' });
const evidenceHash = sha256(serialized);
await writeFile(evidencePath + '.sha256', `${evidenceHash}  ${basename(evidencePath)}\n`, { flag: 'wx' });

console.log(JSON.stringify({
  evidencePath,
  evidenceSha256: evidenceHash,
  node: evidence.node,
  verdicts: Object.fromEntries(observations.map((item) => [item.id, item.verdict])),
}, null, 2));
