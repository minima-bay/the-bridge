// Guarded one-use P8 token ceremony for purpose-created valueless mainnet assets.
// No chain write occurs unless a mint step is invoked with --post.
// This tool never reads or prints the issuer seed or database password.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-p8-ceremony-state.json');
const EVIDENCE_DIR = resolve(ROOT, 'evidence');
const RPC = process.env.USDTM_P8_ISSUER_RPC || 'http://127.0.0.1:9905';
const step = process.argv[2] || 'status';
const POST = process.argv.includes('--post');
const EXPECTED_VERSION = '1.1.2.6';
const ZERO = '0X00';

const definitions = {
  USDTm: {
    decimals: 6, fixedSupply: '1000001', uselimits: true,
    name: {
      name: 'USDTm-P8', ticker: 'USDTm-P8',
      description: 'Valueless Minima mainnet P8 bridge test token. Not issued by Tether, not USDT or USDT0, not redeemable, and no monetary value.',
    },
  },
  ETHm: {
    decimals: 18, fixedSupply: '11', uselimits: false,
    name: {
      name: 'ETHm-P8', ticker: 'ETHm-P8',
      description: 'Valueless Minima mainnet P8 bridge test token. Not ETH, not issued by Ethereum, not redeemable, and no monetary value.',
    },
  },
  USDTmControl: {
    decimals: 0, fixedSupply: '1', uselimits: true,
    name: {
      name: 'USDTm P8 Lane Control', ticker: 'USDTmP8CTRL',
      description: 'Valueless one-unit lineage marker for the USDTm P8 bridge mainnet test lane. Not transferable value and not redeemable.',
    },
  },
  ETHmControl: {
    decimals: 0, fixedSupply: '1', uselimits: true,
    name: {
      name: 'ETHm P8 Lane Control', ticker: 'ETHmP8CTRL',
      description: 'Valueless one-unit lineage marker for the ETHm P8 bridge mainnet test lane. Not transferable value and not redeemable.',
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
    chainHash: status.chain?.hash || null,
    chainLength: Number(status.chain?.length || 0),
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
  console.log(JSON.stringify({ ceremony: state.status, node: await nodeSnapshot(),
    issuerAddress: state.node.issuerAddress, issuerMiniAddress: state.node.issuerMiniAddress,
    fundingReturnAddress: state.node.fundingReturnAddress, tokens: state.tokens }, null, 2));
}

async function dryMint() {
  const state = loadState();
  if (state.dryRun) throw new Error('P8 dry mint is already recorded');
  const before = await nodeSnapshot();
  if (before.version !== EXPECTED_VERSION || BigInt(before.block) <= 0n || before.connected < 1 || before.chainLength < 1000) {
    throw new Error('issuer is not a synchronized Core 1.1.2.6 mainnet node');
  }
  if (Number(before.minima.sendable) > 0 || Number(before.minima.unconfirmed) > 0) {
    throw new Error('issuer is funded; refusing a tokencreate dry run');
  }
  const tokenCountBefore = rows(await must('tokens')).length;
  const result = {};
  for (const name of Object.keys(definitions)) {
    const reply = await rpc(mintCommand(name));
    const message = String(reply.error || reply.message || '');
    if (reply.status || !message.includes('No Minima Coins available')) {
      throw new Error(`${name} dry run did not stop at the expected no-funds gate: ${message || 'unexpected success'}`);
    }
    result[name] = message;
  }
  const after = await nodeSnapshot();
  const tokenCountAfter = rows(await must('tokens')).length;
  if (after.mempool !== before.mempool || tokenCountAfter !== tokenCountBefore) throw new Error('dry run changed node state');
  const preparedAt = new Date().toISOString();
  state.preparedAt = preparedAt;
  state.dryRun = { block: before.block, chainHash: before.chainHash, connected: before.connected,
    mempoolBefore: before.mempool, mempoolAfter: after.mempool, tokenCountBefore, tokenCountAfter, ...result };
  state.status = 'p8-preflight-passed-awaiting-funding';
  saveState(state);
  const evidence = {
    schema: 'generic-bridge-mainnet-p8-ceremony-preflight/v1', status: 'pass', phaseGatePassed: false,
    authorizedBy: state.authorizedBy, preparedAt, node: state.node, before, after,
    tokenCountBefore, tokenCountAfter, dryMintErrors: result,
    commands: Object.fromEntries(Object.keys(definitions).map((name) => [name, mintCommand(name)])),
    noNodeWalletTokenSignatureOrTransactionCommandSucceeded: true,
    nextGate: 'fund the exact issuer address with a small valueless Minima amount and pin the funding input address',
  };
  const stamp = preparedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const filename = `generic-mainnet-p8-ceremony-preflight-${stamp}.json`;
  const evidencePath = resolve(EVIDENCE_DIR, filename);
  const bytes = Buffer.from(JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync(evidencePath, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(`${evidencePath}.sha256`, `${digest}  ${filename}\n`);
  console.log(JSON.stringify({ ...evidence, evidencePath, evidenceSha256: digest }, null, 2));
}

async function detectFunding() {
  const state = loadState();
  if (!state.dryRun) throw new Error('dry mint must pass before funding detection');
  if (state.node.fundingReturnAddress) throw new Error('funding return address is already pinned');
  const txpows = rows(await must(`txpow address:${state.node.issuerAddress} max:50`));
  const candidates = [];
  for (const txpow of txpows) {
    const transaction = txpow?.body?.txn;
    const paysIssuer = transaction?.outputs?.some((output) => upper(output.address) === upper(state.node.issuerAddress)
      && upper(output.tokenid) === ZERO && Number(output.amount) > 0);
    if (!paysIssuer || Number(txpow?.header?.block || 0) <= 0) continue;
    const fundingInputs = (transaction.inputs || []).filter((input) => upper(input.tokenid) === ZERO && input.address);
    const addresses = [...new Set(fundingInputs.map((input) => input.address))];
    if (addresses.length === 1) candidates.push({ txpowid: txpow.txpowid, block: String(txpow.header.block), address: addresses[0] });
  }
  if (candidates.length !== 1) throw new Error(`expected one unambiguous mined funding transaction, found ${candidates.length}`);
  state.node.fundingReturnAddress = candidates[0].address;
  state.funding = candidates[0];
  state.status = 'p8-funded-return-address-pinned';
  saveState(state);
  console.log(JSON.stringify({ pinned: true, funding: candidates[0] }, null, 2));
}

async function mint(name) {
  const state = loadState();
  const tokenState = state.tokens[name];
  if (!tokenState || tokenState.mintTxPoW || tokenState.tokenId) throw new Error(`${name} mint is absent or already recorded`);
  if (!state.node.fundingReturnAddress) throw new Error('funding return address is not pinned');
  const snapshot = await nodeSnapshot();
  if (snapshot.version !== EXPECTED_VERSION || snapshot.connected < 1 || snapshot.chainLength < 1000) throw new Error('issuer is not synchronized');
  if (!(Number(snapshot.minima.sendable) > 0)) throw new Error('issuer has no sendable Minima');
  const pending = Object.entries(state.tokens).find(([other, value]) => other !== name && value.mintTxPoW && !value.tokenId);
  if (pending) throw new Error(`${pending[0]} mint is not confirmed yet`);
  const command = mintCommand(name);
  if (!POST) { console.log(JSON.stringify({ post: false, name, command }, null, 2)); return; }
  const reply = await must(command);
  const outputs = reply?.body?.txn?.outputs || [];
  const tokenOutput = outputs.find((output) => output?.token?.tokenid);
  if (!reply?.txpowid || !tokenOutput?.coinid) throw new Error('mint reply lacks expected TxPoW or token coin ID');
  tokenState.mintTxPoW = reply.txpowid;
  tokenState.mintTokenCoin = tokenOutput.coinid;
  tokenState.provisionalTokenId = reply.tokenid || tokenOutput.token.tokenid || null;
  state.status = `minted-${name.toLowerCase()}-awaiting-confirmation`;
  saveState(state);
  console.log(JSON.stringify({ posted: true, name, txpowid: reply.txpowid,
    tokenCoin: tokenOutput.coinid, provisionalTokenId: tokenState.provisionalTokenId }, null, 2));
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
    const definition = definitions[name];
    const metadata = knownTokens.find((entry) => upper(entry.tokenid) === upper(tokenId));
    if (!/^0x[0-9a-f]{64}$/i.test(tokenId || '') || !sameAmount(coin.tokenamount || coin?.token?.total, definition.fixedSupply)
        || !metadata || Number(metadata.decimals) !== definition.decimals || !sameAmount(metadata.total, definition.fixedSupply)
        || metadata.script !== 'RETURN TRUE' || metadata?.name?.name !== definition.name.name
        || metadata?.name?.description !== definition.name.description) throw new Error(`${name} mined token differs from the frozen definition`);
    const addressTxPoWs = rows(await must(`txpow address:${coin.address} max:20`));
    const mined = addressTxPoWs.find((entry) => entry?.body?.txn?.outputs?.some((output) => upper(output.coinid) === upper(coin.coinid)));
    if (!mined?.txpowid || Number(mined?.header?.block || 0) <= 0) throw new Error(`${name} mined transaction was not found`);
    tokenState.tokenId = tokenId;
    tokenState.createdBlock = String(coin.created);
    tokenState.minedTxPoW = mined.txpowid;
  }
  const confirmed = Object.values(state.tokens).filter((entry) => entry.tokenId).length;
  state.status = confirmed === 4 ? 'all-p8-tokens-confirmed-awaiting-lane-render' : (confirmed ? `${confirmed}-p8-tokens-confirmed` : state.status);
  saveState(state);
  console.log(JSON.stringify({ status: state.status, tokens: state.tokens }, null, 2));
}

async function integrity() {
  console.log(JSON.stringify({
    stateSha256: createHash('sha256').update(readFileSync(STATE_PATH)).digest('hex'),
    toolSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    commands: Object.fromEntries(Object.keys(definitions).map((name) => [name, mintCommand(name)])),
  }, null, 2));
}

if (step === 'status') await status();
else if (step === 'dry-mint') await dryMint();
else if (step === 'detect-funding') await detectFunding();
else if (step === 'mint-usdtm') await mint('USDTm');
else if (step === 'mint-ethm') await mint('ETHm');
else if (step === 'mint-usdtm-control') await mint('USDTmControl');
else if (step === 'mint-ethm-control') await mint('ETHmControl');
else if (step === 'confirm') await confirm();
else if (step === 'integrity') await integrity();
else throw new Error('steps: status, dry-mint, detect-funding, mint-usdtm, mint-ethm, mint-usdtm-control, mint-ethm-control, confirm, integrity');
