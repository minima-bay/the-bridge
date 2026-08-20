import { canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

const BPS = 10_000n;
const OBJECTIVE_FAULTS = new Set([
  'EQUIVOCATION',
  'NONEXISTENT_SOURCE_RECORD',
  'SOURCE_RECORD_MISMATCH',
  'REPLAYED_SETTLEMENT',
  'UNAUTHORIZED_EPOCH',
  'EXPOSURE_CAP_BREACH',
  'DESTINATION_TRANSACTION_MISMATCH',
]);

function amount(value, label) {
  try {
    const parsed = typeof value === 'bigint' ? value : BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch { throw new TypeError(`${label} must be a nonnegative integer`); }
}

function positive(value, label) {
  const parsed = amount(value, label);
  if (parsed === 0n) throw new TypeError(`${label} must be positive`);
  return parsed;
}

function bps(value, label) {
  const parsed = amount(value, label);
  if (parsed > BPS) throw new TypeError(`${label} exceeds 10000 basis points`);
  return parsed;
}

function uniqueIds(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(value))) {
    throw new TypeError(`${label} is invalid`);
  }
  if (new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicates`);
  return [...values];
}

function allocate(total, weights, orderedIds) {
  const normalizedTotal = amount(total, 'allocation total');
  const normalizedWeights = orderedIds.map((id) => amount(weights[id] || 0n, `weight ${id}`));
  const weightTotal = normalizedWeights.reduce((sum, value) => sum + value, 0n);
  const result = Object.fromEntries(orderedIds.map((id) => [id, 0n]));
  if (normalizedTotal === 0n || weightTotal === 0n) return { allocations: result, remainder: normalizedTotal };
  let paid = 0n;
  orderedIds.forEach((id, index) => {
    const share = normalizedTotal * normalizedWeights[index] / weightTotal;
    result[id] = share;
    paid += share;
  });
  return { allocations: result, remainder: normalizedTotal - paid };
}

function stringifyBigInts(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stringifyBigInts(child)]));
  }
  return value;
}

export class CanonicalBridgeAttestorEconomicsModel {
  constructor({
    memberIds,
    quorum,
    equalBond,
    individualBondBps = 8_000,
    mutualBondBps = 2_000,
    exposureSafetyBps = 8_000,
    attestorProtocolFeeBps = 5_000,
    safetyProtocolFeeBps = 2_000,
    relayerProtocolFeeBps = 1_000,
    operationsProtocolFeeBps = 2_000,
    readinessRewardBps = 6_000,
    participationRewardBps = 2_500,
    bondRiskRewardBps = 1_500,
    minimumAvailabilityBps = 9_500,
    minimumSecurityRunwayEpochs = 3,
    minimumEpochSecurityBudget,
  }) {
    this.memberIds = uniqueIds(memberIds, 'memberIds');
    if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > this.memberIds.length) throw new TypeError('quorum is invalid');
    this.quorum = quorum;
    this.equalBond = positive(equalBond, 'equalBond');
    this.individualBondBps = bps(individualBondBps, 'individualBondBps');
    this.mutualBondBps = bps(mutualBondBps, 'mutualBondBps');
    if (this.individualBondBps + this.mutualBondBps !== BPS) throw new TypeError('bond tranches must total 10000 basis points');
    this.exposureSafetyBps = bps(exposureSafetyBps, 'exposureSafetyBps');
    this.protocolFeeBps = {
      attestors: bps(attestorProtocolFeeBps, 'attestorProtocolFeeBps'),
      safety: bps(safetyProtocolFeeBps, 'safetyProtocolFeeBps'),
      relayers: bps(relayerProtocolFeeBps, 'relayerProtocolFeeBps'),
      operations: bps(operationsProtocolFeeBps, 'operationsProtocolFeeBps'),
    };
    if (Object.values(this.protocolFeeBps).reduce((sum, value) => sum + value, 0n) !== BPS) {
      throw new TypeError('protocol fee shares must total 10000 basis points');
    }
    this.rewardBps = {
      readiness: bps(readinessRewardBps, 'readinessRewardBps'),
      participation: bps(participationRewardBps, 'participationRewardBps'),
      bondRisk: bps(bondRiskRewardBps, 'bondRiskRewardBps'),
    };
    if (Object.values(this.rewardBps).reduce((sum, value) => sum + value, 0n) !== BPS) {
      throw new TypeError('reward shares must total 10000 basis points');
    }
    this.minimumAvailabilityBps = bps(minimumAvailabilityBps, 'minimumAvailabilityBps');
    if (!Number.isSafeInteger(minimumSecurityRunwayEpochs) || minimumSecurityRunwayEpochs < 1) {
      throw new TypeError('minimumSecurityRunwayEpochs is invalid');
    }
    this.minimumSecurityRunwayEpochs = minimumSecurityRunwayEpochs;
    this.minimumEpochSecurityBudget = positive(minimumEpochSecurityBudget, 'minimumEpochSecurityBudget');
    const individual = this.equalBond * this.individualBondBps / BPS;
    const mutual = this.equalBond - individual;
    this.members = Object.fromEntries(this.memberIds.map((id) => [id, {
      acceptedRoster: false,
      active: false,
      individualBondRemaining: individual,
      mutualBondRemaining: mutual,
      accruedReward: 0n,
      slashed: 0n,
    }]));
    this.rosterHash = sha256Hex(canonicalJson({ memberIds: this.memberIds, quorum: this.quorum,
      equalBond: this.equalBond.toString() }));
    this.active = false;
    this.principalCustody = 0n;
    this.aggregateLiability = 0n;
    this.laneLiability = {};
    this.attestorRewardPool = 0n;
    this.safetyReserve = 0n;
    this.relayerBudget = 0n;
    this.operationsBudget = 0n;
    this.bootstrapSecurityTreasury = 0n;
    this.totalFeesCollected = 0n;
    this.totalClaimsPaid = 0n;
    this.totalUncoveredClaims = 0n;
    this.newLiabilityPaused = false;
  }

  acceptRoster(memberId, rosterHash) {
    const member = this.members[memberId];
    if (!member || rosterHash !== this.rosterHash || this.active) return false;
    member.acceptedRoster = true;
    return true;
  }

  activate() {
    if (this.active || this.memberIds.some((id) => !this.members[id].acceptedRoster)) return false;
    this.active = true;
    for (const id of this.memberIds) this.members[id].active = true;
    return true;
  }

  addBootstrapSecurityTreasury(value) {
    this.bootstrapSecurityTreasury += positive(value, 'bootstrap security treasury');
  }

  maximumAggregateLiability() {
    return this.equalBond * BigInt(this.quorum) * this.exposureSafetyBps / BPS;
  }

  availableSecurityRewardFunds() {
    return this.attestorRewardPool + this.bootstrapSecurityTreasury;
  }

  securityRunwayEpochs() {
    return this.availableSecurityRewardFunds() / this.minimumEpochSecurityBudget;
  }

  refreshRunwayPause() {
    this.newLiabilityPaused = this.securityRunwayEpochs() < BigInt(this.minimumSecurityRunwayEpochs);
    return this.newLiabilityPaused;
  }

  #allocateProtocolFee(fee) {
    const attestors = fee * this.protocolFeeBps.attestors / BPS;
    const safety = fee * this.protocolFeeBps.safety / BPS;
    const relayers = fee * this.protocolFeeBps.relayers / BPS;
    const operations = fee - attestors - safety - relayers;
    this.attestorRewardPool += attestors;
    this.safetyReserve += safety;
    this.relayerBudget += relayers;
    this.operationsBudget += operations;
    this.totalFeesCollected += fee;
  }

  acceptLiability({ laneId, principal, fee }) {
    if (!this.active || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(laneId || '')) return false;
    const normalizedPrincipal = positive(principal, 'principal');
    const normalizedFee = amount(fee, 'fee');
    const futureAttestorPool = this.attestorRewardPool
      + normalizedFee * this.protocolFeeBps.attestors / BPS;
    const futureRunway = (futureAttestorPool + this.bootstrapSecurityTreasury) / this.minimumEpochSecurityBudget;
    if (futureRunway < BigInt(this.minimumSecurityRunwayEpochs)
      || this.aggregateLiability + normalizedPrincipal > this.maximumAggregateLiability()) {
      this.refreshRunwayPause();
      return false;
    }
    this.#allocateProtocolFee(normalizedFee);
    this.refreshRunwayPause();
    this.principalCustody += normalizedPrincipal;
    this.aggregateLiability += normalizedPrincipal;
    this.laneLiability[laneId] = (this.laneLiability[laneId] || 0n) + normalizedPrincipal;
    return true;
  }

  redeem({ laneId, principal }) {
    const normalizedPrincipal = positive(principal, 'principal');
    if ((this.laneLiability[laneId] || 0n) < normalizedPrincipal || this.principalCustody < normalizedPrincipal) return false;
    this.laneLiability[laneId] -= normalizedPrincipal;
    this.aggregateLiability -= normalizedPrincipal;
    this.principalCustody -= normalizedPrincipal;
    return true;
  }

  closeRewardEpoch({ availabilityBpsById, decisionsById, bondTimeById }) {
    const pool = this.attestorRewardPool;
    const readinessPool = pool * this.rewardBps.readiness / BPS;
    const participationPool = pool * this.rewardBps.participation / BPS;
    const bondRiskPool = pool - readinessPool - participationPool;
    const readinessWeights = {};
    const participationWeights = {};
    const riskWeights = {};
    for (const id of this.memberIds) {
      const availability = bps(availabilityBpsById[id] || 0n, `availability ${id}`);
      readinessWeights[id] = this.members[id].active && availability >= this.minimumAvailabilityBps ? 1n : 0n;
      const decisions = Array.isArray(decisionsById[id]) ? decisionsById[id] : [];
      participationWeights[id] = this.members[id].active
        ? BigInt(decisions.filter((entry) => entry?.timely === true
          && entry?.valid === true && ['APPROVE', 'REJECT'].includes(entry.decision)).length)
        : 0n;
      riskWeights[id] = this.members[id].active ? amount(bondTimeById[id] || 0n, `bond time ${id}`) : 0n;
    }
    const readiness = allocate(readinessPool, readinessWeights, this.memberIds);
    const participation = allocate(participationPool, participationWeights, this.memberIds);
    const bondRisk = allocate(bondRiskPool, riskWeights, this.memberIds);
    let paid = 0n;
    for (const id of this.memberIds) {
      const reward = readiness.allocations[id] + participation.allocations[id] + bondRisk.allocations[id];
      this.members[id].accruedReward += reward;
      paid += reward;
    }
    this.attestorRewardPool -= paid;
    return stringifyBigInts({ paid, retainedRounding: pool - paid, readiness: readiness.allocations,
      participation: participation.allocations, bondRisk: bondRisk.allocations });
  }

  slash({ fault, culprits, coveredLoss = 0n }) {
    if (!OBJECTIVE_FAULTS.has(fault)) return { accepted: false, code: 'FAULT_NOT_OBJECTIVE' };
    const ids = uniqueIds(culprits, 'culprits');
    if (ids.some((id) => !this.members[id])) return { accepted: false, code: 'UNKNOWN_CULPRIT' };
    const loss = amount(coveredLoss, 'coveredLoss');
    let recovered = 0n;
    const individualSlashed = {};
    const mutualSlashed = Object.fromEntries(this.memberIds.map((id) => [id, 0n]));
    for (const id of ids) {
      const member = this.members[id];
      const value = member.individualBondRemaining;
      member.individualBondRemaining = 0n;
      member.slashed += value;
      member.accruedReward = 0n;
      member.active = false;
      individualSlashed[id] = value;
      recovered += value;
    }
    if (ids.length >= this.quorum && recovered < loss) {
      const remaining = loss - recovered;
      const equalMutualSlash = (remaining + BigInt(this.memberIds.length) - 1n) / BigInt(this.memberIds.length);
      for (const id of this.memberIds) {
        const member = this.members[id];
        const value = member.mutualBondRemaining < equalMutualSlash ? member.mutualBondRemaining : equalMutualSlash;
        member.mutualBondRemaining -= value;
        member.slashed += value;
        mutualSlashed[id] = value;
        recovered += value;
      }
    }
    let claimPaid = recovered > loss ? loss : recovered;
    let remainingLoss = loss - claimPaid;
    const safetyPaid = this.safetyReserve < remainingLoss ? this.safetyReserve : remainingLoss;
    this.safetyReserve -= safetyPaid;
    claimPaid += safetyPaid;
    remainingLoss -= safetyPaid;
    this.totalClaimsPaid += claimPaid;
    this.totalUncoveredClaims += remainingLoss;
    if (recovered > loss) this.safetyReserve += recovered - loss;
    return stringifyBigInts({
      accepted: true,
      code: 'OBJECTIVE_SLASH_APPLIED',
      individualSlashed,
      mutualSlashed,
      recoveredFromBonds: recovered,
      safetyPaid,
      claimPaid,
      uncovered: remainingLoss,
    });
  }

  snapshot() {
    return stringifyBigInts({
      rosterHash: this.rosterHash,
      active: this.active,
      principalCustody: this.principalCustody,
      aggregateLiability: this.aggregateLiability,
      laneLiability: this.laneLiability,
      maximumAggregateLiability: this.maximumAggregateLiability(),
      attestorRewardPool: this.attestorRewardPool,
      safetyReserve: this.safetyReserve,
      relayerBudget: this.relayerBudget,
      operationsBudget: this.operationsBudget,
      bootstrapSecurityTreasury: this.bootstrapSecurityTreasury,
      securityRunwayEpochs: this.securityRunwayEpochs(),
      newLiabilityPaused: this.newLiabilityPaused,
      totalFeesCollected: this.totalFeesCollected,
      totalClaimsPaid: this.totalClaimsPaid,
      totalUncoveredClaims: this.totalUncoveredClaims,
      members: this.members,
    });
  }
}

export const ATTESTOR_ECONOMICS_CONSTANTS = Object.freeze({ BPS, OBJECTIVE_FAULTS });
