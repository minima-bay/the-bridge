#!/usr/bin/env node

import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const emitEvidence = process.argv.includes('--evidence');
const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const assertions = [];
const mutations = [];
let acceptedDeposits = 0;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
function ok(name, condition) {
  if (!condition) throw new Error(name);
  assertions.push(name);
}
function reject(name, fn) {
  let rejected = false;
  try { fn(); } catch { rejected = true; }
  ok(name, rejected);
}
const clone = (value) => structuredClone(value);
function stateDigest(value) {
  return sha256(JSON.stringify(value, (_, item) => {
    if (typeof item === 'bigint') return { bigint: String(item) };
    if (item instanceof Map) return { map: [...item.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))) };
    if (item instanceof Set) return { set: [...item].sort() };
    if (item?.type === 'private' || item?.type === 'public') return { key: item.type };
    return item;
  }));
}

function modelEncode(fields) {
  const parts = [Buffer.from('USDTM_P1_MODEL_ONLY_V2', 'ascii')];
  for (const [name, value] of Object.entries(fields)) {
    const key = Buffer.from(name, 'utf8');
    const bytes = Buffer.from(String(value), 'utf8');
    const kl = Buffer.alloc(2);
    const vl = Buffer.alloc(4);
    kl.writeUInt16BE(key.length);
    vl.writeUInt32BE(bytes.length);
    parts.push(kl, key, vl, bytes);
  }
  return Buffer.concat(parts);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const cancellationFields = {
  protocolDomain: 'MINIMA_ETH_DEPOSIT_CANCEL_V1',
  schemaVersion: '1',
  action: 'CANCEL_DEPOSIT',
  sourceChainId: '1',
  sourceGenesisCommitment: '11'.repeat(32),
  destinationNetworkId: '22'.repeat(32),
  sourceBridgeDeploymentId: '33'.repeat(32),
  vaultAddress: '44'.repeat(20),
  destinationBridgeDeploymentId: '55'.repeat(32),
  reserveCovenantCommitment: '66'.repeat(32),
  sourceTokenAddress: '77'.repeat(20),
  destinationTokenId: '88'.repeat(32),
  sourceRecordId: '7',
  messageId: '99'.repeat(32),
  sourceAmountAtoms: '1250000',
  destinationAmountAtoms: '1250000',
  decimalScale: '1',
  minimaRecipientBytes: 'aa'.repeat(32),
  refundRecipientBytes: 'bb'.repeat(20),
  authoritySchemeId: 'ED25519_MODEL_ONLY',
  authorityPublicKeyBytes: publicKey.export({ format: 'der', type: 'spki' }).toString('hex'),
  configurationEpoch: '3',
};
const cancellationDigest = (fields) => Buffer.from(sha256(modelEncode(fields)), 'hex');
const signature = sign(null, cancellationDigest(cancellationFields), privateKey);
ok('committed cancellation authority verifies', verify(null, cancellationDigest(cancellationFields), publicKey, signature));
for (const field of Object.keys(cancellationFields)) {
  const changed = { ...cancellationFields, [field]: `${cancellationFields[field]}:changed` };
  const detected = !verify(null, cancellationDigest(changed), publicKey, signature);
  ok(`cancellation field mutation rejected: ${field}`, detected);
  mutations.push({ family: 'cancellation-field', field, detected });
}
ok('different cancellation authority rejects', !verify(null, cancellationDigest(cancellationFields), generateKeyPairSync('ed25519').publicKey, signature));

const PENDING = 'PENDING';
const REFUNDED = 'REFUNDED';
const EMPTY = 'EMPTY';
const RELEASED = 'RELEASED';
const CANCELLED = 'CANCELLED';

function makeSystem() {
  const F = 10_000n;
  return {
    ethereum: {
      version: 0,
      records: new Map(),
      cumulativeAccepted: 0n,
      cumulativeRefunded: 0n,
      cumulativePaidRedemptions: 0n,
      fixedCapacity: F - 1n,
      transfers: new Map(),
      redemptions: new Set(),
      payoutRecords: [],
      vaultBalance: F,
      minimaCheckpoint: null,
      locked: false,
    },
    minima: {
      branch: 'A',
      height: 0,
      acceptedEthereumVersion: 0,
      payoutCursor: 0,
      acknowledgedPayoutAtoms: 0n,
      nullifiers: new Map(),
      F, R: F, I: 0n, P: 0n, L: F,
      tokenId: cancellationFields.destinationTokenId,
      destinationNetworkId: cancellationFields.destinationNetworkId,
      bridgeDeploymentId: cancellationFields.destinationBridgeDeploymentId,
      configurationEpoch: BigInt(cancellationFields.configurationEpoch),
      control: { id: 'control-v0', version: 0, spent: false, createdBy: 'bootstrap' },
      coins: new Map([
        ['reserve-v0', { id: 'reserve-v0', amount: F, covenant: true, spent: false, createdBy: 'bootstrap', output: 1 }],
        ['donated-equal', { id: 'donated-equal', amount: F, covenant: true, spent: false, createdBy: 'donation', output: 0 }],
        ['donated-wrong', { id: 'donated-wrong', amount: F - 1n, covenant: true, spent: false, createdBy: 'donation', output: 0 }],
      ]),
      canonicalReserveId: 'reserve-v0',
      returnedCoins: new Map(),
      redemptions: new Map(),
      transitions: new Map([['bootstrap', { txid: 'bootstrap', controlOutput: 'control-v0', reserveOutput: 'reserve-v0' }]]),
    },
  };
}

function usedCapacity(system) {
  const eth = system.ethereum;
  return eth.cumulativeAccepted - eth.cumulativeRefunded - eth.cumulativePaidRedemptions;
}
function assertSystem(system, options = {}) {
  const { ethereum: eth, minima: min } = system;
  const used = usedCapacity(system);
  if (used < 0n || used > eth.fixedCapacity) throw new Error('source capacity outside bound');
  if (min.R <= 0n || min.I < 0n || min.P < 0n) throw new Error('invalid Minima amount');
  if (min.R + min.I !== min.F) throw new Error('R + I != F');
  if (min.I + min.P > min.L) throw new Error('I + P > L');
  if (min.payoutCursor < 0 || min.payoutCursor > eth.payoutRecords.length) throw new Error('invalid payout cursor');
  if (min.acknowledgedPayoutAtoms < 0n || min.acknowledgedPayoutAtoms > eth.cumulativePaidRedemptions) throw new Error('invalid acknowledged payout total');
  const canonical = min.coins.get(min.canonicalReserveId);
  if (!canonical || canonical.spent || canonical.amount !== min.R || canonical.amount <= 0n) throw new Error('current reserve sibling missing or wrong');
  for (const [messageId, record] of eth.records) {
    const status = min.nullifiers.get(messageId) ?? EMPTY;
    if (record.status === REFUNDED && status !== CANCELLED && !options.finalityAssumptionBreached) throw new Error('refund without cancellation');
    if (record.status === REFUNDED && status === RELEASED && !options.finalityAssumptionBreached) throw new Error('refund plus release');
  }
}

function acceptDeposit(system, id, amount, fields = cancellationFields) {
  const eth = system.ethereum;
  if (eth.records.has(id)) throw new Error('duplicate deposit');
  if (amount <= 0n || usedCapacity(system) + amount > eth.fixedCapacity) throw new Error('capacity floor exceeded');
  eth.version += 1;
  const recordFields = {
    ...fields,
    messageId: id,
    sourceAmountAtoms: String(amount),
    destinationAmountAtoms: String(amount),
  };
  eth.records.set(id, { status: PENDING, amount, fields: recordFields, acceptedVersion: eth.version });
  eth.cumulativeAccepted += amount;
  acceptedDeposits += 1;
  assertSystem(system);
}
function ethereumRecordProof(system, id) {
  const record = system.ethereum.records.get(id);
  if (!record) throw new Error('missing record');
  return {
    chain: 'ETH', version: system.ethereum.version, id, status: record.status,
    amount: record.amount, fields: clone(record.fields), finalized: true,
    payoutCursor: system.ethereum.payoutRecords.length,
    cumulativePaidRedemptions: system.ethereum.cumulativePaidRedemptions,
    vaultBalance: system.ethereum.vaultBalance,
  };
}
function advanceEthereumHead(system) {
  system.ethereum.version += 1;
}
function ethereumClientProof(system) {
  const eth = system.ethereum;
  return {
    chain: 'ETH', finalized: true, version: eth.version,
    payoutCursor: eth.payoutRecords.length,
    cumulativePaidRedemptions: eth.cumulativePaidRedemptions,
    vaultBalance: eth.vaultBalance,
  };
}
function validateClientProof(system, proof) {
  const { ethereum: eth, minima: min } = system;
  if (!proof || proof.chain !== 'ETH' || !proof.finalized) throw new Error('client proof not finalized');
  if (proof.version !== eth.version || proof.version <= min.acceptedEthereumVersion) throw new Error('client update does not exactly advance authenticated head');
  if (proof.payoutCursor !== eth.payoutRecords.length
      || proof.cumulativePaidRedemptions !== eth.cumulativePaidRedemptions
      || proof.vaultBalance !== eth.vaultBalance) throw new Error('client proof bridge state mismatch');
  if (proof.payoutCursor !== min.payoutCursor
      || proof.cumulativePaidRedemptions !== min.acknowledgedPayoutAtoms) throw new Error('client update crosses unacknowledged payout');
  if (min.I + min.P > proof.vaultBalance) throw new Error('client proof collateral bound');
}
function validatePendingProof(system, proof) {
  if (!proof || proof.chain !== 'ETH' || !proof.finalized || proof.status !== PENDING) throw new Error('not finalized PENDING proof');
  if (proof.version !== system.ethereum.version || proof.version < system.minima.acceptedEthereumVersion) throw new Error('stale or unauthenticated Ethereum proof version');
  const record = system.ethereum.records.get(proof.id);
  if (!record || record.status !== PENDING || record.amount !== proof.amount) throw new Error('record mismatch');
  if (JSON.stringify(proof.fields) !== JSON.stringify(record.fields)) throw new Error('exact record fields mismatch');
  if (proof.payoutCursor !== system.ethereum.payoutRecords.length
      || proof.cumulativePaidRedemptions !== system.ethereum.cumulativePaidRedemptions
      || proof.vaultBalance !== system.ethereum.vaultBalance) throw new Error('Ethereum bridge state mismatch');
  if (proof.payoutCursor !== system.minima.payoutCursor
      || proof.cumulativePaidRedemptions !== system.minima.acknowledgedPayoutAtoms) throw new Error('unacknowledged payout range');
  return proof.version;
}

function redemptionIdFor(system, returnedCoin, recipient) {
  const domain = Buffer.alloc(32);
  Buffer.from('MINIMA_ETH_REDEMPTION_V1', 'ascii').copy(domain);
  const uint128 = Buffer.alloc(16);
  uint128.writeBigUInt64BE(returnedCoin.amount >> 64n, 0);
  uint128.writeBigUInt64BE(returnedCoin.amount & ((1n << 64n) - 1n), 8);
  const epoch = Buffer.alloc(8);
  epoch.writeBigUInt64BE(system.minima.configurationEpoch);
  const exactHex = (name, value, bytes) => {
    if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) throw new Error(`invalid ${name}`);
    return Buffer.from(value, 'hex');
  };
  return sha256(Buffer.concat([
    domain,
    exactHex('destination network ID', system.minima.destinationNetworkId, 32),
    exactHex('bridge deployment ID', system.minima.bridgeDeploymentId, 32),
    exactHex('token ID', system.minima.tokenId, 32),
    exactHex('returned coin ID', returnedCoin.id, 32),
    uint128,
    exactHex('Ethereum recipient', recipient, 20),
    epoch,
  ]));
}

