import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rpcRoot = (process.argv[2] || 'http://127.0.0.1:9105').replace(/\/$/, '');
const recentCount = parsePositiveInt(process.argv[3] || '24', 'recentCount');
const anchorDepth = parsePositiveInt(process.argv[4] || '8', 'anchorDepth');
const boundaryCount = parsePositiveInt(process.argv[5] || '8', 'boundaryCount');

function parsePositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 256) {
    throw new Error(`${name} must be an integer from 1 to 256`);
  }
  return number;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const requests = [];

async function capture(command, meta = {}) {
  const response = await fetch(`${rpcRoot}/${encodeURIComponent(command)}`);
  const raw = await response.text();
  if (!response.ok) throw new Error(`RPC HTTP ${response.status} for ${command}: ${raw.slice(0, 500)}`);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new Error(`RPC returned invalid JSON for ${command}: ${error.message}`);
  }
  if (envelope.status !== true) {
    throw new Error(`RPC command failed for ${command}: ${envelope.error || raw.slice(0, 500)}`);
  }

  const record = {
    command,
    capturedAtUtc: new Date().toISOString(),
    meta,
    responseSha256: sha256(raw),
    raw,
  };
  requests.push(record);
  return { envelope, record };
}

const initialStatusCall = await capture('status', { kind: 'initial-status' });
const initialStatus = initialStatusCall.envelope.response;
const tipHeight = Number(initialStatus?.chain?.block);
const cascadeStart = Number(initialStatus?.chain?.cascade?.start);
if (!Number.isSafeInteger(tipHeight) || !Number.isSafeInteger(cascadeStart)) {
  throw new Error('status did not return numeric chain.block and chain.cascade.start');
}
if (tipHeight <= anchorDepth + recentCount) throw new Error('chain is too short for requested recent range');

const recentEnd = tipHeight - anchorDepth;
const recentStart = recentEnd - recentCount + 1;
const boundaryStart = cascadeStart;
const boundaryEnd = cascadeStart + boundaryCount - 1;

await capture('help command:txpow', { kind: 'help', subject: 'txpow' });
await capture('help command:block', { kind: 'help', subject: 'block' });
await capture('help command:printtree', { kind: 'help', subject: 'printtree' });
await capture('block', { kind: 'tip-summary' });
await capture('printtree depth:64', { kind: 'recent-tree', depth: 64 });

const heights = [...new Set([
  ...range(boundaryStart, boundaryEnd),
  ...range(recentStart, recentEnd),
])].sort((left, right) => left - right);

const blockCalls = new Map();
for (const height of heights) {
  const call = await capture(`txpow block:${height}`, { kind: 'block', requestedHeight: height });
  const block = call.envelope.response;
  if (String(block?.header?.block) !== String(height) || block?.isblock !== true) {
    throw new Error(`txpow block:${height} did not return the requested block`);
  }
  blockCalls.set(height, call);
}

const anchorId = blockCalls.get(recentEnd)?.envelope?.response?.txpowid;
if (!/^0x[0-9a-f]+$/i.test(String(anchorId))) throw new Error('recent anchor did not contain a TxPoW ID');

const anchorLookup = await capture(`txpow onchain:${anchorId}`, {
  kind: 'anchor-onchain',
  anchorHeight: recentEnd,
  anchorId,
  minimumConfirmations: anchorDepth,
});
if (anchorLookup.envelope?.response?.found !== true) throw new Error('captured anchor is not on chain');

const anchorRecheck = await capture(`txpow block:${recentEnd}`, {
  kind: 'anchor-recheck',
  anchorHeight: recentEnd,
  anchorId,
});
if (anchorRecheck.envelope?.response?.txpowid !== anchorId) {
  throw new Error('canonical block at the anchor height changed during capture');
}

const finalStatusCall = await capture('status', { kind: 'final-status' });
const finalStatus = finalStatusCall.envelope.response;
if (finalStatus.version !== initialStatus.version) throw new Error('node version changed during capture');

const chainIds = [...new Set([...blockCalls.values()].map((call) => call.envelope.response.header.chainid))];
const capturedAt = new Date();
const stamp = capturedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const fixtureDir = join(here, 'fixtures');
const fixturePath = join(fixtureDir, `minima-consensus-mainnet-${stamp}.json`);
const source = await readFile(fileURLToPath(import.meta.url));

const fixture = {
  schema: 'minima-consensus-rpc-observations/v1',
  capturedAtUtc: capturedAt.toISOString(),
  rpcRoot,
  safety: {
    network: 'mainnet observation from the target node',
    commandsUsed: [...new Set(requests.map((request) => request.command.split(' ')[0]))],
    walletCommandsUsed: false,
    signed: false,
    posted: false,
    movedFunds: false,
    changedNodeState: false,
  },
  collector: {
    file: basename(fileURLToPath(import.meta.url)),
    sha256: sha256(source),
  },
  node: {
    version: initialStatus.version,
    initialTipHeight: tipHeight,
    initialTipHash: initialStatus.chain.hash,
    finalTipHeight: Number(finalStatus.chain.block),
    finalTipHash: finalStatus.chain.hash,
    megaMmr: initialStatus.megammr,
    cascadeStart,
    cascadeLength: initialStatus.chain.cascade.length,
    cascadeWeight: initialStatus.chain.cascade.weight,
  },
  ranges: {
    boundary: { start: boundaryStart, end: boundaryEnd, count: boundaryCount },
    recent: { start: recentStart, end: recentEnd, count: recentCount, anchorDepth },
  },
  observations: {
    chainIds,
    anchorId,
    anchorHeight: recentEnd,
    anchorConfirmationsAtLookup: Number(anchorLookup.envelope.response.confirmations),
    blockCount: blockCalls.size,
  },
  limitations: [
    'RPC JSON is not canonical consensus serialization.',
    'The collector does not recompute TxPoW IDs, difficulty adjustment, cumulative work, fork choice, Cascade transitions, or MMR proofs.',
    'On-chain lookup and parent continuity describe this node observation and do not prove that no heavier unseen branch exists.',
  ],
  requests,
};

await mkdir(fixtureDir, { recursive: true });
const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
await writeFile(fixturePath, serialized, { flag: 'wx' });
const fixtureHash = sha256(serialized);
await writeFile(fixturePath + '.sha256', `${fixtureHash}  ${basename(fixturePath)}\n`, { flag: 'wx' });

console.log(JSON.stringify({
  fixturePath,
  fixtureSha256: fixtureHash,
  node: fixture.node,
  ranges: fixture.ranges,
  observations: fixture.observations,
  safety: fixture.safety,
}, null, 2));

function range(start, end) {
  const result = [];
  for (let value = start; value <= end; value += 1) result.push(value);
  return result;
}

