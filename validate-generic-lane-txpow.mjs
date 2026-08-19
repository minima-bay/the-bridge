#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DOMAIN, FIELDS, RECORD_BYTES, encodeRecord, fieldOffsets } from './generic-attestation-primary.mjs';
import { independentlyEncode } from './generic-attestation-independent.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = fileURLToPath(import.meta.url);
const harness = resolve(root, 'p7', 'GenericLaneTxPowBenchmark.java');
const coreRoot = resolve(root, 'upstream', 'minima-core');
const minimaJar = resolve(coreRoot, 'jar', 'minima.jar');
const emitEvidence = process.argv.includes('--evidence');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', windowsHide: true, ...options }).trim();
}

function uint(record, offset, width) {
  let value = 0n;
  for (const byte of record.subarray(offset, offset + width)) value = value * 256n + BigInt(byte);
  return value;
}

function hex(record, offset, width) {
  return `0x${record.subarray(offset, offset + width).toString('hex')}`;
}

const outputRoot = mkdtempSync(join(tmpdir(), 'generic-lane-txpow-'));
const resolvedTempBase = `${realpathSync(tmpdir())}${sep}`.toLowerCase();
const resolvedOutputRoot = realpathSync(outputRoot).toLowerCase();
if (!resolvedOutputRoot.startsWith(resolvedTempBase) || !basename(resolvedOutputRoot).startsWith('generic-lane-txpow-')) {
  throw new Error(`refusing temporary cleanup outside expected root: ${resolvedOutputRoot}`);
}

let lanes;
try {
  run('javac', ['--release', '8', '-cp', minimaJar, '-d', outputRoot, harness], { cwd: root });
  const classpath = `${outputRoot};${minimaJar}`;
  lanes = ['erc20', 'eth'].map((mode) => JSON.parse(run('java', ['-cp', classpath, 'GenericLaneTxPowBenchmark', mode], { cwd: root })));
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}

const offsets = fieldOffsets();
const mutationNames = [
  'fourOfSeven', 'recipientOrTransactionId', 'successorAmount', 'crossLaneRecord', 'reserveFloor',
  'payoutCursorAdvanceWithoutAck', 'payoutCumulativeAdvanceWithoutAck',
  'equalHeadChangedBalance', 'equalHeadChangedBlockHash',
  'sourceTimeBeyondFutureSkew', 'sourceTimeBeyondMaximumAge',
  'acceptedHeadBlockInFuture', 'acceptedHeadBlockRollback', 'acceptedHeadBlockBeyondPostingLag',
];
let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const commit = run('git', ['rev-parse', 'HEAD'], { cwd: coreRoot });
check(commit === '52542f25605a28a776e9b3b43b0808a05dceab01', 'pinned Core commit');
check(sha256(readFileSync(minimaJar)) === 'b22182ec5c9389fe52c7cababa79e7e7966726b8996d6a31593f8ae69232af20', 'pinned official jar');
check(lanes.length === 2, 'two lanes executed');

for (const lane of lanes) {
  const record = Buffer.from(lane.recordHex.slice(2), 'hex');
  const domainHash = createHash('sha3-256').update(DOMAIN, 'ascii').digest();
  const digest = `0x${createHash('sha3-256').update(domainHash).update(record).digest('hex')}`;
  check(lane.schema === 'generic-lane-txpow-benchmark/v1', `${lane.lane} benchmark schema`);
  check(record.length === RECORD_BYTES && lane.recordBytes === RECORD_BYTES, `${lane.lane} record length`);
  check(Object.keys(lane.recordFields).length === FIELDS.length, `${lane.lane} Java emitted all semantic fields`);
  check(encodeRecord(lane.recordFields).equals(record), `${lane.lane} primary encoder reproduces Java record`);
  check(independentlyEncode(lane.recordFields).equals(record), `${lane.lane} independent encoder reproduces Java record`);
  check(digest === lane.recordDigest, `${lane.lane} Node and Core SHA3 digest parity`);
  check(hex(record, offsets.destinationTokenId.offset, 32) === lane.bridgeTokenId, `${lane.lane} record token binding`);
  check(hex(record, offsets.reserveCovenant.offset, 32) === lane.covenantAddress, `${lane.lane} record covenant binding`);
  check(lane.fiveSignatureBytes === 20_625, `${lane.lane} exact five-signature size`);
  check(lane.coinProofDepth === 32, `${lane.lane} synthetic proof depth`);
  check(lane.serializedTxPowBytes > lane.witnessBytes && lane.serializedTxPowBytes < 65_536, `${lane.lane} full TxPoW size`);
  check(lane.controlInstructions > 0 && lane.controlInstructions < 1_024, `${lane.lane} control instructions`);
  check(lane.reserveInstructions > 0 && lane.reserveInstructions < 1_024, `${lane.lane} reserve instructions`);
  check(lane.controlScriptPassed && lane.reserveScriptPassed, `${lane.lane} KISS branches`);
  check(lane.signaturesVerified, `${lane.lane} WOTS verification`);
  check(lane.transactionAmountsValid, `${lane.lane} token conservation`);
  check(lane.equalHeadControlPassed && lane.equalHeadReservePassed, `${lane.lane} bounded equal-head KISS branches`);
  check(lane.equalHeadSignaturesVerified && lane.equalHeadTransactionAmountsValid, `${lane.lane} equal-head signature and conservation`);
  check(lane.equalHeadControlInstructions > 0 && lane.equalHeadControlInstructions < 1_024, `${lane.lane} equal-head instructions`);
  check(lane.equalHeadSerializedTxPowBytes < 65_536, `${lane.lane} equal-head TxPoW size`);
  check(lane.staleOriginalSignaturesRejected, `${lane.lane} stale original signatures`);
  check(lane.staleSignatureRecordFieldMutationsRejected === FIELDS.length, `${lane.lane} all field mutations change signed transaction ID`);
  check(lane.authorizedStructuralMutationsRejected === lane.authorizedStructuralMutationCount && lane.authorizedStructuralMutationCount === 14, `${lane.lane} exhaustive output shape mutations`);
  check(lane.freshlySignedPreservedStatePortsRejected === 6, `${lane.lane} freshly signed ports 19-24 mutations`);
  check(Object.values(lane.acceptedHeadBlockBoundaries).length === 4
    && Object.values(lane.acceptedHeadBlockBoundaries).every((value) => value === true), `${lane.lane} accepted-head block boundaries`);
  check(mutationNames.every((name) => lane.mutationsRejected[name] === true), `${lane.lane} hostile mutations`);
  check(uint(record, offsets.amountSourceAtoms.offset, 8) === uint(record, offsets.amountDestinationAtoms.offset, 8), `${lane.lane} exact atom parity`);
  check(uint(record, offsets.vaultPayoutCursor.offset, 8) === 3n, `${lane.lane} release preserves payout cursor`);
  check(uint(record, offsets.vaultCumulativePaidSourceAtoms.offset, 8) === (lane.lane === 'native-ethm' ? 200_000_000_000_000_000n : 200_000n), `${lane.lane} release preserves cumulative paid`);
}

