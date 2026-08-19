// Purpose-created valueless USDTm and ETHm mainnet ceremony.
// No chain write occurs unless a mint step is invoked with --post.
// The issuer seed and database password are never read or printed by this tool.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-ceremony-state.json');
const RPC = process.env.USDTM_ISSUER_RPC || 'http://127.0.0.1:9605';
const step = process.argv[2] || 'status';
const POST = process.argv.includes('--post');
const EXPECTED_VERSION = '1.1.2.6';
const ZERO = '0X00';

const definitions = {
  USDTm: {
    decimals: 6,
    fixedSupply: '1000001',
    fixedSupplyAtoms: 1000001000000n,
    capAtoms: 999999999999n,
    uselimits: true,
    name: {
      name: 'USDTm',
      ticker: 'USDTm',
      description: 'Valueless Minima mainnet bridge test token. Not issued by Tether, not USDT or USDT0, and not redeemable. No monetary value.',
    },
  },
  ETHm: {
    decimals: 18,
    fixedSupply: '11',
    fixedSupplyAtoms: 11000000000000000000n,
    capAtoms: 10000000000000000000n,
    uselimits: false,
    name: {
      name: 'ETHm',
      ticker: 'ETHm',
      description: 'Valueless Minima mainnet bridge test token. Not ETH, not issued by Ethereum, and not redeemable. No monetary value.',
    },
  },
  USDTmControl: {
    decimals: 0,
    fixedSupply: '1',
    fixedSupplyAtoms: 1n,
    capAtoms: 0n,
    uselimits: true,
    name: {
      name: 'USDTm Lane Control V1',
      ticker: 'USDTmCTRL',
      description: 'Valueless one-unit lineage marker for the USDTm bridge mainnet test lane. Not transferable value and not redeemable.',
    },
  },
  ETHmControl: {
    decimals: 0,
    fixedSupply: '1',
    fixedSupplyAtoms: 1n,
    capAtoms: 0n,
    uselimits: true,
    name: {
      name: 'ETHm Lane Control V1',
      ticker: 'ETHmCTRL',
      description: 'Valueless one-unit lineage marker for the ETHm bridge mainnet test lane. Not transferable value and not redeemable.',
    },
  },
};

function loadState() { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
function saveState(state) { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n'); }
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.response) ? value.response : (value?.coins || value?.response?.coins || []));
const upper = (value) => String(value || '').toUpperCase();
const sameAmount = (left, right) => String(left).replace(/\.0+$/, '') === String(right).replace(/\.0+$/, '');

async function rpc(command) {
  const response = await fetch(RPC + '/' + encodeURIComponent(command));
  const body = await response.json();
  return Array.isArray(body) ? body[0] : body;
}

async function must(command) {
  const result = await rpc(command);
  if (!result?.status) throw new Error(`${command.split(' ')[0]} failed: ${result?.error || result?.message || 'unknown error'}`);
  return result.response;
}

function mintCommand(name) {
  const token = definitions[name];
  return `tokencreate name:${JSON.stringify(token.name)} amount:${token.fixedSupply} decimals:${token.decimals}` +
    (token.uselimits ? '' : ' uselimits:false');
}

async function nodeSnapshot() {
  const status = await must('status');
  const balance = rows(await must('balance'));
  const minima = balance.find((entry) => upper(entry.tokenid) === ZERO) || {};
  return {
    version: status.version,
    block: String(status.chain?.block || '0'),
    connected: Number(status.network?.connected || 0),
    mempool: Number(status.txpow?.mempool || 0),
    minima: {
      confirmed: String(minima.confirmed || '0'),
      sendable: String(minima.sendable || '0'),
      unconfirmed: String(minima.unconfirmed || '0'),
    },
  };
}

async function status() {
  const state = loadState();
  const snapshot = await nodeSnapshot();
  console.log(JSON.stringify({ ceremony: state.status, node: snapshot, issuerAddress: state.node.issuerAddress,
    fundingReturnAddress: state.node.fundingReturnAddress, tokens: state.tokens }, null, 2));
}

async function dryMint() {
  const before = await nodeSnapshot();
  if (Number(before.minima.sendable) > 0) throw new Error('issuer is funded; refusing a tokencreate dry run');
  const tokenCountBefore = rows(await must('tokens')).length;
  const result = {};
  for (const name of Object.keys(definitions)) {
    const reply = await rpc(mintCommand(name));
    if (reply.status || !String(reply.error || reply.message).includes('No Minima Coins available')) {
      throw new Error(`${name} dry run did not stop at the expected no-funds gate: ${reply.error || reply.message || 'unexpected success'}`);
    }
    result[name] = reply.error || reply.message;
  }
  const after = await nodeSnapshot();
  const tokenCountAfter = rows(await must('tokens')).length;
  if (after.mempool !== before.mempool || tokenCountAfter !== tokenCountBefore) throw new Error('dry run changed node state');
  console.log(JSON.stringify({ before, after, tokenCountBefore, tokenCountAfter, result }, null, 2));
}

async function recordReturnAddress() {
  const address = process.argv[3];
  if (!/^0x[0-9a-f]{64}$/i.test(address || '')) throw new Error('usage: record-return 0x<32-byte Minima address>');
  const state = loadState();
  if (state.node.fundingReturnAddress && upper(state.node.fundingReturnAddress) !== upper(address)) {
    throw new Error('a different funding return address is already pinned');
  }
  state.node.fundingReturnAddress = address;
  saveState(state);
  console.log(`Pinned funding return address ${address}`);
}

