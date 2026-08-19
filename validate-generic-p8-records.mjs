#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION, DOMAIN, encodeP8Record, layoutFor, offsetsFor, p8RecordDigest, recordType } from './generic-p8-records-primary.mjs';
import { encodeP8RecordIndependent, p8RecordDigestIndependent } from './generic-p8-records-independent.mjs';
import { fixtures, redemptionId } from './generic-p8-record-fixtures.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = fileURLToPath(import.meta.url);
const emitEvidence = process.argv.includes('--evidence');
const ZERO20 = `0x${'00'.repeat(20)}`;
const ZERO32 = `0x${'00'.repeat(32)}`;
const expectedLengths = Object.freeze({ CLIENT_UPDATE: 501, RELEASE: 581, RETURN: 417, CANCEL: 634, PAYOUT_ACK: 661 });
let assertions = 0;
let mutationCount = 0;
let semanticRejectionCount = 0;

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
function nonzero(value) { return !/^0x0+$/i.test(String(value)); }
function positive(value, name) { if (BigInt(value) <= 0n) throw new Error(`${name} must be positive`); }
function converted(record, sourceName = 'amountSourceAtoms', destinationName = 'amountDestinationAtoms') {
  return BigInt(record[sourceName]) * BigInt(record.destinationQuantumAtoms)
    === BigInt(record[destinationName]) * BigInt(record.sourceQuantumAtoms);
}
function semanticValidate(record, expectedLane = undefined) {
  const type = recordType(record);
  if (record.domainTag !== DOMAIN[type]) throw new Error('domain/action mismatch');
  if (BigInt(record.schemaVersion) !== 1n || BigInt(record.laneVersion) !== 2n) throw new Error('version mismatch');
  if (![0n, 1n].includes(BigInt(record.sourceAssetKind))) throw new Error('source kind');
  if (BigInt(record.sourceQuantumAtoms) <= 0n || BigInt(record.destinationQuantumAtoms) <= 0n) throw new Error('zero quantum');
  if (BigInt(record.laneExposureCapDestinationAtoms) <= 0n) throw new Error('zero cap');
  for (const name of ['minimaNetwork', 'ethereumVault', 'laneId', 'destinationTokenId', 'reserveCovenant', 'controlTokenId', 'committeeRoot']) {
    if (!nonzero(record[name])) throw new Error(`zero ${name}`);
  }
  if (BigInt(record.sourceAssetKind) === 0n && record.sourceAsset !== ZERO20) throw new Error('native source sentinel');
  if (BigInt(record.sourceAssetKind) === 1n && !nonzero(record.sourceAsset)) throw new Error('ERC source token');
  if (expectedLane) {
    for (const name of ['sourceAssetKind', 'sourceDecimals', 'destinationDecimals', 'sourceQuantumAtoms',
      'destinationQuantumAtoms', 'laneExposureCapDestinationAtoms', 'ethereumChainId', 'minimaNetwork',
      'ethereumVault', 'sourceAsset', 'laneId', 'destinationTokenId', 'reserveCovenant', 'controlTokenId',
      'configurationEpoch', 'committeeEpoch', 'committeeRoot']) {
      if (String(record[name]).toLowerCase() !== String(expectedLane[name]).toLowerCase()) throw new Error(`lane mismatch ${name}`);
    }
  }
  if (type === 'CLIENT_UPDATE') {
    if (BigInt(record.vaultStateVersion) !== BigInt(record.previousVaultStateVersion) + 1n) throw new Error('client version step');
  } else if (type === 'RELEASE') {
    positive(record.amountSourceAtoms, 'source amount'); positive(record.amountDestinationAtoms, 'destination amount');
    if (!converted(record) || !nonzero(record.depositId) || !nonzero(record.minimaRecipient)) throw new Error('release binding');
    const delta = BigInt(record.vaultStateVersion) - BigInt(record.previousVaultStateVersion);
    if (delta !== 0n && delta !== 1n) throw new Error('release version');
  } else if (type === 'RETURN') {
    positive(record.amountSourceAtoms, 'source amount'); positive(record.amountDestinationAtoms, 'destination amount');
    if (!converted(record) || !nonzero(record.returnedCoinId) || !nonzero(record.ethereumRecipient)) throw new Error('return binding');
    if (record.redemptionId.toLowerCase() !== redemptionId(record).toLowerCase()) throw new Error('redemption id');
  } else if (type === 'CANCEL') {
    positive(record.amountSourceAtoms, 'source amount'); positive(record.amountDestinationAtoms, 'destination amount');
    if (!converted(record) || BigInt(record.ethereumRecordStatus) !== 1n || !nonzero(record.cancellationAuthorityPublicKey)) throw new Error('cancel binding');
    if (!nonzero(record.depositId) || !nonzero(record.minimaRecipient) || !nonzero(record.refundRecipient)) throw new Error('cancel identity');
    const delta = BigInt(record.vaultStateVersion) - BigInt(record.previousVaultStateVersion);
    if (delta !== 0n && delta !== 1n) throw new Error('cancel version');
  } else if (type === 'PAYOUT_ACK') {
    positive(record.batchPaidSourceAtoms, 'batch source'); positive(record.batchPaidDestinationAtoms, 'batch destination');
    if (BigInt(record.newPayoutCursor) !== BigInt(record.priorPayoutCursor) + 1n) throw new Error('payout cursor');
    if (BigInt(record.newCumulativePaidSourceAtoms) - BigInt(record.priorCumulativePaidSourceAtoms) !== BigInt(record.batchPaidSourceAtoms)) throw new Error('payout cumulative delta');
    if (!converted(record, 'batchPaidSourceAtoms', 'batchPaidDestinationAtoms')) throw new Error('payout conversion');
    if (BigInt(record.vaultStateVersion) !== BigInt(record.previousVaultStateVersion) + 1n) throw new Error('payout version');
  }
  encodeP8Record(record);
  return true;
}
function mutatedValue(record, name, kind, width) {
  if (kind === 'ascii') return record[name].endsWith('X') ? `${record[name].slice(0, -1)}Y` : `${record[name]}X`;
  if (kind === 'hex') {
    const value = String(record[name]);
    return `${value.slice(0, -1)}${value.at(-1) === '0' ? '1' : '0'}`;
  }
  const current = BigInt(record[name]);
  const maximum = (1n << BigInt(width * 8)) - 1n;
  return (current === maximum ? current - 1n : current + 1n).toString();
}
function mustReject(record, label) {
  let rejected = false;
  try { semanticValidate(record); } catch { rejected = true; }
  check(rejected, `semantic negative accepted: ${label}`);
  semanticRejectionCount += 1;
}
function mustRejectAgainst(record, expectedLane, label) {
  let rejected = false;
  try { semanticValidate(record, expectedLane); } catch { rejected = true; }
  check(rejected, `semantic lane negative accepted: ${label}`);
  semanticRejectionCount += 1;
}

