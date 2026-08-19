#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const emitEvidence = process.argv.includes('--evidence');
const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const MAX_U64 = (1n << 64n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const failures = [];
let assertions = 0;
let atomicRejects = 0;

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

function stringify(value) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
}

function digest(value) {
  return sha256(stringify(value));
}

const signerSecrets = Object.fromEntries(
  Array.from({ length: 7 }, (_, index) => [`operator-${index + 1}`, `asset-lane-secret-${index + 1}`]),
);

function laneCommitment(config) {
  const fields = {
    laneVersion: config.laneVersion,
    sourceAssetKind: config.sourceAssetKind,
    sourceAsset: config.sourceAsset,
    sourceDecimals: config.sourceDecimals,
    destinationTokenId: config.destinationTokenId,
    destinationDecimals: config.destinationDecimals,
    sourceQuantumAtoms: config.sourceQuantumAtoms,
    destinationQuantumAtoms: config.destinationQuantumAtoms,
    ethereumVault: config.ethereumVault,
    reserveCovenant: config.reserveCovenant,
    configurationEpoch: config.configurationEpoch,
  };
  return `0x${sha256(`GENERIC_BRIDGE_LANE_V1\0${stringify(fields)}`)}`;
}

function makeConfig(input) {
  const config = { laneVersion: 1, configurationEpoch: 1, ...input };
  config.laneId = laneCommitment(config);
  return config;
}

const usdtConfig = makeConfig({
  name: 'USDTm',
  sourceAssetKind: 1,
  sourceAsset: `0x${'11'.repeat(20)}`,
  sourceDecimals: 6,
  destinationTokenId: `0x${'12'.repeat(32)}`,
  destinationDecimals: 6,
  sourceQuantumAtoms: 1n,
  destinationQuantumAtoms: 1n,
  ethereumVault: `0x${'13'.repeat(20)}`,
  reserveCovenant: `0x${'14'.repeat(32)}`,
  fixedSupplyAtoms: 1_000_001_000_000n,
  exposureCapAtoms: 999_999_999_999n,
});

const ethConfig = makeConfig({
  name: 'ETHm',
  sourceAssetKind: 0,
  sourceAsset: ZERO_ADDRESS,
  sourceDecimals: 18,
  destinationTokenId: `0x${'21'.repeat(32)}`,
  destinationDecimals: 18,
  sourceQuantumAtoms: 1n,
  destinationQuantumAtoms: 1n,
  ethereumVault: `0x${'22'.repeat(20)}`,
  reserveCovenant: `0x${'23'.repeat(32)}`,
  fixedSupplyAtoms: 11_000_000_000_000_000_000n,
  exposureCapAtoms: 10_000_000_000_000_000_000n,
});

function validateConfig(config) {
  requireModel(config.sourceAssetKind === 0 || config.sourceAssetKind === 1, 'unknown source asset kind');
  requireModel(config.sourceAssetKind === 0 ? config.sourceAsset === ZERO_ADDRESS : config.sourceAsset !== ZERO_ADDRESS, 'asset kind and source address disagree');
  requireModel(Number.isInteger(config.sourceDecimals) && config.sourceDecimals >= 0 && config.sourceDecimals <= 44, 'invalid source decimals');
  requireModel(Number.isInteger(config.destinationDecimals) && config.destinationDecimals >= 0 && config.destinationDecimals <= 44, 'invalid destination decimals');
  requireModel(config.sourceQuantumAtoms > 0n && config.destinationQuantumAtoms > 0n, 'quantum is not positive');
  requireModel(config.fixedSupplyAtoms <= MAX_U64 && config.exposureCapAtoms <= MAX_U64, 'single-limb lane exceeds uint64');
  requireModel(config.exposureCapAtoms < config.fixedSupplyAtoms, 'lane lacks positive reserve floor');
  requireModel(config.laneId === laneCommitment(config), 'lane ID does not match immutable fields');
}

