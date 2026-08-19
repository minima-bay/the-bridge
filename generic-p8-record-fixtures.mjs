import { createHash } from 'node:crypto';
import { ACTION, DOMAIN } from './generic-p8-records-primary.mjs';

const h = (label, bytes = 32) => `0x${createHash('sha3-256').update(label, 'ascii').digest('hex').slice(0, bytes * 2)}`;
const uint = (value, width) => {
  let number = BigInt(value);
  const output = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index -= 1) { output[index] = Number(number & 255n); number >>= 8n; }
  return output;
};
const raw = (value) => Buffer.from(String(value).replace(/^0x/i, ''), 'hex');
const asciiPad = (value, width) => { const output = Buffer.alloc(width); Buffer.from(value, 'ascii').copy(output); return output; };

export function redemptionId(record) {
  return `0x${createHash('sha256').update(Buffer.concat([
    asciiPad('BRIDGE_LANE_REDEMPTION_V2', 32), raw(record.minimaNetwork), raw(record.laneId),
    raw(record.destinationTokenId), raw(record.reserveCovenant), raw(record.returnedCoinId),
    uint(record.amountDestinationAtoms, 8), raw(record.ethereumRecipient), uint(record.configurationEpoch, 8),
  ])).digest('hex')}`;
}

function common(mode, type) {
  const eth = mode === 'eth';
  return {
    domainTag: DOMAIN[type], schemaVersion: '1', action: String(ACTION[type]), laneVersion: '2',
    sourceAssetKind: eth ? '0' : '1', sourceDecimals: eth ? '18' : '6',
    destinationDecimals: eth ? '18' : '6', sourceQuantumAtoms: '1', destinationQuantumAtoms: '1',
    laneExposureCapDestinationAtoms: eth ? '10000000000000000000' : '999999999999',
    ethereumChainId: '1', minimaNetwork: h('p8-minima-mainnet'),
    ethereumVault: eth ? h('p8-eth-vault', 20) : h('p8-usdt-vault', 20),
    sourceAsset: eth ? `0x${'00'.repeat(20)}` : h('p8-usdt-token', 20),
    laneId: h(`p8-${mode}-lane`), destinationTokenId: h(`p8-${mode}-destination-token`),
    reserveCovenant: h(`p8-${mode}-reserve-covenant`), controlTokenId: h(`p8-${mode}-control-token`),
    configurationEpoch: '1', committeeEpoch: '9', committeeRoot: h('p8-committee-root'),
  };
}

function sourceValues(mode, prefix, previous = '17', next = '18') {
  const eth = mode === 'eth';
  return {
    finalizedBlockNumber: '22123457', finalizedBlockHash: h(`p8-${mode}-${prefix}-block`),
    sourceRecordHash: h(`p8-${mode}-${prefix}-source-record`),
    previousVaultStateVersion: previous, vaultStateVersion: next,
    newClientStateHash: h(`p8-${mode}-${prefix}-client`),
    newBridgeStateHash: h(`p8-${mode}-${prefix}-bridge`),
    vaultBalanceSourceAtoms: eth ? '5000000000000000000' : '5000000',
    vaultPayoutCursor: '3',
    vaultCumulativePaidSourceAtoms: eth ? '200000000000000000' : '200000',
    sourceExecutionTimeMilliseconds: '1700000000000',
  };
}

function record(mode, type) {
  const eth = mode === 'eth';
  const base = common(mode, type);
  const amount = eth ? '1250000000000000000' : '1250000';
  if (type === 'CLIENT_UPDATE') return { ...base, ...sourceValues(mode, 'client') };
  if (type === 'RELEASE') return {
    ...base, depositId: h(`p8-${mode}-deposit`), amountSourceAtoms: amount,
    amountDestinationAtoms: amount, minimaRecipient: h(`p8-${mode}-minima-recipient`),
    ...sourceValues(mode, 'release'),
  };
  if (type === 'RETURN') {
    const result = {
      ...base, returnedCoinId: h(`p8-${mode}-returned-coin`),
      amountSourceAtoms: eth ? '500000000000000000' : '500000',
      amountDestinationAtoms: eth ? '500000000000000000' : '500000',
      ethereumRecipient: h(`p8-${mode}-ethereum-recipient`, 20),
    };
    return { ...result, redemptionId: redemptionId(result) };
  }
  if (type === 'CANCEL') return {
    ...base, depositId: h(`p8-${mode}-cancel-deposit`), amountSourceAtoms: amount,
    amountDestinationAtoms: amount, minimaRecipient: h(`p8-${mode}-cancel-minima-recipient`),
    refundRecipient: h(`p8-${mode}-refund-recipient`, 20),
    cancellationAuthorityPublicKey: h(`p8-${mode}-cancellation-authority`), ethereumRecordStatus: '1',
    ...sourceValues(mode, 'cancel'),
  };
  if (type === 'PAYOUT_ACK') {
    const prior = eth ? 200000000000000000n : 200000n;
    const batch = eth ? 200000000000000000n : 200000n;
    return {
      ...base, payoutBatchId: h(`p8-${mode}-payout-batch`), priorPayoutCursor: '3', newPayoutCursor: '4',
      priorCumulativePaidSourceAtoms: String(prior), newCumulativePaidSourceAtoms: String(prior + batch),
      batchPaidSourceAtoms: String(batch), batchPaidDestinationAtoms: String(batch),
      firstRedemptionId: h(`p8-${mode}-first-redemption`), lastRedemptionId: h(`p8-${mode}-last-redemption`),
      payoutRangeRoot: h(`p8-${mode}-payout-range`), finalizedBlockNumber: '22123458',
      finalizedBlockHash: h(`p8-${mode}-payout-block`), sourceRecordHash: h(`p8-${mode}-payout-source-record`),
      previousVaultStateVersion: '18', vaultStateVersion: '19',
      newClientStateHash: h(`p8-${mode}-payout-client`), newBridgeStateHash: h(`p8-${mode}-payout-bridge`),
      vaultBalanceSourceAtoms: eth ? '4800000000000000000' : '4800000',
      sourceExecutionTimeMilliseconds: '1700000000000',
    };
  }
  throw new Error(`unknown type ${type}`);
}

export const fixtures = Object.freeze(['erc20', 'eth'].flatMap((mode) =>
  Object.keys(ACTION).map((type) => Object.freeze({ name: `${mode}-${type.toLowerCase()}`, mode, type, record: Object.freeze(record(mode, type)) }))));
