// Verify the completed valueless P8 mainnet ceremony, retire the issuer and emit evidence.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(ROOT, 'mainnet-p8-ceremony-state.json');
const LANES_PATH = resolve(ROOT, 'mainnet-lanes-p8.json');
const SIGNERS_PATH = resolve(ROOT, 'mainnet-test-signers.json');
const EVIDENCE_DIR = resolve(ROOT, 'evidence');
const ISSUER_RPC = 'http://127.0.0.1:9905';
const SIGNER_RPC = 'http://127.0.0.1:9705';
const ORDER = ['CLIENT_UPDATE', 'RELEASE', 'CANCEL', 'RETURN', 'PAYOUT_ACK'];
const RETURN = Object.freeze({
  fundingTxPoW: '0x000051135C2D5E8BF4C88084D8DEEFB5828EBFBB31C3DD23015D0867B74B5F10',
  fundingBlock: '2269761',
  address: '0x58438FD5C83E22A8D3A1C9B72198EB1415977D8347EB983FA4F8E38D6CFA814E',
  inputCoinId: '0xAAF7D580AF83681C13E5FAFE542011911026261EDA2DE8A13153C4AB68567586',
  transactionId: '0x4331E544CCFCC33CE275D006F63E0337BD4CB81E6EDAF4BB71CB8AA96D53B4ED',
  minedTxPoW: '0x000018706ADEE4855A57B84D06D6C3456515F4706238A953380A15C0830829B8',
  outputCoinId: '0x538A40C3BA6274BEFB93481B2E65411B0B1A12717D7E6BEB11023BF56566100F',
  amount: '0.09999999999999999999999988999998999998999998',
  createdBlock: '2269833',
  burn: '0',
});
const RECOVERY = Object.freeze({
  node: 'BridgeTestSigners',
  backupPath: 'C:\\Users\\Charles\\Documents\\Crypto\\Minima\\Nodes\\BridgeTestSigners-backups\\BridgeTestSigners-pre-p8-resync-20260819T190001Z',
  verifiedFiles: 23,
  verifiedBytes: 630768194,
  manifestSha256: '9f12e10cecaf8902c9c2e89c9a06c2e89c6ab4e5d7e4bb2d62ea045d7e290d34',
  walletKeyCount: 74,
  activeUsesBeforeCeremony: [4, 4, 4, 4, 4],
  strategy: 'A normal restart converged to the issuer canonical tip, so the authorized destructive archive resync was not executed.',
});
const upper = (value) => String(value || '').toUpperCase();
const same = (left, right) => upper(left) === upper(right);
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.response) ? value.response : []);
const sameAmount = (left, right) => String(left).replace(/\.0+$/, '') === String(right).replace(/\.0+$/, '');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
let assertionCount = 0;

function assert(condition, message) {
  assertionCount += 1;
  if (!condition) throw new Error(message);
}
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

const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
const lanes = JSON.parse(readFileSync(LANES_PATH, 'utf8'));
const signers = JSON.parse(readFileSync(SIGNERS_PATH, 'utf8'));
assert(state.authorizedBy === 'D-USDTM-023', 'ceremony authorization differs');
assert(same(state.node.fundingReturnAddress, RETURN.address), 'pinned funding return address differs');
assert(state.node.retired === false && state.node.retirementMarker === null, 'issuer was already marked retired');

const issuerStatus = await must(ISSUER_RPC, 'status');
const issuerBalances = rows(await must(ISSUER_RPC, 'balance'));
const issuerMinima = issuerBalances.find((entry) => same(entry.tokenid, '0x00'));
assert(issuerStatus.version === '1.1.2.6' && Number(issuerStatus.network?.connected || 0) > 0, 'issuer is not connected stock Core');
assert(issuerMinima && String(issuerMinima.confirmed) === '0' && String(issuerMinima.unconfirmed) === '0'
  && String(issuerMinima.sendable) === '0' && Number(issuerMinima.coins) === 0, 'issuer is not empty');

