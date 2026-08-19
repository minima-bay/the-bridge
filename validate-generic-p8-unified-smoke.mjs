#!/usr/bin/env node

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { encodeP8Record, layoutFor, p8RecordDigest } from './generic-p8-records-primary.mjs';
import { encodeP8RecordIndependent, p8RecordDigestIndependent } from './generic-p8-records-independent.mjs';
import { fixtures, redemptionId } from './generic-p8-record-fixtures.mjs';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = fileURLToPath(import.meta.url);
const harness = resolve(root, 'p8', 'GenericP8UnifiedSmoke.java');
const coreRoot = resolve(root, 'upstream', 'minima-core');
const minimaJar = resolve(coreRoot, 'jar', 'minima.jar');
const emitEvidence = process.argv.includes('--evidence');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, ...options }).trim();
let assertions = 0;
function check(condition, message) { assertions += 1; if (!condition) throw new Error(message); }

const outputRoot = mkdtempSync(join(tmpdir(), 'generic-p8-smoke-'));
const resolvedTempBase = `${realpathSync(tmpdir())}${sep}`.toLowerCase();
const resolvedOutputRoot = realpathSync(outputRoot).toLowerCase();
if (!resolvedOutputRoot.startsWith(resolvedTempBase) || !basename(resolvedOutputRoot).startsWith('generic-p8-smoke-')) {
  throw new Error(`refusing cleanup outside expected temporary root: ${resolvedOutputRoot}`);
}