function initialState() {
  validateConfig(usdtConfig);
  validateConfig(ethConfig);
  const makeLane = (config) => ({
    config: clone(config),
    reserveAtoms: config.fixedSupplyAtoms,
    issuedAtoms: 0n,
    pendingOutboundAtoms: 0n,
    authenticatedCollateralAtoms: 0n,
    nullifiers: {},
  });
  const makeVault = (config) => ({
    sourceAssetKind: config.sourceAssetKind,
    accountedAssetAtoms: 0n,
    rawNativeBalanceWei: 0n,
    usedCapacityAtoms: 0n,
    locked: false,
    deposits: {},
    redemptions: {},
  });
  return {
    lanes: {
      [usdtConfig.laneId]: makeLane(usdtConfig),
      [ethConfig.laneId]: makeLane(ethConfig),
    },
    vaults: {
      [usdtConfig.laneId]: makeVault(usdtConfig),
      [ethConfig.laneId]: makeVault(ethConfig),
    },
  };
}

function depositNative(state, { laneId, depositId, amountWei, recipient, namedEntrypoint = true }) {
  const next = clone(state);
  const lane = next.lanes[laneId];
  const vault = next.vaults[laneId];
  requireModel(lane && vault, 'unknown lane');
  requireModel(lane.config.sourceAssetKind === 0, 'native deposit used non-native lane');
  requireModel(namedEntrypoint, 'direct native transfer is not an accepted deposit');
  requireModel(amountWei > 0n && amountWei <= MAX_U64, 'native amount outside single-limb range');
  requireModel(!Object.hasOwn(vault.deposits, depositId), 'duplicate source deposit');
  requireModel(vault.usedCapacityAtoms + amountWei <= lane.config.exposureCapAtoms, 'native source capacity exceeded');
  vault.accountedAssetAtoms += amountWei;
  vault.rawNativeBalanceWei += amountWei;
  vault.usedCapacityAtoms += amountWei;
  vault.deposits[depositId] = { amountAtoms: amountWei, recipient, status: 'PENDING' };
  return next;
}

function forceNative(state, laneId, amountWei) {
  const next = clone(state);
  const lane = next.lanes[laneId];
  const vault = next.vaults[laneId];
  requireModel(lane?.config.sourceAssetKind === 0 && vault, 'forced ETH targets wrong lane');
  requireModel(amountWei > 0n, 'forced ETH amount is not positive');
  vault.rawNativeBalanceWei += amountWei;
  return next;
}

function depositErc20(state, { laneId, depositId, requestedAtoms, measuredReceivedAtoms, recipient }) {
  const next = clone(state);
  const lane = next.lanes[laneId];
  const vault = next.vaults[laneId];
  requireModel(lane && vault, 'unknown lane');
  requireModel(lane.config.sourceAssetKind === 1, 'ERC-20 deposit used native lane');
  requireModel(requestedAtoms > 0n && measuredReceivedAtoms > 0n, 'ERC-20 amount is not positive');
  requireModel(measuredReceivedAtoms <= MAX_U64, 'ERC-20 measured amount outside single-limb range');
  requireModel(!Object.hasOwn(vault.deposits, depositId), 'duplicate source deposit');
  requireModel(vault.usedCapacityAtoms + measuredReceivedAtoms <= lane.config.exposureCapAtoms, 'ERC-20 source capacity exceeded');
  vault.accountedAssetAtoms += measuredReceivedAtoms;
  vault.usedCapacityAtoms += measuredReceivedAtoms;
  vault.deposits[depositId] = {
    requestedAtoms,
    amountAtoms: measuredReceivedAtoms,
    recipient,
    status: 'PENDING',
  };
  return next;
}

function recordForDeposit(state, laneId, depositId) {
  const lane = state.lanes[laneId];
  const vault = state.vaults[laneId];
  const deposit = vault?.deposits[depositId];
  requireModel(lane && vault && deposit, 'source deposit does not exist');
  return {
    schema: 1,
    laneId,
    sourceAssetKind: lane.config.sourceAssetKind,
    sourceAsset: lane.config.sourceAsset,
    sourceDecimals: lane.config.sourceDecimals,
    destinationTokenId: lane.config.destinationTokenId,
    destinationDecimals: lane.config.destinationDecimals,
    sourceQuantumAtoms: lane.config.sourceQuantumAtoms,
    destinationQuantumAtoms: lane.config.destinationQuantumAtoms,
    ethereumVault: lane.config.ethereumVault,
    reserveCovenant: lane.config.reserveCovenant,
    configurationEpoch: lane.config.configurationEpoch,
    depositId,
    sourceAmountAtoms: deposit.amountAtoms,
    minimaRecipient: deposit.recipient,
    vaultBalanceAtoms: vault.accountedAssetAtoms,
    expiry: 2_000,
  };
}