const returned = await must(ISSUER_RPC, `txpow txpowid:${RETURN.minedTxPoW}`);
const returnTransaction = returned?.body?.txn;
assert(returned && String(returned.header?.block) === RETURN.createdBlock, 'funding return block differs');
assert(returnTransaction && same(returnTransaction.transactionid, RETURN.transactionId), 'funding return transaction ID differs');
assert(returnTransaction.inputs?.length === 1 && returnTransaction.outputs?.length === 1, 'funding return shape differs');
assert(same(returnTransaction.inputs[0].coinid, RETURN.inputCoinId), 'funding return input differs');
assert(same(returnTransaction.outputs[0].coinid, RETURN.outputCoinId)
  && same(returnTransaction.outputs[0].address, RETURN.address)
  && same(returnTransaction.outputs[0].tokenid, '0x00')
  && sameAmount(returnTransaction.outputs[0].amount, RETURN.amount)
  && returnTransaction.outputs[0].storestate === false, 'funding return output differs');
assert(Number(returned.burn || 0) === 0, 'funding return burn is nonzero');

const laneEvidence = [];
for (const name of ['USDTm', 'ETHm']) {
  const lane = lanes.lanes.find((entry) => entry.name === name);
  const branch = state.branches?.[name];
  assert(lane && branch?.prepared === true, `${name} lane is not prepared`);
  assert(branch.walletScriptRegistryUsed === false && branch.explicitScriptWitnessRequired === true,
    `${name} explicit witness mode differs`);
  const actions = [];
  let previousCreated = Number(state.genesis[name].createdBlock);
  for (const actionName of ORDER) {
    const action = branch.actions?.[actionName];
    assert(action?.minedTxPoW && action?.minedStateExact === true, `${name} ${actionName} is not mined and exact`);
    assert(action.walletScriptRegistryUsed === false
      && action.witnessConstruction === 'txnsign-then-txnmmr-then-explicit-txnscript', `${name} ${actionName} witness mode differs`);
    assert(action.txncheck?.validtransaction === true && action.txncheck?.validamounts === true
      && action.txncheck?.allsignaturesvalid === true && action.txncheck?.basic === true
      && action.txncheck?.mmrproofs === true && action.txncheck?.scripts === true
      && String(action.txncheck?.burn) === '0', `${name} ${actionName} txncheck differs`);
    assert(Number(action.serializedTxPoWBytes) > 0 && Number(action.serializedTxPoWBytes) < 65536,
      `${name} ${actionName} serialized size differs`);
    assert(Number(action.createdBlock) >= previousCreated + 3, `${name} ${actionName} coin-age gate differs`);
    previousCreated = Number(action.createdBlock);
    const mined = await must(SIGNER_RPC, `txpow txpowid:${action.minedTxPoW}`);
    assert(same(mined?.body?.txn?.transactionid, action.transactionId), `${name} ${actionName} mined transaction differs`);
    const inclusion = await must(SIGNER_RPC, `txpow onchain:${action.minedTxPoW}`);
    assert(inclusion?.found === true && String(inclusion.block) === String(action.createdBlock),
      `${name} ${actionName} canonical inclusion block differs`);
    assert(Number(mined?.burn || 0) === 0, `${name} ${actionName} burn is nonzero`);
    const expectedSignatures = actionName === 'RETURN' ? 1 : (actionName === 'CANCEL' ? 6 : 5);
    assert(action.signingKeys?.length === expectedSignatures && action.txncheck.signatures === expectedSignatures,
      `${name} ${actionName} signature count differs`);
    actions.push({
      action: actionName,
      transactionId: action.transactionId,
      minedTxPoW: action.minedTxPoW,
      createdBlock: action.createdBlock,
      serializedTxPoWBytes: action.serializedTxPoWBytes,
      recordDigest: action.recordDigest,
      controlCoinId: action.controlCoinId,
      reserveCoinId: action.reserveCoinId,
      payoutCoinId: action.payoutCoinId,
      keyUsesBefore: action.keyUsesBefore,
      keyUsesAfter: action.keyUsesAfter,
      signatures: expectedSignatures,
      burn: '0',
    });
  }
  const release = branch.actions.RELEASE;
  const minedReturn = await must(SIGNER_RPC, `txpow txpowid:${branch.actions.RETURN.minedTxPoW}`);
  assert(minedReturn?.body?.txn?.inputs?.length === 3
    && same(minedReturn.body.txn.inputs[2].coinid, release.payoutCoinId), `${name} release payout was not consumed by RETURN`);
  assert(branch.payoutConsumedByReturn === true && same(branch.payoutCoinId, release.payoutCoinId), `${name} return journal differs`);
  const finalControl = await coin(branch.current.controlCoinId);
  const finalReserve = await coin(branch.current.reserveCoinId);
  assert(finalControl && finalReserve && finalControl.spent === false && finalReserve.spent === false,
    `${name} final control or reserve is missing or spent`);
  assert(same(finalControl.address, lane.covenantAddress) && same(finalControl.tokenid, lane.controlTokenId)
    && sameAmount(finalControl.tokenamount, '1') && finalControl.storestate === true, `${name} final control shape differs`);
  assert(same(finalReserve.address, lane.covenantAddress) && same(finalReserve.tokenid, lane.bridgeTokenId)
    && sameAmount(finalReserve.tokenamount, lane.fixedSupply) && finalReserve.storestate === false
    && (finalReserve.state || []).length === 0, `${name} final reserve shape differs`);
  const finalState = stateMap(finalControl);
  const expectedState = branch.actions.PAYOUT_ACK.successorState;
  assert(Object.keys(finalState).length === 41 && Object.keys(expectedState).length === 41
    && Object.keys(expectedState).every((port) => same(finalState[port], expectedState[port])), `${name} final state differs`);
  assert(finalState['4'] === '0' && finalState['5'] === '0' && finalState['6'] === finalState['7'],
    `${name} final I, P, R or F accounting differs`);
  assert(finalState['15'] === '1' && finalState['16'] === branch.actions.RETURN.amountAtoms,
    `${name} final payout cursor or cumulative paid differs`);
  assert(sha256(readFileSync(resolve(ROOT, lane.scriptFile))) === lane.cleanScriptSha256, `${name} script hash differs`);
  laneEvidence.push({
    name,
    laneId: lane.laneId,
    bridgeTokenId: lane.bridgeTokenId,
    controlTokenId: lane.controlTokenId,
    covenantAddress: lane.covenantAddress,
    scriptSha256: lane.cleanScriptSha256,
    actions,
    finalControlCoinId: finalControl.coinid,
    finalReserveCoinId: finalReserve.coinid,
    finalIssuedAtoms: finalState['4'],
    finalPendingAtoms: finalState['5'],
    finalReserveAtoms: finalState['6'],
    fixedSupplyAtoms: finalState['7'],
    finalPayoutCursor: finalState['15'],
    finalCumulativePaidAtoms: finalState['16'],
    releasePayoutConsumed: true,
  });
}

