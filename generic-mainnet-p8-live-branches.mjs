// Exact five-action live P8 lane executor. Build, post and confirmation are separate steps.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION, DOMAIN, encodeP8Record, p8RecordDigest } from './generic-p8-records-primary.mjs';
import { redemptionId } from './generic-p8-record-fixtures.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-p8-ceremony-state.json');
const LANES_PATH = resolve(ROOT, 'mainnet-lanes-p8.json');
const SIGNERS_PATH = resolve(ROOT, 'mainnet-test-signers.json');
const RPC = process.env.BRIDGE_TEST_SIGNERS_RPC || 'http://127.0.0.1:9705';
const command = process.argv[2] || 'status';
const laneKey = process.argv[3];
const actionKey = process.argv[4];
const ORDER = ['CLIENT_UPDATE', 'RELEASE', 'CANCEL', 'RETURN', 'PAYOUT_ACK'];
const KEY_MAP = Object.freeze({ client: 'CLIENT_UPDATE', release: 'RELEASE', cancel: 'CANCEL', return: 'RETURN', payout: 'PAYOUT_ACK' });
const upper = (value) => String(value || '').toUpperCase();
const lower = (value) => String(value || '').toLowerCase();
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.response) ? value.response : []);
const sameAmount = (left, right) => String(left).replace(/\.0+$/, '') === String(right).replace(/\.0+$/, '');
const sha3Text = (value) => `0x${createHash('sha3-256').update(value, 'utf8').digest('hex')}`;
const raw = (value) => Buffer.from(String(value).replace(/^0x/i, ''), 'hex');
const uint = (value, width) => {
  let number = BigInt(value); const output = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index -= 1) { output[index] = Number(number & 255n); number >>= 8n; }
  return output;
};
const sha3Hex = (...values) => `0x${createHash('sha3-256').update(Buffer.concat(values.map(raw))).digest('hex')}`;
const decimal = (atoms, decimals) => {
  const value = BigInt(atoms); const scale = 10n ** BigInt(decimals);
  const whole = value / scale; const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};
function refuseUnguardedWrite() {
  throw new Error('legacy live signing and posting are disabled after P8; a P9 fenced guard adapter is required');
}