function recordDigest(record) {
  return sha256(`GENERIC_BRIDGE_ATTESTATION_V1\0${stringify(record)}`);
}

function sign(record, signerId) {
  requireModel(Object.hasOwn(signerSecrets, signerId), 'unknown signer');
  return {
    signerId,
    signature: sha256(`${signerSecrets[signerId]}\0${recordDigest(record)}`),
  };
}

function quorum(record) {
  return Object.keys(signerSecrets).slice(0, 5).map((signerId) => sign(record, signerId));
}

function convertAmount(config, sourceAmountAtoms) {
  requireModel(sourceAmountAtoms > 0n && sourceAmountAtoms <= MAX_U64, 'source amount outside uint64');
  requireModel(sourceAmountAtoms % config.sourceQuantumAtoms === 0n, 'source amount is not divisible by lane quantum');
  const units = sourceAmountAtoms / config.sourceQuantumAtoms;
  const destinationAmountAtoms = units * config.destinationQuantumAtoms;
  requireModel(destinationAmountAtoms > 0n && destinationAmountAtoms <= MAX_U64, 'destination amount outside uint64');
  return destinationAmountAtoms;
}

function expectedOutputs(lane, record) {
  const amount = convertAmount(lane.config, record.sourceAmountAtoms);
  return [
    { index: 0, kind: 'CONTROL', laneId: lane.config.laneId, issuedAtoms: lane.issuedAtoms + amount },
    { index: 1, kind: 'RESERVE', tokenId: lane.config.destinationTokenId, amountAtoms: lane.reserveAtoms - amount, covenant: lane.config.reserveCovenant },
    { index: 2, kind: 'RECIPIENT', tokenId: lane.config.destinationTokenId, amountAtoms: amount, recipient: record.minimaRecipient },
  ];
}

function release(state, { laneId, record, signatures, outputs, now = 1_000 }) {
  const lane = state.lanes[laneId];
  requireModel(lane, 'unknown destination lane');
  validateConfig(lane.config);
  const config = lane.config;
  requireModel(record.laneId === laneId, 'cross-lane record');
  for (const field of [
    'sourceAssetKind', 'sourceAsset', 'sourceDecimals', 'destinationTokenId',
    'destinationDecimals', 'sourceQuantumAtoms', 'destinationQuantumAtoms',
    'ethereumVault', 'reserveCovenant', 'configurationEpoch',
  ]) {
    requireModel(record[field] === config[field], `record lane field mismatch: ${field}`);
  }
  requireModel(now <= record.expiry, 'record expired');
  const nullifier = `${record.laneId}:${record.depositId}`;
  requireModel(!Object.hasOwn(lane.nullifiers, nullifier), 'lane-local replay');
  const unique = new Set();
  for (const item of signatures) {
    requireModel(Object.hasOwn(signerSecrets, item.signerId), 'outsider signer');
    requireModel(!unique.has(item.signerId), 'duplicate signer');
    unique.add(item.signerId);
    requireModel(item.signature === sign(record, item.signerId).signature, 'signature does not bind exact lane record');
  }
  requireModel(unique.size >= 5, 'insufficient quorum');
  const amount = convertAmount(config, record.sourceAmountAtoms);
  requireModel(amount < lane.reserveAtoms, 'positive reserve floor violated');
  const newIssued = lane.issuedAtoms + amount;
  requireModel(newIssued <= config.exposureCapAtoms, 'lane exposure cap exceeded');
  requireModel(newIssued + lane.pendingOutboundAtoms <= record.vaultBalanceAtoms, 'lane collateral exceeded');
  requireModel(stringify(outputs) === stringify(expectedOutputs(lane, record)), 'lane outputs are not exact');

  const next = clone(state);
  const nextLane = next.lanes[laneId];
  nextLane.reserveAtoms -= amount;
  nextLane.issuedAtoms = newIssued;
  nextLane.authenticatedCollateralAtoms = record.vaultBalanceAtoms;
  nextLane.nullifiers[nullifier] = 'RELEASED';
  requireModel(nextLane.reserveAtoms + nextLane.issuedAtoms === config.fixedSupplyAtoms, 'lane conservation failed');
  return next;
}