async function mint(name) {
  const state = loadState();
  const tokenState = state.tokens[name];
  if (!tokenState) throw new Error(`unknown token ${name}`);
  if (tokenState.mintTxPoW || tokenState.tokenId) throw new Error(`${name} mint is already recorded`);
  if (!state.node.fundingReturnAddress) throw new Error('funding return address is not pinned');
  const snapshot = await nodeSnapshot();
  if (snapshot.version !== EXPECTED_VERSION || BigInt(snapshot.block) <= 0n || snapshot.connected < 1) throw new Error('issuer is not a synced 1.1.2.6 mainnet node');
  if (!(Number(snapshot.minima.sendable) > 0)) throw new Error('issuer has no sendable Minima');
  const otherPending = Object.entries(state.tokens).find(([other, value]) => other !== name && value.mintTxPoW && !value.tokenId);
  if (otherPending) throw new Error(`${otherPending[0]} mint is not confirmed yet`);
  const command = mintCommand(name);
  console.log(command);
  if (!POST) { console.log('No post. Re-run this exact step with --post after reviewing the command.'); return; }
  const reply = await must(command);
  const outputs = reply?.body?.txn?.outputs || [];
  const tokenOutput = outputs.find((output) => output?.token?.tokenid);
  const provisional = reply?.tokenid || tokenOutput?.token?.tokenid || null;
  if (!reply?.txpowid || !tokenOutput?.coinid) throw new Error('mint reply lacks the expected TxPoW or token coin ID');
  tokenState.mintTxPoW = reply.txpowid;
  tokenState.mintTokenCoin = tokenOutput.coinid;
  tokenState.provisionalTokenId = provisional;
  state.status = `minted-${name.toLowerCase()}-awaiting-confirmation`;
  saveState(state);
  console.log(JSON.stringify({ posted: true, name, txpowid: reply.txpowid, tokenCoin: tokenOutput.coinid,
    provisionalTokenId: provisional }, null, 2));
}

async function confirm() {
  const state = loadState();
  const coins = rows(await must('coins relevant:true'));
  const knownTokens = rows(await must('tokens'));
  for (const [name, tokenState] of Object.entries(state.tokens)) {
    if (!tokenState.mintTokenCoin || tokenState.tokenId) continue;
    const coin = coins.find((entry) => upper(entry.coinid) === upper(tokenState.mintTokenCoin));
    if (!coin || Number(coin.created || 0) <= 0) continue;
    const tokenId = coin?.token?.tokenid;
    if (!/^0x[0-9a-f]{64}$/i.test(tokenId || '')) throw new Error(`${name} mined coin lacks a real token ID`);
    const displayedSupply = coin.tokenamount || coin?.token?.total;
    if (!sameAmount(displayedSupply, definitions[name].fixedSupply)) throw new Error(`${name} mined supply differs: ${displayedSupply}`);
    const metadata = knownTokens.find((entry) => upper(entry.tokenid) === upper(tokenId));
    if (!metadata || Number(metadata.decimals) !== definitions[name].decimals
        || !sameAmount(metadata.total, definitions[name].fixedSupply)
        || metadata.script !== 'RETURN TRUE'
        || metadata?.name?.name !== definitions[name].name.name
        || metadata?.name?.description !== definitions[name].name.description) {
      throw new Error(`${name} token metadata, supply, script or decimals do not match`);
    }
    const addressTxPoWs = rows(await must(`txpow address:${coin.address} max:20`));
    const mined = addressTxPoWs.find((entry) => entry?.body?.txn?.outputs?.some((output) => upper(output.coinid) === upper(coin.coinid)));
    if (!mined?.txpowid || Number(mined?.header?.block || 0) <= 0) throw new Error(`${name} mined transaction was not found`);
    tokenState.tokenId = tokenId;
    tokenState.createdBlock = String(coin.created);
    tokenState.minedTxPoW = mined.txpowid;
  }
  const confirmed = Object.values(state.tokens).filter((entry) => entry.tokenId).length;
  state.status = confirmed === Object.keys(definitions).length ? 'all-tokens-confirmed-awaiting-genesis'
    : (confirmed >= 2 ? 'bridge-tokens-confirmed-control-ceremony-active' : (confirmed ? 'one-token-confirmed' : state.status));
  saveState(state);
  console.log(JSON.stringify({ status: state.status, tokens: state.tokens }, null, 2));
}

async function integrity() {
  const stateBytes = readFileSync(STATE_PATH);
  const toolBytes = readFileSync(fileURLToPath(import.meta.url));
  console.log(JSON.stringify({ stateSha256: createHash('sha256').update(stateBytes).digest('hex'),
    toolSha256: createHash('sha256').update(toolBytes).digest('hex'), commands: Object.fromEntries(Object.keys(definitions).map((name) => [name, mintCommand(name)])) }, null, 2));
}

if (step === 'status') await status();
else if (step === 'dry-mint') await dryMint();
else if (step === 'record-return') await recordReturnAddress();
else if (step === 'mint-usdtm') await mint('USDTm');
else if (step === 'mint-ethm') await mint('ETHm');
else if (step === 'mint-usdtm-control') await mint('USDTmControl');
else if (step === 'mint-ethm-control') await mint('ETHmControl');
else if (step === 'confirm') await confirm();
else if (step === 'integrity') await integrity();
else throw new Error('steps: status, dry-mint, record-return, mint-usdtm, mint-ethm, mint-usdtm-control, mint-ethm-control, confirm, integrity');
