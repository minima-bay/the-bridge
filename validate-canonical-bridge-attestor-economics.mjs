import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanonicalBridgeAttestorEconomicsModel } from './canonical-bridge-attestor-economics-model.mjs';
import { sha256Hex } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const emitEvidence = process.argv.includes('--evidence');
const members = Array.from({ length: 7 }, (_, index) => `attestor-${index}`);
let assertions = 0;
let hostileCases = 0;
let propertySteps = 0;

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function baseModel(overrides = {}) {
  return new CanonicalBridgeAttestorEconomicsModel({
    memberIds: members,
    quorum: 5,
    equalBond: 125_000n,
    minimumEpochSecurityBudget: 100n,
    minimumSecurityRunwayEpochs: 3,
    ...overrides,
  });
}

function activate(model) {
  check(model.activate() === false, 'roster cannot activate before unanimous acceptance');
  check(model.acceptRoster(members[0], sha256Hex('foreign-roster')) === false,
    'foreign roster hash is rejected');
  for (const id of members) check(model.acceptRoster(id, model.rosterHash) === true, `${id} accepts exact full roster`);
  check(model.activate() === true, 'unanimously accepted equal-bond roster activates');
  check(model.activate() === false, 'active roster cannot activate twice');
}

const accounting = baseModel();
activate(accounting);
accounting.addBootstrapSecurityTreasury(1_000n);
check(accounting.maximumAggregateLiability() === 500_000n,
  '5 times 125000 bond times 80 percent safety factor caps aggregate liability at 500000');
check(accounting.acceptLiability({ laneId: 'lane-usdt', principal: 300_000n, fee: 1_000n }) === true,
  'first lane liability accepted');
check(accounting.acceptLiability({ laneId: 'lane-eth', principal: 200_000n, fee: 1_000n }) === true,
  'second lane uses the remaining aggregate committee capacity');
const beforeOverCap = accounting.snapshot();
check(accounting.acceptLiability({ laneId: 'lane-third', principal: 1n, fee: 10_000n }) === false,
  'third lane cannot double-count the same committee bond');
const afterOverCap = accounting.snapshot();
check(afterOverCap.principalCustody === beforeOverCap.principalCustody
  && afterOverCap.totalFeesCollected === beforeOverCap.totalFeesCollected
  && afterOverCap.aggregateLiability === beforeOverCap.aggregateLiability,
  'rejected over-cap transfer consumes neither principal nor fee');
hostileCases += 1;
check(afterOverCap.principalCustody === afterOverCap.aggregateLiability,
  'principal custody exactly equals issued aggregate liability');
check(BigInt(afterOverCap.totalFeesCollected) === 2_000n && BigInt(afterOverCap.principalCustody) === 500_000n,
  'fees remain separate from principal');
check(BigInt(afterOverCap.attestorRewardPool) === 1_000n
  && BigInt(afterOverCap.safetyReserve) === 400n
  && BigInt(afterOverCap.relayerBudget) === 200n
  && BigInt(afterOverCap.operationsBudget) === 400n,
  'illustrative protocol fee split conserves all fee atoms');

const availability = Object.fromEntries(members.map((id) => [id, 10_000n]));
const bondTime = Object.fromEntries(members.map((id) => [id, 1n]));
const decisions = Object.fromEntries(members.map((id, index) => [id, [{
  timely: true,
  valid: true,
  decision: index % 2 === 0 ? 'APPROVE' : 'REJECT',
}]]));
const rewards = accounting.closeRewardEpoch({ availabilityBpsById: availability,
  decisionsById: decisions, bondTimeById: bondTime });
check(rewards.participation['attestor-0'] === rewards.participation['attestor-1'],
  'a valid timely rejection receives the same participation weight as approval');
check(rewards.readiness['attestor-5'] === rewards.readiness['attestor-0'],
  'sixth and seventh members do not lose readiness pay because five signatures suffice');
check(rewards.bondRisk['attestor-6'] === rewards.bondRisk['attestor-0'],
  'equal bond-time receives equal risk remuneration');
const paidRewards = members.reduce((sum, id) => sum + BigInt(accounting.snapshot().members[id].accruedReward), 0n);
check(paidRewards + BigInt(accounting.snapshot().attestorRewardPool) === 1_000n,
  'attestor reward distribution conserves its isolated fee pool');

const biasedDecisions = baseModel();
activate(biasedDecisions);
biasedDecisions.addBootstrapSecurityTreasury(1_000n);
check(biasedDecisions.acceptLiability({ laneId: 'lane-usdt', principal: 1n, fee: 1_400n }),
  'biased-decision reward fixture accepts liability');
