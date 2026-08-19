#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const emitEvidence = process.argv.includes('--evidence');
const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const failures = [];
let assertions = 0;
let rejectedTransitionAtomicityChecks = 0;

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function check(condition, message) {
  assertions += 1;
  if (!condition) failures.push(message);
}

function requireModel(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
}

function stateDigest(state) {
  return sha256(JSON.stringify(state));
}

function uint(value, bytes, field) {
  requireModel(Number.isSafeInteger(value) && value >= 0, `${field} is not a safe unsigned integer`);
  const out = Buffer.alloc(bytes);
  let remaining = BigInt(value);
  for (let index = bytes - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  requireModel(remaining === 0n, `${field} exceeds ${bytes} bytes`);
  return out;
}

function fixedHex(value, bytes, field) {
  requireModel(typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(value), `${field} is not canonical ${bytes}-byte lowercase hex`);
  return Buffer.from(value.slice(2), 'hex');
}

const RECORD_FIELDS = [
  'schemaVersion',
  'direction',
  'ethereumChainId',
  'minimaNetwork',
  'ethereumVault',
  'ethereumToken',
  'reserveCovenant',
  'depositId',
  'amountAtoms',
  'minimaRecipient',
  'finalizedBlockNumber',
  'finalizedBlockHash',
  'sourceRecordHash',
  'vaultStateVersion',
  'vaultBalanceAtoms',
  'vaultPayoutCursor',
  'vaultCumulativePaidAtoms',
  'committeeEpoch',
  'committeeRoot',
  'expiryUnixSeconds',
];

function encodeRecord(record) {
  requireModel(Object.keys(record).length === RECORD_FIELDS.length, 'record has an unknown or missing field');
  requireModel(RECORD_FIELDS.every((field) => Object.hasOwn(record, field)), 'record field set is not exact');
  return Buffer.concat([
    uint(record.schemaVersion, 2, 'schemaVersion'),
    uint(record.direction, 1, 'direction'),
    uint(record.ethereumChainId, 8, 'ethereumChainId'),
    fixedHex(record.minimaNetwork, 32, 'minimaNetwork'),
    fixedHex(record.ethereumVault, 20, 'ethereumVault'),
    fixedHex(record.ethereumToken, 20, 'ethereumToken'),
    fixedHex(record.reserveCovenant, 32, 'reserveCovenant'),
    fixedHex(record.depositId, 32, 'depositId'),
    uint(record.amountAtoms, 8, 'amountAtoms'),
    fixedHex(record.minimaRecipient, 32, 'minimaRecipient'),
    uint(record.finalizedBlockNumber, 8, 'finalizedBlockNumber'),
    fixedHex(record.finalizedBlockHash, 32, 'finalizedBlockHash'),
    fixedHex(record.sourceRecordHash, 32, 'sourceRecordHash'),
    uint(record.vaultStateVersion, 8, 'vaultStateVersion'),
    uint(record.vaultBalanceAtoms, 8, 'vaultBalanceAtoms'),
    uint(record.vaultPayoutCursor, 8, 'vaultPayoutCursor'),
    uint(record.vaultCumulativePaidAtoms, 8, 'vaultCumulativePaidAtoms'),
    uint(record.committeeEpoch, 4, 'committeeEpoch'),
    fixedHex(record.committeeRoot, 32, 'committeeRoot'),
    uint(record.expiryUnixSeconds, 8, 'expiryUnixSeconds'),
  ]);
}

function recordDigest(record) {
  return sha256(Buffer.concat([Buffer.from('USDTM_ATTESTATION_V1', 'ascii'), encodeRecord(record)]));
}

const signerSecrets = Object.fromEntries(
  Array.from({ length: 7 }, (_, index) => [`operator-${index + 1}`, `semantic-secret-${index + 1}`]),
);

function mockPublicKey(signerId) {
  return `0x${sha256(`mock-public-key\0${signerSecrets[signerId]}`)}`;
}

function mockSign(record, signerId) {
  requireModel(Object.hasOwn(signerSecrets, signerId), `unknown mock signer ${signerId}`);
  return {
    signerId,
    signature: `0x${sha256(`mock-signature-v1\0${signerSecrets[signerId]}\0${recordDigest(record)}`)}`,
  };
}

function committeeRoot(members) {
  const encoded = members.map((member) => `${member.index}:${member.signerId}:${member.publicKey}`).join('|');
  return `0x${sha256(`USDTM_COMMITTEE_V1\0${encoded}`)}`;
}

const members = Array.from({ length: 7 }, (_, index) => {
  const signerId = `operator-${index + 1}`;
  return {
    index,
    signerId,
    publicKey: mockPublicKey(signerId),
    bondAtoms: 100_000,
  };
});

const config = {
  schemaVersion: 1,
  direction: 1,
  ethereumChainId: 1,
  minimaNetwork: `0x${'11'.repeat(32)}`,
  ethereumVault: `0x${'22'.repeat(20)}`,
  ethereumToken: `0x${'33'.repeat(20)}`,
  reserveCovenant: `0x${'44'.repeat(32)}`,
};

function initialState(overrides = {}) {
  const committee = {
    epoch: 7,
    threshold: 5,
    members: clone(members),
  };
  committee.root = committeeRoot(committee.members);
  return {
    committee,
    reserve: {
      fixedSupply: 1_000,
      reserveAtoms: 1_000,
      issuedAtoms: 0,
      pendingOutboundAtoms: 0,
      exposureCapAtoms: 500,
      acceptedVaultStateVersion: 10,
      authenticatedVaultBalanceAtoms: 500,
      authenticatedPayoutCursor: 0,
      authenticatedCumulativePaidAtoms: 0,
      authenticatedFinalizedBlockNumber: 19_999_999,
      authenticatedFinalizedBlockHash: `0x${'70'.repeat(32)}`,
      nullifiers: {},
      transitionHeight: 0,
      ...overrides.reserve,
    },
  };
}

function baseRecord(state = initialState()) {
  return {
    ...config,
    depositId: `0x${'55'.repeat(32)}`,
    amountAtoms: 100,
    minimaRecipient: `0x${'66'.repeat(32)}`,
    finalizedBlockNumber: 20_000_000,
    finalizedBlockHash: `0x${'77'.repeat(32)}`,
    sourceRecordHash: `0x${'88'.repeat(32)}`,
    vaultStateVersion: state.reserve.acceptedVaultStateVersion + 1,
    vaultBalanceAtoms: state.reserve.authenticatedVaultBalanceAtoms,
    vaultPayoutCursor: state.reserve.authenticatedPayoutCursor,
    vaultCumulativePaidAtoms: state.reserve.authenticatedCumulativePaidAtoms,
    committeeEpoch: state.committee.epoch,
    committeeRoot: state.committee.root,
    expiryUnixSeconds: 2_000,
  };
}

function quorum(record, signerIds = members.slice(0, 5).map((member) => member.signerId)) {
  return signerIds.map((signerId) => mockSign(record, signerId));
}

function expectedOutputs(state, record) {
  const nextIssued = state.reserve.issuedAtoms + record.amountAtoms;
  return [
    {
      index: 0,
      kind: 'CONTROL',
      amount: 1,
      covenant: config.reserveCovenant,
      issuedAtoms: nextIssued,
      nullifier: record.depositId,
    },
    {
      index: 1,
      kind: 'RESERVE',
      amount: state.reserve.reserveAtoms - record.amountAtoms,
      covenant: config.reserveCovenant,
    },
    {
      index: 2,
      kind: 'RECIPIENT',
      amount: record.amountAtoms,
      recipient: record.minimaRecipient,
    },
  ];
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function release(state, { capability, record, signatures, outputs, now }) {
  requireModel(capability === 'RELEASE_V1', 'missing release dispatcher capability');
  encodeRecord(record);
  requireModel(record.schemaVersion === config.schemaVersion, 'wrong schema version');
  requireModel(record.direction === config.direction, 'wrong direction');
  requireModel(record.ethereumChainId === config.ethereumChainId, 'wrong Ethereum chain');
  requireModel(record.minimaNetwork === config.minimaNetwork, 'wrong Minima network');
  requireModel(record.ethereumVault === config.ethereumVault, 'wrong Ethereum vault');
  requireModel(record.ethereumToken === config.ethereumToken, 'wrong Ethereum token');
  requireModel(record.reserveCovenant === config.reserveCovenant, 'wrong reserve covenant');
  requireModel(record.committeeEpoch === state.committee.epoch, 'wrong committee epoch');
  requireModel(record.committeeRoot === state.committee.root, 'wrong committee root');
  requireModel(now <= record.expiryUnixSeconds, 'attestation expired');
  requireModel(Number.isSafeInteger(record.amountAtoms) && record.amountAtoms > 0, 'amount is not positive');
  requireModel(record.amountAtoms < state.reserve.reserveAtoms, 'positive reserve remainder violated');
  requireModel(state.reserve.reserveAtoms + state.reserve.issuedAtoms === state.reserve.fixedSupply, 'reserve conservation precondition failed');
  requireModel(record.vaultStateVersion >= state.reserve.acceptedVaultStateVersion, 'stale vault state version');
  requireModel(record.vaultStateVersion <= state.reserve.acceptedVaultStateVersion + 1, 'skipped future vault state version');
  if (record.vaultStateVersion === state.reserve.acceptedVaultStateVersion) {
    requireModel(record.vaultBalanceAtoms === state.reserve.authenticatedVaultBalanceAtoms, 'equal-version vault balance changed');
    requireModel(record.vaultPayoutCursor === state.reserve.authenticatedPayoutCursor, 'equal-version payout cursor changed');
    requireModel(record.vaultCumulativePaidAtoms === state.reserve.authenticatedCumulativePaidAtoms, 'equal-version cumulative paid amount changed');
    requireModel(record.finalizedBlockNumber === state.reserve.authenticatedFinalizedBlockNumber, 'equal-version finalized block number changed');
    requireModel(record.finalizedBlockHash === state.reserve.authenticatedFinalizedBlockHash, 'equal-version finalized block hash changed');
  } else {
    requireModel(record.finalizedBlockNumber >= state.reserve.authenticatedFinalizedBlockNumber, 'finalized block number rolled back');
    requireModel(record.vaultPayoutCursor >= state.reserve.authenticatedPayoutCursor, 'payout cursor rolled back');
    requireModel(record.vaultCumulativePaidAtoms >= state.reserve.authenticatedCumulativePaidAtoms, 'cumulative paid amount rolled back');
  }
  const newIssued = state.reserve.issuedAtoms + record.amountAtoms;
  requireModel(newIssued + state.reserve.pendingOutboundAtoms <= record.vaultBalanceAtoms, 'collateral limit exceeded');
  requireModel(newIssued <= state.reserve.exposureCapAtoms, 'exposure cap exceeded');
  requireModel(!Object.hasOwn(state.reserve.nullifiers, record.depositId), 'deposit replay');
  requireModel(Array.isArray(signatures), 'signatures are not an array');

  const active = new Map(state.committee.members.map((member) => [member.signerId, member]));
  const seen = new Set();
  const digest = recordDigest(record);
  for (const item of signatures) {
    requireModel(item && typeof item.signerId === 'string' && typeof item.signature === 'string', 'malformed signature item');
    requireModel(active.has(item.signerId), 'outsider signature');
    requireModel(!seen.has(item.signerId), 'duplicate signer');
    seen.add(item.signerId);
    const expected = `0x${sha256(`mock-signature-v1\0${signerSecrets[item.signerId]}\0${digest}`)}`;
    requireModel(item.signature === expected, 'signature does not bind the exact record');
  }
  requireModel(seen.size >= state.committee.threshold, 'insufficient quorum');
  requireModel(exactJson(outputs, expectedOutputs(state, record)), 'outputs are not exact');

  const next = clone(state);
  next.reserve.reserveAtoms -= record.amountAtoms;
  next.reserve.issuedAtoms = newIssued;
  next.reserve.acceptedVaultStateVersion = record.vaultStateVersion;
  next.reserve.authenticatedVaultBalanceAtoms = record.vaultBalanceAtoms;
  next.reserve.authenticatedPayoutCursor = record.vaultPayoutCursor;
  next.reserve.authenticatedCumulativePaidAtoms = record.vaultCumulativePaidAtoms;
  next.reserve.authenticatedFinalizedBlockNumber = record.finalizedBlockNumber;
  next.reserve.authenticatedFinalizedBlockHash = record.finalizedBlockHash;
  next.reserve.nullifiers[record.depositId] = 'RELEASED';
  next.reserve.transitionHeight += 1;
  requireModel(next.reserve.reserveAtoms + next.reserve.issuedAtoms === next.reserve.fixedSupply, 'reserve conservation postcondition failed');
  return next;
}

function expectReject(label, state, invocation) {
  const before = stateDigest(state);
  let rejected = false;
  try {
    invocation();
  } catch {
    rejected = true;
  }
  check(rejected, `${label}: transition unexpectedly succeeded`);
  check(stateDigest(state) === before, `${label}: rejected transition changed state`);
  rejectedTransitionAtomicityChecks += 1;
}

function request(state, record, signatures = quorum(record), outputs = expectedOutputs(state, record), capability = 'RELEASE_V1', now = 1_000) {
  return { capability, record, signatures, outputs, now };
}

const start = initialState();
const honestRecord = baseRecord(start);
const honestNext = release(start, request(start, honestRecord));
check(honestNext.reserve.issuedAtoms === 100, 'honest quorum did not increase issued liability');
check(honestNext.reserve.reserveAtoms === 900, 'honest quorum did not reduce reserve exactly');
check(honestNext.reserve.nullifiers[honestRecord.depositId] === 'RELEASED', 'honest quorum did not consume nullifier');
check(honestNext.reserve.acceptedVaultStateVersion === honestRecord.vaultStateVersion, 'honest quorum did not advance vault snapshot');
check(stateDigest(start) === stateDigest(initialState()), 'successful transition mutated its input state');

const equalVersionRecord = {
  ...honestRecord,
  depositId: `0x${'56'.repeat(32)}`,
  sourceRecordHash: `0x${'89'.repeat(32)}`,
  amountAtoms: 50,
};
const equalVersionNext = release(honestNext, request(honestNext, equalVersionRecord, quorum(equalVersionRecord)));
check(equalVersionNext.reserve.issuedAtoms === 150, 'equal-version second deposit did not succeed');

expectReject('replay', honestNext, () => release(honestNext, request(honestNext, honestRecord)));
expectReject('four signatures', start, () => release(start, request(start, honestRecord, quorum(honestRecord, ['operator-1', 'operator-2', 'operator-3', 'operator-4']))));
expectReject('duplicate signer', start, () => release(start, request(start, honestRecord, quorum(honestRecord, ['operator-1', 'operator-1', 'operator-2', 'operator-3', 'operator-4']))));
expectReject('outsider signer', start, () => {
  const signatures = quorum(honestRecord, ['operator-1', 'operator-2', 'operator-3', 'operator-4']);
  signatures.push({ signerId: 'outsider', signature: `0x${'00'.repeat(32)}` });
  release(start, request(start, honestRecord, signatures));
});
expectReject('corrupt signature', start, () => {
  const signatures = quorum(honestRecord);
  signatures[0].signature = `0x${'00'.repeat(32)}`;
  release(start, request(start, honestRecord, signatures));
});
expectReject('missing dispatcher capability', start, () => release(start, request(start, honestRecord, quorum(honestRecord), expectedOutputs(start, honestRecord), null)));
expectReject('wrong dispatcher capability', start, () => release(start, request(start, honestRecord, quorum(honestRecord), expectedOutputs(start, honestRecord), 'CLIENT_UPDATE')));

const staleVaultRecord = { ...honestRecord, vaultStateVersion: start.reserve.acceptedVaultStateVersion - 1, depositId: `0x${'a1'.repeat(32)}` };
expectReject('resigned stale vault version', start, () => release(start, request(start, staleVaultRecord, quorum(staleVaultRecord), expectedOutputs(start, staleVaultRecord))));
const futureVaultRecord = { ...honestRecord, vaultStateVersion: start.reserve.acceptedVaultStateVersion + 2, depositId: `0x${'a2'.repeat(32)}` };
expectReject('resigned skipped future vault version', start, () => release(start, request(start, futureVaultRecord, quorum(futureVaultRecord), expectedOutputs(start, futureVaultRecord))));
const equalBalancePoison = {
  ...honestRecord,
  vaultStateVersion: start.reserve.acceptedVaultStateVersion,
  vaultBalanceAtoms: start.reserve.authenticatedVaultBalanceAtoms + 1,
  finalizedBlockNumber: start.reserve.authenticatedFinalizedBlockNumber,
  finalizedBlockHash: start.reserve.authenticatedFinalizedBlockHash,
  depositId: `0x${'a3'.repeat(32)}`,
};
expectReject('resigned equal-version balance poison', start, () => release(start, request(start, equalBalancePoison, quorum(equalBalancePoison), expectedOutputs(start, equalBalancePoison))));
const rollbackBlockRecord = { ...honestRecord, finalizedBlockNumber: start.reserve.authenticatedFinalizedBlockNumber - 1, depositId: `0x${'a4'.repeat(32)}` };
expectReject('resigned finalized-block rollback', start, () => release(start, request(start, rollbackBlockRecord, quorum(rollbackBlockRecord), expectedOutputs(start, rollbackBlockRecord))));
const payoutState = initialState({ reserve: { authenticatedPayoutCursor: 5, authenticatedCumulativePaidAtoms: 200 } });
const payoutRollbackRecord = { ...baseRecord(payoutState), vaultPayoutCursor: 4, depositId: `0x${'a5'.repeat(32)}` };
expectReject('resigned payout-cursor rollback', payoutState, () => release(payoutState, request(payoutState, payoutRollbackRecord, quorum(payoutRollbackRecord), expectedOutputs(payoutState, payoutRollbackRecord))));
const paidRollbackRecord = { ...baseRecord(payoutState), vaultCumulativePaidAtoms: 199, depositId: `0x${'a6'.repeat(32)}` };
expectReject('resigned cumulative-paid rollback', payoutState, () => release(payoutState, request(payoutState, paidRollbackRecord, quorum(paidRollbackRecord), expectedOutputs(payoutState, paidRollbackRecord))));
const staleEpochRecord = { ...honestRecord, committeeEpoch: start.committee.epoch - 1, depositId: `0x${'a7'.repeat(32)}` };
expectReject('resigned stale committee epoch', start, () => release(start, request(start, staleEpochRecord, quorum(staleEpochRecord), expectedOutputs(start, staleEpochRecord))));
const futureEpochRecord = { ...honestRecord, committeeEpoch: start.committee.epoch + 1, depositId: `0x${'a8'.repeat(32)}` };
expectReject('resigned future committee epoch', start, () => release(start, request(start, futureEpochRecord, quorum(futureEpochRecord), expectedOutputs(start, futureEpochRecord))));

const fieldMutations = {
  schemaVersion: 2,
  direction: 2,
  ethereumChainId: 2,
  minimaNetwork: `0x${'91'.repeat(32)}`,
  ethereumVault: `0x${'92'.repeat(20)}`,
  ethereumToken: `0x${'93'.repeat(20)}`,
  reserveCovenant: `0x${'94'.repeat(32)}`,
  depositId: `0x${'95'.repeat(32)}`,
  amountAtoms: 101,
  minimaRecipient: `0x${'96'.repeat(32)}`,
  finalizedBlockNumber: honestRecord.finalizedBlockNumber + 1,
  finalizedBlockHash: `0x${'97'.repeat(32)}`,
  sourceRecordHash: `0x${'98'.repeat(32)}`,
  vaultStateVersion: honestRecord.vaultStateVersion + 1,
  vaultBalanceAtoms: honestRecord.vaultBalanceAtoms + 1,
  vaultPayoutCursor: honestRecord.vaultPayoutCursor + 1,
  vaultCumulativePaidAtoms: honestRecord.vaultCumulativePaidAtoms + 1,
  committeeEpoch: honestRecord.committeeEpoch + 1,
  committeeRoot: `0x${'99'.repeat(32)}`,
  expiryUnixSeconds: honestRecord.expiryUnixSeconds + 1,
};

let fieldMutationCount = 0;
for (const [field, mutatedValue] of Object.entries(fieldMutations)) {
  const mutated = { ...honestRecord, [field]: mutatedValue };
  expectReject(`record mutation ${field}`, start, () => release(start, request(start, mutated, quorum(honestRecord), expectedOutputs(start, mutated))));
  fieldMutationCount += 1;
}

expectReject('expired record', start, () => release(start, request(start, honestRecord, quorum(honestRecord), expectedOutputs(start, honestRecord), 'RELEASE_V1', honestRecord.expiryUnixSeconds + 1)));
expectReject('unknown record field', start, () => {
  const malformed = { ...honestRecord, coordinator: 'not-authority' };
  release(start, request(start, malformed, quorum(honestRecord), expectedOutputs(start, honestRecord)));
});
expectReject('missing record field', start, () => {
  const malformed = { ...honestRecord };
  delete malformed.sourceRecordHash;
  release(start, request(start, malformed, quorum(honestRecord), expectedOutputs(start, honestRecord)));
});

let outputMutationCount = 0;
const outputMutators = [
  (outputs) => { outputs[0].issuedAtoms += 1; },
  (outputs) => { outputs[0].nullifier = `0x${'aa'.repeat(32)}`; },
  (outputs) => { outputs[1].amount -= 1; },
  (outputs) => { outputs[1].covenant = `0x${'ab'.repeat(32)}`; },
  (outputs) => { outputs[2].amount += 1; },
  (outputs) => { outputs[2].recipient = `0x${'ac'.repeat(32)}`; },
  (outputs) => { outputs.push({ index: 3, kind: 'SIGNER_FEE', amount: 1 }); },
  (outputs) => { outputs.reverse(); },
];
for (const [index, mutate] of outputMutators.entries()) {
  const outputs = expectedOutputs(start, honestRecord);
  mutate(outputs);
  expectReject(`output mutation ${index + 1}`, start, () => release(start, request(start, honestRecord, quorum(honestRecord), outputs)));
  outputMutationCount += 1;
}

const zeroRecord = { ...honestRecord, amountAtoms: 0, depositId: `0x${'b1'.repeat(32)}` };
expectReject('zero amount', start, () => release(start, request(start, zeroRecord, quorum(zeroRecord), expectedOutputs(start, zeroRecord))));

const exhaustedState = initialState({ reserve: { fixedSupply: 1_000, reserveAtoms: 100, issuedAtoms: 900, pendingOutboundAtoms: 0, authenticatedVaultBalanceAtoms: 1_000, exposureCapAtoms: 1_000 } });
const exhaustedRecord = { ...baseRecord(exhaustedState), amountAtoms: 100, depositId: `0x${'b2'.repeat(32)}` };
expectReject('reserve exhaustion', exhaustedState, () => release(exhaustedState, request(exhaustedState, exhaustedRecord, quorum(exhaustedRecord), expectedOutputs(exhaustedState, exhaustedRecord))));

const capState = initialState({ reserve: { fixedSupply: 1_000, reserveAtoms: 550, issuedAtoms: 450, pendingOutboundAtoms: 0, authenticatedVaultBalanceAtoms: 1_000, exposureCapAtoms: 500 } });
const capRecord = { ...baseRecord(capState), vaultBalanceAtoms: 1_000, depositId: `0x${'b3'.repeat(32)}` };
expectReject('exposure cap', capState, () => release(capState, request(capState, capRecord, quorum(capRecord), expectedOutputs(capState, capRecord))));

const collateralState = initialState({ reserve: { fixedSupply: 1_000, reserveAtoms: 550, issuedAtoms: 450, pendingOutboundAtoms: 0, authenticatedVaultBalanceAtoms: 500, exposureCapAtoms: 1_000 } });
const collateralRecord = { ...baseRecord(collateralState), vaultBalanceAtoms: 500, depositId: `0x${'b4'.repeat(32)}` };
expectReject('collateral limit', collateralState, () => release(collateralState, request(collateralState, collateralRecord, quorum(collateralRecord), expectedOutputs(collateralState, collateralRecord))));

const pendingState = initialState({ reserve: { fixedSupply: 1_000, reserveAtoms: 800, issuedAtoms: 200, pendingOutboundAtoms: 250, authenticatedVaultBalanceAtoms: 500, exposureCapAtoms: 500 } });
const pendingRecord = { ...baseRecord(pendingState), amountAtoms: 100, depositId: `0x${'b5'.repeat(32)}` };
expectReject('pending outbound collateral', pendingState, () => release(pendingState, request(pendingState, pendingRecord, quorum(pendingRecord), expectedOutputs(pendingState, pendingRecord))));

const falseRecord = {
  ...honestRecord,
  depositId: `0x${'ee'.repeat(32)}`,
  amountAtoms: 200,
  minimaRecipient: `0x${'ef'.repeat(32)}`,
  finalizedBlockHash: `0x${'f0'.repeat(32)}`,
  sourceRecordHash: `0x${'f1'.repeat(32)}`,
};
const simulatedEthereumTruth = new Set([honestRecord.depositId]);
check(!simulatedEthereumTruth.has(falseRecord.depositId), 'collusion fixture unexpectedly exists in simulated Ethereum truth');
const colludingNext = release(start, request(start, falseRecord, quorum(falseRecord)));
check(colludingNext.reserve.nullifiers[falseRecord.depositId] === 'RELEASED', 'colluding quorum counterexample was not accepted');
check(colludingNext.reserve.issuedAtoms === falseRecord.amountAtoms, 'colluding quorum did not create the false liability exactly');

const fiveSmallestBond = [...start.committee.members]
  .map((member) => member.bondAtoms)
  .sort((left, right) => left - right)
  .slice(0, start.committee.threshold)
  .reduce((sum, value) => sum + value, 0);
check(fiveSmallestBond >= start.reserve.exposureCapAtoms, 'model committee bond does not cover the model exposure cap');
check(start.committee.members.length === 7 && start.committee.threshold === 5, 'benchmark is not exactly 5-of-7');
check(encodeRecord(honestRecord).length === 335, 'canonical semantic record length changed');

if (failures.length > 0) {
  console.error(`USDTm P7 threshold validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const result = {
  schema: 'usdtm-p7-threshold-validation/v1',
  status: 'semantic-pass',
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha256(readFileSync(sourcePath)),
  assertionCount: assertions,
  rejectedTransitionAtomicityChecks,
  fieldMutationCount,
  outputMutationCount,
  committeeSize: 7,
  threshold: 5,
  canonicalRecordBytes: encodeRecord(honestRecord).length,
  honestQuorumAccepted: true,
  replayRejected: true,
  colludingQuorumFalseClaimAccepted: true,
  conditionalSafetyAssumption: 'fewer-than-five-active-operators-collude',
  signatureMechanism: 'deterministic semantic mock, not Minima TreeKey/WOTS',
  kissChecksigEstimatedInstructions: 160,
  exactSignedTxPowMeasured: false,
  kissRuntimeExecuted: false,
  mainnetTransactionMined: false,
  operatorIndependenceProved: false,
  ethereumSlashingAdjudicationProved: false,
  noNodeWalletTokenSignatureOrTransactionCommands: true,
};

if (emitEvidence) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `usdtm-p7-threshold-validation-${stamp}.json`);
  const evidence = {
    createdAtUtc: new Date().toISOString(),
    ...result,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(evidencePath, serialized, 'utf8');
  const evidenceSha256 = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`, 'utf8');
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