function addReturnedCoin(system, id, amount, options = {}) {
  if (!/^[0-9a-f]{64}$/.test(id) || amount <= 0n) throw new Error('invalid returned coin identity or amount');
  if (system.minima.returnedCoins.has(id)) throw new Error('duplicate returned coin');
  system.minima.returnedCoins.set(id, {
    id,
    amount,
    tokenId: options.tokenId ?? system.minima.tokenId,
    owner: options.owner ?? 'USER',
    covenant: options.covenant ?? true,
    spent: false,
  });
  return id;
}
function exactReturnOptions(system, returnedCoinId, recipient) {
  const returnedCoin = system.minima.returnedCoins.get(returnedCoinId);
  if (!returnedCoin) throw new Error('missing returned coin');
  return { returnedCoinId, recipient, redemptionId: redemptionIdFor(system, returnedCoin, recipient) };
}
function branchShape(action) {
  if (action === 'RELEASE') return { inputs: 2, outputs: 3 };
  if (action === 'RETURN') return { inputs: 3, outputs: 2 };
  return { inputs: 2, outputs: 2 };
}

const validatedTransitionCapability = Symbol('validated proof transition');

function spendControlAndReserve(system, action, reserveId, amount = 0n, options = {}) {
  const min = system.minima;
  if (!['CLIENT_UPDATE', 'RELEASE', 'CANCEL', 'RETURN', 'PAYOUT_ACK'].includes(action)) throw new Error('unknown action');
  if (['CLIENT_UPDATE', 'RELEASE', 'CANCEL', 'PAYOUT_ACK'].includes(action) && options.validatedTransitionCapability !== validatedTransitionCapability) throw new Error('proof-gated action requires validated dispatcher');
  if (['CLIENT_UPDATE', 'CANCEL', 'PAYOUT_ACK'].includes(action) && amount !== 0n) throw new Error('non-message transition amount must be zero');
  const expectedVersion = options.expectedVersion ?? min.control.version;
  const shape = branchShape(action);
  if (expectedVersion !== min.control.version || min.control.spent) throw new Error('stale control');
  if ((options.inputs ?? shape.inputs) !== shape.inputs || (options.outputs ?? shape.outputs) !== shape.outputs) throw new Error('wrong cardinality');
  const reserve = min.coins.get(reserveId);
  if (!reserve || reserve.spent || !reserve.covenant || reserve.amount !== min.R || reserve.amount <= 0n) throw new Error('reserve not admitted');
  let successorAmount = min.R;
  let returnedCoin = null;
  let redemptionId = null;
  if (action === 'RELEASE') {
    if (amount <= 0n || amount >= min.R) throw new Error('release violates positive reserve floor');
    const collateralLimit = options.provedL ?? min.L;
    if (min.I + amount + min.P > collateralLimit) throw new Error('collateral bound');
    successorAmount = min.R - amount;
  } else if (action === 'RETURN') {
    if (amount <= 0n || amount > min.I) throw new Error('invalid return');
    returnedCoin = min.returnedCoins.get(options.returnedCoinId);
    if (!returnedCoin || returnedCoin.spent || !returnedCoin.covenant || returnedCoin.owner !== 'USER') throw new Error('returned coin not spendable');
    if (returnedCoin.tokenId !== min.tokenId || returnedCoin.amount !== amount) throw new Error('returned coin mismatch');
    if (!/^[0-9a-f]{40}$/.test(options.recipient ?? '')) throw new Error('invalid redemption recipient');
    redemptionId = redemptionIdFor(system, returnedCoin, options.recipient);
    if (options.redemptionId !== redemptionId || min.redemptions.has(redemptionId)) throw new Error('invalid redemption identity');
    successorAmount = min.R + amount;
  }
  if ((options.successorAmount ?? successorAmount) !== successorAmount || successorAmount <= 0n) throw new Error('wrong reserve successor');
  min.control.spent = true;
  reserve.spent = true;
  if (returnedCoin) returnedCoin.spent = true;
  const nextVersion = min.control.version + 1;
  const txid = `${action.toLowerCase()}-v${nextVersion}-${reserveId}`;
  const nextControlId = `control-v${nextVersion}`;
  const nextReserveId = `reserve-v${nextVersion}`;
  min.control = { id: nextControlId, version: nextVersion, spent: false, createdBy: txid };
  min.coins.set(nextReserveId, { id: nextReserveId, amount: successorAmount, covenant: true, spent: false, createdBy: txid, output: 1 });
  min.canonicalReserveId = nextReserveId;
  min.transitions.set(txid, { txid, controlOutput: nextControlId, reserveOutput: nextReserveId });
  if (action === 'RELEASE') { min.R -= amount; min.I += amount; }
  if (action === 'RETURN') { min.R += amount; min.I -= amount; min.P += amount; }
  if (action === 'RETURN') {
    min.redemptions.set(redemptionId, {
      id: redemptionId,
      amount,
      recipient: options.recipient,
      returnedCoinId: returnedCoin.id,
      tokenId: returnedCoin.tokenId,
      branch: min.branch,
      height: min.height + 1,
      status: 'RETURNED',
    });
  }
  min.height += 1;
  assertSystem(system);
  return { txid, reserveOutput: nextReserveId, controlOutput: nextControlId, branch: min.branch, height: min.height };
}

