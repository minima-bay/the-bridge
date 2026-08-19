import { createHash } from 'node:crypto';

const DOMAIN_BY_ACTION = new Map([
  [1n, 'BRIDGE_LANE_CLIENT_V2'], [2n, 'BRIDGE_LANE_RELEASE_V2'], [3n, 'BRIDGE_LANE_RETURN_V2'],
  [5n, 'BRIDGE_LANE_CANCEL_V2'], [7n, 'BRIDGE_LANE_PAYOUT_V2'],
]);

class Writer {
  constructor() { this.parts = []; }
  ascii(value, width) {
    const input = Buffer.from(value, 'ascii');
    if (input.length > width || input.toString('ascii') !== value) throw new Error('invalid ascii');
    const output = Buffer.alloc(width); input.copy(output); this.parts.push(output); return this;
  }
  hex(value, width) {
    const normalized = String(value).replace(/^0x/i, '').toLowerCase();
    if (!new RegExp(`^[0-9a-f]{${width * 2}}$`).test(normalized)) throw new Error('invalid hex');
    this.parts.push(Buffer.from(normalized, 'hex')); return this;
  }
  uint(value, width) {
    let number = BigInt(value);
    if (number < 0n || number >= (1n << BigInt(width * 8))) throw new Error('invalid uint');
    const output = Buffer.alloc(width);
    for (let index = width - 1; index >= 0; index -= 1) { output[index] = Number(number & 255n); number >>= 8n; }
    this.parts.push(output); return this;
  }
  finish() { return Buffer.concat(this.parts); }
}

function common(writer, record) {
  return writer.ascii(record.domainTag, 32).uint(record.schemaVersion, 2).uint(record.action, 2)
    .uint(record.laneVersion, 2).uint(record.sourceAssetKind, 1).uint(record.sourceDecimals, 1)
    .uint(record.destinationDecimals, 1).uint(record.sourceQuantumAtoms, 8)
    .uint(record.destinationQuantumAtoms, 8).uint(record.laneExposureCapDestinationAtoms, 8)
    .uint(record.ethereumChainId, 8).hex(record.minimaNetwork, 32).hex(record.ethereumVault, 20)
    .hex(record.sourceAsset, 20).hex(record.laneId, 32).hex(record.destinationTokenId, 32)
    .hex(record.reserveCovenant, 32).hex(record.controlTokenId, 32).uint(record.configurationEpoch, 8)
    .uint(record.committeeEpoch, 4).hex(record.committeeRoot, 32);
}

export function encodeP8RecordIndependent(record) {
  const action = BigInt(record.action);
  if (record.domainTag !== DOMAIN_BY_ACTION.get(action) || BigInt(record.schemaVersion) !== 1n
      || BigInt(record.laneVersion) !== 2n) throw new Error('record domain or version differs');
  const writer = common(new Writer(), record);
  if (action === 1n) {
    writer.uint(record.previousVaultStateVersion, 8).uint(record.vaultStateVersion, 8)
      .uint(record.finalizedBlockNumber, 8).hex(record.finalizedBlockHash, 32)
      .hex(record.sourceRecordHash, 32).hex(record.newClientStateHash, 32)
      .hex(record.newBridgeStateHash, 32).uint(record.vaultBalanceSourceAtoms, 8)
      .uint(record.vaultPayoutCursor, 8).uint(record.vaultCumulativePaidSourceAtoms, 8)
      .uint(record.sourceExecutionTimeMilliseconds, 8);
  } else if (action === 2n) {
    writer.hex(record.depositId, 32).uint(record.amountSourceAtoms, 8).uint(record.amountDestinationAtoms, 8)
      .hex(record.minimaRecipient, 32).uint(record.finalizedBlockNumber, 8)
      .hex(record.finalizedBlockHash, 32).hex(record.sourceRecordHash, 32)
      .uint(record.previousVaultStateVersion, 8).uint(record.vaultStateVersion, 8)
      .hex(record.newClientStateHash, 32).hex(record.newBridgeStateHash, 32)
      .uint(record.vaultBalanceSourceAtoms, 8).uint(record.vaultPayoutCursor, 8)
      .uint(record.vaultCumulativePaidSourceAtoms, 8).uint(record.sourceExecutionTimeMilliseconds, 8);
  } else if (action === 3n) {
    writer.hex(record.returnedCoinId, 32).uint(record.amountSourceAtoms, 8)
      .uint(record.amountDestinationAtoms, 8).hex(record.ethereumRecipient, 20).hex(record.redemptionId, 32);
  } else if (action === 5n) {
    writer.hex(record.depositId, 32).uint(record.amountSourceAtoms, 8).uint(record.amountDestinationAtoms, 8)
      .hex(record.minimaRecipient, 32).hex(record.refundRecipient, 20)
      .hex(record.cancellationAuthorityPublicKey, 32).uint(record.ethereumRecordStatus, 1)
      .uint(record.finalizedBlockNumber, 8).hex(record.finalizedBlockHash, 32)
      .hex(record.sourceRecordHash, 32).uint(record.previousVaultStateVersion, 8)
      .uint(record.vaultStateVersion, 8).hex(record.newClientStateHash, 32)
      .hex(record.newBridgeStateHash, 32).uint(record.vaultBalanceSourceAtoms, 8)
      .uint(record.vaultPayoutCursor, 8).uint(record.vaultCumulativePaidSourceAtoms, 8)
      .uint(record.sourceExecutionTimeMilliseconds, 8);
  } else if (action === 7n) {
    writer.hex(record.payoutBatchId, 32).uint(record.priorPayoutCursor, 8).uint(record.newPayoutCursor, 8)
      .uint(record.priorCumulativePaidSourceAtoms, 8).uint(record.newCumulativePaidSourceAtoms, 8)
      .uint(record.batchPaidSourceAtoms, 8).uint(record.batchPaidDestinationAtoms, 8)
      .hex(record.firstRedemptionId, 32).hex(record.lastRedemptionId, 32).hex(record.payoutRangeRoot, 32)
      .uint(record.finalizedBlockNumber, 8).hex(record.finalizedBlockHash, 32)
      .hex(record.sourceRecordHash, 32).uint(record.previousVaultStateVersion, 8)
      .uint(record.vaultStateVersion, 8).hex(record.newClientStateHash, 32)
      .hex(record.newBridgeStateHash, 32).uint(record.vaultBalanceSourceAtoms, 8)
      .uint(record.sourceExecutionTimeMilliseconds, 8);
  } else throw new Error('unsupported action');
  return writer.finish();
}

const domainHash = createHash('sha3-256').update('BRIDGE_P8_RECORD_V1', 'ascii').digest();
export function p8RecordDigestIndependent(record) {
  return `0x${createHash('sha3-256').update(Buffer.concat([domainHash, encodeP8RecordIndependent(record)])).digest('hex')}`;
}
