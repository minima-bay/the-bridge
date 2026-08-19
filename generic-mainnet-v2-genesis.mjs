// Guarded exact genesis for the authorized valueless v2 bridge lanes.
// Build, post and confirmation are separate one-shot steps.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-v2-ceremony-state.json');
const LANES_PATH = resolve(ROOT, 'mainnet-lanes-v2.json');
const RPC = process.env.USDTM_V2_ISSUER_RPC || 'http://127.0.0.1:9805';
const action = process.argv[2] || 'status';
const key = process.argv[3];
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.response) ? value.response : []);
const upper = (value) => String(value || '').toUpperCase();
const sameAmount = (left, right) => String(left).replace(/\.0+$/, '') === String(right).replace(/\.0+$/, '');

function loadState() { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
function saveState(state) { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n'); }
function loadLanes() { return JSON.parse(readFileSync(LANES_PATH, 'utf8')); }

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

function selected() {
  const state = loadState();
  const lanes = loadLanes();
  const name = key === 'usdtm' ? 'USDTm' : (key === 'ethm' ? 'ETHm' : null);
  if (!name) throw new Error('lane must be usdtm or ethm');
  const lane = lanes.lanes.find((entry) => entry.name === name);
  if (!lane) throw new Error(`missing final ${name} lane`);
  const bridge = state.tokens[name];
  const control = state.tokens[`${name}Control`];
  if (!bridge?.tokenId || !control?.tokenId) throw new Error(`${name} tokens are not confirmed`);
  if (upper(bridge.tokenId) !== upper(lane.bridgeTokenId) || upper(control.tokenId) !== upper(lane.controlTokenId)) {
    throw new Error(`${name} final lane is not bound to the mined token IDs`);
  }
  state.genesis ||= {};
  state.genesis[name] ||= {};
  return { state, lane, bridge, control, name, record: state.genesis[name] };
}

async function coin(coinid) {
  // Exact covenant outputs leave the issuer wallet's "relevant" set after mining. A direct coin-ID
  // lookup is the authoritative read for both still-unspent inputs and newly created outputs.
  const response = await must(`coins coinid:${coinid}`);
  return rows(response).find((entry) => upper(entry.coinid) === upper(coinid));
}

function requireInput(found, token, amount, label) {
  if (!found || found.spent === true) throw new Error(`${label} input is missing or spent`);
  if (upper(found.tokenid) !== upper(token) || !sameAmount(found.tokenamount || found.amount, amount)) {
    throw new Error(`${label} input token or amount differs`);
  }
  if (Number(found.age || 0) < 3) throw new Error(`${label} input is not three blocks old`);
}

function checkTxn(response, lane) {
  if (response.inputs !== 2 || response.outputs !== 2 || response.mmrproofs !== 2 || response.scripts !== 2) {
    throw new Error('genesis witness or input/output cardinality differs');
  }
  if (response.validamounts !== true || response.allsignaturesvalid !== true || response.validtransaction !== true
      || response.valid?.basic !== true || response.valid?.mmrproofs !== true || response.valid?.scripts !== true) {
    throw new Error(`genesis txncheck failed: ${JSON.stringify(response)}`);
  }
  if (!response.coins?.every((entry) => String(entry.difference) === '0')) throw new Error('genesis has token burn or surplus');
  const [controlOut, reserveOut] = response.alloutputs || [];
  if (!controlOut || !reserveOut
      || upper(controlOut.address) !== upper(lane.covenantAddress)
      || upper(controlOut.tokenid) !== upper(lane.controlTokenId)
      || !sameAmount(controlOut.tokenamount || controlOut.amount, '1')
      || controlOut.storestate !== true
      || upper(reserveOut.address) !== upper(lane.covenantAddress)
      || upper(reserveOut.tokenid) !== upper(lane.bridgeTokenId)
      || !sameAmount(reserveOut.tokenamount || reserveOut.amount, lane.name === 'USDTm' ? '1000001' : '11')
      || reserveOut.storestate !== false) {
    throw new Error('genesis exact output shape differs');
  }
  return { controlOut, reserveOut };
}

async function build() {
  const { state, lane, bridge, control, name, record } = selected();
  if (record.transactionId || record.postTxPoW || record.minedTxPoW) throw new Error(`${name} genesis is already recorded`);
  const bridgeCoin = await coin(bridge.mintTokenCoin);
  const controlCoin = await coin(control.mintTokenCoin);
  requireInput(bridgeCoin, lane.bridgeTokenId, bridge.fixedSupply, `${name} bridge`);
  requireInput(controlCoin, lane.controlTokenId, '1', `${name} control`);
  const id = `bridge-v2-${key}-genesis`;
  const existing = await rpc(`txnlist id:${id}`);
  if (existing?.status) throw new Error(`custom transaction ${id} already exists; inspect it instead of rebuilding`);

  await must(`txncreate id:${id}`);
  try {
    await must(`txninput id:${id} coinid:${control.mintTokenCoin}`);
    await must(`txninput id:${id} coinid:${bridge.mintTokenCoin}`);
    await must(`txnoutput id:${id} amount:1 address:${lane.covenantAddress} tokenid:${lane.controlTokenId} storestate:true`);
    await must(`txnoutput id:${id} amount:${bridge.fixedSupply} address:${lane.covenantAddress} tokenid:${lane.bridgeTokenId} storestate:false`);
    for (const [port, value] of Object.entries(lane.genesisState)) await must(`txnstate id:${id} port:${port} value:${value}`);
    await must(`txnsign id:${id} publickey:auto`);
    await must(`txnbasics id:${id}`);
    const checked = await must(`txncheck id:${id}`);
    const { controlOut, reserveOut } = checkTxn(checked, lane);
    const listed = await must(`txnlist id:${id}`);
    const transaction = listed?.transaction || listed?.txn || listed;
    const transactionId = transaction?.transactionid;
    if (!/^0x[0-9a-f]{64}$/i.test(transactionId || '')) throw new Error('built genesis lacks transaction ID');
    record.customTransactionId = id;
    record.transactionId = transactionId;
    record.controlCoinId = controlOut.coinid;
    record.reserveCoinId = reserveOut.coinid;
    record.txncheck = { validtransaction: true, validamounts: true, allsignaturesvalid: true,
      basic: true, mmrproofs: true, scripts: true, burn: '0' };
    state.status = `${name.toLowerCase()}-genesis-built-prechecked-awaiting-post`;
    saveState(state);
    console.log(JSON.stringify({ built: true, name, id, transactionId,
      controlCoinId: controlOut.coinid, reserveCoinId: reserveOut.coinid, txncheck: record.txncheck }, null, 2));
  } catch (error) {
    await rpc(`txndelete id:${id}`);
    throw error;
  }
}

async function post() {
  const { state, name, record } = selected();
  if (!record.transactionId || !record.customTransactionId) throw new Error(`${name} genesis is not built`);
  if (record.postTxPoW || record.minedTxPoW) throw new Error(`${name} genesis was already posted`);
  const checked = await must(`txncheck id:${record.customTransactionId}`);
  checkTxn(checked, selected().lane);
  const reply = await must(`txnpost id:${record.customTransactionId} auto:false mine:false txndelete:false`);
  const txpowid = reply?.txpowid || reply?.response?.txpowid;
  if (!/^0x[0-9a-f]{64}$/i.test(txpowid || '')) throw new Error('txnpost reply lacks TxPoW ID');
  record.postTxPoW = txpowid;
  state.status = `${name.toLowerCase()}-genesis-posted-awaiting-mining`;
  saveState(state);
  console.log(JSON.stringify({ posted: true, name, transactionId: record.transactionId, txpowid }, null, 2));
}

async function confirm() {
  const { state, lane, name, record } = selected();
  if (!record.postTxPoW || !record.controlCoinId || !record.reserveCoinId) throw new Error(`${name} genesis is not posted`);
  if (record.minedTxPoW) throw new Error(`${name} genesis is already confirmed`);
  const controlCoin = await coin(record.controlCoinId);
  const reserveCoin = await coin(record.reserveCoinId);
  if (!controlCoin || !reserveCoin || Number(controlCoin.created || 0) <= 0 || controlCoin.created !== reserveCoin.created) {
    console.log(JSON.stringify({ confirmed: false, name, transactionId: record.transactionId }, null, 2));
    return;
  }
  if (upper(controlCoin.address) !== upper(lane.covenantAddress) || upper(reserveCoin.address) !== upper(lane.covenantAddress)
      || upper(controlCoin.tokenid) !== upper(lane.controlTokenId) || upper(reserveCoin.tokenid) !== upper(lane.bridgeTokenId)
      || !sameAmount(controlCoin.tokenamount || controlCoin.amount, '1')
      || !sameAmount(reserveCoin.tokenamount || reserveCoin.amount, lane.name === 'USDTm' ? '1000001' : '11')) {
    throw new Error(`${name} mined genesis output shape differs`);
  }
  const stateEntries = Array.isArray(controlCoin.state) ? controlCoin.state : Object.entries(controlCoin.state || {}).map(([port, value]) => ({ port, data: value }));
  if (stateEntries.length !== 40) throw new Error(`${name} control coin does not carry exactly 40 state ports`);
  const stateMap = Object.fromEntries(stateEntries.map((entry) => [String(entry.port), String(entry.data ?? entry.value)]));
  for (const [port, value] of Object.entries(lane.genesisState)) {
    if (upper(stateMap[port]) !== upper(value)) throw new Error(`${name} mined state port ${port} differs`);
  }
  if ((Array.isArray(reserveCoin.state) ? reserveCoin.state.length : Object.keys(reserveCoin.state || {}).length) !== 0) {
    throw new Error(`${name} reserve coin unexpectedly stores state`);
  }
  const txpows = rows(await must(`txpow address:${lane.covenantAddress} max:20`));
  const mined = txpows.find((entry) => upper(entry?.body?.txn?.transactionid) === upper(record.transactionId));
  if (!mined?.txpowid || Number(mined?.header?.block || 0) <= 0) throw new Error(`${name} mined TxPoW not found`);
  record.minedTxPoW = mined.txpowid;
  record.createdBlock = String(controlCoin.created);
  record.genesisStateExact = true;
  await rpc(`txndelete id:${record.customTransactionId}`);
  const both = ['USDTm', 'ETHm'].every((laneName) => state.genesis?.[laneName]?.minedTxPoW);
  state.status = both ? 'both-v2-genesis-confirmed-awaiting-live-releases' : `${name.toLowerCase()}-genesis-confirmed`;
  saveState(state);
  console.log(JSON.stringify({ confirmed: true, name, transactionId: record.transactionId,
    minedTxPoW: record.minedTxPoW, createdBlock: record.createdBlock,
    controlCoinId: record.controlCoinId, reserveCoinId: record.reserveCoinId, statePorts: 40 }, null, 2));
}

if (action === 'status') console.log(JSON.stringify(loadState().genesis || {}, null, 2));
else if (action === 'build') await build();
else if (action === 'post') await post();
else if (action === 'confirm') await confirm();
else throw new Error('actions: status, build <usdtm|ethm>, post <usdtm|ethm>, confirm <usdtm|ethm>');
