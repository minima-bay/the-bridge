import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseHex(value, label) {
  requireCondition(/^0x[0-9a-f]+$/i.test(String(value)), `${label} must be hexadecimal`);
  return BigInt(value);
}

async function latestFixture() {
  const names = (await readdir(join(here, 'fixtures')))
    .filter((name) => /^minima-consensus-mainnet-\d{8}T\d{6}Z\.json$/.test(name))
    .sort();
  requireCondition(names.length > 0, 'no Minima consensus fixture found');
  return join(here, 'fixtures', names.at(-1));
}

const input = process.argv[2];
const fixturePath = input
  ? (isAbsolute(input) ? input : resolve(process.cwd(), input))
  : await latestFixture();
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes);

function parseRequest(request) {
  requireCondition(sha256(request.raw) === request.responseSha256, `response hash mismatch for ${request.command}`);
  const envelope = JSON.parse(request.raw);
  requireCondition(envelope.status === true, `unsuccessful response for ${request.command}`);
  return envelope;
}

function validate(candidate) {
  requireCondition(candidate.schema === 'minima-consensus-rpc-observations/v1', 'wrong fixture schema');
  requireCondition(candidate.safety?.walletCommandsUsed === false, 'wallet command safety flag failed');
  requireCondition(candidate.safety?.signed === false, 'signature safety flag failed');
  requireCondition(candidate.safety?.posted === false, 'post safety flag failed');
  requireCondition(candidate.safety?.movedFunds === false, 'fund movement safety flag failed');
  requireCondition(candidate.safety?.changedNodeState === false, 'node state safety flag failed');

  const parsed = candidate.requests.map((request) => ({ request, envelope: parseRequest(request) }));
  const initial = parsed.find((item) => item.request.meta?.kind === 'initial-status')?.envelope?.response;
  const final = parsed.find((item) => item.request.meta?.kind === 'final-status')?.envelope?.response;
  requireCondition(initial && final, 'initial and final status are required');
  requireCondition(initial.version === final.version, 'node version changed');
  requireCondition(initial.version === candidate.node.version, 'declared node version mismatch');

  const blockItems = parsed.filter((item) => item.request.meta?.kind === 'block');
  const blocks = new Map();
  const ids = new Set();
  const chainIds = new Set();
  for (const item of blockItems) {
    const requestedHeight = Number(item.request.meta.requestedHeight);
    const block = item.envelope.response;
    requireCondition(block?.isblock === true, `height ${requestedHeight} is not marked as a block`);
    requireCondition(Number(block?.header?.block) === requestedHeight, `wrong returned height for ${requestedHeight}`);
    requireCondition(!blocks.has(requestedHeight), `duplicate requested height ${requestedHeight}`);

    const id = String(block.txpowid);
    const target = String(block.header.blkdiff);
    parseHex(id, `TxPoW ID at ${requestedHeight}`);
    parseHex(target, `block target at ${requestedHeight}`);
    requireCondition(parseHex(id, `TxPoW ID at ${requestedHeight}`) <= parseHex(target, `block target at ${requestedHeight}`), `TxPoW ID exceeds target at ${requestedHeight}`);
    requireCondition(!ids.has(id), `duplicate TxPoW ID ${id}`);
    ids.add(id);
    requireCondition(/^0x[0-9a-f]+$/i.test(String(block.header.chainid)), `malformed chain ID at ${requestedHeight}`);
    chainIds.add(String(block.header.chainid));
    requireCondition(/^0x[0-9a-f]{64}$/i.test(String(block.header.mmr)), `malformed MMR root at ${requestedHeight}`);
    blocks.set(requestedHeight, block);
  }

  validateRange(candidate.ranges.boundary, blocks, 'boundary');
  validateRange(candidate.ranges.recent, blocks, 'recent');

  const anchorHeight = Number(candidate.observations.anchorHeight);
  const anchorId = String(candidate.observations.anchorId);
  requireCondition(blocks.get(anchorHeight)?.txpowid === anchorId, 'declared anchor does not match captured block');
  const anchor = parsed.find((item) => item.request.meta?.kind === 'anchor-onchain');
  requireCondition(anchor?.envelope?.response?.found === true, 'anchor on-chain lookup did not find the block');
  requireCondition(String(anchor.envelope.response.block) === String(anchorHeight), 'anchor lookup height mismatch');
  requireCondition(anchor.envelope.response.blockid === anchorId, 'anchor lookup ID mismatch');
  requireCondition(Number(anchor.envelope.response.confirmations) >= Number(anchor.request.meta.minimumConfirmations), 'anchor has fewer confirmations than required');

  const recheck = parsed.find((item) => item.request.meta?.kind === 'anchor-recheck');
  requireCondition(recheck?.envelope?.response?.txpowid === anchorId, 'anchor recheck ID mismatch');
  requireCondition(Number(final.chain.block) >= anchorHeight, 'final tip predates anchor');

  requireCondition(blockItems.length === Number(candidate.observations.blockCount), 'declared block count mismatch');
  const declaredChainIds = [...candidate.observations.chainIds].map(String).sort();
  const observedChainIds = [...chainIds].sort();
  requireCondition(JSON.stringify(declaredChainIds) === JSON.stringify(observedChainIds), 'declared chain IDs mismatch');

  return {
    blocks: blocks.size,
    ranges: candidate.ranges,
    chainIds: observedChainIds,
    anchorHeight,
    anchorId,
    anchorConfirmations: Number(anchor.envelope.response.confirmations),
    nodeVersion: initial.version,
    initialTip: Number(initial.chain.block),
    finalTip: Number(final.chain.block),
  };
}