function release(system, proof, reserveId, options = {}) {
  const acceptedVersion = validatePendingProof(system, proof);
  if ((system.minima.nullifiers.get(proof.id) ?? EMPTY) !== EMPTY) throw new Error('nullifier not EMPTY');
  if (system.minima.I + proof.amount + system.minima.P > proof.vaultBalance) throw new Error('proof-bound collateral bound');
  const transition = spendControlAndReserve(system, 'RELEASE', reserveId, proof.amount, { ...options, provedL: proof.vaultBalance, validatedTransitionCapability });
  system.minima.nullifiers.set(proof.id, RELEASED);
  system.minima.acceptedEthereumVersion = acceptedVersion;
  system.minima.L = proof.vaultBalance;
  assertSystem(system);
  return transition;
}
function clientUpdate(system, proof, reserveId, options = {}) {
  validateClientProof(system, proof);
  const transition = spendControlAndReserve(system, 'CLIENT_UPDATE', reserveId, 0n, { ...options, validatedTransitionCapability });
  system.minima.acceptedEthereumVersion = proof.version;
  system.minima.L = proof.vaultBalance;
  assertSystem(system);
  return transition;
}
function cancel(system, proof, reserveId, options = {}) {
  const acceptedVersion = validatePendingProof(system, proof);
  const authorization = options.authorization;
  if (!authorization?.publicKey || !authorization?.signature) throw new Error('cancellation authorization missing');
  const encodedKey = authorization.publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
  if (encodedKey !== proof.fields.authorityPublicKeyBytes) throw new Error('cancellation authority key mismatch');
  if (!verify(null, cancellationDigest(proof.fields), authorization.publicKey, authorization.signature)) throw new Error('cancellation signature invalid');
  if ((system.minima.nullifiers.get(proof.id) ?? EMPTY) !== EMPTY) throw new Error('nullifier not EMPTY');
  if (system.minima.I + system.minima.P > proof.vaultBalance) throw new Error('proof-bound collateral bound');
  const transition = spendControlAndReserve(system, 'CANCEL', reserveId, 0n, { ...options, validatedTransitionCapability });
  system.minima.nullifiers.set(proof.id, CANCELLED);
  system.minima.acceptedEthereumVersion = acceptedVersion;
  system.minima.L = proof.vaultBalance;
  assertSystem(system);
  return transition;
}
function cancellationAuthorization(proof, signingKey = privateKey, verifyingKey = publicKey) {
  return { publicKey: verifyingKey, signature: sign(null, cancellationDigest(proof.fields), signingKey) };
}
function minimaCancellationProof(system, id, settled = true) {
  return { chain: 'MINIMA', branch: system.minima.branch, height: system.minima.height, id, status: system.minima.nullifiers.get(id) ?? EMPTY, settled };
}