function loadState() { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
function saveState(state) { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n'); }
function loadLanes() { return JSON.parse(readFileSync(LANES_PATH, 'utf8')); }
function loadSigners() { return JSON.parse(readFileSync(SIGNERS_PATH, 'utf8')); }

async function rpc(text) {
  const response = await fetch(RPC + '/' + encodeURIComponent(text));
  const body = await response.json(); return Array.isArray(body) ? body[0] : body;
}
async function must(text) {
  const reply = await rpc(text);
  if (!reply?.status) throw new Error(`${text.split(' ')[0]} failed: ${reply?.error || reply?.message || 'unknown error'}`);
  return reply.response;
}
async function coin(coinid) {
  const response = await must(`coins coinid:${coinid}`);
  return rows(response).find((entry) => upper(entry.coinid) === upper(coinid));
}
async function keyUses(publicKeys) {
  const response = await must('keys'); const keys = response.keys || [];
  return publicKeys.map((publicKey) => {
    const found = keys.find((entry) => upper(entry.publickey) === upper(publicKey));
    if (!found) throw new Error(`configured signing key missing: ${publicKey}`);
    return Number(found.uses);
  });
}
function coinState(found) {
  return Object.fromEntries((found.state || []).map((entry) => [String(entry.port), String(entry.data)]));
}
function txState(transaction) {
  return Object.fromEntries((transaction.state || []).map((entry) => [String(entry.port), String(entry.data)]));
}

function selected(requireAction = false) {
  const state = loadState(); const lanes = loadLanes(); const signers = loadSigners();
  const name = laneKey === 'usdtm' ? 'USDTm' : (laneKey === 'ethm' ? 'ETHm' : null);
  if (!name) throw new Error('lane must be usdtm or ethm');
  const lane = lanes.lanes.find((entry) => entry.name === name); const genesis = state.genesis?.[name];
  if (!lane || !genesis?.minedTxPoW || !genesis?.genesisStateExact) throw new Error(`${name} exact genesis is not confirmed`);
  state.branches ||= {}; state.branches[name] ||= { prepared: false, actions: {} };
  const branch = state.branches[name];
  const type = requireAction ? KEY_MAP[actionKey] : null;
  if (requireAction && !type) throw new Error('action must be client, release, cancel, return or payout');
  return { state, lanes, signers, name, lane, genesis, branch, type };
}

function expectedNext(branch) {
  return ORDER.find((type) => !branch.actions?.[type]?.minedTxPoW) || null;
}
function requireCurrentCoin(found, tokenId, amount, statePorts, label, minimumAge = 3) {
  if (!found || found.spent === true || Number(found.created || 0) <= 0) throw new Error(`${label} is missing or spent`);
  if (Number(found.age || 0) < minimumAge) throw new Error(`${label} is not ${minimumAge} blocks old`);
  if (upper(found.tokenid) !== upper(tokenId) || !sameAmount(found.tokenamount || found.amount, amount)) throw new Error(`${label} token or amount differs`);
  const count = Array.isArray(found.state) ? found.state.length : Object.keys(found.state || {}).length;
  if (count !== statePorts) throw new Error(`${label} state-port count differs: ${count}`);
}

function commonRecord(lane, type) {
  return {
    domainTag: DOMAIN[type], schemaVersion: '1', action: String(ACTION[type]), laneVersion: '2',
    sourceAssetKind: String(lane.sourceKind), sourceDecimals: String(lane.decimals),
    destinationDecimals: String(lane.decimals), sourceQuantumAtoms: '1', destinationQuantumAtoms: '1',
    laneExposureCapDestinationAtoms: lane.capAtoms, ethereumChainId: '1', minimaNetwork: lower(lane.minimaNetwork || loadLanes().minimaNetwork),
    ethereumVault: lower(lane.ethereumVault), sourceAsset: lower(lane.sourceAsset), laneId: lower(lane.laneId),
    destinationTokenId: lower(lane.bridgeTokenId), reserveCovenant: lower(lane.covenantAddress),
    controlTokenId: lower(lane.controlTokenId), configurationEpoch: '1', committeeEpoch: '1',
    committeeRoot: lower(loadLanes().committeeRoot),
  };
}

function sourceFields(lane, type, current, version, sourceTime) {
  const label = `P8_LIVE_${lane.name}_${type}_${version}`;
  return {
    finalizedBlockNumber: String(BigInt(current['26']) + 1n),
    finalizedBlockHash: sha3Text(`${label}\0BLOCK`), sourceRecordHash: sha3Text(`${label}\0SOURCE`),
    previousVaultStateVersion: current['25'], vaultStateVersion: String(version),
    newClientStateHash: sha3Text(`${label}\0CLIENT`), newBridgeStateHash: sha3Text(`${label}\0BRIDGE`),
    vaultBalanceSourceAtoms: lane.name === 'USDTm' ? '5000000' : '5000000000000000000',
    sourceExecutionTimeMilliseconds: String(sourceTime),
  };
}

function nullifierSuccessor(previousRoot, laneId, depositId, actionCode) {
  const actionHex = `0x${uint(actionCode, 2).toString('hex')}`;
  return sha3Hex(lower(previousRoot), lower(laneId), lower(depositId), actionHex);
}

function makeTransition(lane, type, current, acceptedBlock, returnedCoinId, authorityPublicKey, returnOwner) {
  const common = commonRecord(lane, type); const sourceTime = Date.now();
  const amount = lane.name === 'USDTm' ? 1250000n : 1250000000000000000n;
  const next = { ...current }; delete next['90'];
  let record; let payoutAddress = null;
  if (type === 'CLIENT_UPDATE') {
    const source = sourceFields(lane, type, current, BigInt(current['25']) + 1n, sourceTime);
    record = { ...common, ...source, vaultPayoutCursor: current['15'], vaultCumulativePaidSourceAtoms: current['16'] };
    Object.assign(next, { 2: source.newClientStateHash, 3: source.newBridgeStateHash, 8: source.vaultBalanceSourceAtoms,
      17: String(acceptedBlock), 25: source.vaultStateVersion, 26: source.finalizedBlockNumber, 27: source.finalizedBlockHash });
  } else if (type === 'RELEASE') {
    const source = sourceFields(lane, type, current, BigInt(current['25']) + 1n, sourceTime);
    const depositId = sha3Text(`P8_LIVE_${lane.name}_RELEASE_DEPOSIT\0${source.vaultStateVersion}`);
    payoutAddress = returnOwner.address;
    record = { ...common, depositId, amountSourceAtoms: String(amount), amountDestinationAtoms: String(amount),
      minimaRecipient: lower(payoutAddress), ...source, vaultPayoutCursor: current['15'],
      vaultCumulativePaidSourceAtoms: current['16'] };
    Object.assign(next, { 2: source.newClientStateHash, 3: source.newBridgeStateHash,
      4: String(BigInt(current['4']) + amount), 6: String(BigInt(current['6']) - amount), 8: source.vaultBalanceSourceAtoms,
      10: nullifierSuccessor(current['10'], lane.laneId, depositId, ACTION.RELEASE), 17: String(acceptedBlock),
      25: source.vaultStateVersion, 26: source.finalizedBlockNumber, 27: source.finalizedBlockHash });
  } else if (type === 'CANCEL') {
    const source = sourceFields(lane, type, current, BigInt(current['25']) + 1n, sourceTime);
    const depositId = sha3Text(`P8_LIVE_${lane.name}_CANCEL_DEPOSIT\0${source.vaultStateVersion}`);
    record = { ...common, depositId, amountSourceAtoms: String(amount), amountDestinationAtoms: String(amount),
      minimaRecipient: lower(returnOwner.address), refundRecipient: lower(lane.ethereumVault),
      cancellationAuthorityPublicKey: lower(authorityPublicKey), ethereumRecordStatus: '1', ...source,
      vaultPayoutCursor: current['15'], vaultCumulativePaidSourceAtoms: current['16'] };
    Object.assign(next, { 2: source.newClientStateHash, 3: source.newBridgeStateHash, 8: source.vaultBalanceSourceAtoms,
      10: nullifierSuccessor(current['10'], lane.laneId, depositId, ACTION.CANCEL), 17: String(acceptedBlock),
      25: source.vaultStateVersion, 26: source.finalizedBlockNumber, 27: source.finalizedBlockHash });
  } else if (type === 'RETURN') {
    if (!returnedCoinId) throw new Error('RETURN requires the exact mined RELEASE payout coin');
    record = { ...common, returnedCoinId: lower(returnedCoinId), amountSourceAtoms: String(amount),
      amountDestinationAtoms: String(amount), ethereumRecipient: lower(lane.ethereumVault) };
    record.redemptionId = redemptionId(record);
    Object.assign(next, { 4: String(BigInt(current['4']) - amount), 5: String(BigInt(current['5']) + amount),
      6: String(BigInt(current['6']) + amount), 19: record.redemptionId,
      20: record.ethereumRecipient, 21: record.returnedCoinId, 22: String(amount) });
  } else if (type === 'PAYOUT_ACK') {
    const source = sourceFields(lane, type, current, BigInt(current['25']) + 1n, sourceTime);
    const priorCursor = BigInt(current['15']); const priorPaid = BigInt(current['16']);
    const redemption = current['19'];
    record = { ...common, payoutBatchId: sha3Text(`P8_LIVE_${lane.name}_PAYOUT_BATCH\0${priorCursor + 1n}`),
      priorPayoutCursor: String(priorCursor), newPayoutCursor: String(priorCursor + 1n),
      priorCumulativePaidSourceAtoms: String(priorPaid), newCumulativePaidSourceAtoms: String(priorPaid + amount),
      batchPaidSourceAtoms: String(amount), batchPaidDestinationAtoms: String(amount), firstRedemptionId: redemption,
      lastRedemptionId: redemption, payoutRangeRoot: sha3Text(`P8_LIVE_${lane.name}_PAYOUT_RANGE\0${redemption}`), ...source };
    Object.assign(next, { 2: source.newClientStateHash, 3: source.newBridgeStateHash,
      5: String(BigInt(current['5']) - amount), 8: source.vaultBalanceSourceAtoms,
      15: record.newPayoutCursor, 16: record.newCumulativePaidSourceAtoms, 17: String(acceptedBlock),
      25: source.vaultStateVersion, 26: source.finalizedBlockNumber, 27: source.finalizedBlockHash });
  } else throw new Error('unsupported transition');
  const recordBytes = encodeP8Record(record); next['90'] = `0x${recordBytes.toString('hex')}`;
  return { record, recordHex: next['90'], recordDigest: p8RecordDigest(record), successor: next,
    amountAtoms: String(amount), payoutAddress };
}

function checkStructure(transaction, lane, branch, type, transition) {
  const expectedInputs = type === 'RETURN' ? 3 : 2; const expectedOutputs = type === 'RELEASE' ? 3 : 2;
  if (transaction.inputs?.length !== expectedInputs || transaction.outputs?.length !== expectedOutputs) throw new Error('branch cardinality differs');
  if (upper(transaction.inputs[0]?.coinid) !== upper(branch.current.controlCoinId)
      || upper(transaction.inputs[1]?.coinid) !== upper(branch.current.reserveCoinId)) throw new Error('control or reserve input ordering differs');
  if (type === 'RETURN' && upper(transaction.inputs[2]?.coinid) !== upper(branch.payoutCoinId)) throw new Error('RETURN input coin differs');
  const expectedReserve = decimal(transition.successor['6'], lane.decimals);
  const [controlOut, reserveOut, payoutOut] = transaction.outputs;
  if (upper(controlOut?.address) !== upper(lane.covenantAddress) || upper(controlOut?.tokenid) !== upper(lane.controlTokenId)
      || !sameAmount(controlOut?.tokenamount || controlOut?.amount, '1') || controlOut?.storestate !== true
      || upper(reserveOut?.address) !== upper(lane.covenantAddress) || upper(reserveOut?.tokenid) !== upper(lane.bridgeTokenId)
      || !sameAmount(reserveOut?.tokenamount || reserveOut?.amount, expectedReserve) || reserveOut?.storestate !== false) throw new Error('control or reserve output differs');
  if (type === 'RELEASE' && (upper(payoutOut?.address) !== upper(transition.payoutAddress)
      || upper(payoutOut?.tokenid) !== upper(lane.bridgeTokenId)
      || !sameAmount(payoutOut?.tokenamount || payoutOut?.amount, decimal(transition.amountAtoms, lane.decimals))
      || payoutOut?.storestate !== false)) throw new Error('RELEASE payout output differs');
  const actual = txState(transaction); const expected = transition.successor;
  if (Object.keys(actual).length !== 41 || Object.keys(expected).length !== 41
      || Object.keys(expected).some((port) => upper(actual[port]) !== upper(expected[port]))) throw new Error('successor state differs');
}

function checkTxn(response, type) {
  const expectedInputs = type === 'RETURN' ? 3 : 2; const expectedOutputs = type === 'RELEASE' ? 3 : 2;
  const expectedSignatures = type === 'RETURN' ? 1 : (type === 'CANCEL' ? 6 : 5);
  if (response.inputs !== expectedInputs || response.outputs !== expectedOutputs || response.signatures !== expectedSignatures
      || response.validamounts !== true || response.allsignaturesvalid !== true || response.validtransaction !== true
      || response.valid?.basic !== true || response.valid?.mmrproofs !== true || response.valid?.scripts !== true) {
    throw new Error(`branch txncheck failed: ${JSON.stringify(response)}`);
  }
  if (!response.coins?.every((entry) => String(entry.difference) === '0')) throw new Error('branch burns or creates token quantity');
}

async function prepare() {
  const { state, lane, genesis, name, branch } = selected();
  const script = readFileSync(resolve(ROOT, lane.scriptFile), 'utf8').trim();
  const parsed = await must(`runscript script:"${script}"`);
  if (parsed.parseok !== true || upper(parsed.clean?.address) !== upper(lane.covenantAddress)
      || parsed.clean?.script !== script || Buffer.byteLength(script) <= 8192) {
    throw new Error(`${name} explicit-witness script parse, address or wallet-limit precondition differs`);
  }
  await must(`cointrack enable:true coinid:${genesis.controlCoinId}`); await must(`cointrack enable:true coinid:${genesis.reserveCoinId}`);
  const control = await coin(genesis.controlCoinId); const reserve = await coin(genesis.reserveCoinId);
  requireCurrentCoin(control, lane.controlTokenId, '1', 40, `${name} genesis control`);
  requireCurrentCoin(reserve, lane.bridgeTokenId, lane.fixedSupply, 0, `${name} genesis reserve`);
  branch.prepared = true; branch.walletScriptRegistryUsed = false; branch.explicitScriptWitnessRequired = true;
  branch.current = { controlCoinId: genesis.controlCoinId, reserveCoinId: genesis.reserveCoinId,
    state: coinState(control), createdBlock: String(control.created) }; branch.actions ||= {};
  state.status = `${name.toLowerCase()}-p8-live-branches-prepared`; saveState(state);
  console.log(JSON.stringify({ prepared: true, name, current: branch.current }, null, 2));
}

async function build() {
  refuseUnguardedWrite();
  const { state, lane, signers, name, branch, type } = selected(true);
  if (!branch.prepared || !branch.current) throw new Error(`${name} live branch is not prepared`);
  if (expectedNext(branch) !== type) throw new Error(`expected next action ${expectedNext(branch)}, not ${type}`);
  branch.actions[type] ||= {}; const record = branch.actions[type];
  if (record.transactionId || record.postTxPoW || record.minedTxPoW) throw new Error(`${name} ${type} is already recorded`);
  const control = await coin(branch.current.controlCoinId); const reserve = await coin(branch.current.reserveCoinId);
  requireCurrentCoin(control, lane.controlTokenId, '1', branch.current.state['90'] ? 41 : 40, `${name} current control`);
  requireCurrentCoin(reserve, lane.bridgeTokenId, decimal(branch.current.state['6'], lane.decimals), 0, `${name} current reserve`);
  let returned = null;
  if (type === 'RETURN') {
    returned = await coin(branch.payoutCoinId);
    requireCurrentCoin(returned, lane.bridgeTokenId, decimal(branch.actions.RELEASE.amountAtoms, lane.decimals), 0, `${name} returned payout`);
    if (upper(returned.address) !== upper(lane.returnOwner.address)) throw new Error('RETURN payout owner differs');
  }
  const status = await must('status'); const acceptedBlock = BigInt(status.chain?.block || 0);
  if (acceptedBlock <= 0n || Number(status.network?.connected || 0) < 1) throw new Error('signer node is not synchronized');
  const authority = lane.cancellationAuthorityPublicKey;
  const script = readFileSync(resolve(ROOT, lane.scriptFile), 'utf8').trim();
  const transition = makeTransition(lane, type, branch.current.state, acceptedBlock, returned?.coinid, authority, lane.returnOwner);
  const id = `bridge-p8-${laneKey}-${actionKey}`;
  if ((await rpc(`txnlist id:${id}`))?.status) throw new Error(`custom transaction ${id} already exists`);
  const signingKeys = type === 'RETURN' ? [lane.returnOwner.publicKey]
    : [...signers.publicKeys.slice(0, 5), ...(type === 'CANCEL' ? [authority] : [])];
  const usesBefore = await keyUses(signingKeys); let signingStarted = false;
  await must(`txncreate id:${id}`);
  try {
    await must(`txninput id:${id} coinid:${branch.current.controlCoinId}`);
    await must(`txninput id:${id} coinid:${branch.current.reserveCoinId}`);
    if (type === 'RETURN') await must(`txninput id:${id} coinid:${branch.payoutCoinId}`);
    await must(`txnoutput id:${id} amount:1 address:${lane.covenantAddress} tokenid:${lane.controlTokenId} storestate:true`);
    await must(`txnoutput id:${id} amount:${decimal(transition.successor['6'], lane.decimals)} address:${lane.covenantAddress} tokenid:${lane.bridgeTokenId} storestate:false`);
    if (type === 'RELEASE') await must(`txnoutput id:${id} amount:${decimal(transition.amountAtoms, lane.decimals)} address:${transition.payoutAddress} tokenid:${lane.bridgeTokenId} storestate:false`);
    for (const [port, value] of Object.entries(transition.successor)) await must(`txnstate id:${id} port:${port} value:${value}`);
    let listed = await must(`txnlist id:${id}`); let transaction = listed?.transaction || listed?.txn || listed;
    checkStructure(transaction, lane, branch, type, transition);
    signingStarted = true; for (const publicKey of signingKeys) await must(`txnsign id:${id} publickey:${publicKey}`);
    await must(`txnmmr id:${id}`);
    const explicitScripts = { [script]: '' };
    if (type === 'RETURN') explicitScripts[lane.returnOwner.script] = '';
    await must(`txnscript id:${id} scripts:${JSON.stringify(explicitScripts)}`);
    const checked = await must(`txncheck id:${id}`); checkTxn(checked, type);
    listed = await must(`txnlist id:${id}`); transaction = listed?.transaction || listed?.txn || listed;
    checkStructure(transaction, lane, branch, type, transition);
    const usesAfter = await keyUses(signingKeys);
    if (!usesAfter.every((value, index) => value === usesBefore[index] + 1)) throw new Error('signing key uses did not increment exactly once');
    Object.assign(record, { customTransactionId: id, transactionId: transaction.transactionid,
      controlCoinId: transaction.outputs[0].coinid, reserveCoinId: transaction.outputs[1].coinid,
      payoutCoinId: type === 'RELEASE' ? transaction.outputs[2].coinid : null, record: transition.record,
      recordHex: transition.recordHex, recordDigest: transition.recordDigest, successorState: transition.successor,
      amountAtoms: transition.amountAtoms, acceptedBlock: String(acceptedBlock), keyUsesBefore: usesBefore, keyUsesAfter: usesAfter,
      witnessConstruction: 'txnsign-then-txnmmr-then-explicit-txnscript', walletScriptRegistryUsed: false,
      signingKeys, txncheck: { validtransaction: true, validamounts: true, allsignaturesvalid: true,
        basic: true, mmrproofs: true, scripts: true, signatures: signingKeys.length, burn: '0' } });
    state.status = `${name.toLowerCase()}-${actionKey}-built-prechecked-awaiting-post`; saveState(state);
    console.log(JSON.stringify({ built: true, name, type, id, transactionId: record.transactionId,
      outputs: { control: record.controlCoinId, reserve: record.reserveCoinId, payout: record.payoutCoinId },
      recordDigest: record.recordDigest, keyUsesBefore: usesBefore, keyUsesAfter: usesAfter, txncheck: record.txncheck }, null, 2));
  } catch (error) {
    if (!signingStarted) await rpc(`txndelete id:${id}`);
    else { record.failedSignedIntent = { id, error: error.message, signingKeys, keyUsesBefore: usesBefore,
      keyUsesObservedAfterFailure: await keyUses(signingKeys) }; state.status = `${name.toLowerCase()}-${actionKey}-signed-build-failed-preserved`; saveState(state); }
    throw error;
  }
}

async function post() {
  refuseUnguardedWrite();
  const { state, name, branch, type } = selected(true); const record = branch.actions?.[type];
  if (!record?.transactionId || !record.customTransactionId) throw new Error(`${name} ${type} is not built`);
  if (record.postTxPoW || record.minedTxPoW) throw new Error(`${name} ${type} was already posted`);
  const checked = await must(`txncheck id:${record.customTransactionId}`); checkTxn(checked, type);
  const reply = await must(`txnpost id:${record.customTransactionId} auto:false mine:true txndelete:false`);
  if (Number(reply.size || 0) <= 0 || Number(reply.size) >= 65536 || !/^0x[0-9a-f]{64}$/i.test(reply.txpowid || '')) throw new Error('posted branch size or TxPoW ID differs');
  record.postTxPoW = reply.txpowid; record.serializedTxPoWBytes = Number(reply.size);
  state.status = `${name.toLowerCase()}-${actionKey}-posted-awaiting-mining`; saveState(state);
  console.log(JSON.stringify({ posted: true, name, type, transactionId: record.transactionId,
    preMiningTxPoW: record.postTxPoW, serializedTxPoWBytes: record.serializedTxPoWBytes }, null, 2));
}

async function confirm() {
  const { state, lane, name, branch, type } = selected(true); const record = branch.actions?.[type];
  if (!record?.postTxPoW || !record.controlCoinId || !record.reserveCoinId) throw new Error(`${name} ${type} is not posted`);
  if (record.minedTxPoW) throw new Error(`${name} ${type} is already confirmed`);
  const control = await coin(record.controlCoinId); const reserve = await coin(record.reserveCoinId);
  const payout = record.payoutCoinId ? await coin(record.payoutCoinId) : null;
  if (!control || !reserve || Number(control.created || 0) <= 0 || control.created !== reserve.created
      || (record.payoutCoinId && (!payout || payout.created !== control.created))) {
    console.log(JSON.stringify({ confirmed: false, name, type, transactionId: record.transactionId }, null, 2)); return;
  }
  requireCurrentCoin(control, lane.controlTokenId, '1', 41, `${name} ${type} control`, 0);
  requireCurrentCoin(reserve, lane.bridgeTokenId, decimal(record.successorState['6'], lane.decimals), 0, `${name} ${type} reserve`, 0);
  const actual = coinState(control); const expected = record.successorState;
  if (Object.keys(actual).length !== 41 || Object.keys(expected).some((port) => upper(actual[port]) !== upper(expected[port]))) throw new Error('mined successor state differs');
  if (upper(control.address) !== upper(lane.covenantAddress) || upper(reserve.address) !== upper(lane.covenantAddress)) throw new Error('mined covenant output address differs');
  if (payout && (upper(payout.address) !== upper(lane.returnOwner.address)
      || !sameAmount(payout.tokenamount || payout.amount, decimal(record.amountAtoms, lane.decimals)))) throw new Error('mined payout differs');
  const txpows = rows(await must(`txpow address:${lane.covenantAddress} max:50`));
  const mined = txpows.find((entry) => upper(entry?.body?.txn?.transactionid) === upper(record.transactionId));
  if (!mined?.txpowid || Number(mined?.header?.block || 0) <= 0) throw new Error(`${name} mined ${type} TxPoW not found`);
  record.minedTxPoW = mined.txpowid; record.createdBlock = String(control.created); record.minedStateExact = true;
  branch.current = { controlCoinId: record.controlCoinId, reserveCoinId: record.reserveCoinId,
    state: record.successorState, createdBlock: String(control.created) };
  if (type === 'RELEASE') branch.payoutCoinId = record.payoutCoinId;
  if (type === 'RETURN') branch.payoutConsumedByReturn = true;
  await rpc(`txndelete id:${record.customTransactionId}`);
  const next = expectedNext(branch); state.status = next ? `${name.toLowerCase()}-${type.toLowerCase()}-confirmed-awaiting-${next.toLowerCase()}`
    : `${name.toLowerCase()}-all-p8-branches-confirmed`;
  saveState(state);
  console.log(JSON.stringify({ confirmed: true, name, type, transactionId: record.transactionId,
    minedTxPoW: record.minedTxPoW, createdBlock: record.createdBlock, current: branch.current, next }, null, 2));
}

if (command === 'status') console.log(JSON.stringify(loadState().branches || {}, null, 2));
else if (command === 'prepare') await prepare();
else if (command === 'build') await build();
else if (command === 'post') await post();
else if (command === 'confirm') await confirm();
else throw new Error('commands: status, prepare <usdtm|ethm>, build|post|confirm <usdtm|ethm> <client|release|cancel|return|payout>');