let runs;
try {
  run('javac', ['--release', '8', '-cp', minimaJar, '-d', outputRoot, harness], { cwd: root });
  const classpath = `${outputRoot};${minimaJar}`;
  const jobs = fixtures.map((fixture) => async () => {
    const inputHex = `0x${encodeP8Record(fixture.record).toString('hex')}`;
    const { stdout } = await execFileAsync('java', ['-cp', classpath, 'GenericP8UnifiedSmoke', fixture.mode, fixture.type, inputHex],
      { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    return { fixture, result: JSON.parse(stdout) };
  });
  // Two JVMs at a time avoids multiplying the TreeKey memory cost while cutting wall time.
  runs = [];
  for (let index = 0; index < jobs.length; index += 2) runs.push(...await Promise.all(jobs.slice(index, index + 2).map((job) => job())));
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}

const commit = run('git', ['rev-parse', 'HEAD'], { cwd: coreRoot });
check(commit === '52542f25605a28a776e9b3b43b0808a05dceab01', 'pinned Core commit');
check(sha(readFileSync(minimaJar)) === 'b22182ec5c9389fe52c7cababa79e7e7966726b8996d6a31593f8ae69232af20', 'pinned Core jar');
check(runs.length === 10, 'ten action/lane runs');

const expectedShape = Object.freeze({
  CLIENT_UPDATE: [2, 2, 5, 2, 1], RELEASE: [2, 3, 5, 2, 1], RETURN: [3, 2, 1, 3, 2],
  CANCEL: [2, 2, 6, 2, 1], PAYOUT_ACK: [2, 2, 5, 2, 1],
});
const laneIdentity = new Map();
const records = [];
for (const { fixture, result } of runs) {
  const dynamic = { ...fixture.record,
    destinationTokenId: result.bridgeTokenId,
    reserveCovenant: result.covenantAddress,
    controlTokenId: result.controlTokenId,
    committeeRoot: result.committeeRoot,
  };
  if (fixture.type === 'CANCEL') dynamic.cancellationAuthorityPublicKey = result.authorityPublicKey;
  if (fixture.type === 'RETURN') dynamic.redemptionId = redemptionId(dynamic);
  const primary = encodeP8Record(dynamic);
  const independent = encodeP8RecordIndependent(dynamic);
  const javaBytes = Buffer.from(result.recordHex.slice(2), 'hex');
  check(primary.equals(javaBytes), `${fixture.name} primary reproduces Java record`);
  check(independent.equals(javaBytes), `${fixture.name} independent reproduces Java record`);
  check(p8RecordDigest(dynamic) === p8RecordDigestIndependent(dynamic), `${fixture.name} digest parity`);
  check(result.action === fixture.type && BigInt(result.actionCode) === BigInt(fixture.record.action), `${fixture.name} dispatcher action`);
  check(result.controlPassed && result.reservePassed && result.ownerPassed, `${fixture.name} all input scripts pass`);
  check(result.transactionValid, `${fixture.name} token conservation`);
  check(result.controlInstructions > 0 && result.controlInstructions < 1024, `${fixture.name} control instruction bound`);
  check(result.reserveInstructions > 0 && result.reserveInstructions < 1024, `${fixture.name} reserve instruction bound`);
  const [inputs, outputs, signatures, coinProofs, scriptProofs] = expectedShape[fixture.type];
  check(result.inputCount === inputs && result.outputCount === outputs, `${fixture.name} exact input/output shape`);
  check(result.signatureCount === signatures && result.coinProofCount === coinProofs && result.scriptProofCount === scriptProofs, `${fixture.name} exact witness shape`);
  check(result.transactionBytes > 0 && result.witnessBytes > result.transactionBytes, `${fixture.name} serialized transaction and witness`);
  check(result.coinProofDepth === 32, `${fixture.name} synthetic proof depth`);
  check(result.serializedTxPowBytes > result.witnessBytes && result.serializedTxPowBytes < 65_536, `${fixture.name} full TxPoW bound`);
  check(Object.keys(result.mutationsRejected).length === 8 && Object.values(result.mutationsRejected).every(Boolean), `${fixture.name} freshly authorized hostile mutations`);
  check(javaBytes.length === encodeP8Record(fixture.record).length && layoutFor(fixture.type).length > 0, `${fixture.name} exact action record length`);
  const identity = `${result.covenantAddress}:${result.bridgeTokenId}:${result.controlTokenId}:${result.committeeRoot}`;
  if (laneIdentity.has(fixture.mode)) check(laneIdentity.get(fixture.mode) === identity, `${fixture.name} one unified covenant identity`);
  else laneIdentity.set(fixture.mode, identity);
  records.push({ name: fixture.name, type: fixture.type, mode: fixture.mode, recordBytes: javaBytes.length,
    recordDigest: p8RecordDigest(dynamic), covenantAddress: result.covenantAddress,
    bridgeTokenId: result.bridgeTokenId, controlTokenId: result.controlTokenId,
    scriptBytes: result.scriptBytes, transactionBytes: result.transactionBytes, witnessBytes: result.witnessBytes,
    serializedTxPowBytes: result.serializedTxPowBytes, coinProofDepth: result.coinProofDepth,
    inputCount: result.inputCount, outputCount: result.outputCount, signatureCount: result.signatureCount,
    coinProofCount: result.coinProofCount, scriptProofCount: result.scriptProofCount,
    controlInstructions: result.controlInstructions, reserveInstructions: result.reserveInstructions,
    ownerInstructions: result.ownerInstructions, transactionValid: result.transactionValid,
    controlPassed: result.controlPassed, reservePassed: result.reservePassed, ownerPassed: result.ownerPassed,
    mutationsRejected: result.mutationsRejected });
}
check(laneIdentity.size === 2, 'two independent lane covenant identities');
check(new Set(records.filter((item) => item.mode === 'erc20').map((item) => item.covenantAddress)).size === 1, 'ERC unified address');
check(new Set(records.filter((item) => item.mode === 'eth').map((item) => item.covenantAddress)).size === 1, 'ETH unified address');

const result = {
  schema: 'generic-bridge-p8-unified-smoke/v1', status: 'all-five-kiss-branches-smoke-pass', phaseGatePassed: false,
  validator: basename(sourcePath), validatorSha256: sha(readFileSync(sourcePath)),
  harness: 'p8/GenericP8UnifiedSmoke.java', harnessSha256: sha(readFileSync(harness)),
  coreCommit: commit, minimaJarSha256: sha(readFileSync(minimaJar)), laneCount: 2, actionCount: 5,
  executionCount: records.length, assertionCount: assertions, records,
  canonicalRecordParity: true, exactTransactionShapesExecuted: true, kissRuntimeExecutedAgainstPinnedCore: true,
  freshTransactionSignaturesGeneratedOffline: true, syntheticThirtyTwoLevelCoinProofs: true,
  hostileMutationGateExecuted: true, hostileMutationsPerExecution: 8, exactFullTxPoWMeasured: true, nodeTxncheckExecuted: false,
  mainnetTransactionMined: false, noNodeWalletTokenSignatureOrTransactionCommands: true,
  blockers: [
    'Coin proofs are deterministic 32-level synthetic proofs, not proofs for current mainnet UTXOs.',
    'A fresh mainnet generation is required because the immutable v2 lanes contain only RELEASE.',
  ],
};
if (emitEvidence) {
  const createdAtUtc = new Date().toISOString();
  const stamp = createdAtUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `generic-p8-unified-smoke-${stamp}.json`);
  const serialized = `${JSON.stringify({ createdAtUtc, ...result }, null, 2)}\n`;
  writeFileSync(evidencePath, serialized); const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath; result.evidenceSha256 = evidenceSha256;
}
console.log(JSON.stringify(result, null, 2));