const erc20 = lanes.find((lane) => lane.lane === 'erc20-usdtm');
const native = lanes.find((lane) => lane.lane === 'native-ethm');
check(erc20 !== undefined && native !== undefined, 'expected lane names');
const ercRecord = Buffer.from(erc20.recordHex.slice(2), 'hex');
const nativeRecord = Buffer.from(native.recordHex.slice(2), 'hex');
check(uint(ercRecord, offsets.sourceAssetKind.offset, 1) === 1n, 'ERC-20 kind');
check(hex(ercRecord, offsets.sourceAsset.offset, 20) !== `0x${'00'.repeat(20)}`, 'ERC-20 token nonzero');
check(uint(ercRecord, offsets.sourceDecimals.offset, 1) === 6n, 'ERC-20 decimals');
check(uint(nativeRecord, offsets.sourceAssetKind.offset, 1) === 0n, 'native kind');
check(hex(nativeRecord, offsets.sourceAsset.offset, 20) === `0x${'00'.repeat(20)}`, 'native zero-address sentinel');
check(uint(nativeRecord, offsets.sourceDecimals.offset, 1) === 18n && uint(nativeRecord, offsets.destinationDecimals.offset, 1) === 18n, 'native 18 decimals');
check(uint(nativeRecord, offsets.amountDestinationAtoms.offset, 8) === 1_250_000_000_000_000_000n, 'native 1.25 ETH exact wei fixture');
check(uint(nativeRecord, offsets.laneExposureCapDestinationAtoms.offset, 8) === 10_000_000_000_000_000_000n, 'native 10 ETH cap');

const result = {
  schema: 'generic-bridge-p7-txpow-validation/v1',
  status: 'offline-complete-synthetic-pass',
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha256(readFileSync(sourcePath)),
  harness: 'p7/GenericLaneTxPowBenchmark.java',
  harnessSha256: sha256(readFileSync(harness)),
  coreCommit: commit,
  minimaJarSha256: sha256(readFileSync(minimaJar)),
  recordSchemaBytes: RECORD_BYTES,
  laneCount: lanes.length,
  assertionCount: assertions,
  mutationsPerLane: mutationNames.length + lanes[0].authorizedStructuralMutationCount + FIELDS.length + 1 + 6,
  txpowHardLimitBytes: 65_536,
  kissInstructionLimit: 1_024,
  lanes,
  exactOfflineSignedTxPowMeasured: true,
  transactionAndWitnessSerializedByPinnedCore: true,
  kissRuntimeExecutedAgainstPinnedCore: true,
  syntheticCoinProofs: true,
  hypotheticalValuelessTokenMetadata: true,
  nodeTxncheckExecutedByThisOfflineHarness: false,
  eighteenDecimalTokenUsedByThisHarness: false,
  candidateV2MainnetTransitionMined: true,
  liveV2MainnetEvidenceSeparate: 'evidence/generic-mainnet-v2-live-p7-20260819T143029Z.json',
  noNodeWalletTokenOrTransactionCommands: true,
  blockers: [
    'Coin proofs are deterministic 32-level synthetic proofs, not proofs for current mainnet UTXOs.',
    'Token metadata inside this deterministic harness is hypothetical; the separately recorded v2 mainnet ceremony uses the actual mined token IDs and UTXOs.',
    'This offline harness itself does not call node txncheck or mine; the separate live P7 evidence records both v2 node checks and mined transitions.',
    'Historical deposit non-reuse remains enforced by independently operated quorum journals under the declared fewer-than-five-collude assumption, not by a stock-KISS non-membership proof.'
  ]
};

if (emitEvidence) {
  const createdAtUtc = new Date().toISOString();
  const stamp = createdAtUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `generic-p7-txpow-validation-${stamp}.json`);
  const serialized = `${JSON.stringify({ createdAtUtc, ...result }, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