const keys = (await must(SIGNER_RPC, 'keys')).keys || [];
const keyUse = (publicKey) => {
  const found = keys.find((entry) => same(entry.publickey, publicKey));
  assert(found, `signing key missing: ${publicKey}`);
  return Number(found.uses);
};
const committeeUses = signers.publicKeys.map(keyUse);
const cancellationUses = {
  USDTm: keyUse(signers.p8CancellationAuthorities.USDTm.publicKey),
  ETHm: keyUse(signers.p8CancellationAuthorities.ETHm.publicKey),
};
const returnOwnerUses = keyUse(signers.p8ReturnOwner.publicKey);
assert(committeeUses.slice(0, 5).every((value) => value === 12)
  && committeeUses.slice(5).every((value) => value === 0), 'final committee TreeKey uses differ');
assert(cancellationUses.USDTm === 1 && cancellationUses.ETHm === 1, 'final cancellation key uses differ');
assert(returnOwnerUses === 2, 'final return-owner key uses differ');

state.residualReturn = RETURN;
state.issuerRetirement = { retired: true, marker: 'NEVER-REUSE', emptyBeforeShutdown: true };
state.node.retired = true;
state.node.retirementMarker = 'NEVER-REUSE';
state.status = 'p8-mainnet-all-branches-confirmed-issuer-retired-never-reuse';

try { await rpc(ISSUER_RPC, 'quit'); } catch {}
let issuerStopped = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  try {
    await fetch(`${ISSUER_RPC}/${encodeURIComponent('status')}`, { signal: AbortSignal.timeout(500) });
  } catch {
    issuerStopped = true;
    break;
  }
}
assert(issuerStopped, 'issuer RPC still responds after quit');
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');

const capturedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const evidence = {
  schema: 'generic-bridge-mainnet-p8-live-evidence/v1',
  capturedAt,
  authorizedBy: ['D-USDTM-023', 'O-USDTM-016'],
  minima: {
    network: 'mainnet',
    coreVersion: state.node.version,
    coreJarSha256: state.node.jarSha256,
    domain: lanes.minimaNetwork,
  },
  recovery: {
    ...RECOVERY,
    canonicalTipValidatedAgainstIssuer: true,
    archiveResyncExecuted: false,
    genesisProofsImportedAndTracked: Object.values(state.genesis).flatMap((entry) => [entry.controlCoinId, entry.reserveCoinId]),
  },
  committee: {
    threshold: signers.threshold,
    members: signers.publicKeys.length,
    root: lanes.committeeRoot,
    publicKeys: signers.publicKeys,
    finalTreeKeyUses: committeeUses,
    cancellationAuthorityUses: cancellationUses,
    returnOwnerUses,
    singleControllerFixture: true,
    decentralizationEvidence: false,
  },
  tokens: Object.fromEntries(Object.entries(state.tokens).map(([name, token]) => [name, {
    tokenId: token.tokenId,
    fixedSupply: token.fixedSupply,
    decimals: token.decimals,
    minedTxPoW: token.minedTxPoW,
    createdBlock: token.createdBlock,
  }])),
  genesis: state.genesis,
  lanes: laneEvidence,
  fundingReturn: RETURN,
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
    allTenAuthorizedBranchTransactionsMined: true,
    allTransactionsPassedStockNodeTxncheck: true,
    allTransactionsBelow65536Bytes: laneEvidence.every((lane) => lane.actions.every((action) => action.serializedTxPoWBytes < 65536)),
    allTransactionsBurnZero: true,
    exactExplicitScriptWitnessesUsed: true,
    clientUpdateReleaseCancelReturnAndPayoutAckMinedOnBothLanes: true,
    crossLaneTokenAndCovenantBindingExact: true,
    releasePayoutsConsumedByExactReturnBranches: true,
    bothFinalIssuedAndPendingLiabilitiesZero: true,
    bothFinalReservesEqualFixedSupply: true,
    payoutCursorAndCumulativeTotalsAdvancedExactly: true,
    wotsUsesAdvancedExactlyOncePerSignedIntent: true,
    allResidualMinimaReturnedToPinnedFundingInputAddress: true,
    issuerEmptyStoppedAndRetired: true,
  },
  assertionCount,
  phaseGate: 'P8',
  phaseGatePassed: true,
  limitations: [
    'The seven committee keys remain controlled by one fixture node and do not prove decentralized operation.',
    'The Ethereum facts are synthetic and do not prove source-chain authenticity or finality.',
    'The backup was byte-verified, but no restored-wallet rollback simulation has yet proved WOTS non-reuse across recovery.',
    'No real USDT, ETH or other collateral was accepted or represented.',
  ],
  nextGate: 'P9 and P12 must prove restore-safe WOTS durability, reconstruction and operating controls. P6 still owns independent threshold operators.',
};
const filename = `generic-mainnet-p8-live-${capturedAt.replace(/[-:]/g, '')}.json`;
const serialized = JSON.stringify(evidence, null, 2) + '\n';
const digest = sha256(serialized);
writeFileSync(resolve(EVIDENCE_DIR, filename), serialized);
writeFileSync(resolve(EVIDENCE_DIR, `${filename}.sha256`), `${digest}  ${filename}\n`);
console.log(JSON.stringify({
  finalized: true,
  evidence: `evidence/${filename}`,
  sha256: digest,
  assertionCount,
  lanes: laneEvidence.map((lane) => ({ name: lane.name, actions: lane.actions.length,
    finalIssuedAtoms: lane.finalIssuedAtoms, finalPendingAtoms: lane.finalPendingAtoms,
    finalReserveAtoms: lane.finalReserveAtoms, fixedSupplyAtoms: lane.fixedSupplyAtoms })),
  fundingReturn: RETURN,
  issuerStopped,
  issuerRetired: true,
  phaseGatePassed: true,
}, null, 2));