function payoutNative(state, { laneId, redemptionId, amountWei, recipient, settled, receiverSucceeds, callback }) {
  const vault = state.vaults[laneId];
  const lane = state.lanes[laneId];
  requireModel(vault && lane?.config.sourceAssetKind === 0, 'native payout used wrong lane');
  requireModel(!vault.locked, 'global native vault reentrancy lock');
  requireModel(settled === true, 'redemption is not settled');
  requireModel(!Object.hasOwn(vault.redemptions, redemptionId), 'native redemption replay');
  requireModel(amountWei > 0n && amountWei <= vault.accountedAssetAtoms, 'payout exceeds accounted native collateral');
  const next = clone(state);
  const nextVault = next.vaults[laneId];
  nextVault.locked = true;
  nextVault.redemptions[redemptionId] = { amountWei, recipient, status: 'CONSUMED' };
  nextVault.accountedAssetAtoms -= amountWei;
  nextVault.rawNativeBalanceWei -= amountWei;
  if (callback) callback(next);
  requireModel(receiverSucceeds === true, 'native receiver rejected payout');
  nextVault.locked = false;
  nextVault.redemptions[redemptionId].status = 'PAID';
  return next;
}

function expectReject(label, state, operation) {
  const before = digest(state);
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  check(rejected, `${label}: unexpectedly accepted`);
  check(digest(state) === before, `${label}: rejected operation changed state`);
  atomicRejects += 1;
}

let state = initialState();
check(Object.keys(state.lanes).length === 2, 'initial state does not contain two isolated lanes');
check(ethConfig.destinationDecimals === 18 && ethConfig.exposureCapAtoms === 10_000_000_000_000_000_000n, 'ETH lane is not exact-wei under 10 ETH cap');
check(ethConfig.exposureCapAtoms < MAX_U64, 'ETH prototype cap exceeds uint64');

expectReject('zero native deposit', state, () => depositNative(state, { laneId: ethConfig.laneId, depositId: 'eth-zero', amountWei: 0n, recipient: 'Mx00' }));
expectReject('direct native transfer', state, () => depositNative(state, { laneId: ethConfig.laneId, depositId: 'eth-direct', amountWei: 1n, recipient: 'Mx00', namedEntrypoint: false }));
expectReject('native deposit into ERC-20 lane', state, () => depositNative(state, { laneId: usdtConfig.laneId, depositId: 'wrong-kind', amountWei: 1n, recipient: 'Mx00' }));
expectReject('single-limb overflow', state, () => depositNative(state, { laneId: ethConfig.laneId, depositId: 'overflow', amountWei: MAX_U64 + 1n, recipient: 'Mx00' }));
expectReject('native cap excess', state, () => depositNative(state, { laneId: ethConfig.laneId, depositId: 'cap', amountWei: ethConfig.exposureCapAtoms + 1n, recipient: 'Mx00' }));

state = depositNative(state, {
  laneId: ethConfig.laneId,
  depositId: 'eth-deposit-1',
  amountWei: 1_000_000_000_000_000_000n,
  recipient: `0x${'31'.repeat(32)}`,
});
check(state.vaults[ethConfig.laneId].accountedAssetAtoms === 1_000_000_000_000_000_000n, 'native deposit did not update accounted collateral');
state = forceNative(state, ethConfig.laneId, 2_000_000_000_000_000_000n);
check(state.vaults[ethConfig.laneId].rawNativeBalanceWei === 3_000_000_000_000_000_000n, 'forced native balance was not observed');
check(state.vaults[ethConfig.laneId].accountedAssetAtoms === 1_000_000_000_000_000_000n, 'forced native balance changed attributable collateral');

const ethRecord = recordForDeposit(state, ethConfig.laneId, 'eth-deposit-1');
const usdtLaneBeforeEth = digest(state.lanes[usdtConfig.laneId]);
state = release(state, {
  laneId: ethConfig.laneId,
  record: ethRecord,
  signatures: quorum(ethRecord),
  outputs: expectedOutputs(state.lanes[ethConfig.laneId], ethRecord),
});
check(state.lanes[ethConfig.laneId].issuedAtoms === 1_000_000_000_000_000_000n, 'ETH release amount is not exact wei');
check(digest(state.lanes[usdtConfig.laneId]) === usdtLaneBeforeEth, 'ETH release mutated USDT lane');