function refund(system, proof, mode = 'success') {
  const eth = system.ethereum;
  const behavior = typeof mode === 'string' ? { transfer: mode } : mode;
  if (eth.locked) throw new Error('reentrancy guard');
  const record = eth.records.get(proof.id);
  if (!record || record.status !== PENDING) throw new Error('record not PENDING');
  if (!proof.settled || proof.branch !== system.minima.branch || proof.status !== CANCELLED) throw new Error('cancellation proof not settled canonical');
  if (eth.minimaCheckpoint && (proof.branch !== eth.minimaCheckpoint.branch || proof.height < eth.minimaCheckpoint.height)) throw new Error('Minima checkpoint rollback');
  const snapshot = clone(eth);
  try {
    eth.locked = true;
    record.status = REFUNDED;
    eth.cumulativeRefunded += record.amount;
    eth.transfers.set(proof.id, (eth.transfers.get(proof.id) ?? 0) + 1);
    eth.minimaCheckpoint = { branch: proof.branch, height: proof.height };
    if (behavior.transfer === 'throw' || behavior.transfer === 'false') throw new Error('token transfer failed');
    if (behavior.callback) behavior.callback();
    eth.version += 1;
    eth.locked = false;
    assertSystem(system);
  } catch (error) {
    Object.assign(eth, snapshot);
    throw error;
  }
}
function minimaRedemptionProof(system, id, settled = true) {
  const record = system.minima.redemptions?.get(id);
  if (!record) throw new Error('missing Minima redemption');
  return { chain: 'MINIMA', ...clone(record), settled };
}
function payRedemption(system, proof, mode = 'success') {
  const eth = system.ethereum;
  const behavior = typeof mode === 'string' ? { transfer: mode } : mode;
  if (eth.locked) throw new Error('reentrancy guard');
  if (!proof || proof.chain !== 'MINIMA' || !proof.settled || proof.branch !== system.minima.branch || proof.status !== 'RETURNED') throw new Error('redemption proof not settled canonical');
  const record = system.minima.redemptions?.get(proof.id);
  if (!record || record.amount !== proof.amount || record.recipient !== proof.recipient
      || record.height !== proof.height || record.returnedCoinId !== proof.returnedCoinId
      || record.tokenId !== proof.tokenId) throw new Error('redemption record mismatch');
  if (eth.redemptions.has(proof.id) || proof.amount <= 0n || proof.amount > usedCapacity(system) || proof.amount > system.minima.P) throw new Error('invalid redemption payout');
  const snapshot = clone(eth);
  try {
    eth.locked = true;
    eth.redemptions.add(proof.id);
    eth.cumulativePaidRedemptions += proof.amount;
    eth.transfers.set(proof.id, (eth.transfers.get(proof.id) ?? 0) + 1);
    eth.vaultBalance -= proof.amount;
    if (eth.vaultBalance < 0n) throw new Error('insufficient source vault balance');
    if (behavior.transfer === 'throw' || behavior.transfer === 'false') throw new Error('token transfer failed');
    if (behavior.callback) behavior.callback();
    eth.version += 1;
    eth.payoutRecords.push({
      cursor: eth.payoutRecords.length + 1,
      redemptionId: proof.id,
      amount: proof.amount,
      recipient: proof.recipient,
      cumulativePaidRedemptions: eth.cumulativePaidRedemptions,
      ethereumVersion: eth.version,
    });
    eth.locked = false;
    assertSystem(system);
  } catch (error) {
    Object.assign(eth, snapshot);
    throw error;
  }
}
function ethereumPayoutProof(system, priorCursor = system.minima.payoutCursor) {
  const eth = system.ethereum;
  if (!Number.isInteger(priorCursor) || priorCursor < 0 || priorCursor >= eth.payoutRecords.length) throw new Error('empty or invalid payout range');
  const priorCumulative = priorCursor === 0 ? 0n : eth.payoutRecords[priorCursor - 1].cumulativePaidRedemptions;
  const records = clone(eth.payoutRecords.slice(priorCursor));
  return {
    chain: 'ETH', finalized: true, version: eth.version,
    priorCursor, newCursor: eth.payoutRecords.length,
    priorCumulativePaidRedemptions: priorCumulative,
    cumulativePaidRedemptions: eth.cumulativePaidRedemptions,
    paidAmount: eth.cumulativePaidRedemptions - priorCumulative,
    vaultBalance: eth.vaultBalance,
    records,
  };
}
function payoutAck(system, proof, reserveId, options = {}) {
  const { ethereum: eth, minima: min } = system;
  if (!proof || proof.chain !== 'ETH' || !proof.finalized) throw new Error('payout proof not finalized');
  if (proof.version < min.acceptedEthereumVersion || proof.version !== eth.version) throw new Error('stale payout proof');
  if (proof.priorCursor !== min.payoutCursor || proof.newCursor !== eth.payoutRecords.length
      || proof.priorCumulativePaidRedemptions !== min.acknowledgedPayoutAtoms
      || proof.cumulativePaidRedemptions !== eth.cumulativePaidRedemptions
      || proof.vaultBalance !== eth.vaultBalance) throw new Error('payout cursor mismatch');
  const expectedRecords = eth.payoutRecords.slice(proof.priorCursor);
  if (JSON.stringify(proof.records, (_, value) => typeof value === 'bigint' ? `${value}n` : value)
      !== JSON.stringify(expectedRecords, (_, value) => typeof value === 'bigint' ? `${value}n` : value)) throw new Error('payout range mismatch');
  const paidAmount = proof.cumulativePaidRedemptions - proof.priorCumulativePaidRedemptions;
  if (paidAmount <= 0n || proof.paidAmount !== paidAmount || paidAmount > min.P) throw new Error('invalid payout acknowledgement amount');
  if (min.I + (min.P - paidAmount) > proof.vaultBalance) throw new Error('post-payout collateral bound');
  const transition = spendControlAndReserve(system, 'PAYOUT_ACK', reserveId, 0n, { ...options, validatedTransitionCapability });
  min.P -= paidAmount;
  min.L = proof.vaultBalance;
  min.payoutCursor = proof.newCursor;
  min.acknowledgedPayoutAtoms = proof.cumulativePaidRedemptions;
  min.acceptedEthereumVersion = proof.version;
  assertSystem(system);
  return transition;
}
function recoverReserveFromControl(system) {
  const min = system.minima;
  const transition = min.transitions.get(min.control.createdBy);
  if (!transition || transition.controlOutput !== min.control.id) throw new Error('control creation transaction unavailable');
  const reserve = min.coins.get(transition.reserveOutput);
  if (!reserve || reserve.spent || reserve.amount !== min.R || !reserve.covenant || reserve.output !== 1) throw new Error('sibling reserve unavailable');
  return reserve.id;
}

