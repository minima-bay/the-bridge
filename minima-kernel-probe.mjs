import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rpcRoot = (process.argv[2] || 'http://127.0.0.1:9105').replace(/\/$/, '');

async function rpc(command) {
  const response = await fetch(rpcRoot + '/' + encodeURIComponent(command));
  const text = await response.text();
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function summarize(envelope) {
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

function sha3(data) {
  return createHash('sha3-256').update(data).digest();
}

function hashChainScript(iterations) {
  const zero = Buffer.alloc(32);
  let value = Buffer.alloc(32);
  const commands = [`LET h = 0x${value.toString('hex')}`];
  for (let index = 0; index < iterations; index += 1) {
    commands.push(`LET h = SHA3(CONCAT(h 0x${zero.toString('hex')}))`);
    value = sha3(Buffer.concat([value, zero]));
  }
  commands.push(`RETURN h EQ 0x${value.toString('hex')}`);
  return commands.join(' ');
}

async function runScript(id, script, extra = {}) {
  const command = `runscript script:"${script}"`;
  const envelope = await rpc(command);
  return {
    id,
    ...extra,
    command,
    scriptSha256: sha256(script),
    scriptBytes: Buffer.byteLength(script, 'utf8'),
    verdict: summarize(envelope),
    envelope,
  };
}

const statusEnvelope = await rpc('status');
const status = statusEnvelope.response;
const blockEnvelope = await rpc(`txpow block:${status.chain.block}`);

const p128 = 340282366920938463463374557953744961537n;
const field128Script = `RETURN ${p128} EQ ${p128}`;

const p64 = 18446744069414584321n;
const a64 = p64 - 2n;
const b64 = p64 - 3n;
const expectedProduct64 = (a64 * b64) % p64;
const field64ParseScript = `RETURN ${p64} EQ ${p64}`;
const field64MultiplyScript = [
  `LET p = ${p64}`,
  `LET a = ${a64}`,
  `LET b = ${b64}`,
  `RETURN ((a * b) % p) EQ ${expectedProduct64}`,
].join(' ');

const abc = Buffer.from('abc', 'utf8');
const abcDigest = sha3(abc);
const sha3VectorScript = `RETURN SHA3(0x${abc.toString('hex')}) EQ 0x${abcDigest.toString('hex')}`;

const observations = [
  await runScript('winterfell-f128-modulus-parse', field128Script, {
    fieldModulus: p128.toString(),
  }),
  await runScript('winterfell-f64-modulus-parse', field64ParseScript, {
    fieldModulus: p64.toString(),
  }),
  await runScript('winterfell-f64-mulmod', field64MultiplyScript, {
    fieldModulus: p64.toString(),
    expectedProduct: expectedProduct64.toString(),
  }),
  await runScript('sha3-256-abc', sha3VectorScript, {
    expectedDigest: abcDigest.toString('hex'),
  }),
];

let low = 0;
let high = 256;
const search = [];
while (low < high) {
  const middle = Math.ceil((low + high) / 2);
  const result = await runScript(`sha3-chain-${middle}`, hashChainScript(middle), {
    sha3Calls: middle,
  });
  search.push(result);
  if (result.verdict.success) low = middle;
  else high = middle - 1;
}

const maxPass = search.find((item) => item.sha3Calls === low)
  || await runScript(`sha3-chain-${low}`, hashChainScript(low), { sha3Calls: low });
const firstFail = await runScript(
  `sha3-chain-${low + 1}`,
  hashChainScript(low + 1),
  { sha3Calls: low + 1 },
);
observations.push(...search, maxPass, firstFail);

const source = await readFile(fileURLToPath(import.meta.url));
const capturedAt = new Date();
const stamp = capturedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const evidenceDir = join(here, 'evidence');
const evidencePath = join(evidenceDir, `minima-kernel-probe-${stamp}.json`);

const evidence = {
  schema: 'minima-zk-kernel-probe/v1',
  capturedAtUtc: capturedAt.toISOString(),
  rpcRoot,
  safety: {
    commandsUsed: ['status', 'txpow', 'runscript'],
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
    chainBlock: status.chain.block,
    chainHash: status.chain.hash,
    chainTime: status.chain.time,
    currentMaxTxPoWSize: blockEnvelope.response?.header?.magic?.currentmaxtxpowsize,
    currentMaxKissVmOps: blockEnvelope.response?.header?.magic?.currentmaxkissvmops,
    currentMaxTxn: blockEnvelope.response?.header?.magic?.currentmaxtxn,
  },
  result: {
    maxExactSha3ChainCalls: low,
    maxPass: maxPass.verdict,
    firstFail: firstFail.verdict,
  },
  observations,
};

await mkdir(evidenceDir, { recursive: true });
const serialized = JSON.stringify(evidence, null, 2) + '\n';
await writeFile(evidencePath, serialized, { flag: 'wx' });
const evidenceHash = sha256(serialized);
await writeFile(evidencePath + '.sha256', `${evidenceHash}  ${basename(evidencePath)}\n`, {
  flag: 'wx',
});

console.log(JSON.stringify({
  evidencePath,
  evidenceSha256: evidenceHash,
  node: evidence.node,
  field128Parse: observations[0].verdict,
  field64Parse: observations[1].verdict,
  field64MulMod: observations[2].verdict,
  sha3Vector: observations[3].verdict,
  result: evidence.result,
}, null, 2));
