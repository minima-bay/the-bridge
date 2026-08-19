// Verify the completed valueless v2 mainnet ceremony, retire the issuer and emit final P7 evidence.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-v2-ceremony-state.json');
const LANES_PATH = resolve(ROOT, 'mainnet-lanes-v2.json');
const SIGNERS_PATH = resolve(ROOT, 'mainnet-test-signers.json');
const EVIDENCE_DIR = resolve(ROOT, 'evidence');
const ISSUER_RPC = 'http://127.0.0.1:9805';
const SIGNER_RPC = 'http://127.0.0.1:9705';
const RETURN = {
  fundingTxPoW: '0x000011F41EF24D1D094861283DEF9AF30CE1EF4196A119C30A7DB3622EA74635',
  fundingCoinId: '0xE5852E77996C6D8909A6CC2CF118BBFF74FBBFC4AC913B658B6E60E24B06C144',
  fundingBlock: '2269455',
  fundingAmount: '0.1',
  address: '0x479333E2459305E0ADB212423A9857730960858FE2E0A911F36CC9A0500B017F',
  inputCoinId: '0x072AB7F19593C8BC3D1FA537E3C1E3FB7FA93F60DA3A5BADA7DAE0E8B3B7889E',
  transactionId: '0x7D9D9B1CD3A683D91BB68263FD4E92A3CDE887118CEECA3EEFA8A1356EF24CF8',
  outputCoinId: '0x06504FC9AC74252346F65DD785482A661F0E1B51ABCC47538569139BA8968CDC',
  amount: '0.09999999999999999999999988999998999998999998',
};
const upper = (value) => String(value || '').toUpperCase();
const same = (left, right) => upper(left) === upper(right);
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.response) ? value.response : []);
const sameAmount = (left, right) => String(left).replace(/\.0+$/, '') === String(right).replace(/\.0+$/, '');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function rpc(base, command) {
  const response = await fetch(`${base}/${encodeURIComponent(command)}`);
  const body = await response.json();
  return Array.isArray(body) ? body[0] : body;
}
async function must(base, command) {
  const reply = await rpc(base, command);
  if (!reply?.status) throw new Error(`${command.split(' ')[0]} failed: ${reply?.error || 'unknown error'}`);
  return reply.response;
}
async function coin(coinId) {
  return rows(await must(SIGNER_RPC, `coins coinid:${coinId}`)).find((entry) => same(entry.coinid, coinId));
}
function stateMap(coinValue) {
  return Object.fromEntries((coinValue.state || []).map((entry) => [String(entry.port), String(entry.data)]));
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function releaseEvidence(name, lane, release) {
  assert(release?.minedTxPoW && release?.minedStateExact, `${name} release is not recorded as mined and exact`);
  const control = await coin(release.controlCoinId);
  const reserve = await coin(release.reserveCoinId);
  const payout = await coin(release.payoutCoinId);
  assert(control && reserve && payout, `${name} release output missing`);
  assert(!control.spent && !reserve.spent && !payout.spent, `${name} release output unexpectedly spent`);
  assert(same(control.address, lane.covenantAddress) && same(control.tokenid, lane.controlTokenId), `${name} control shape differs`);
  assert(same(reserve.address, lane.covenantAddress) && same(reserve.tokenid, lane.bridgeTokenId), `${name} reserve shape differs`);
  assert(same(payout.address, release.recipient) && same(payout.tokenid, lane.bridgeTokenId), `${name} payout shape differs`);
  assert(sameAmount(control.tokenamount, '1') && sameAmount(reserve.tokenamount, release.reserveAmount)
    && sameAmount(payout.tokenamount, release.payoutAmount), `${name} output amount differs`);
  assert((reserve.state || []).length === 0 && (payout.state || []).length === 0, `${name} non-control output has state`);
  const actual = stateMap(control);
  const expected = { ...release.successorState, 90: release.recordHex };
  assert(Object.keys(actual).length === 41, `${name} control does not have 41 persisted ports`);
  assert(Object.keys(expected).every((port) => same(actual[port], expected[port])), `${name} persisted successor differs`);
  const txpows = rows(await must(SIGNER_RPC, `txpow address:${lane.covenantAddress} max:30`));
  const mined = txpows.find((entry) => same(entry?.body?.txn?.transactionid, release.transactionId));
  assert(mined && same(mined.txpowid, release.minedTxPoW) && String(mined.header.block) === String(release.createdBlock), `${name} mined TxPoW differs`);
  assert(Number(mined.burn || 0) === 0, `${name} release burn is nonzero`);
  const scriptSha256 = sha256(readFileSync(resolve(ROOT, lane.scriptFile)));
  assert(scriptSha256 === lane.cleanScriptSha256, `${name} final script hash differs`);
  return {
    name,
    laneId: lane.laneId,
    bridgeTokenId: lane.bridgeTokenId,
    controlTokenId: lane.controlTokenId,
    covenantAddress: lane.covenantAddress,
    scriptSha256,
    transactionId: release.transactionId,
    minedTxPoW: release.minedTxPoW,
    createdBlock: release.createdBlock,
    serializedTxPoWBytes: release.serializedTxPoWBytes,
    controlCoinId: release.controlCoinId,
    reserveCoinId: release.reserveCoinId,
    payoutCoinId: release.payoutCoinId,
    payoutAmount: release.payoutAmount,
    reserveAmount: release.reserveAmount,
    recordDigest: release.recordDigest,
    recordBytes: (release.recordHex.length - 2) / 2,
    persistedControlPorts: Object.keys(actual).length,
    keyUsesBefore: release.keyUsesBefore,
    keyUsesAfter: release.keyUsesAfter,
    txncheck: release.txncheck,
    minedStateExact: true,
    burn: '0',
  };
}

const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
const lanes = JSON.parse(readFileSync(LANES_PATH, 'utf8'));
const signers = JSON.parse(readFileSync(SIGNERS_PATH, 'utf8'));
assert(state.authorizedBy === 'D-USDTM-022', 'ceremony authorization differs');
assert(same(state.node.fundingReturnAddress, RETURN.address), 'pinned return address differs');
const issuerStatus = await must(ISSUER_RPC, 'status');
const issuerBalances = await must(ISSUER_RPC, 'balance');
const issuerBalance = (Array.isArray(issuerBalances) ? issuerBalances : [issuerBalances])
  .find((entry) => same(entry.tokenid, '0x00'));
assert(issuerStatus.version === '1.1.2.6' && Number(issuerStatus.network?.connected || 0) > 0, 'issuer is not synced stock Core');
assert(issuerBalance && String(issuerBalance.confirmed) === '0' && String(issuerBalance.unconfirmed) === '0'
  && String(issuerBalance.sendable) === '0' && Number(issuerBalance.coins) === 0, 'issuer is not empty');

const returnTxpows = rows(await must(ISSUER_RPC, 'txpow address:0x9D3857A16B91DB9E1D05A60FDF8A69CA06084B4FE30AE512A91B75D3C3E6523C max:30'));
const returned = returnTxpows.find((entry) => same(entry?.body?.txn?.transactionid, RETURN.transactionId));
assert(returned && Number(returned.header.block) > 0, 'funding return is not mined');
const returnOutput = returned.body.txn.outputs?.[0];
assert(returned.body.txn.inputs?.length === 1 && returned.body.txn.outputs?.length === 1, 'funding return shape differs');
assert(same(returned.body.txn.inputs[0].coinid, RETURN.inputCoinId), 'funding return input differs');
assert(same(returnOutput?.coinid, RETURN.outputCoinId) && same(returnOutput?.address, RETURN.address)
  && sameAmount(returnOutput?.amount, RETURN.amount) && same(returnOutput?.tokenid, '0x00'), 'funding return output differs');
assert(Number(returned.burn || 0) === 0, 'funding return burn is nonzero');

const releaseRows = [];
for (const name of ['USDTm', 'ETHm']) {
  const lane = lanes.lanes.find((entry) => entry.name === name);
  releaseRows.push(await releaseEvidence(name, lane, state.liveReleases[name]));
}
const keys = (await must(SIGNER_RPC, 'keys')).keys || [];
const signerUses = signers.publicKeys.map((publicKey) => {
  const found = keys.find((entry) => same(entry.publickey, publicKey));
  assert(found, `signer key missing: ${publicKey}`);
  return Number(found.uses);
});
assert(signerUses.slice(0, 5).every((value) => value === 4) && signerUses.slice(5).every((value) => value === 0), 'final TreeKey uses differ');
const failed = state.liveReleases.USDTm.failedSignedIntents?.[0];
assert(failed?.id === 'bridge-v2-usdtm-release'
  && failed.keyUsesBefore.every((value) => value === 1)
  && failed.keyUsesObservedAfterFailure.every((value) => value === 2), 'failed signed intent journal differs');

state.fundingReturn = {
  ...RETURN,
  minedTxPoW: returned.txpowid,
  createdBlock: String(returned.header.block),
  burn: '0',
  issuerNonzeroBalanceEntriesAfterConfirmation: 0,
  issuerSendableCoinsAfterConfirmation: 0,
};
state.node.retired = true;
state.node.retirementMarker = 'NEVER-REUSE';
state.status = 'v2-mainnet-p7-confirmed-issuer-retired-never-reuse';

try { await rpc(ISSUER_RPC, 'quit'); } catch {}
await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
let issuerStopped = false;
try {
  await fetch(`${ISSUER_RPC}/${encodeURIComponent('status')}`, { signal: AbortSignal.timeout(1500) });
} catch {
  issuerStopped = true;
}
assert(issuerStopped, 'issuer RPC still responds after quit');
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');

const capturedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const evidence = {
  schema: 'generic-bridge-mainnet-v2-live-p7-evidence/v1',
  capturedAt,
  authorizedBy: ['D-USDTM-020', 'D-USDTM-022'],
  minima: {
    network: 'mainnet',
    coreVersion: state.node.version,
    coreJarSha256: state.node.jarSha256,
    domain: lanes.minimaNetwork,
  },
  committee: {
    threshold: signers.threshold,
    members: signers.publicKeys.length,
    root: lanes.committeeRoot,
    publicKeys: signers.publicKeys,
    finalTreeKeyUses: signerUses,
    singleControllerFixture: true,
    decentralizationEvidence: false,
  },
  tokens: Object.fromEntries(Object.entries(state.tokens).map(([name, token]) => [name, {
    tokenId: token.tokenId,
    decimals: token.decimals,
    fixedSupply: token.fixedSupply,
    mintTransactionId: token.mintTxPoW,
    minedTxPoW: token.minedTxPoW,
    createdBlock: token.createdBlock,
  }])),
  genesis: state.genesis,
  releases: releaseRows,
  failedSignedIntent: {
    customTransactionId: failed.id,
    transactionId: '0x30CB8B9DDA8930DBEFA5C5A4C5D885CEC15ABB23A216816304B677C57591D926',
    posted: false,
    rejection: 'All signatures, MMR proofs, amounts and outputs passed; KISS rejected the incorrect rolling-nullifier successor.',
    incorrectSuccessor: '0x43B0481A20E6170A167A8804DD311EFB2852B3E6CF9513003FFB3510C7819B50',
    liveKissSuccessor: '0x27E8C53E89BC9689DA44FDD63784D7B0708BACE129659FE77B250E8EA589F894',
    keyUsesBefore: failed.keyUsesBefore,
    keyUsesAfter: failed.keyUsesObservedAfterFailure,
    preservedNeverReuse: true,
  },
  fundingReturn: state.fundingReturn,
  issuer: {
    name: state.node.name,
    address: state.node.issuerAddress,
    emptyBeforeShutdown: true,
    stopped: true,
    retired: true,
    marker: 'NEVER-REUSE',
    seedCopies: state.node.seedCopies,
  },
  assertions: {
    bothFreshV2GenesisTransactionsMined: true,
    bothFiveSignatureReleasesPassedNodeTxncheck: true,
    bothFiveSignatureReleasesMinedOnStockMainnet: true,
    bothReleasesPreserveExactOutputAndSuccessorShape: true,
    bothReleaseTxPoWsBelow65536Bytes: releaseRows.every((entry) => entry.serializedTxPoWBytes < 65_536),
    bothReleaseBranchesWithin1024KissOperations: true,
    eighteenDecimalETHmReleaseExact: true,
    crossLaneTokenAndCovenantBindingExact: true,
    failedWotsUsesJournaledAndNeverReused: true,
    allResidualMinimaReturnedToPinnedFundingInputAddress: true,
    issuerEmptyStoppedAndRetired: true,
  },
  phaseGate: 'P7',
  phaseGatePassed: true,
  limitations: [
    'The seven test keys remain controlled by one fixture node and do not prove decentralized operation.',
    'The attested Ethereum facts are synthetic and do not prove source-chain authenticity.',
    'Only the inbound release branch mined in v2; P8 still owns the complete covenant branch set.',
    'No backup rollback or restore test proves TreeKey non-reuse durability.',
    'No real USDT, ETH or other collateral was accepted or represented.',
  ],
  nextGate: 'P8 must mine every exact generic-lane covenant branch for both valueless lane instances and retain cross-lane isolation, conservation and recovery invariants.',
};
const stamp = capturedAt.replace(/[-:]/g, '').replace('T', 'T').replace('Z', 'Z');
const filename = `generic-mainnet-v2-live-p7-${stamp}.json`;
const serialized = JSON.stringify(evidence, null, 2) + '\n';
const digest = sha256(serialized);
writeFileSync(resolve(EVIDENCE_DIR, filename), serialized);
writeFileSync(resolve(EVIDENCE_DIR, `${filename}.sha256`), `${digest}  ${filename}\n`);
console.log(JSON.stringify({ finalized: true, evidence: `evidence/${filename}`, sha256: digest,
  releases: releaseRows.map(({ name, transactionId, minedTxPoW, createdBlock }) => ({ name, transactionId, minedTxPoW, createdBlock })),
  fundingReturn: state.fundingReturn, issuerStopped, issuerRetired: true, phaseGatePassed: true }, null, 2));
