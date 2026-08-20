// Guarded one-shot live release for the two authorized valueless v2 lanes.
// Preparation, signing/build, post and mined-output confirmation are separate steps.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRecord, recordDigest } from './generic-attestation-primary.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-v2-ceremony-state.json');
const LANES_PATH = resolve(ROOT, 'mainnet-lanes-v2.json');
const SIGNERS_PATH = resolve(ROOT, 'mainnet-test-signers.json');
const RPC = process.env.BRIDGE_TEST_SIGNERS_RPC || 'http://127.0.0.1:9705';
const RECIPIENT = '0x49D2FB10995C4CCE7112FC4EBAB19A6F1540C083BFEBFF432675F6425E2F2B69';
const action = process.argv[2] || 'status';
const key = process.argv[3];
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.response) ? value.response : []);
const upper = (value) => String(value || '').toUpperCase();
const lower = (value) => String(value).toLowerCase();
const sameAmount = (left, right) => String(left).replace(/\.0+$/, '') === String(right).replace(/\.0+$/, '');

function loadState() { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
function saveState(state) { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n'); }
function loadLanes() { return JSON.parse(readFileSync(LANES_PATH, 'utf8')); }
function loadSigners() { return JSON.parse(readFileSync(SIGNERS_PATH, 'utf8')); }
function sha3Text(value) { return `0x${createHash('sha3-256').update(value, 'utf8').digest('hex')}`; }
function sha3Hex(...values) {
  return `0x${createHash('sha3-256').update(Buffer.concat(values.map((value) => Buffer.from(value.slice(2), 'hex')))).digest('hex')}`;
}
function nullifierSuccessor(previousRoot, laneId, depositId) {
  const digest = sha3Hex(lower(previousRoot), lower(laneId), lower(depositId));
  return `0x${digest.slice(2).toUpperCase()}`;
}
const LIVE_NULLIFIER_VECTOR = {
  previousRoot: '0xB45D4F46C225F843061D48DD8D76AD0D0F80CB9774D53CF35C3A985BABF697BC',
  laneId: '0xCC6EBD579AD362AD222BD88C5E8529F4926DD4DD77E108A984696A5FF7C16B28',
  depositId: '0x7B2B3E4F7322A5134F25F61DEF70536BF1B0669D8B63D1289812710BD6012A96',
  successor: '0x27E8C53E89BC9689DA44FDD63784D7B0708BACE129659FE77B250E8EA589F894',
};
if (nullifierSuccessor(LIVE_NULLIFIER_VECTOR.previousRoot, LIVE_NULLIFIER_VECTOR.laneId,
    LIVE_NULLIFIER_VECTOR.depositId) !== LIVE_NULLIFIER_VECTOR.successor) {
  throw new Error('Minima KISS SHA3 nullifier live-vector regression failed');
}
function decimal(atoms, decimals) {
  const value = BigInt(atoms);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

async function rpc(command) {
  const response = await fetch(RPC + '/' + encodeURIComponent(command));
  const body = await response.json();
  return Array.isArray(body) ? body[0] : body;
}
async function must(command) {
  const reply = await rpc(command);
  if (!reply?.status) throw new Error(`${command.split(' ')[0]} failed: ${reply?.error || reply?.message || 'unknown error'}`);
  return reply.response;
}
async function coin(coinid) {
  const response = await must(`coins coinid:${coinid}`);
  return rows(response).find((entry) => upper(entry.coinid) === upper(coinid));
}
async function uses(publicKeys) {
  const response = await must('keys');
  const keys = response.keys || [];
  return publicKeys.map((publicKey) => {
    const found = keys.find((entry) => upper(entry.publickey) === upper(publicKey));
    if (!found) throw new Error(`configured signer key missing: ${publicKey}`);
    return Number(found.uses);
  });
}

function selected() {
  const state = loadState();
  const lanes = loadLanes();
  const signers = loadSigners();
  const name = key === 'usdtm' ? 'USDTm' : (key === 'ethm' ? 'ETHm' : null);
  if (!name) throw new Error('lane must be usdtm or ethm');
  const lane = lanes.lanes.find((entry) => entry.name === name);
  const genesis = state.genesis?.[name];
  if (!lane || !genesis?.minedTxPoW || !genesis?.genesisStateExact) throw new Error(`${name} exact genesis is not confirmed`);
  state.liveReleases ||= {};
  state.liveReleases[name] ||= {};
  return { state, lane, signers, genesis, name, release: state.liveReleases[name] };
}

function requireCoin(found, tokenId, amount, statePorts, label, minimumAge = 3) {
  if (!found || found.spent === true || Number(found.created || 0) <= 0) throw new Error(`${label} coin is missing or spent`);
  if (Number(found.age || 0) < minimumAge) throw new Error(`${label} coin is not ${minimumAge} blocks old`);
  if (upper(found.tokenid) !== upper(tokenId) || !sameAmount(found.tokenamount || found.amount, amount)) {
    throw new Error(`${label} token or amount differs`);
  }
  const ports = Array.isArray(found.state) ? found.state.length : Object.keys(found.state || {}).length;
  if (ports !== statePorts) throw new Error(`${label} state-port count differs`);
}

function makeFixture(lane, acceptedBlock) {
  const amount = lane.name === 'USDTm' ? 1_250_000n : 1_250_000_000_000_000_000n;
  const vault = lane.name === 'USDTm' ? 5_000_000n : 5_000_000_000_000_000_000n;
  const depositId = sha3Text(`GENERIC_BRIDGE_V2_LIVE_DEPOSIT\0${lane.laneId}\0${acceptedBlock}`);
  const finalizedBlockHash = sha3Text(['GENERIC_BRIDGE_V2_ETH_BLOCK', lane.laneId, '1'].join('\0'));
  const sourceRecordHash = sha3Text(`GENERIC_BRIDGE_V2_SOURCE_RECORD\0${lane.laneId}\0${depositId}`);
  const record = {
    schemaVersion: '1', direction: '1', laneVersion: '1', sourceAssetKind: String(lane.sourceKind),
    sourceDecimals: String(lane.decimals), destinationDecimals: String(lane.decimals),
    sourceQuantumAtoms: '1', destinationQuantumAtoms: '1',
    laneExposureCapDestinationAtoms: lane.capAtoms, ethereumChainId: '1',
    minimaNetwork: lower(lane.minimaNetwork || loadLanes().minimaNetwork), ethereumVault: lower(lane.ethereumVault),
    sourceAsset: lower(lane.sourceAsset), laneId: lower(lane.laneId), destinationTokenId: lower(lane.bridgeTokenId),
    reserveCovenant: lower(lane.covenantAddress), depositId, amountSourceAtoms: String(amount),
    amountDestinationAtoms: String(amount), minimaRecipient: lower(RECIPIENT), finalizedBlockNumber: '1',
    finalizedBlockHash, sourceRecordHash, vaultStateVersion: '1', vaultBalanceSourceAtoms: String(vault),
    vaultPayoutCursor: '0', vaultCumulativePaidSourceAtoms: '0', committeeEpoch: '1',
    committeeRoot: lower(loadLanes().committeeRoot), configurationEpoch: '1',
    sourceExecutionTimeMilliseconds: String(Date.now()),
  };
  const total = BigInt(lane.fixedSupplyAtoms);
  const reserve = total - amount;
  const successor = { ...lane.genesisState, 4: String(amount), 6: String(reserve), 8: String(vault),
    10: nullifierSuccessor(lane.genesisState[10], lane.laneId, depositId),
    17: String(acceptedBlock), 25: '1', 26: '1', 27: upper(finalizedBlockHash) };
  return { record, recordHex: `0x${encodeRecord(record).toString('hex')}`, recordDigest: recordDigest(record),
    successor, amountAtoms: String(amount), reserveAtoms: String(reserve),
    payoutAmount: decimal(amount, lane.decimals), reserveAmount: decimal(reserve, lane.decimals) };
}

function stateMap(transaction) {
  return Object.fromEntries((transaction.state || []).map((entry) => [String(entry.port), String(entry.data)]));
}

function checkStructure(transaction, lane, genesis, fixture) {
  if (transaction.inputs?.length !== 2 || transaction.outputs?.length !== 3) throw new Error('release cardinality differs');
  const [controlIn, reserveIn] = transaction.inputs;
  const [controlOut, reserveOut, payoutOut] = transaction.outputs;
  if (upper(controlIn.coinid) !== upper(genesis.controlCoinId) || upper(reserveIn.coinid) !== upper(genesis.reserveCoinId)) {
    throw new Error('release input ordering or IDs differ');
  }
  const exact = [
    [controlOut, lane.covenantAddress, lane.controlTokenId, '1', true],
    [reserveOut, lane.covenantAddress, lane.bridgeTokenId, fixture.reserveAmount, false],
    [payoutOut, RECIPIENT, lane.bridgeTokenId, fixture.payoutAmount, false],
  ];
  for (const [output, address, tokenId, amount, keep] of exact) {
    if (!output || upper(output.address) !== upper(address) || upper(output.tokenid) !== upper(tokenId)
        || !sameAmount(output.tokenamount || output.amount, amount) || output.storestate !== keep) {
      throw new Error('release exact output shape differs');
    }
  }
  const actual = stateMap(transaction);
  const expected = { ...fixture.successor, 90: fixture.recordHex };
  if (Object.keys(actual).length !== 41 || Object.keys(expected).some((port) => upper(actual[port]) !== upper(expected[port]))) {
    throw new Error('release transaction state differs');
  }
}

function checkTxn(response, lane, fixture) {
  if (response.inputs !== 2 || response.outputs !== 3 || response.signatures !== 5
      || response.validamounts !== true || response.allsignaturesvalid !== true || response.validtransaction !== true
      || response.valid?.basic !== true || response.valid?.mmrproofs !== true || response.valid?.scripts !== true) {
    throw new Error(`release txncheck failed: ${JSON.stringify(response)}`);
  }
  if (!response.coins?.every((entry) => String(entry.difference) === '0')) throw new Error('release has token burn or surplus');
  const [controlOut, reserveOut, payoutOut] = response.alloutputs || [];
  if (upper(controlOut?.address) !== upper(lane.covenantAddress) || upper(reserveOut?.address) !== upper(lane.covenantAddress)
      || upper(payoutOut?.address) !== upper(RECIPIENT) || !sameAmount(reserveOut?.tokenamount, fixture.reserveAmount)
      || !sameAmount(payoutOut?.tokenamount, fixture.payoutAmount)) throw new Error('txncheck output shape differs');
}

async function prepare() {
  const { state, lane, genesis, name, release } = selected();
  const script = readFileSync(resolve(ROOT, lane.scriptFile), 'utf8').trim();
  const added = await must(`newscript trackall:true clean:true script:"${script}"`);
  if (upper(added.address) !== upper(lane.covenantAddress)) throw new Error(`${name} registered script address differs`);
  await must(`cointrack enable:true coinid:${genesis.controlCoinId}`);
  await must(`cointrack enable:true coinid:${genesis.reserveCoinId}`);
  const control = await coin(genesis.controlCoinId);
  const reserve = await coin(genesis.reserveCoinId);
  requireCoin(control, lane.controlTokenId, '1', 40, `${name} control`);
  requireCoin(reserve, lane.bridgeTokenId, lane.name === 'USDTm' ? '1000001' : '11', 0, `${name} reserve`);
  release.prepared = true;
  release.recipient = RECIPIENT;
  release.scriptRegistered = true;
  release.inputsTracked = true;
  state.status = `${name.toLowerCase()}-v2-release-prepared`;
  saveState(state);
  console.log(JSON.stringify({ prepared: true, name, covenantAddress: lane.covenantAddress,
    controlCoinId: genesis.controlCoinId, reserveCoinId: genesis.reserveCoinId, recipient: RECIPIENT }, null, 2));
}

async function build() {
  throw new Error('legacy live signing is disabled after P8; a P9 fenced guard adapter is required');
  const { state, lane, signers, genesis, name, release } = selected();
  if (!release.prepared) throw new Error(`${name} release is not prepared`);
  if (release.transactionId || release.postTxPoW || release.minedTxPoW) throw new Error(`${name} release is already recorded`);
  const control = await coin(genesis.controlCoinId);
  const reserve = await coin(genesis.reserveCoinId);
  requireCoin(control, lane.controlTokenId, '1', 40, `${name} control`);
  requireCoin(reserve, lane.bridgeTokenId, lane.name === 'USDTm' ? '1000001' : '11', 0, `${name} reserve`);
  const status = await must('status');
  const acceptedBlock = BigInt(status.chain?.block || 0);
  if (acceptedBlock <= 0n || Number(status.network?.connected || 0) < 1) throw new Error('signer node is not synced');
  const fixture = makeFixture(lane, acceptedBlock);
  release.failedSignedIntents ||= [];
  if (release.failedSignedIntent) {
    release.failedSignedIntents.push(release.failedSignedIntent);
    delete release.failedSignedIntent;
    saveState(state);
  }
  const attempt = release.failedSignedIntents.length + 1;
  const id = attempt === 1 ? `bridge-v2-${key}-release` : `bridge-v2-${key}-release-retry-${attempt}`;
  if ((await rpc(`txnlist id:${id}`))?.status) throw new Error(`custom transaction ${id} already exists`);
  const signerKeys = signers.publicKeys.slice(0, 5);
  const usesBefore = await uses(signerKeys);
  let signingStarted = false;
  await must(`txncreate id:${id}`);
  try {
    await must(`txninput id:${id} coinid:${genesis.controlCoinId}`);
    await must(`txninput id:${id} coinid:${genesis.reserveCoinId}`);
    await must(`txnoutput id:${id} amount:1 address:${lane.covenantAddress} tokenid:${lane.controlTokenId} storestate:true`);
    await must(`txnoutput id:${id} amount:${fixture.reserveAmount} address:${lane.covenantAddress} tokenid:${lane.bridgeTokenId} storestate:false`);
    await must(`txnoutput id:${id} amount:${fixture.payoutAmount} address:${RECIPIENT} tokenid:${lane.bridgeTokenId} storestate:false`);
    for (const [port, value] of Object.entries(fixture.successor)) await must(`txnstate id:${id} port:${port} value:${value}`);
    await must(`txnstate id:${id} port:90 value:${fixture.recordHex}`);
    let listed = await must(`txnlist id:${id}`);
    let transaction = listed?.transaction || listed?.txn || listed;
    checkStructure(transaction, lane, genesis, fixture);
    signingStarted = true;
    for (const publicKey of signerKeys) await must(`txnsign id:${id} publickey:${publicKey}`);
    await must(`txnbasics id:${id}`);
    const checked = await must(`txncheck id:${id}`);
    checkTxn(checked, lane, fixture);
    listed = await must(`txnlist id:${id}`);
    transaction = listed?.transaction || listed?.txn || listed;
    checkStructure(transaction, lane, genesis, fixture);
    const transactionId = transaction.transactionid;
    const usesAfter = await uses(signerKeys);
    if (!usesAfter.every((value, index) => value === usesBefore[index] + 1)) throw new Error('TreeKey uses did not increment exactly once');
    release.customTransactionId = id;
    release.transactionId = transactionId;
    release.controlCoinId = transaction.outputs[0].coinid;
    release.reserveCoinId = transaction.outputs[1].coinid;
    release.payoutCoinId = transaction.outputs[2].coinid;
    release.depositId = fixture.record.depositId;
    release.record = fixture.record;
    release.recordHex = fixture.recordHex;
    release.recordDigest = fixture.recordDigest;
    release.successorState = fixture.successor;
    release.acceptedBlock = String(acceptedBlock);
    release.payoutAmount = fixture.payoutAmount;
    release.reserveAmount = fixture.reserveAmount;
    release.keyUsesBefore = usesBefore;
    release.keyUsesAfter = usesAfter;
    release.txncheck = { validtransaction: true, validamounts: true, allsignaturesvalid: true,
      basic: true, mmrproofs: true, scripts: true, signatures: 5, burn: '0' };
    state.status = `${name.toLowerCase()}-v2-release-built-prechecked-awaiting-post`;
    saveState(state);
    console.log(JSON.stringify({ built: true, name, id, transactionId,
      depositId: release.depositId, recordDigest: release.recordDigest, acceptedBlock: release.acceptedBlock,
      outputs: { control: release.controlCoinId, reserve: release.reserveCoinId, payout: release.payoutCoinId },
      keyUsesBefore: usesBefore, keyUsesAfter: usesAfter, txncheck: release.txncheck }, null, 2));
  } catch (error) {
    if (!signingStarted) await rpc(`txndelete id:${id}`);
    else {
      release.failedSignedIntents.push({ id, error: error.message, keyUsesBefore: usesBefore,
        keyUsesObservedAfterFailure: await uses(signerKeys) });
      state.status = `${name.toLowerCase()}-v2-release-signed-build-failed-preserved`;
      saveState(state);
    }
    throw error;
  }
}

async function post() {
  throw new Error('legacy live posting is disabled after P8; a P9 fenced guard adapter is required');
  const { state, lane, name, release } = selected();
  if (!release.transactionId || !release.customTransactionId) throw new Error(`${name} release is not built`);
  if (release.postTxPoW || release.minedTxPoW) throw new Error(`${name} release was already posted`);
  const checked = await must(`txncheck id:${release.customTransactionId}`);
  const fixture = { reserveAmount: release.reserveAmount, payoutAmount: release.payoutAmount };
  checkTxn(checked, lane, fixture);
  const reply = await must(`txnpost id:${release.customTransactionId} auto:false mine:false txndelete:false`);
  if (Number(reply.size || 0) <= 0 || Number(reply.size) >= 65_536) throw new Error('posted release size is absent or exceeds chain limit');
  release.postTxPoW = reply.txpowid;
  release.serializedTxPoWBytes = Number(reply.size);
  state.status = `${name.toLowerCase()}-v2-release-posted-awaiting-mining`;
  saveState(state);
  console.log(JSON.stringify({ posted: true, name, transactionId: release.transactionId,
    preMiningTxPoW: release.postTxPoW, serializedTxPoWBytes: release.serializedTxPoWBytes }, null, 2));
}

async function confirm() {
  const { state, lane, name, release } = selected();
  if (!release.postTxPoW || !release.controlCoinId) throw new Error(`${name} release is not posted`);
  if (release.minedTxPoW) throw new Error(`${name} release is already confirmed`);
  const control = await coin(release.controlCoinId);
  const reserve = await coin(release.reserveCoinId);
  const payout = await coin(release.payoutCoinId);
  if (!control || !reserve || !payout || Number(control.created || 0) <= 0
      || control.created !== reserve.created || control.created !== payout.created) {
    console.log(JSON.stringify({ confirmed: false, name, transactionId: release.transactionId }, null, 2));
    return;
  }
  requireCoin(control, lane.controlTokenId, '1', 41, `${name} successor control`, 0);
  requireCoin(reserve, lane.bridgeTokenId, release.reserveAmount, 0, `${name} successor reserve`, 0);
  requireCoin(payout, lane.bridgeTokenId, release.payoutAmount, 0, `${name} payout`, 0);
  if (upper(control.address) !== upper(lane.covenantAddress) || upper(reserve.address) !== upper(lane.covenantAddress)
      || upper(payout.address) !== upper(RECIPIENT)) throw new Error(`${name} mined output address differs`);
  const actual = Object.fromEntries(control.state.map((entry) => [String(entry.port), String(entry.data)]));
  const expected = { ...release.successorState, 90: release.recordHex };
  if (Object.keys(actual).length !== 41 || Object.keys(expected).some((port) => upper(actual[port]) !== upper(expected[port]))) {
    throw new Error(`${name} mined successor state differs`);
  }
  const txpows = rows(await must(`txpow address:${lane.covenantAddress} max:20`));
  const mined = txpows.find((entry) => upper(entry?.body?.txn?.transactionid) === upper(release.transactionId));
  if (!mined?.txpowid || Number(mined?.header?.block || 0) <= 0) throw new Error(`${name} mined release TxPoW not found`);
  release.minedTxPoW = mined.txpowid;
  release.createdBlock = String(control.created);
  release.minedStateExact = true;
  await rpc(`txndelete id:${release.customTransactionId}`);
  const both = ['USDTm', 'ETHm'].every((laneName) => state.liveReleases?.[laneName]?.minedTxPoW);
  state.status = both ? 'both-v2-live-releases-confirmed' : `${name.toLowerCase()}-v2-live-release-confirmed`;
  saveState(state);
  console.log(JSON.stringify({ confirmed: true, name, transactionId: release.transactionId,
    minedTxPoW: release.minedTxPoW, createdBlock: release.createdBlock,
    controlCoinId: release.controlCoinId, reserveCoinId: release.reserveCoinId,
    payoutCoinId: release.payoutCoinId, keyUsesAfter: release.keyUsesAfter }, null, 2));
}

if (action === 'status') console.log(JSON.stringify(loadState().liveReleases || {}, null, 2));
else if (action === 'prepare') await prepare();
else if (action === 'build') await build();
else if (action === 'post') await post();
else if (action === 'confirm') await confirm();
else throw new Error('actions: status, prepare <usdtm|ethm>, build <usdtm|ethm>, post <usdtm|ethm>, confirm <usdtm|ethm>');
