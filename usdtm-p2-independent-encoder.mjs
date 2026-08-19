import { createHash } from 'node:crypto';

function uint(value, width) {
  let number = BigInt(value);
  if (number < 0n || number >= 2n ** BigInt(width * 8)) throw new Error('integer out of range');
  let hex = number.toString(16);
  hex = hex.padStart(width * 2, '0');
  return Buffer.from(hex, 'hex');
}

function raw(value, width) {
  if (!new RegExp(`^[0-9a-f]{${width * 2}}$`).test(value)) throw new Error('invalid fixed bytes');
  return Buffer.from(value, 'hex');
}

function tag(value) {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 32 || [...encoded].some((byte) => byte > 127)) throw new Error('invalid domain tag');
  const result = new Uint8Array(32);
  result.set(encoded);
  return Buffer.from(result);
}

export function encodeCancellationIndependent(r) {
  return Buffer.concat([
    tag(r.domainTag), uint(r.schemaVersion, 2), uint(r.action, 2), uint(r.sourceChainId, 8),
    raw(r.sourceGenesisCommitment, 32), raw(r.destinationNetworkId, 32),
    raw(r.sourceBridgeDeploymentId, 32), raw(r.vaultAddress, 20),
    raw(r.destinationBridgeDeploymentId, 32), raw(r.reserveCovenantCommitment, 32),
    raw(r.sourceTokenAddress, 20), raw(r.destinationTokenId, 32), raw(r.sourceRecordId, 32),
    raw(r.messageId, 32), uint(r.sourceAmountAtoms, 16), uint(r.destinationAmountAtoms, 16),
    uint(r.decimalScale, 4), raw(r.minimaRecipient, 32), raw(r.refundRecipient, 20),
    uint(r.authorityScheme, 2), raw(r.authorityPublicKey, 32), uint(r.configurationEpoch, 8),
    uint(r.ethereumRecordStatus, 1), uint(r.expectedMinimaNullifierStatus, 1),
    uint(r.proofProgramVersion, 4), uint(r.verifierVersion, 4), raw(r.verificationKeyHash, 32),
  ]);
}

export const hashCancellationIndependent = (record) => createHash('sha256').update(encodeCancellationIndependent(record)).digest('hex');