check(fixtures.length === 10, 'five actions for two lanes');
const results = [];
for (const fixture of fixtures) {
  const { record, type, mode, name } = fixture;
  const primary = encodeP8Record(record);
  const independent = encodeP8RecordIndependent(record);
  check(primary.length === expectedLengths[type], `${name} exact length`);
  check(primary.equals(independent), `${name} independent bytes`);
  check(p8RecordDigest(record) === p8RecordDigestIndependent(record), `${name} independent digest`);
  check(semanticValidate(record), `${name} semantic fixture`);
  check(BigInt(record.action) === BigInt(ACTION[type]), `${name} action code`);
  check(record.domainTag === DOMAIN[type], `${name} domain`);
  if (mode === 'eth') {
    check(record.sourceAssetKind === '0' && record.sourceAsset === ZERO20, `${name} native identity`);
    check(record.sourceDecimals === '18' && record.destinationDecimals === '18', `${name} native decimals`);
  } else {
    check(record.sourceAssetKind === '1' && record.sourceAsset !== ZERO20, `${name} ERC identity`);
    check(record.sourceDecimals === '6' && record.destinationDecimals === '6', `${name} ERC decimals`);
  }
  const baseline = p8RecordDigest(record);
  for (const [field, kind, width] of layoutFor(type)) {
    const mutated = { ...record, [field]: mutatedValue(record, field, kind, width) };
    let changedOrRejected = false;
    try {
      changedOrRejected = p8RecordDigest(mutated) !== baseline
        && p8RecordDigestIndependent(mutated) !== p8RecordDigestIndependent(record);
    } catch { changedOrRejected = true; }
    check(changedOrRejected, `${name} mutation bound: ${field}`);
    mutationCount += 1;
  }
  const offsets = offsetsFor(type);
  const last = layoutFor(type).at(-1)[0];
  check(offsets[last].offset + offsets[last].width === expectedLengths[type], `${name} offsets cover bytes`);
  results.push({ name, type, mode, recordBytes: primary.length, fieldCount: layoutFor(type).length,
    recordDigest: baseline, encodedHex: `0x${primary.toString('hex')}`, offsets });
}