{
  const s = makeSystem();
  addReturnedCoin(s, 'ab'.repeat(32), 100n);
  ok('canonical redemption commitment matches fixed binary golden vector', exactReturnOptions(s, 'ab'.repeat(32), 'ee'.repeat(20)).redemptionId === 'e3b4e433fae40efe692ade55ced2fd040157c4b1236d3c4b58e3a3b3c733c67c');
}

{
  const s = makeSystem();
  acceptDeposit(s, 'd1', 2_000n);
  acceptDeposit(s, 'd2', 3_000n);
  acceptDeposit(s, 'd3', 4_999n);
  ok('multiple deposits fill capacity to F minus one', usedCapacity(s) === 9_999n);
  reject('deposit crossing one-atom reserve floor rejects', () => acceptDeposit(s, 'd4', 1n));
  reject('duplicate deposit rejects', () => acceptDeposit(s, 'd1', 1n));
}

for (const field of Object.keys(cancellationFields)) {
  const s = makeSystem();
  acceptDeposit(s, `auth-${field}`, 10n);
  const proof = ethereumRecordProof(s, `auth-${field}`);
  const authorization = cancellationAuthorization(proof);
  proof.fields[field] = `${proof.fields[field]}:changed`;
  reject(`cancel transition rejects changed ${field}`, () => cancel(s, proof, recoverReserveFromControl(s), { authorization }));
}
{
  const s = makeSystem();
  acceptDeposit(s, 'wrong-authority', 10n);
  const proof = ethereumRecordProof(s, 'wrong-authority');
  const other = generateKeyPairSync('ed25519');
  reject('cancel transition rejects different authority key', () => cancel(s, proof, recoverReserveFromControl(s), { authorization: cancellationAuthorization(proof, other.privateKey, other.publicKey) }));
}

const orderings = [
  ['release', 'cancel', 'refund'],
  ['release', 'refund', 'cancel'],
  ['cancel', 'release', 'refund'],
  ['cancel', 'refund', 'release'],
  ['refund', 'release', 'cancel'],
  ['refund', 'cancel', 'release'],
];
let orderingCases = 0;
for (const ordering of orderings) {
  const s = makeSystem();
  acceptDeposit(s, 'race', 100n);
  const pending = ethereumRecordProof(s, 'race');
  let cancellationProof = null;
  for (const action of ordering) {
    try {
      if (action === 'release') release(s, pending, recoverReserveFromControl(s));
      if (action === 'cancel') {
        cancel(s, pending, recoverReserveFromControl(s), { authorization: cancellationAuthorization(pending) });
        cancellationProof = minimaCancellationProof(s, 'race');
      }
      if (action === 'refund') refund(s, cancellationProof ?? { id: 'race', status: EMPTY, settled: false, branch: 'A', height: 0 });
    } catch {}
    assertSystem(s);
  }
  orderingCases += 1;
}
ok('release cancellation refund orderings preserve conditional safety', orderingCases === 6);

{
  const s = makeSystem();
  acceptDeposit(s, 'cancelled', 500n);
  const pending = ethereumRecordProof(s, 'cancelled');
  cancel(s, pending, recoverReserveFromControl(s), { authorization: cancellationAuthorization(pending) });
  const proof = minimaCancellationProof(s, 'cancelled');
  reject('false token transfer rolls back refund', () => refund(s, proof, 'false'));
  ok('failed refund preserves record and capacity', s.ethereum.records.get('cancelled').status === PENDING && usedCapacity(s) === 500n);
  refund(s, proof, { transfer: 'success', callback: () => reject('nested refund blocked by shared guard', () => refund(s, proof)) });
  ok('reentrant refund transfers once', s.ethereum.transfers.get('cancelled') === 1 && usedCapacity(s) === 0n);
  reject('refund replay rejects', () => refund(s, proof));
  reject('stale PENDING release after refund rejects terminal nullifier', () => release(s, pending, recoverReserveFromControl(s)));
}

