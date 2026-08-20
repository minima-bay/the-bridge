import { expect } from "../../p4/node_modules/chai/index.js";
import { network } from "../../p4/node_modules/hardhat/dist/src/index.js";

const { ethers } = await network.create();

const BRIDGE_ID = ethers.id("VALUELESS_CANONICAL_BRIDGE_V1");
const DOSSIER_ROOT = ethers.id("RESEARCH_DOSSIERS_V1");
const POLICY_DOMAIN = ethers.id("CANONICAL_BRIDGE_EXPOSURE_POLICY_V1");
const LANE_A_ID = ethers.id("VALUELESS_USDTM_LANE_V1");
const LANE_B_ID = ethers.id("VALUELESS_ETHM_LANE_V1");
const EQUAL_BOND = 100_000n;
const READINESS_WINDOW = 10n;
const CHALLENGE_PERIOD = 20n;
const VERIFIER_NAME = "CanonicalBridgeObjectiveDecisionVerifier";
const VERIFIER_VERSION = "1";
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const FEE_POLICY = {
  attestorBps: 5_000n,
  safetyBps: 2_000n,
  relayerBps: 1_000n,
  operationsBps: 2_000n,
  readinessBps: 6_000n,
  participationBps: 2_500n,
  bondRiskBps: 1_500n
};

async function mineBefore(target) {
  const current = BigInt(await ethers.provider.getBlockNumber());
  if (current < target - 1n) {
    await ethers.provider.send("hardhat_mine", [`0x${(target - 1n - current).toString(16)}`]);
  }
}

async function mineTo(target) {
  const current = BigInt(await ethers.provider.getBlockNumber());
  if (current < target) {
    await ethers.provider.send("hardhat_mine", [`0x${(target - current).toString(16)}`]);
  }
}