const responseSet = Object.fromEntries(members.map((id) => [id, []]));
responseSet['attestor-0'] = [{ timely: true, valid: true, decision: 'APPROVE' }];
responseSet['attestor-1'] = [{ timely: true, valid: true, decision: 'REJECT' }];
responseSet['attestor-2'] = [{ timely: true, valid: false, decision: 'APPROVE' }];
responseSet['attestor-3'] = [{ timely: false, valid: true, decision: 'APPROVE' }];
responseSet['attestor-4'] = [{ timely: true, valid: true, decision: 'UNKNOWN' }];
const responseRewards = biasedDecisions.closeRewardEpoch({ availabilityBpsById: availability,
  decisionsById: responseSet, bondTimeById: bondTime });
check(responseRewards.participation['attestor-0'] === responseRewards.participation['attestor-1']
  && BigInt(responseRewards.participation['attestor-0']) > 0n,
  'valid approve and reject decisions are rewarded equally');
check(responseRewards.participation['attestor-2'] === '0'
  && responseRewards.participation['attestor-3'] === '0'
  && responseRewards.participation['attestor-4'] === '0',
  'invalid, late and unknown decisions earn no participation reward');
hostileCases += 1;

const runway = baseModel();
activate(runway);
check(runway.acceptLiability({ laneId: 'lane-usdt', principal: 100n, fee: 600n }) === true,
  'entry fee creates exactly three epochs of initial security runway');
runway.closeRewardEpoch({ availabilityBpsById: availability, decisionsById: decisions, bondTimeById: bondTime });
runway.refreshRunwayPause();
check(runway.newLiabilityPaused === true, 'depleted reward runway pauses new liability');
const runwayBeforeRejected = runway.snapshot();
check(runway.acceptLiability({ laneId: 'lane-usdt', principal: 1n, fee: 0n }) === false,
  'new liability remains stopped without adequate future runway');
check(runway.redeem({ laneId: 'lane-usdt', principal: 100n }) === true,
  'redemption remains open while new liability is paused');
check(runway.snapshot().principalCustody === '0' && runway.snapshot().aggregateLiability === '0',
  'paused bridge redemption returns all principal and clears liability');
check(runwayBeforeRejected.totalFeesCollected === runway.snapshot().totalFeesCollected,
  'runway rejection charges no new fee');
hostileCases += 1;

const soloSlash = baseModel();
activate(soloSlash);
const soloBefore = soloSlash.snapshot();
const subjective = soloSlash.slash({ fault: 'TEMPORARY_DOWNTIME', culprits: ['attestor-0'], coveredLoss: 0n });
check(subjective.accepted === false && subjective.code === 'FAULT_NOT_OBJECTIVE',
  'subjective downtime cannot trigger catastrophic slashing');
check(JSON.stringify(soloSlash.snapshot().members) === JSON.stringify(soloBefore.members),
  'subjective slash attempt changes no bond');
hostileCases += 1;
const solo = soloSlash.slash({ fault: 'EQUIVOCATION', culprits: ['attestor-0'], coveredLoss: 0n });
check(solo.accepted === true && solo.individualSlashed['attestor-0'] === '100000',
  'objective solo equivocation slashes only the culprit individual tranche');
for (const id of members.slice(1)) {
  check(soloSlash.snapshot().members[id].individualBondRemaining === soloBefore.members[id].individualBondRemaining,
    `${id} individual tranche survives another member solo fault`);
  check(soloSlash.snapshot().members[id].mutualBondRemaining === soloBefore.members[id].mutualBondRemaining,
    `${id} mutual tranche survives a non-quorum solo fault`);
}

const quorumSlash = baseModel();
activate(quorumSlash);
quorumSlash.addBootstrapSecurityTreasury(1_000n);
check(quorumSlash.acceptLiability({ laneId: 'lane-usdt', principal: 1n, fee: 2_000n }),
  'quorum slash fixture funds safety reserve without touching principal');
const quorumBefore = quorumSlash.snapshot();
const culprits = members.slice(0, 5);
const quorumResult = quorumSlash.slash({ fault: 'NONEXISTENT_SOURCE_RECORD', culprits, coveredLoss: 600_000n });
check(quorumResult.accepted === true, 'objective five-member fraud is slashable');
for (const id of culprits) {
  check(quorumSlash.snapshot().members[id].individualBondRemaining === '0', `${id} loses its individual accountability tranche`);
}
for (const id of members.slice(5)) {
  check(quorumSlash.snapshot().members[id].individualBondRemaining === quorumBefore.members[id].individualBondRemaining,
    `${id} honest individual tranche is untouched by quorum fraud`);
  check(BigInt(quorumSlash.snapshot().members[id].mutualBondRemaining) > 0n,
    `${id} honest member loses no more than the limited mutual tranche`);
}
check(BigInt(quorumResult.mutualSlashed['attestor-5']) === BigInt(quorumResult.mutualSlashed['attestor-0']),
  'mutual guarantee is applied equally to honest and dishonest committee members');
