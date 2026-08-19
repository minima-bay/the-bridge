import { createHash } from 'node:crypto';

const C = {
  tag: (name) => [name, 'ascii', 32],
  u: (name, bytes) => [name, 'uint', bytes],
  h: (name, bytes) => [name, 'hex', bytes],
};

export const recordLayouts = {
  deposit: [C.tag('domainTag'), C.u('schemaVersion',2), C.u('action',2), C.u('sourceChainId',8), C.h('sourceGenesisCommitment',32), C.h('sourceBridgeDeploymentId',32), C.h('vaultAddress',20), C.h('sourceTokenAddress',20), C.h('destinationNetworkId',32), C.h('destinationBridgeDeploymentId',32), C.h('destinationTokenId',32), C.h('reserveCovenantCommitment',32), C.h('sourceRecordId',32), C.h('messageId',32), C.u('sourceAmountAtoms',16), C.u('destinationAmountAtoms',16), C.u('decimalScale',4), C.h('minimaRecipient',32), C.h('refundRecipient',20), C.u('authorityScheme',2), C.h('authorityPublicKey',32), C.u('configurationEpoch',8), C.u('ethereumRecordStatus',1), C.u('expectedMinimaNullifierStatus',1), C.u('sourceBlockNumber',8), C.u('sourceTimestampMs',8), C.h('sourceStorageRoot',32), C.u('vaultBalanceAtoms',16), C.u('fixedCapacityAtoms',16), C.u('usedCapacityBeforeAtoms',16), C.u('usedCapacityAfterAtoms',16), C.u('proofProgramVersion',4), C.u('verifierVersion',4), C.h('verificationKeyHash',32)],
  refund: [C.tag('domainTag'), C.u('schemaVersion',2), C.u('action',2), C.u('sourceChainId',8), C.h('sourceGenesisCommitment',32), C.h('sourceBridgeDeploymentId',32), C.h('vaultAddress',20), C.h('sourceTokenAddress',20), C.h('destinationNetworkId',32), C.h('destinationBridgeDeploymentId',32), C.h('sourceRecordId',32), C.h('messageId',32), C.u('amountAtoms',16), C.h('refundRecipient',20), C.u('recordStatusBefore',1), C.u('recordStatusAfter',1), C.h('cancellationTxpowId',32), C.u('cancellationOutputIndex',4), C.h('cancellationStateCommitment',32), C.u('minimaHeight',8), C.h('minimaBranchCommitment',32), C.u('capacityBeforeAtoms',16), C.u('capacityAfterAtoms',16), C.u('configurationEpoch',8), C.u('proofProgramVersion',4), C.u('verifierVersion',4), C.h('verificationKeyHash',32)],
  redemption: [C.tag('domainTag'), C.u('schemaVersion',2), C.u('action',2), C.h('destinationNetworkId',32), C.h('destinationBridgeDeploymentId',32), C.h('destinationTokenId',32), C.h('reserveCovenantCommitment',32), C.u('sourceChainId',8), C.h('sourceBridgeDeploymentId',32), C.h('redemptionId',32), C.h('returnedCoinId',32), C.u('returnedAmountAtoms',16), C.h('ethereumRecipient',20), C.h('txpowId',32), C.u('stateOutputIndex',4), C.h('stateCommitment',32), C.u('minimaHeight',8), C.h('minimaBranchCommitment',32), C.u('configurationEpoch',8), C.u('proofProgramVersion',4), C.u('verifierVersion',4), C.h('verificationKeyHash',32)],
  payoutBatch: [C.tag('domainTag'), C.u('schemaVersion',2), C.u('action',2), C.u('sourceChainId',8), C.h('sourceGenesisCommitment',32), C.h('sourceBridgeDeploymentId',32), C.h('vaultAddress',20), C.h('sourceTokenAddress',20), C.h('destinationNetworkId',32), C.h('destinationBridgeDeploymentId',32), C.u('priorCursor',8), C.u('newCursor',8), C.u('priorCumulativePaidAtoms',16), C.u('newCumulativePaidAtoms',16), C.u('batchPaidAtoms',16), C.h('firstRedemptionId',32), C.h('lastRedemptionId',32), C.h('payoutRangeRoot',32), C.u('vaultBalanceAtoms',16), C.u('sourceBlockNumber',8), C.u('sourceTimestampMs',8), C.h('sourceStateRoot',32), C.u('configurationEpoch',8), C.u('proofProgramVersion',4), C.u('verifierVersion',4), C.h('verificationKeyHash',32)],
  clientState: [C.tag('domainTag'), C.u('schemaVersion',2), C.u('action',2), C.u('sourceChainId',8), C.h('sourceGenesisCommitment',32), C.h('sourceBridgeDeploymentId',32), C.h('vaultAddress',20), C.h('sourceTokenAddress',20), C.h('destinationNetworkId',32), C.h('destinationBridgeDeploymentId',32), C.h('previousClientCommitment',32), C.h('newClientCommitment',32), C.u('finalizedSlot',8), C.u('executionBlockNumber',8), C.u('sourceTimestampMs',8), C.h('executionStateRoot',32), C.u('vaultBalanceAtoms',16), C.u('payoutCursor',8), C.u('cumulativePaidAtoms',16), C.u('destinationAcceptanceBlock',8), C.u('destinationAcceptanceTimestampMs',8), C.u('maximumSourceAgeMs',8), C.u('maximumFutureSkewMs',8), C.u('configurationEpoch',8), C.u('proofProgramVersion',4), C.u('verifierVersion',4), C.h('verificationKeyHash',32)],
};

function encodeField(name, kind, width, value) {
  if (kind === 'ascii') {
    const bytes = Buffer.from(value, 'ascii');
    if (bytes.length > width || bytes.toString('ascii') !== value) throw new Error(`invalid ${name}`);
    const output = Buffer.alloc(width); bytes.copy(output); return output;
  }
  if (kind === 'hex') {
    if (!new RegExp(`^[0-9a-f]{${width * 2}}$`).test(value)) throw new Error(`invalid ${name}`);
    return Buffer.from(value, 'hex');
  }
  let number = BigInt(value);
  if (number < 0n || number >= (1n << BigInt(width * 8))) throw new Error(`invalid ${name}`);
  const output = Buffer.alloc(width);
  for (let i = width - 1; i >= 0; i -= 1) { output[i] = Number(number & 255n); number >>= 8n; }
  return output;
}

export function encodeRecordPrimary(type, record) {
  const layout = recordLayouts[type];
  if (!layout) throw new Error('unknown record type');
  if (JSON.stringify(Object.keys(record)) !== JSON.stringify(layout.map(([name]) => name))) throw new Error('noncanonical fields or order');
  return Buffer.concat(layout.map(([name, kind, width]) => encodeField(name, kind, width, record[name])));
}

export const hashRecordPrimary = (type, record) => createHash('sha256').update(encodeRecordPrimary(type, record)).digest('hex');