async function fixture({ activateRoster = true } = {}) {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const memberSigners = signers.slice(1, 8);
  const members = memberSigners.map((signer) => signer.address);
  const tokenA = await ethers.deployContract("MockValuelessBondToken");
  const tokenB = await ethers.deployContract("MockValuelessBondToken");
  const bondVault = await ethers.deployContract("AttestorBondVaultV1");
  await tokenA.waitForDeployment();
  await tokenB.waitForDeployment();
  await bondVault.waitForDeployment();
  const factSource = await ethers.deployContract("MockFinalizedDecisionFactSource");
  await factSource.waitForDeployment();

  const currentBlock = BigInt(await ethers.provider.getBlockNumber());
  const activationBlock = currentBlock + 100n;
  const epochStart = activationBlock + 10n;
  const epochEnd = epochStart + 39n;
  const nextNonce = await ethers.provider.getTransactionCount(deployer.address);
  const predictedController = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 5 });
  const predictedTreasury = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 6 });
  const predictedWorkRecorder = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 7 });
  const predictedWorkRewardIndex = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 8 });
  const laneA = await ethers.deployContract("MockFeeLane", [predictedController, LANE_A_ID]);
  const laneB = await ethers.deployContract("MockFeeLane", [predictedController, LANE_B_ID]);
  const assets = [await tokenA.getAddress(), await tokenB.getAddress()];
  const rewardIndex = await ethers.deployContract("AttestorEpochRewardIndexV1", [
    await bondVault.getAddress(),
    predictedTreasury,
    assets
  ]);
  const decisionVerifier = await ethers.deployContract("ObjectiveDecisionVerifierV1", [
    await factSource.getAddress(),
    predictedWorkRecorder
  ]);
  await laneA.waitForDeployment();
  await laneB.waitForDeployment();
  await rewardIndex.waitForDeployment();
  await decisionVerifier.waitForDeployment();
  const lanes = [await laneA.getAddress(), await laneB.getAddress()];
  const laneIds = [LANE_A_ID, LANE_B_ID];
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const policyHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "bytes32", "uint256", "address", "address", "address[2]", "bytes32[2]"],
      [
        POLICY_DOMAIN,
        chainId,
        BRIDGE_ID,
        1n,
        predictedController,
        await bondVault.getAddress(),
        lanes,
        laneIds
      ]
    )
  );
  const proposal = {
    bridgeId: BRIDGE_ID,
    epoch: 1n,
    activationBlock,
    bondReadiness: await bondVault.getAddress(),
    rewardIndex: await rewardIndex.getAddress(),
    workRecorder: predictedWorkRecorder,
    bondAsset: assets[0],
    equalBondAmount: EQUAL_BOND,
    minimumSelfBondBps: 3_000n,
    individualSlashBps: 8_000n,
    mutualSlashBps: 2_000n,
    exposureCapBps: 8_000n,
    policyHash,
    dossierRoot: DOSSIER_ROOT
  };
  const registry = await ethers.deployContract("AttestorRosterRegistryV1", [proposal, members]);
  const controller = await ethers.deployContract("AttestorExposureControllerV1", [
    await registry.getAddress(),
    await bondVault.getAddress(),
    lanes,
    laneIds
  ]);
  const treasury = await ethers.deployContract("AttestorFeeRewardTreasuryV1", [
    await controller.getAddress(),
    await rewardIndex.getAddress(),
    assets,
    [1_000n, 2_000n],
    [3n, 2n],
    FEE_POLICY
  ]);
  const workRecorder = await ethers.deployContract("AttestorWorkEpochV1", [
    await registry.getAddress(),
    await bondVault.getAddress(),
    await controller.getAddress(),
    await decisionVerifier.getAddress(),
    predictedWorkRewardIndex,
    epochStart,
    epochEnd,
    READINESS_WINDOW,
    CHALLENGE_PERIOD
  ]);
  await registry.waitForDeployment();
  await controller.waitForDeployment();
  await treasury.waitForDeployment();
  await workRecorder.waitForDeployment();
  const workRewardIndex = await ethers.deployContract("AttestorWorkRewardIndexV1", [
    await workRecorder.getAddress(),
    await treasury.getAddress(),
    assets
  ]);
  await workRewardIndex.waitForDeployment();
  await workRewardIndex.registerTreasury();
  expect(await controller.getAddress()).to.equal(predictedController);
  expect(await treasury.getAddress()).to.equal(predictedTreasury);
  expect(await workRecorder.getAddress()).to.equal(predictedWorkRecorder);
  expect(await workRewardIndex.getAddress()).to.equal(predictedWorkRewardIndex);
  await bondVault.registerRoster(await registry.getAddress());
  const rosterHash = await registry.rosterHash();
  if (activateRoster) {
    for (const member of memberSigners) {
      await tokenA.mint(member.address, EQUAL_BOND);
      await tokenA.connect(member).approve(await bondVault.getAddress(), EQUAL_BOND);
      await bondVault.connect(member).postBond(rosterHash);
      await registry.connect(member).acceptRoster(rosterHash);
    }
    await mineBefore(activationBlock);
    await registry.activate();
  }
  return {
    signers,
    memberSigners,
    tokenA,
    bondVault,
    lanes,
    laneA,
    laneB,
    registry,
    controller,
    factSource,
    decisionVerifier,
    workRecorder,
    workRewardIndex,
    rosterHash,
    epochStart,
    epochEnd,
    challengeEnd: epochEnd + CHALLENGE_PERIOD
  };
}

function requestDigestFor(requestId) {
  return ethers.id(`digest-${requestId}`);
}

async function registerRequest(f, lane, requestId, deadline = f.epochEnd) {
  await lane.registerWorkRequest(
    await f.workRecorder.getAddress(),
    requestId,
    requestDigestFor(requestId),
    deadline
  );
}

function factEvidence(proof) {
  return ethers.concat(["0x01", proof]);
}