check(BigInt(quorumSlash.snapshot().members['attestor-5'].individualBondRemaining)
  + BigInt(quorumSlash.snapshot().members['attestor-5'].mutualBondRemaining) > 0n,
  'honest attestor never loses 100 percent of stake under the modeled mutual guarantee');
check(quorumSlash.snapshot().principalCustody === '1',
  'slashing and compensation never spend the separate principal ledger');

let seed = 0x6d2b79f5;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
const property = baseModel();
activate(property);
property.addBootstrapSecurityTreasury(10_000n);
for (let index = 0; index < 100; index += 1) {
  const laneId = `lane-${random() % 3}`;
  const current = BigInt(property.snapshot().laneLiability[laneId] || '0');
  if ((random() & 1) === 0 || current === 0n) {
    const principal = BigInt((random() % 5_000) + 1);
    property.acceptLiability({ laneId, principal, fee: BigInt((random() % 200) + 1) });
  } else {
    const principal = BigInt((random() % Number(current)) + 1);
    property.redeem({ laneId, principal });
  }
  const state = property.snapshot();
  const laneTotal = Object.values(state.laneLiability).reduce((sum, value) => sum + BigInt(value), 0n);
  check(laneTotal === BigInt(state.aggregateLiability), `property ${index} lane liabilities equal aggregate`);
  check(BigInt(state.principalCustody) === BigInt(state.aggregateLiability), `property ${index} principal equals liability`);
  check(BigInt(state.aggregateLiability) <= BigInt(state.maximumAggregateLiability), `property ${index} exposure cap holds`);
  propertySteps += 1;
}

const sourceFiles = [
  'canonical-bridge-attestor-economics-model.mjs',
  'validate-canonical-bridge-attestor-economics.mjs',
  'canonical-bridge-attestor-framework-discussion-v1.md',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name, sha256Hex(await fs.readFile(path.join(root, name))),
])));

const result = {
  schema: 'canonical-bridge-attestor-economics-validation/v1',
  createdAt: new Date().toISOString(),
  result: 'PASS',
  evidenceLevel: 'offline executable economic reference model',
  assertions,
  hostileCases,
  propertySteps,
  illustrativeParameters: {
    committee: '5-of-7',
    equalBond: '125000',
    exposureSafetyBps: 8000,
    individualBondBps: 8000,
    mutualBondBps: 2000,
    attestorRewardSplitBps: { readiness: 6000, participation: 2500, bondRisk: 1500 },
    protocolFeeSplitBps: { attestors: 5000, safety: 2000, relayers: 1000, operations: 2000 },
  },
  proved: [
    'Unanimous acceptance of one complete roster is required before activation.',
    'Aggregate multi-lane liability cannot exceed the discounted slashable quorum bond.',
    'Principal, protocol fees, attestor rewards, safety reserves, relayer funds and operations funds remain separate.',
    'Valid timely approval and rejection receive equal participation weight; the first five signers do not capture all rewards.',
    'Low security runway stops new liability while redemption remains open.',
    'Objective solo fault slashes only the culprit individual tranche.',
    'Successful quorum fraud can use equal limited mutual tranches without taking an honest attestor individual tranche.',
    'Subjective downtime cannot trigger catastrophic slashing.',
  ],
  notProved: [
    'All percentages and amounts are illustrative founder-review parameters, not production decisions.',
    'Local self/delegated bond accounting, aggregate exposure, fee custody, bond-risk indexing, signed work records and finalized work-reward indexing exist, but withdrawal, production finalized-fact verification, forfeiture and claim contracts do not.',
    'EIP-712 equivocation is locally verifiable, but no inseparable Minima WOTS signer-attribution proof, legal enforceability, market bond valuation or actuarial sufficiency is proved.',
    'No bond, fee, insurance deposit, real asset or chain transaction was created.',
  ],
  boundaries: { realAssets: false, contractsDeployed: false, transactionsPosted: 0 },
  sourceSha256,
};

if (emitEvidence) {
  const stamp = result.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = path.join(root, 'evidence', `canonical-bridge-attestor-economics-${stamp}.json`);
  const body = `${JSON.stringify(result, null, 2)}\n`;
  await fs.writeFile(evidencePath, body);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  await fs.writeFile(`${evidencePath}.sha256`, `${digest}  ${path.basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.sha256 = digest;
}

console.log(JSON.stringify(result, null, 2));