const sample = Object.fromEntries(fixtures.map((item) => [item.name, item.record]));
mustReject({ ...sample['eth-client_update'], sourceAssetKind: '1' }, 'native kind with zero source token');
mustReject({ ...sample['erc20-client_update'], sourceAssetKind: '0' }, 'ERC token in native lane');
mustReject({ ...sample['erc20-client_update'], sourceQuantumAtoms: '0' }, 'zero source quantum');
mustReject({ ...sample['erc20-client_update'], vaultStateVersion: sample['erc20-client_update'].previousVaultStateVersion }, 'client equal version');
mustReject({ ...sample['erc20-release'], amountDestinationAtoms: '1250001' }, 'release conversion mismatch');
mustReject({ ...sample['erc20-release'], depositId: ZERO32 }, 'release zero deposit id');
mustReject({ ...sample['erc20-release'], vaultStateVersion: '20' }, 'release skipped version');
mustReject({ ...sample['erc20-return'], redemptionId: ZERO32 }, 'return wrong redemption id');
mustReject({ ...sample['erc20-return'], returnedCoinId: ZERO32 }, 'return zero coin id');
mustReject({ ...sample['erc20-cancel'], ethereumRecordStatus: '2' }, 'cancel non-pending status');
mustReject({ ...sample['erc20-cancel'], cancellationAuthorityPublicKey: ZERO32 }, 'cancel zero authority');
mustReject({ ...sample['erc20-payout_ack'], newPayoutCursor: '5' }, 'payout noncontiguous cursor');
mustReject({ ...sample['erc20-payout_ack'], newCumulativePaidSourceAtoms: '399999' }, 'payout wrong cumulative delta');
mustReject({ ...sample['erc20-payout_ack'], batchPaidDestinationAtoms: '199999' }, 'payout conversion mismatch');
mustReject({ ...sample['erc20-payout_ack'], vaultStateVersion: '20' }, 'payout skipped version');
mustRejectAgainst({ ...sample['erc20-release'], laneId: sample['eth-release'].laneId }, sample['erc20-release'], 'cross-lane record');
mustReject({ ...sample['erc20-release'], domainTag: DOMAIN.CANCEL }, 'cross-action domain');

const result = {
  schema: 'generic-bridge-p8-record-validation/v1', status: 'canonical-action-records-pass', phaseGatePassed: false,
  validator: basename(sourcePath), validatorSha256: sha(readFileSync(sourcePath)),
  primaryEncoderSha256: sha(readFileSync(resolve(root, 'generic-p8-records-primary.mjs'))),
  independentEncoderSha256: sha(readFileSync(resolve(root, 'generic-p8-records-independent.mjs'))),
  fixtureGeneratorSha256: sha(readFileSync(resolve(root, 'generic-p8-record-fixtures.mjs'))),
  schemaDocumentSha256: sha(readFileSync(resolve(root, 'generic-p8-record-schema-v2.md'))),
  actionCount: Object.keys(ACTION).length, laneCount: 2, recordCount: results.length,
  assertionCount: assertions, mutationCount, semanticRejectionCount, expectedLengths, records: results,
  kissRuntimeExecuted: false, txncheckExecuted: false, mainnetTransactionMined: false,
  noNodeWalletTokenSignatureOrTransactionCommands: true,
};
if (emitEvidence) {
  const createdAtUtc = new Date().toISOString();
  const stamp = createdAtUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `generic-p8-record-validation-${stamp}.json`);
  const serialized = `${JSON.stringify({ createdAtUtc, ...result }, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}
console.log(JSON.stringify(result, null, 2));