async function accountabilitySignature(f, signer, requestId, decision, overrides = {}) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name: VERIFIER_NAME,
    version: VERIFIER_VERSION,
    chainId: overrides.chainId ?? chainId,
    verifyingContract: overrides.verifyingContract ?? await f.decisionVerifier.getAddress()
  };
  const types = {
    Decision: [
      { name: "rosterHash", type: "bytes32" },
      { name: "workRecorder", type: "address" },
      { name: "requestId", type: "bytes32" },
      { name: "requestDigest", type: "bytes32" },
      { name: "decision", type: "uint8" }
    ]
  };
  const value = {
    rosterHash: overrides.rosterHash ?? f.rosterHash,
    workRecorder: overrides.workRecorder ?? await f.workRecorder.getAddress(),
    requestId: overrides.requestId ?? requestId,
    requestDigest: overrides.requestDigest ?? requestDigestFor(requestId),
    decision
  };
  return signer.signTypedData(domain, types, value);
}

async function submitDecision(f, signer, requestId, decision, evidenceDigest, signature) {
  const accountability = signature ?? await accountabilitySignature(f, signer, requestId, decision);
  return f.workRecorder.connect(signer).recordDecision(
    requestId,
    decision,
    evidenceDigest,
    accountability
  );
}

function malleateToHighS(signature) {
  const parsed = ethers.Signature.from(signature);
  const highS = SECP256K1_ORDER - BigInt(parsed.s);
  const flippedV = parsed.v === 27 ? 28 : 27;
  return ethers.concat([parsed.r, ethers.toBeHex(highS, 32), ethers.toBeHex(flippedV, 1)]);
}