{
  const s = makeSystem();
  acceptDeposit(s, 'full', 9_999n);
  release(s, ethereumRecordProof(s, 'full'), recoverReserveFromControl(s));
  ok('maximum accepted release leaves one atom', s.minima.R === 1n);
  reject('A equals R rejects zero reserve successor', () => spendControlAndReserve(s, 'RELEASE', recoverReserveFromControl(s), 1n, { validatedTransitionCapability }));
}
{
  const canonical = makeSystem();
  const substitute = makeSystem();
  acceptDeposit(canonical, 'sub', 100n);
  acceptDeposit(substitute, 'sub', 100n);
  release(canonical, ethereumRecordProof(canonical, 'sub'), 'reserve-v0');
  release(substitute, ethereumRecordProof(substitute, 'sub'), 'donated-equal');
  ok('equal reserve substitution has identical accounting', canonical.minima.R === substitute.minima.R && canonical.minima.I === substitute.minima.I);
  ok('substituted transition records new sibling', recoverReserveFromControl(substitute) === substitute.minima.canonicalReserveId);
  reject('displaced prior reserve cannot add same-state transition', () => release(substitute, ethereumRecordProof(substitute, 'sub'), 'reserve-v0'));
  const versionBeforeReturn = substitute.minima.control.version;
  addReturnedCoin(substitute, 'ab'.repeat(32), 100n);
  spendControlAndReserve(substitute, 'RETURN', recoverReserveFromControl(substitute), 100n, exactReturnOptions(substitute, 'ab'.repeat(32), 'ee'.repeat(20)));
  ok('return cycle restores displaced amount eligibility', substitute.minima.R === 10_000n && substitute.minima.coins.get('reserve-v0').amount === substitute.minima.R);
  advanceEthereumHead(substitute);
  clientUpdate(substitute, ethereumClientProof(substitute), 'reserve-v0');
  ok('later displaced reserve substitution preserves accounting and new sibling recovery', substitute.minima.R === 10_000n && substitute.minima.I === 0n && recoverReserveFromControl(substitute) === substitute.minima.canonicalReserveId);
  advanceEthereumHead(substitute);
  reject('stale sibling competitor loses after cycle substitution', () => clientUpdate(substitute, ethereumClientProof(substitute), `reserve-v${versionBeforeReturn + 1}`, { expectedVersion: versionBeforeReturn + 1 }));
}
{
  const s = makeSystem();
  acceptDeposit(s, 'recover', 100n);
  const p = ethereumRecordProof(s, 'recover');
  cancel(s, p, recoverReserveFromControl(s), { authorization: cancellationAuthorization(p) });
  advanceEthereumHead(s);
  clientUpdate(s, ethereumClientProof(s), recoverReserveFromControl(s));
  advanceEthereumHead(s);
  clientUpdate(s, ethereumClientProof(s), recoverReserveFromControl(s));
  for (let i = 0; i < 50; i += 1) s.minima.coins.set(`pollution-${i}`, { id: `pollution-${i}`, amount: BigInt(2 + i), covenant: true, spent: false, createdBy: 'donation', output: 0 });
  ok('in-memory lineage follows sibling after cancellation and updates', recoverReserveFromControl(s) === s.minima.canonicalReserveId);
}
{
  const s = makeSystem();
  acceptDeposit(s, 'ret', 400n);
  release(s, ethereumRecordProof(s, 'ret'), recoverReserveFromControl(s));
  addReturnedCoin(s, 'bc'.repeat(32), 100n);
  const retOptions = exactReturnOptions(s, 'bc'.repeat(32), 'cc'.repeat(20));
  spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, retOptions);
  ok('return preserves R plus I and moves I to P', s.minima.R === 9_700n && s.minima.I === 300n && s.minima.P === 100n);
  const redemptionProof = minimaRedemptionProof(s, retOptions.redemptionId);
  payRedemption(s, redemptionProof);
  ok('redemption frees source capacity once', usedCapacity(s) === 300n);
  reject('redemption replay rejects', () => payRedemption(s, redemptionProof));
  reject('fake redemption proof rejects', () => payRedemption(s, { ...redemptionProof, id: 'fake' }));
  const payoutProof = ethereumPayoutProof(s);
  payoutAck(s, payoutProof, recoverReserveFromControl(s));
  ok('payout acknowledgement consumes exact pending amount and advances cursor', s.minima.P === 0n && s.minima.payoutCursor === 1 && s.minima.L === 9_900n);
  reject('payout acknowledgement replay rejects', () => payoutAck(s, payoutProof, recoverReserveFromControl(s)));
}
{
  const s = makeSystem();
  acceptDeposit(s, 'issued', 400n);
  const issued = ethereumRecordProof(s, 'issued');
  release(s, issued, recoverReserveFromControl(s));
  addReturnedCoin(s, 'cd'.repeat(32), 100n);
  const crossReturn = exactReturnOptions(s, 'cd'.repeat(32), 'dd'.repeat(20));
  spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, crossReturn);
  const redemptionProof = minimaRedemptionProof(s, crossReturn.redemptionId);

  acceptDeposit(s, 'cross-cancel-1', 50n);
  const pending1 = ethereumRecordProof(s, 'cross-cancel-1');
  cancel(s, pending1, recoverReserveFromControl(s), { authorization: cancellationAuthorization(pending1) });
  const cancelProof1 = minimaCancellationProof(s, 'cross-cancel-1');

  acceptDeposit(s, 'cross-cancel-2', 50n);
  const pending2 = ethereumRecordProof(s, 'cross-cancel-2');
  cancel(s, pending2, recoverReserveFromControl(s), { authorization: cancellationAuthorization(pending2) });
  const cancelProof2 = minimaCancellationProof(s, 'cross-cancel-2');

  refund(s, cancelProof1, {
    transfer: 'success',
    callback: () => reject('refund callback cannot enter redemption payout', () => payRedemption(s, redemptionProof)),
  });
  payRedemption(s, redemptionProof, {
    transfer: 'success',
    callback: () => reject('redemption callback cannot enter refund', () => refund(s, cancelProof2)),
  });
  ok('cross-entrypoint callbacks preserve one transfer each', s.ethereum.transfers.get('cross-cancel-1') === 1 && s.ethereum.transfers.get(crossReturn.redemptionId) === 1);
  refund(s, cancelProof2);
}
{
  const s = makeSystem();
  acceptDeposit(s, 'shape', 100n);
  const p = ethereumRecordProof(s, 'shape');
  reject('wrong reserve amount rejects', () => release(s, p, 'donated-wrong'));
  reject('extra input rejects', () => release(s, p, 'reserve-v0', { inputs: 3 }));
  reject('extra output rejects', () => release(s, p, 'reserve-v0', { outputs: 4 }));
  reject('short successor rejects', () => release(s, p, 'reserve-v0', { successorAmount: 9_899n }));
  reject('unknown action rejects', () => spendControlAndReserve(s, 'UNKNOWN', 'reserve-v0'));
  const stale = s.minima.control.version;
  release(s, p, 'reserve-v0');
  advanceEthereumHead(s);
  reject('concurrent stale control rejects', () => clientUpdate(s, ethereumClientProof(s), recoverReserveFromControl(s), { expectedVersion: stale }));
}

