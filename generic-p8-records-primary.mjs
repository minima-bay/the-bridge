import { createHash } from 'node:crypto';

export const ACTION = Object.freeze({ CLIENT_UPDATE: 1, RELEASE: 2, RETURN: 3, CANCEL: 5, PAYOUT_ACK: 7 });
export const DOMAIN = Object.freeze({
  CLIENT_UPDATE: 'BRIDGE_LANE_CLIENT_V2',
  RELEASE: 'BRIDGE_LANE_RELEASE_V2',
  RETURN: 'BRIDGE_LANE_RETURN_V2',
  CANCEL: 'BRIDGE_LANE_CANCEL_V2',
  PAYOUT_ACK: 'BRIDGE_LANE_PAYOUT_V2',
});

export const COMMON_LAYOUT = Object.freeze([
  ['domainTag', 'ascii', 32], ['schemaVersion', 'uint', 2], ['action', 'uint', 2],
  ['laneVersion', 'uint', 2], ['sourceAssetKind', 'uint', 1], ['sourceDecimals', 'uint', 1],
  ['destinationDecimals', 'uint', 1], ['sourceQuantumAtoms', 'uint', 8],
  ['destinationQuantumAtoms', 'uint', 8], ['laneExposureCapDestinationAtoms', 'uint', 8],
  ['ethereumChainId', 'uint', 8], ['minimaNetwork', 'hex', 32], ['ethereumVault', 'hex', 20],
  ['sourceAsset', 'hex', 20], ['laneId', 'hex', 32], ['destinationTokenId', 'hex', 32],
  ['reserveCovenant', 'hex', 32], ['controlTokenId', 'hex', 32], ['configurationEpoch', 'uint', 8],
  ['committeeEpoch', 'uint', 4], ['committeeRoot', 'hex', 32],
]);

export const SUFFIX_LAYOUTS = Object.freeze({
  CLIENT_UPDATE: Object.freeze([
    ['previousVaultStateVersion', 'uint', 8], ['vaultStateVersion', 'uint', 8],
    ['finalizedBlockNumber', 'uint', 8], ['finalizedBlockHash', 'hex', 32],
    ['sourceRecordHash', 'hex', 32], ['newClientStateHash', 'hex', 32],
    ['newBridgeStateHash', 'hex', 32], ['vaultBalanceSourceAtoms', 'uint', 8],
    ['vaultPayoutCursor', 'uint', 8], ['vaultCumulativePaidSourceAtoms', 'uint', 8],
    ['sourceExecutionTimeMilliseconds', 'uint', 8],
  ]),
  RELEASE: Object.freeze([
    ['depositId', 'hex', 32], ['amountSourceAtoms', 'uint', 8], ['amountDestinationAtoms', 'uint', 8],
    ['minimaRecipient', 'hex', 32], ['finalizedBlockNumber', 'uint', 8],
    ['finalizedBlockHash', 'hex', 32], ['sourceRecordHash', 'hex', 32],
    ['previousVaultStateVersion', 'uint', 8], ['vaultStateVersion', 'uint', 8],
    ['newClientStateHash', 'hex', 32], ['newBridgeStateHash', 'hex', 32],
    ['vaultBalanceSourceAtoms', 'uint', 8], ['vaultPayoutCursor', 'uint', 8],
    ['vaultCumulativePaidSourceAtoms', 'uint', 8], ['sourceExecutionTimeMilliseconds', 'uint', 8],
  ]),
  RETURN: Object.freeze([
    ['returnedCoinId', 'hex', 32], ['amountSourceAtoms', 'uint', 8],
    ['amountDestinationAtoms', 'uint', 8], ['ethereumRecipient', 'hex', 20], ['redemptionId', 'hex', 32],
  ]),
  CANCEL: Object.freeze([
    ['depositId', 'hex', 32], ['amountSourceAtoms', 'uint', 8], ['amountDestinationAtoms', 'uint', 8],
    ['minimaRecipient', 'hex', 32], ['refundRecipient', 'hex', 20],
    ['cancellationAuthorityPublicKey', 'hex', 32], ['ethereumRecordStatus', 'uint', 1],
    ['finalizedBlockNumber', 'uint', 8], ['finalizedBlockHash', 'hex', 32],
    ['sourceRecordHash', 'hex', 32], ['previousVaultStateVersion', 'uint', 8],
    ['vaultStateVersion', 'uint', 8], ['newClientStateHash', 'hex', 32],
    ['newBridgeStateHash', 'hex', 32], ['vaultBalanceSourceAtoms', 'uint', 8],
    ['vaultPayoutCursor', 'uint', 8], ['vaultCumulativePaidSourceAtoms', 'uint', 8],
    ['sourceExecutionTimeMilliseconds', 'uint', 8],
  ]),
  PAYOUT_ACK: Object.freeze([
    ['payoutBatchId', 'hex', 32], ['priorPayoutCursor', 'uint', 8], ['newPayoutCursor', 'uint', 8],
    ['priorCumulativePaidSourceAtoms', 'uint', 8], ['newCumulativePaidSourceAtoms', 'uint', 8],
    ['batchPaidSourceAtoms', 'uint', 8], ['batchPaidDestinationAtoms', 'uint', 8],
    ['firstRedemptionId', 'hex', 32], ['lastRedemptionId', 'hex', 32],
    ['payoutRangeRoot', 'hex', 32], ['finalizedBlockNumber', 'uint', 8],
    ['finalizedBlockHash', 'hex', 32], ['sourceRecordHash', 'hex', 32],
    ['previousVaultStateVersion', 'uint', 8], ['vaultStateVersion', 'uint', 8],
    ['newClientStateHash', 'hex', 32], ['newBridgeStateHash', 'hex', 32],
    ['vaultBalanceSourceAtoms', 'uint', 8], ['sourceExecutionTimeMilliseconds', 'uint', 8],
  ]),
});