describe("AttestorWorkEpochV1 local objective-record gate", function () {
  it("binds the exact roster, controller lanes, verifier and delayed epoch windows", async function () {
    const f = await fixture();
    expect(await f.registry.workRecorder()).to.equal(await f.workRecorder.getAddress());
    expect(await f.workRecorder.rosterHash()).to.equal(f.rosterHash);
    expect(await f.workRecorder.lanes(0)).to.equal(f.lanes[0]);
    expect(await f.workRecorder.lanes(1)).to.equal(f.lanes[1]);
    expect(await f.workRecorder.epochStartBlock()).to.equal(f.epochStart);
    expect(await f.workRecorder.epochEndBlock()).to.equal(f.epochEnd);
    expect(await f.workRecorder.readinessWindowCount()).to.equal(4n);
    expect(await f.workRecorder.challengeEndBlock()).to.equal(f.challengeEnd);
    expect(await f.decisionVerifier.workRecorder()).to.equal(await f.workRecorder.getAddress());
    expect(await f.decisionVerifier.factSource()).to.equal(await f.factSource.getAddress());
    expect(await f.workRecorder.workRewardIndex()).to.equal(await f.workRewardIndex.getAddress());
    expect(await f.workRewardIndex.treasuryRegistered()).to.equal(true);
    expect(await f.workRecorder.workAccumulator()).to.equal(ethers.ZeroHash);
  });

  it("records one fully bonded member heartbeat per readiness window", async function () {
    const f = await fixture();
    await expect(f.workRecorder.connect(f.memberSigners[0]).recordReadiness())
      .to.be.revertedWithCustomError(f.workRecorder, "EpochNotOpen");
    await mineBefore(f.epochStart);
    await f.workRecorder.connect(f.memberSigners[0]).recordReadiness();
    expect(await f.workRecorder.readinessWeight(f.memberSigners[0].address)).to.equal(1n);
    await expect(f.workRecorder.connect(f.memberSigners[0]).recordReadiness())
      .to.be.revertedWithCustomError(f.workRecorder, "ReadinessAlreadyRecorded");
    await mineBefore(f.epochStart + READINESS_WINDOW);
    await f.workRecorder.connect(f.memberSigners[0]).recordReadiness();
    expect(await f.workRecorder.readinessWeight(f.memberSigners[0].address)).to.equal(2n);
    expect(await f.workRecorder.totalReadinessWeight()).to.equal(2n);
  });

  it("rejects outsider and underbonded readiness signals", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    await expect(f.workRecorder.connect(f.signers[9]).recordReadiness())
      .to.be.revertedWithCustomError(f.workRecorder, "NotMember");
    await f.tokenA.confiscate(await f.bondVault.getAddress(), 1n);
    await expect(f.workRecorder.connect(f.memberSigners[0]).recordReadiness())
      .to.be.revertedWithCustomError(f.workRecorder, "BondsNotReady");
  });

  it("allows only an exact lane to register a unique request with a bounded deadline", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    const requestId = ethers.id("request-lane-bound");
    await expect(
      f.workRecorder.registerRequest(requestId, ethers.id("outsider"), f.epochEnd)
    ).to.be.revertedWithCustomError(f.workRecorder, "UnauthorizedLane");
    await registerRequest(f, f.laneA, requestId);
    const request = await f.workRecorder.requests(requestId);
    expect(request.lane).to.equal(f.lanes[0]);
    expect(request.laneId).to.equal(LANE_A_ID);
    const acceptedAccumulator = await f.workRecorder.workAccumulator();
    expect(acceptedAccumulator).to.not.equal(ethers.ZeroHash);
    await expect(registerRequest(f, f.laneB, requestId))
      .to.be.revertedWithCustomError(f.workRecorder, "RequestAlreadyRegistered");
    await expect(registerRequest(f, f.laneA, ethers.id("late-deadline"), f.epochEnd + 1n))
      .to.be.revertedWithCustomError(f.workRecorder, "InvalidDecisionDeadline");
    expect(await f.workRecorder.workAccumulator()).to.equal(acceptedAccumulator);
  });

  it("rejects lane work requests while the committed roster is inactive", async function () {
    const f = await fixture({ activateRoster: false });
    await mineBefore(f.epochStart);
    await expect(registerRequest(f, f.laneA, ethers.id("inactive-roster-request")))
      .to.be.revertedWithCustomError(f.workRecorder, "RosterInactive");
    expect(await f.workRecorder.requestCount()).to.equal(0n);
  });

  it("gives timely approve and reject records equal weight and keeps the window open for all seven", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    const requestId = ethers.id("neutral-participation");
    await registerRequest(f, f.laneA, requestId);
    for (let i = 0; i < f.memberSigners.length; i += 1) {
      const decision = i % 2 === 0 ? 1 : 2;
      await submitDecision(
        f,
        f.memberSigners[i],
        requestId,
        decision,
        ethers.id(`evidence-${i}`)
      );
      expect(await f.workRecorder.participationWeight(f.memberSigners[i].address)).to.equal(1n);
    }
    expect(await f.workRecorder.totalParticipationWeight()).to.equal(7n);
    expect(await f.workRecorder.decisionCount()).to.equal(7n);
  });

  it("rejects malformed, duplicate and late member decisions", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    const requestId = ethers.id("decision-boundaries");
    const deadline = f.epochStart + 8n;
    await registerRequest(f, f.laneA, requestId, deadline);
    const requestAccumulator = await f.workRecorder.workAccumulator();
    await expect(
      submitDecision(f, f.memberSigners[0], requestId, 0, ethers.id("none"))
    ).to.be.revertedWithCustomError(f.workRecorder, "InvalidDecision");
    await expect(
      submitDecision(f, f.memberSigners[0], requestId, 1, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(f.workRecorder, "ZeroDigest");
    const foreignSignature = await accountabilitySignature(f, f.memberSigners[1], requestId, 1);
    await expect(
      submitDecision(f, f.memberSigners[0], requestId, 1, ethers.id("foreign-signature"), foreignSignature)
    ).to.be.revertedWithCustomError(f.workRecorder, "InvalidAccountabilitySignature");
    expect(await f.workRecorder.workAccumulator()).to.equal(requestAccumulator);
    await submitDecision(f, f.memberSigners[0], requestId, 1, ethers.id("valid"));
    await expect(
      submitDecision(f, f.memberSigners[0], requestId, 2, ethers.id("duplicate"))
    ).to.be.revertedWithCustomError(f.workRecorder, "DecisionAlreadyRecorded");
    await mineTo(deadline);
    await expect(
      submitDecision(f, f.memberSigners[1], requestId, 2, ethers.id("late"))
    ).to.be.revertedWithCustomError(f.workRecorder, "DecisionDeadlinePassed");
  });

  it("accepts only an exact finalized-fact contradiction and removes one participation weight", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    const requestId = ethers.id("challenged-decision");
    const member = f.memberSigners[0];
    const proof = ethers.toUtf8Bytes("finalized-opposite-fact");
    await registerRequest(f, f.laneA, requestId);
    await submitDecision(f, member, requestId, 1, ethers.id("decision-evidence"));
    const decisionAccumulator = await f.workRecorder.workAccumulator();
    await expect(f.workRecorder.challengeDecision(requestId, member.address, ethers.toUtf8Bytes("wrong")))
      .to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    expect(await f.workRecorder.workAccumulator()).to.equal(decisionAccumulator);
    await f.factSource.setFact(ethers.keccak256(proof), {
      rosterHash: f.rosterHash,
      requestId,
      requestDigest: requestDigestFor(requestId),
      correctDecision: 2,
      factDigest: ethers.id("confirmed-opposite-fact"),
      finalized: true
    });
    await f.workRecorder.challengeDecision(requestId, member.address, factEvidence(proof));
    expect(await f.workRecorder.participationWeight(member.address)).to.equal(0n);
    expect(await f.workRecorder.totalParticipationWeight()).to.equal(0n);
    expect(await f.workRecorder.successfulChallengeCount()).to.equal(1n);
    expect((await f.workRecorder.decisions(requestId, member.address)).challenged).to.equal(true);
    await expect(f.workRecorder.challengeDecision(requestId, member.address, factEvidence(proof)))
      .to.be.revertedWithCustomError(f.workRecorder, "ChallengeAlreadySucceeded");
  });

  it("rejects nonfinal, same-decision, empty-digest and foreign-bound fact claims", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    const requestId = ethers.id("hostile-fact-claims");
    const member = f.memberSigners[0];
    await registerRequest(f, f.laneA, requestId);
    await submitDecision(f, member, requestId, 1, ethers.id("recorded-approve"));
    const cases = [
      { label: "nonfinal", correctDecision: 2, factDigest: ethers.id("fact"), finalized: false },
      { label: "same-decision", correctDecision: 1, factDigest: ethers.id("fact"), finalized: true },
      { label: "empty-digest", correctDecision: 2, factDigest: ethers.ZeroHash, finalized: true },
      {
        label: "foreign-request-digest",
        correctDecision: 2,
        factDigest: ethers.id("fact"),
        finalized: true,
        requestDigest: ethers.id("foreign")
      }
    ];
    for (const item of cases) {
      const proof = ethers.toUtf8Bytes(`hostile-${item.label}`);
      await f.factSource.setFact(ethers.keccak256(proof), {
        rosterHash: f.rosterHash,
        requestId,
        requestDigest: item.requestDigest ?? requestDigestFor(requestId),
        correctDecision: item.correctDecision,
        factDigest: item.factDigest,
        finalized: item.finalized
      });
      await expect(f.workRecorder.challengeDecision(requestId, member.address, factEvidence(proof)))
        .to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    }
    expect(await f.workRecorder.participationWeight(member.address)).to.equal(1n);
    expect(await f.workRecorder.successfulChallengeCount()).to.equal(0n);
  });

  it("proves same-request accountability equivocation and rejects foreign signatures", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    const requestId = ethers.id("accountability-equivocation");
    const member = f.memberSigners[0];
    await registerRequest(f, f.laneA, requestId);
    const approve = await accountabilitySignature(f, member, requestId, 1);
    await submitDecision(f, member, requestId, 1, ethers.id("recorded-approve"), approve);
    expect((await f.workRecorder.decisions(requestId, member.address)).accountabilityDigest)
      .to.equal(ethers.keccak256(approve));
    const foreignReject = await accountabilitySignature(f, f.memberSigners[1], requestId, 2);
    await expect(
      f.workRecorder.challengeDecision(
        requestId,
        member.address,
        ethers.concat(["0x02", approve, foreignReject])
      )
    ).to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    const wrongDigestReject = await accountabilitySignature(f, member, requestId, 2, {
      requestDigest: ethers.id("foreign-request-digest")
    });
    await expect(
      f.workRecorder.challengeDecision(
        requestId,
        member.address,
        ethers.concat(["0x02", approve, wrongDigestReject])
      )
    ).to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    const wrongChainReject = await accountabilitySignature(f, member, requestId, 2, {
      chainId: (await ethers.provider.getNetwork()).chainId + 1n
    });
    await expect(
      f.workRecorder.challengeDecision(
        requestId,
        member.address,
        ethers.concat(["0x02", approve, wrongChainReject])
      )
    ).to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    const reject = await accountabilitySignature(f, member, requestId, 2);
    await expect(
      f.workRecorder.challengeDecision(
        requestId,
        member.address,
        ethers.concat(["0x02", malleateToHighS(approve), reject])
      )
    ).to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    await expect(
      f.workRecorder.challengeDecision(requestId, member.address, ethers.concat(["0x02", approve]))
    ).to.be.revertedWithCustomError(f.workRecorder, "ChallengeNotProved");
    await f.workRecorder.challengeDecision(
      requestId,
      member.address,
      ethers.concat(["0x02", approve, reject])
    );
    expect(await f.workRecorder.participationWeight(member.address)).to.equal(0n);
    expect(await f.workRecorder.successfulChallengeCount()).to.equal(1n);
  });

  it("finalizes permissionlessly only after the complete challenge delay and then freezes", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    await f.workRecorder.connect(f.memberSigners[0]).recordReadiness();
    const requestId = ethers.id("finalized-epoch");
    await registerRequest(f, f.laneA, requestId);
    await submitDecision(f, f.memberSigners[0], requestId, 2, ethers.id("reject-proof"));
    await expect(f.workRecorder.connect(f.signers[9]).finalizeEpoch())
      .to.be.revertedWithCustomError(f.workRecorder, "FinalizationTooEarly");
    await mineTo(f.challengeEnd);
    await f.workRecorder.connect(f.signers[9]).finalizeEpoch();
    expect(await f.workRecorder.finalized()).to.equal(true);
    expect(await f.workRecorder.finalizationDigest()).to.not.equal(ethers.ZeroHash);
    expect(await f.workRecorder.workAccumulator()).to.not.equal(ethers.ZeroHash);
    expect(await f.workRecorder.totalReadinessWeight()).to.equal(1n);
    expect(await f.workRecorder.totalParticipationWeight()).to.equal(1n);
    await expect(f.workRecorder.finalizeEpoch())
      .to.be.revertedWithCustomError(f.workRecorder, "AlreadyFinalized");
    await expect(f.workRecorder.challengeDecision(requestId, f.memberSigners[0].address, "0x"))
      .to.be.revertedWithCustomError(f.workRecorder, "ChallengeWindowClosed");
  });

  it("rejects a second recorder because the roster commits one exact address", async function () {
    const f = await fixture();
    await expect(
      ethers.deployContract("AttestorWorkEpochV1", [
        await f.registry.getAddress(),
        await f.bondVault.getAddress(),
        await f.controller.getAddress(),
        await f.decisionVerifier.getAddress(),
        await f.workRewardIndex.getAddress(),
        f.epochStart,
        f.epochEnd,
        READINESS_WINDOW,
        CHALLENGE_PERIOD
      ])
    ).to.be.revertedWithCustomError(f.workRecorder, "WrongWorkRecorder");
  });
});