{
  const makeIssued = () => {
    const s = makeSystem();
    acceptDeposit(s, 'return-input', 500n);
    release(s, ethereumRecordProof(s, 'return-input'), recoverReserveFromControl(s));
    return s;
  };
  {
    const s = makeIssued();
    const before = stateDigest(s.minima);
    reject('return without input coin rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, { recipient: '11'.repeat(20), redemptionId: '00'.repeat(32) }));
    ok('rejected missing-input return leaves Minima state unchanged', stateDigest(s.minima) === before);
  }
  {
    const s = makeIssued();
    addReturnedCoin(s, '01'.repeat(32), 100n, { tokenId: 'ff'.repeat(32) });
    const before = stateDigest(s.minima);
    reject('wrong-token returned input rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, exactReturnOptions(s, '01'.repeat(32), '11'.repeat(20))));
    ok('wrong-token rejection leaves Minima state unchanged', stateDigest(s.minima) === before);
  }
  {
    const s = makeIssued();
    addReturnedCoin(s, '02'.repeat(32), 101n);
    const before = stateDigest(s.minima);
    reject('wrong-amount returned input rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, exactReturnOptions(s, '02'.repeat(32), '11'.repeat(20))));
    ok('wrong-amount rejection leaves Minima state unchanged', stateDigest(s.minima) === before);
  }
  {
    const s = makeIssued();
    addReturnedCoin(s, '05'.repeat(32), 100n, { owner: 'ATTACKER_COVENANT' });
    const before = stateDigest(s.minima);
    reject('wrong-owner returned input rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, exactReturnOptions(s, '05'.repeat(32), '11'.repeat(20))));
    ok('wrong-owner rejection leaves Minima state unchanged', stateDigest(s.minima) === before);
  }
  {
    const s = makeIssued();
    addReturnedCoin(s, '03'.repeat(32), 100n);
    const exact = exactReturnOptions(s, '03'.repeat(32), '11'.repeat(20));
    const before = stateDigest(s.minima);
    reject('mutated redemption ID rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, { ...exact, redemptionId: '04'.repeat(32) }));
    reject('mutated redemption recipient rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, { ...exact, recipient: '12'.repeat(20) }));
    ok('identity and recipient rejections leave Minima state unchanged', stateDigest(s.minima) === before);
    spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, exact);
    const after = stateDigest(s.minima);
    reject('reused returned input rejects', () => spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, exact));
    ok('reused-input rejection leaves Minima state unchanged', stateDigest(s.minima) === after);
  }
}

{
  const s = makeSystem();
  acceptDeposit(s, 'atomic-v1', 100n);
  acceptDeposit(s, 'atomic-v2', 100n);
  const proof = ethereumRecordProof(s, 'atomic-v1');
  const before = stateDigest(s.minima);
  reject('future Ethereum proof version rejects', () => release(s, { ...proof, version: 999_999 }, recoverReserveFromControl(s)));
  reject('skipped or unrelated Ethereum proof version rejects', () => release(s, { ...proof, version: proof.version - 1 }, recoverReserveFromControl(s)));
  ok('version mutations leave Minima state unchanged', stateDigest(s.minima) === before);
  reject('wrong reserve rejects after proof validation', () => release(s, proof, 'donated-wrong'));
  ok('rejected release does not advance accepted Ethereum version', stateDigest(s.minima) === before && s.minima.acceptedEthereumVersion === 0);
}

{
  const s = makeSystem();
  acceptDeposit(s, 'lower-l-release', 100n);
  s.ethereum.vaultBalance = 50n;
  s.ethereum.version += 1;
  const proof = ethereumRecordProof(s, 'lower-l-release');
  const before = stateDigest(s.minima);
  reject('lower proof-bound balance rejects release before mutation', () => release(s, proof, recoverReserveFromControl(s)));
  ok('lower-balance release rejection leaves full Minima state unchanged', stateDigest(s.minima) === before);
}

{
  const s = makeSystem();
  acceptDeposit(s, 'issued-before-cancel', 100n);
  release(s, ethereumRecordProof(s, 'issued-before-cancel'), recoverReserveFromControl(s));
  acceptDeposit(s, 'lower-l-cancel', 10n);
  s.ethereum.vaultBalance = 50n;
  s.ethereum.version += 1;
  const proof = ethereumRecordProof(s, 'lower-l-cancel');
  const before = stateDigest(s.minima);
  reject('lower proof-bound balance rejects cancellation client update before mutation', () => cancel(s, proof, recoverReserveFromControl(s), { authorization: cancellationAuthorization(proof) }));
  ok('lower-balance cancellation rejection leaves full Minima state unchanged', stateDigest(s.minima) === before);
  s.ethereum.vaultBalance = 9_000n;
  s.ethereum.version += 1;
  const admissible = ethereumRecordProof(s, 'lower-l-cancel');
  cancel(s, admissible, recoverReserveFromControl(s), { authorization: cancellationAuthorization(admissible) });
  ok('advancing cancellation client update binds admissible lower L without changing R I or P', s.minima.L === 9_000n && s.minima.R === 9_900n && s.minima.I === 100n && s.minima.P === 0n);
}

{
  for (const action of ['CLIENT_UPDATE', 'RELEASE', 'CANCEL', 'PAYOUT_ACK']) {
    const s = makeSystem();
    const before = stateDigest(s.minima);
    reject(`raw ${action} structural path rejects without validated dispatcher`, () => spendControlAndReserve(s, action, recoverReserveFromControl(s), action === 'RELEASE' ? 1n : 0n));
    ok(`raw ${action} rejection leaves full Minima state unchanged`, stateDigest(s.minima) === before);
  }
}

{
  const s = makeSystem();
  const initial = stateDigest(s.minima);
  reject('client update without proof rejects', () => clientUpdate(s, null, recoverReserveFromControl(s)));
  reject('raw nonzero client update rejects even with internal capability', () => spendControlAndReserve(s, 'CLIENT_UPDATE', recoverReserveFromControl(s), 123n, { validatedTransitionCapability }));
  ok('missing and nonzero client updates leave state unchanged', stateDigest(s.minima) === initial);
  advanceEthereumHead(s);
  const proof = ethereumClientProof(s);
  reject('malformed client balance proof rejects', () => clientUpdate(s, { ...proof, vaultBalance: proof.vaultBalance - 1n }, recoverReserveFromControl(s)));
  reject('malformed client payout cursor rejects', () => clientUpdate(s, { ...proof, payoutCursor: 1 }, recoverReserveFromControl(s)));
  ok('malformed client updates leave state unchanged', stateDigest(s.minima) === initial);
  clientUpdate(s, proof, recoverReserveFromControl(s));
  const afterAdvance = stateDigest(s.minima);
  reject('equal-head client update rejects', () => clientUpdate(s, proof, recoverReserveFromControl(s)));
  advanceEthereumHead(s);
  reject('stale client update rejects after source head advance', () => clientUpdate(s, proof, recoverReserveFromControl(s)));
  ok('equal-head and stale client updates leave Minima state unchanged', stateDigest(s.minima) === afterAdvance);
}

{
  const s = makeSystem();
  acceptDeposit(s, 'ordering-base', 400n);
  release(s, ethereumRecordProof(s, 'ordering-base'), recoverReserveFromControl(s));
  addReturnedCoin(s, '10'.repeat(32), 100n);
  const returned = exactReturnOptions(s, '10'.repeat(32), '21'.repeat(20));
  spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, returned);
  payRedemption(s, minimaRedemptionProof(s, returned.redemptionId));
  acceptDeposit(s, 'ordering-pending', 50n);
  const pendingAfterPayout = ethereumRecordProof(s, 'ordering-pending');
  const beforeBlockedRelease = stateDigest(s.minima);
  reject('release cannot advance past unacknowledged payout', () => release(s, pendingAfterPayout, recoverReserveFromControl(s)));
  ok('blocked post-payout release leaves Minima state unchanged', stateDigest(s.minima) === beforeBlockedRelease);
  payoutAck(s, ethereumPayoutProof(s), recoverReserveFromControl(s));
  release(s, ethereumRecordProof(s, 'ordering-pending'), recoverReserveFromControl(s));
  ok('acknowledgement then release preserves collateral accounting', s.minima.P === 0n && s.minima.I === 350n && s.minima.L === 9_900n);
}

{
  const s = makeSystem();
  acceptDeposit(s, 'release-first-base', 400n);
  acceptDeposit(s, 'release-first-pending', 50n);
  release(s, ethereumRecordProof(s, 'release-first-base'), recoverReserveFromControl(s));
  release(s, ethereumRecordProof(s, 'release-first-pending'), recoverReserveFromControl(s));
  addReturnedCoin(s, '20'.repeat(32), 100n);
  const returned = exactReturnOptions(s, '20'.repeat(32), '31'.repeat(20));
  spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, returned);
  payRedemption(s, minimaRedemptionProof(s, returned.redemptionId));
  const staleAck = ethereumPayoutProof(s);
  acceptDeposit(s, 'head-advance', 10n);
  const beforeStaleAck = stateDigest(s.minima);
  reject('payout acknowledgement stale after Ethereum head advance', () => payoutAck(s, staleAck, recoverReserveFromControl(s)));
  ok('stale acknowledgement leaves Minima state unchanged', stateDigest(s.minima) === beforeStaleAck);
  payoutAck(s, ethereumPayoutProof(s), recoverReserveFromControl(s));
  ok('release then acknowledgement preserves collateral accounting', s.minima.P === 0n && s.minima.I === 350n && s.minima.payoutCursor === 1);
}

{
  const s = makeSystem();
  acceptDeposit(s, 'ack-mutations', 300n);
  release(s, ethereumRecordProof(s, 'ack-mutations'), recoverReserveFromControl(s));
  addReturnedCoin(s, '30'.repeat(32), 100n);
  const returned = exactReturnOptions(s, '30'.repeat(32), '41'.repeat(20));
  spendControlAndReserve(s, 'RETURN', recoverReserveFromControl(s), 100n, returned);
  payRedemption(s, minimaRedemptionProof(s, returned.redemptionId));
  const proof = ethereumPayoutProof(s);
  const before = stateDigest(s.minima);
  reject('payout acknowledgement rejects changed cursor', () => payoutAck(s, { ...proof, newCursor: proof.newCursor + 1 }, recoverReserveFromControl(s)));
  reject('payout acknowledgement rejects changed amount', () => payoutAck(s, { ...proof, paidAmount: proof.paidAmount + 1n }, recoverReserveFromControl(s)));
  reject('payout acknowledgement rejects changed vault balance', () => payoutAck(s, { ...proof, vaultBalance: proof.vaultBalance + 1n }, recoverReserveFromControl(s)));
  const changedRecords = clone(proof.records);
  changedRecords[0].recipient = '42'.repeat(20);
  reject('payout acknowledgement rejects changed record', () => payoutAck(s, { ...proof, records: changedRecords }, recoverReserveFromControl(s)));
  ok('all mutated payout proofs leave Minima state unchanged', stateDigest(s.minima) === before);
}

{
  const s = makeSystem();
  acceptDeposit(s, 'forked', 100n);
  const pending = ethereumRecordProof(s, 'forked');
  cancel(s, pending, recoverReserveFromControl(s), { authorization: cancellationAuthorization(pending) });
  const oldForkProof = minimaCancellationProof(s, 'forked', false);
  s.minima.branch = 'B';
  reject('unsettled noncanonical cancellation proof rejects', () => refund(s, oldForkProof));
}

let finalityAssumptionCounterexampleObserved = false;
{
  const s = makeSystem();
  acceptDeposit(s, 'late-fork', 100n);
  const pending = ethereumRecordProof(s, 'late-fork');
  cancel(s, pending, recoverReserveFromControl(s), { authorization: cancellationAuthorization(pending) });
  refund(s, minimaCancellationProof(s, 'late-fork'));
  s.minima.branch = 'late-heavier-B';
  s.minima.nullifiers.set('late-fork', RELEASED);
  finalityAssumptionCounterexampleObserved = s.ethereum.records.get('late-fork').status === REFUNDED && s.minima.nullifiers.get('late-fork') === RELEASED;
  ok('late-fork assumption breach counterexample is preserved', finalityAssumptionCounterexampleObserved);
  assertSystem(s, { finalityAssumptionBreached: true });
}

function detectedMutation(name, attack) {
  let detected = false;
  try { attack(); } catch { detected = true; }
  ok(`deliberate mutation detected: ${name}`, detected);
  mutations.push({ family: 'state-guard', field: name, detected });
}
detectedMutation('capacity floor removed', () => {
  const s = makeSystem();
  s.ethereum.fixedCapacity = s.minima.F;
  acceptDeposit(s, 'all', s.minima.F);
  release(s, ethereumRecordProof(s, 'all'), recoverReserveFromControl(s));
});
detectedMutation('refund without cancellation', () => {
  const s = makeSystem();
  acceptDeposit(s, 'bad-refund', 100n);
  s.ethereum.records.get('bad-refund').status = REFUNDED;
  s.ethereum.cumulativeRefunded += 100n;
  assertSystem(s);
});
detectedMutation('reserve sibling output missing', () => {
  const s = makeSystem();
  s.minima.coins.delete('reserve-v0');
  recoverReserveFromControl(s);
});
detectedMutation('reserve successor shortened', () => {
  const s = makeSystem();
  acceptDeposit(s, 'short', 100n);
  release(s, ethereumRecordProof(s, 'short'), 'reserve-v0', { successorAmount: 9_899n });
});
detectedMutation('stale control accepted', () => {
  const s = makeSystem();
  advanceEthereumHead(s);
  clientUpdate(s, ethereumClientProof(s), 'reserve-v0');
  advanceEthereumHead(s);
  clientUpdate(s, ethereumClientProof(s), recoverReserveFromControl(s), { expectedVersion: 0 });
});

const result = {
  schema: 'usdtm-p1-model-validation/v2',
  createdAtUtc: new Date().toISOString(),
  status: 'passed',
  validator: basename(sourcePath),
  validatorSha256: sha256(readFileSync(sourcePath)),
  assertionCount: assertions.length,
  orderingCases,
  acceptedDeposits,
  cancellationFieldsMutated: Object.keys(cancellationFields).length,
  deliberateMutations: mutations.length,
  mutationsDetected: mutations.filter((item) => item.detected).length,
  finalityAssumptionCounterexampleObserved,
  limitations: [
    'The cancellation encoder and Ed25519 operation are model-only, not P2 bytes or Minima signature evidence.',
    'The two ledgers, proofs, UTXOs, forks and callbacks are local state models, not EVM, KISS, light-client or consensus execution.',
    'A late heavier Minima fork after Ethereum refund can produce refund plus release; safety is conditional on the declared settlement-finality assumption.',
    'The sibling lookup is in-memory lineage only; clean-node bundle validation, proof import and bounded reconstruction remain P9 and P12 gates.',
    'No ZK proof, transaction, token, vault, funds or mainnet runtime executed.',
  ],
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `usdtm-p1-model-validation-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized, 'utf8');
  const evidenceSha256 = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`, 'utf8');
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