export function recordType(record) {
  const found = Object.entries(ACTION).find(([, code]) => BigInt(record.action) === BigInt(code));
  if (!found) throw new Error('unsupported action');
  return found[0];
}
export function layoutFor(recordOrType) {
  const type = typeof recordOrType === 'string' ? recordOrType : recordType(recordOrType);
  if (!SUFFIX_LAYOUTS[type]) throw new Error(`unknown record type ${type}`);
  return [...COMMON_LAYOUT, ...SUFFIX_LAYOUTS[type]];
}
export function offsetsFor(recordOrType) {
  let offset = 0;
  return Object.fromEntries(layoutFor(recordOrType).map(([name,, width]) => {
    const entry = [name, { offset, width }];
    offset += width;
    return entry;
  }));
}
function encodeField(name, kind, width, value) {
  if (kind === 'ascii') {
    if (typeof value !== 'string') throw new Error(`invalid ${name}`);
    const bytes = Buffer.from(value, 'ascii');
    if (bytes.length > width || bytes.toString('ascii') !== value) throw new Error(`invalid ${name}`);
    const output = Buffer.alloc(width); bytes.copy(output); return output;
  }
  if (kind === 'hex') {
    const normalized = String(value).replace(/^0x/i, '').toLowerCase();
    if (!new RegExp(`^[0-9a-f]{${width * 2}}$`).test(normalized)) throw new Error(`invalid ${name}`);
    return Buffer.from(normalized, 'hex');
  }
  let number;
  try { number = BigInt(value); } catch { throw new Error(`invalid ${name}`); }
  if (number < 0n || number >= (1n << BigInt(width * 8))) throw new Error(`out-of-range ${name}`);
  const output = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index -= 1) { output[index] = Number(number & 255n); number >>= 8n; }
  return output;
}
export function encodeP8Record(record) {
  const type = recordType(record);
  if (record.domainTag !== DOMAIN[type] || BigInt(record.schemaVersion) !== 1n || BigInt(record.laneVersion) !== 2n) {
    throw new Error('record domain or version differs');
  }
  return Buffer.concat(layoutFor(type).map(([name, kind, width]) => encodeField(name, kind, width, record[name])));
}
const RECORD_DOMAIN_HASH = createHash('sha3-256').update('BRIDGE_P8_RECORD_V1', 'ascii').digest();
export function p8RecordDigest(record) {
  return `0x${createHash('sha3-256').update(Buffer.concat([RECORD_DOMAIN_HASH, encodeP8Record(record)])).digest('hex')}`;
}