expectReject('cross-lane replay', state, () => release(state, {
  laneId: usdtConfig.laneId,
  record: ethRecord,
  signatures: quorum(ethRecord),
  outputs: [],
}));

const decimalMutation = { ...ethRecord, destinationDecimals: 16 };
expectReject('signed-field decimal mutation', state, () => release(state, {
  laneId: ethConfig.laneId,
  record: decimalMutation,
  signatures: quorum(ethRecord),
  outputs: expectedOutputs(state.lanes[ethConfig.laneId], ethRecord),
}));

const kindMutation = { ...ethRecord, sourceAssetKind: 1 };
expectReject('signed-field asset-kind mutation', state, () => release(state, {
  laneId: ethConfig.laneId,
  record: kindMutation,
  signatures: quorum(ethRecord),
  outputs: expectedOutputs(state.lanes[ethConfig.laneId], ethRecord),
}));

let usdtState = depositErc20(state, {
  laneId: usdtConfig.laneId,
  depositId: 'usdt-deposit-1',
  requestedAtoms: 100_000_000n,
  measuredReceivedAtoms: 99_000_000n,
  recipient: `0x${'41'.repeat(32)}`,
});
check(usdtState.vaults[usdtConfig.laneId].deposits['usdt-deposit-1'].amountAtoms === 99_000_000n, 'ERC-20 deposit trusted requested rather than measured amount');
const usdtRecord = recordForDeposit(usdtState, usdtConfig.laneId, 'usdt-deposit-1');
const ethLaneBeforeUsdt = digest(usdtState.lanes[ethConfig.laneId]);
usdtState = release(usdtState, {
  laneId: usdtConfig.laneId,
  record: usdtRecord,
  signatures: quorum(usdtRecord),
  outputs: expectedOutputs(usdtState.lanes[usdtConfig.laneId], usdtRecord),
});
check(usdtState.lanes[usdtConfig.laneId].issuedAtoms === 99_000_000n, 'ERC-20 lane release used wrong amount');
check(digest(usdtState.lanes[ethConfig.laneId]) === ethLaneBeforeUsdt, 'USDT release mutated ETH lane');

const coarseConfig = makeConfig({
  ...ethConfig,
  name: 'coarse-test',
  destinationTokenId: `0x${'51'.repeat(32)}`,
  sourceQuantumAtoms: 100n,
  destinationQuantumAtoms: 1n,
});
check(convertAmount(coarseConfig, 1_000n) === 10n, 'coarser exact conversion failed');
expectReject('conversion dust', state, () => convertAmount(coarseConfig, 1_001n));

expectReject('forced surplus payout', state, () => payoutNative(state, {
  laneId: ethConfig.laneId,
  redemptionId: 'too-much',
  amountWei: 2_000_000_000_000_000_000n,
  recipient: 'receiver',
  settled: true,
  receiverSucceeds: true,
}));
expectReject('unsettled native payout', state, () => payoutNative(state, {
  laneId: ethConfig.laneId,
  redemptionId: 'unsettled',
  amountWei: 1n,
  recipient: 'receiver',
  settled: false,
  receiverSucceeds: true,
}));
expectReject('failed native receiver', state, () => payoutNative(state, {
  laneId: ethConfig.laneId,
  redemptionId: 'failed-receiver',
  amountWei: 100n,
  recipient: 'receiver',
  settled: true,
  receiverSucceeds: false,
}));
expectReject('native callback reentry', state, () => payoutNative(state, {
  laneId: ethConfig.laneId,
  redemptionId: 'outer',
  amountWei: 100n,
  recipient: 'receiver',
  settled: true,
  receiverSucceeds: true,
  callback: (intermediate) => payoutNative(intermediate, {
    laneId: ethConfig.laneId,
    redemptionId: 'inner',
    amountWei: 1n,
    recipient: 'receiver',
    settled: true,
    receiverSucceeds: true,
  }),
}));

