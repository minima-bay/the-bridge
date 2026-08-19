import { createHash } from 'node:crypto';

export const DOMAIN = 'BRIDGE_LANE_ATTESTATION_V1';

export const FIELDS = Object.freeze([
  ['schemaVersion', 2, 'uint'],
  ['direction', 1, 'uint'],
  ['laneVersion', 2, 'uint'],
  ['sourceAssetKind', 1, 'uint'],
  ['sourceDecimals', 1, 'uint'],
  ['destinationDecimals', 1, 'uint'],
  ['sourceQuantumAtoms', 8, 'uint'],
  ['destinationQuantumAtoms', 8, 'uint'],
  ['laneExposureCapDestinationAtoms', 8, 'uint'],
  ['ethereumChainId', 8, 'uint'],
  ['minimaNetwork', 32, 'hex'],
  ['ethereumVault', 20, 'hex'],
  ['sourceAsset', 20, 'hex'],
  ['laneId', 32, 'hex'],
  ['destinationTokenId', 32, 'hex'],
  ['reserveCovenant', 32, 'hex'],
  ['depositId', 32, 'hex'],
  ['amountSourceAtoms', 8, 'uint'],
  ['amountDestinationAtoms', 8, 'uint'],
  ['minimaRecipient', 32, 'hex'],
  ['finalizedBlockNumber', 8, 'uint'],
  ['finalizedBlockHash', 32, 'hex'],
  ['sourceRecordHash', 32, 'hex'],
  ['vaultStateVersion', 8, 'uint'],
  ['vaultBalanceSourceAtoms', 8, 'uint'],
  ['vaultPayoutCursor', 8, 'uint'],
  ['vaultCumulativePaidSourceAtoms', 8, 'uint'],
  ['committeeEpoch', 4, 'uint'],
  ['committeeRoot', 32, 'hex'],
  ['configurationEpoch', 8, 'uint'],
  ['sourceExecutionTimeMilliseconds', 8, 'uint'],
]);

export const RECORD_BYTES = FIELDS.reduce((sum, [, width]) => sum + width, 0);

function uintBytes(value, width, name) {
  const number = BigInt(value);
  if (number < 0n || number >= (1n << BigInt(width * 8))) throw new Error(`${name} does not fit uint${width * 8}`);
  const out = Buffer.alloc(width);
  let remaining = number;
  for (let index = width - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function hexBytes(value, width, name) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${width * 2}}$`).test(value)) {
    throw new Error(`${name} is not canonical lowercase ${width}-byte hex`);
  }
  return Buffer.from(value.slice(2), 'hex');
}

export function encodeRecord(record) {
  const exact = Object.keys(record);
  if (exact.length !== FIELDS.length || !FIELDS.every(([name]) => Object.hasOwn(record, name))) {
    throw new Error('record field set is not exact');
  }
  const encoded = Buffer.concat(FIELDS.map(([name, width, kind]) => (
    kind === 'uint' ? uintBytes(record[name], width, name) : hexBytes(record[name], width, name)
  )));
  if (encoded.length !== RECORD_BYTES) throw new Error('record length changed');
  return encoded;
}

export function recordDigest(record) {
  const domainHash = createHash('sha3-256').update(DOMAIN, 'ascii').digest();
  return `0x${createHash('sha3-256').update(domainHash).update(encodeRecord(record)).digest('hex')}`;
}

export function fieldOffsets() {
  let offset = 0;
  return Object.fromEntries(FIELDS.map(([name, width]) => {
    const entry = [name, { offset, width }];
    offset += width;
    return entry;
  }));
}