function validateRange(range, blocks, name) {
  requireCondition(range && Number.isInteger(Number(range.start)) && Number.isInteger(Number(range.end)), `${name} range missing`);
  for (let height = Number(range.start); height <= Number(range.end); height += 1) {
    requireCondition(blocks.has(height), `${name} range missing height ${height}`);
    if (height === Number(range.start)) continue;
    const block = blocks.get(height);
    const parent = block.header.superparents?.[0]?.parent;
    requireCondition(parent === blocks.get(height - 1).txpowid, `broken parent link at ${height}`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function blockRequest(candidate, height) {
  const request = candidate.requests.find((item) => item.meta?.kind === 'block' && Number(item.meta.requestedHeight) === Number(height));
  requireCondition(request, `block request ${height} not found`);
  return request;
}

function updateRaw(request, mutate) {
  const envelope = JSON.parse(request.raw);
  mutate(envelope);
  request.raw = JSON.stringify(envelope);
  request.responseSha256 = sha256(request.raw);
}

function expectRejected(id, mutate) {
  const candidate = clone(fixture);
  mutate(candidate);
  try {
    validate(candidate);
    return { id, rejected: false, error: null };
  } catch (error) {
    return { id, rejected: true, error: error.message };
  }
}

const baseline = validate(fixture);
const recentStart = Number(fixture.ranges.recent.start);
const recentSecond = recentStart + 1;
const cases = [
  expectRejected('raw-response-hash-mutation', (candidate) => {
    blockRequest(candidate, recentStart).raw += ' ';
  }),
  expectRejected('wrong-returned-height', (candidate) => {
    updateRaw(blockRequest(candidate, recentStart), (envelope) => {
      envelope.response.header.block = String(recentStart + 99);
    });
  }),
  expectRejected('broken-parent-link', (candidate) => {
    updateRaw(blockRequest(candidate, recentSecond), (envelope) => {
      const parent = envelope.response.header.superparents[0];
      parent.parent = `0x${'11'.repeat(32)}`;
    });
  }),
  expectRejected('txpow-id-above-target', (candidate) => {
    updateRaw(blockRequest(candidate, recentStart), (envelope) => {
      envelope.response.txpowid = `0x${'FF'.repeat(32)}`;
    });
  }),
  expectRejected('duplicate-txpow-id', (candidate) => {
    const firstId = JSON.parse(blockRequest(candidate, recentStart).raw).response.txpowid;
    updateRaw(blockRequest(candidate, recentSecond), (envelope) => {
      envelope.response.txpowid = firstId;
    });
  }),
  expectRejected('malformed-txpow-id', (candidate) => {
    updateRaw(blockRequest(candidate, recentStart), (envelope) => {
      envelope.response.txpowid = '0xNOTHEX';
    });
  }),
  expectRejected('anchor-id-mismatch', (candidate) => {
    const request = candidate.requests.find((item) => item.meta?.kind === 'anchor-onchain');
    updateRaw(request, (envelope) => {
      envelope.response.blockid = `0x${'00'.repeat(32)}`;
    });
  }),
];

requireCondition(cases.every((item) => item.rejected), 'one or more negative controls were accepted');

const source = await readFile(fileURLToPath(import.meta.url));
const createdAt = new Date();
const stamp = createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const evidenceDir = join(here, 'evidence');
const evidencePath = join(evidenceDir, `minima-consensus-fixture-validation-${stamp}.json`);
const result = {
  schema: 'minima-consensus-fixture-validation/v1',
  createdAtUtc: createdAt.toISOString(),
  fixture: basename(fixturePath),
  fixtureSha256: sha256(fixtureBytes),
  validator: basename(fileURLToPath(import.meta.url)),
  validatorSha256: sha256(source),
  passed: true,
  baseline,
  cases,
  limitations: fixture.limitations,
};

await mkdir(evidenceDir, { recursive: true });
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(evidencePath, serialized, { flag: 'wx' });
const evidenceHash = sha256(serialized);
await writeFile(evidencePath + '.sha256', `${evidenceHash}  ${basename(evidencePath)}\n`, { flag: 'wx' });

console.log(JSON.stringify({
  evidencePath,
  evidenceSha256: evidenceHash,
  fixture: result.fixture,
  fixtureSha256: result.fixtureSha256,
  validatorSha256: result.validatorSha256,
  passed: result.passed,
  baseline,
  negativeControlsRejected: cases.length,
}, null, 2));