const payoutState = payoutNative(state, {
  laneId: ethConfig.laneId,
  redemptionId: 'paid-1',
  amountWei: 100_000_000_000_000_000n,
  recipient: 'receiver',
  settled: true,
  receiverSucceeds: true,
});
check(payoutState.vaults[ethConfig.laneId].accountedAssetAtoms === 900_000_000_000_000_000n, 'native payout did not reduce accounted collateral exactly');
check(payoutState.vaults[ethConfig.laneId].rawNativeBalanceWei === 2_900_000_000_000_000_000n, 'native payout did not preserve forced surplus distinction');
expectReject('native payout replay', payoutState, () => payoutNative(payoutState, {
  laneId: ethConfig.laneId,
  redemptionId: 'paid-1',
  amountWei: 1n,
  recipient: 'receiver',
  settled: true,
  receiverSucceeds: true,
}));

const tokenCreatePath = resolve(root, 'upstream', 'minima-core', 'src', 'org', 'minima', 'system', 'commands', 'base', 'tokencreate.java');
const miniNumberPath = resolve(root, 'upstream', 'minima-core', 'src', 'org', 'minima', 'objects', 'base', 'MiniNumber.java');
const contractPath = resolve(root, 'upstream', 'minima-core', 'src', 'org', 'minima', 'kissvm', 'Contract.java');
const tokenCreateSource = readFileSync(tokenCreatePath, 'utf8');
const miniNumberSource = readFileSync(miniNumberPath, 'utf8');
const contractSource = readFileSync(contractPath, 'utf8');
check(tokenCreateSource.includes('if(uselimits && decimals>16)'), 'pinned tokencreate 16-decimal safety check changed');
check(tokenCreateSource.includes('getBooleanParam("uselimits", true)'), 'pinned tokencreate uselimits default changed');
check(tokenCreateSource.includes('not consensus set - could be more'), 'pinned tokencreate non-consensus comment changed');
check(miniNumberSource.includes('MAX_DECIMAL_PLACES = MAX_DIGITS - 20'), 'pinned MiniNumber decimal bound changed');
check(miniNumberSource.includes('pow(64).subtract(BigDecimal.ONE)'), 'pinned MiniNumber magnitude bound changed');
check(contractSource.includes('getScaledTokenAmount(amt)'), 'KISS @AMOUNT token scaling path changed');

if (failures.length > 0) {
  console.error(`Generic bridge asset-lane validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const result = {
  schema: 'generic-bridge-asset-lane-validation/v1',
  status: 'semantic-and-source-pass',
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha256(readFileSync(sourcePath)),
  assertionCount: assertions,
  atomicRejectCount: atomicRejects,
  laneCount: 2,
  lanes: [
    { name: 'USDTm', kind: 'ERC20', decimals: 6, capAtoms: usdtConfig.exposureCapAtoms.toString() },
    { name: 'ETHm-provisional', kind: 'NATIVE', decimals: 18, capAtoms: ethConfig.exposureCapAtoms.toString() },
  ],
  ethExactWeiModeled: true,
  ethSingleLimbMaximumWei: MAX_U64.toString(),
  ethSingleLimbMaximum: '18.446744073709551615 ETH',
  ethPrototypeCapWei: ethConfig.exposureCapAtoms.toString(),
  forcedEthExcludedFromAttributableCollateral: true,
  crossLaneReplayRejected: true,
  crossLaneStateIsolationChecked: true,
  erc20MeasuredIncreaseChecked: true,
  nativePayoutAtomicityAndReentrancyChecked: true,
  tokenCreate18DecimalsRuntimeExecuted: false,
  kissRuntimeExecuted: false,
  exactSignedTxPowMeasured: false,
  tokenWalletOrNodeCommandExecuted: false,
  sourceInspection: {
    minimaCommit: '52542f25605a28a776e9b3b43b0808a05dceab01',
    tokencreateSha256: sha256(tokenCreateSource),
    miniNumberSha256: sha256(miniNumberSource),
    contractSha256: sha256(contractSource),
  },
};

if (emitEvidence) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `generic-bridge-asset-lane-validation-${stamp}.json`);
  const serialized = `${JSON.stringify({ createdAtUtc: new Date().toISOString(), ...result }, null, 2)}\n`;
  writeFileSync(evidencePath, serialized, 'utf8');
  const evidenceSha256 = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`, 'utf8');
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
