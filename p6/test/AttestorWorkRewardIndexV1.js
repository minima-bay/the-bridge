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

async function fixture({ registerIndex = true } = {}) {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const memberSigners = signers.slice(1, 8);
  const members = memberSigners.map((signer) => signer.address);
  const tokenA = await ethers.deployContract("MockValuelessBondToken");
  const tokenB = await ethers.deployContract("MockValuelessBondToken");
  const bondVault = await ethers.deployContract("AttestorBondVaultV1");
  const factSource = await ethers.deployContract("MockFinalizedDecisionFactSource");
  await tokenA.waitForDeployment();
  await tokenB.waitForDeployment();
  await bondVault.waitForDeployment();
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
  const bondRewardIndex = await ethers.deployContract("AttestorEpochRewardIndexV1", [
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
  await bondRewardIndex.waitForDeployment();
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
    rewardIndex: await bondRewardIndex.getAddress(),
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
    await bondRewardIndex.getAddress(),
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
  expect(await controller.getAddress()).to.equal(predictedController);
  expect(await treasury.getAddress()).to.equal(predictedTreasury);
  expect(await workRecorder.getAddress()).to.equal(predictedWorkRecorder);
  expect(await workRewardIndex.getAddress()).to.equal(predictedWorkRewardIndex);
  if (registerIndex) await workRewardIndex.registerTreasury();

  await bondVault.registerRoster(await registry.getAddress());
  const rosterHash = await registry.rosterHash();
  for (const member of memberSigners) {
    await tokenA.mint(member.address, EQUAL_BOND);
    await tokenA.connect(member).approve(await bondVault.getAddress(), EQUAL_BOND);
    await bondVault.connect(member).postBond(rosterHash);
    await registry.connect(member).acceptRoster(rosterHash);
  }
  await mineBefore(activationBlock);
  await registry.activate();
  return {
    signers,
    memberSigners,
    tokenA,
    tokenB,
    assets,
    lanes,
    laneA,
    laneB,
    bondVault,
    registry,
    controller,
    treasury,
    workRecorder,
    workRewardIndex,
    factSource,
    decisionVerifier,
    rosterHash,
    epochStart,
    epochEnd,
    challengeEnd: epochEnd + CHALLENGE_PERIOD
  };
}

function requestDigestFor(requestId) {
  return ethers.id(`work-reward-digest-${requestId}`);
}

async function registerRequest(f, requestId) {
  await f.laneA.registerWorkRequest(
    await f.workRecorder.getAddress(),
    requestId,
    requestDigestFor(requestId),
    f.epochEnd
  );
}

async function accountabilitySignature(f, signer, requestId, decision) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  return signer.signTypedData(
    {
      name: VERIFIER_NAME,
      version: VERIFIER_VERSION,
      chainId,
      verifyingContract: await f.decisionVerifier.getAddress()
    },
    {
      Decision: [
        { name: "rosterHash", type: "bytes32" },
        { name: "workRecorder", type: "address" },
        { name: "requestId", type: "bytes32" },
        { name: "requestDigest", type: "bytes32" },
        { name: "decision", type: "uint8" }
      ]
    },
    {
      rosterHash: f.rosterHash,
      workRecorder: await f.workRecorder.getAddress(),
      requestId,
      requestDigest: requestDigestFor(requestId),
      decision
    }
  );
}

async function submitDecision(f, signer, requestId, decision) {
  const signature = await accountabilitySignature(f, signer, requestId, decision);
  await f.workRecorder.connect(signer).recordDecision(
    requestId,
    decision,
    ethers.id(`work-reward-evidence-${signer.address}`),
    signature
  );
}

async function collectFee(f, assetIndex, settlementLabel, fee) {
  const lane = assetIndex === 0 ? f.laneA : f.laneB;
  const token = assetIndex === 0 ? f.tokenA : f.tokenB;
  await token.mint(f.lanes[assetIndex], fee);
  await lane.settleAndCollect(
    await f.treasury.getAddress(),
    f.assets[assetIndex],
    ethers.id(settlementLabel),
    1n,
    fee
  );
}

async function recordWeightedWork(f, { challengeFirst = false } = {}) {
  await mineBefore(f.epochStart);
  for (const member of f.memberSigners.slice(0, 6)) {
    await f.workRecorder.connect(member).recordReadiness();
  }
  const requestId = ethers.id("weighted-work-request");
  await registerRequest(f, requestId);
  for (let i = 0; i < f.memberSigners.length; i += 1) {
    await submitDecision(f, f.memberSigners[i], requestId, i % 2 === 0 ? 1 : 2);
  }
  await f.workRecorder.connect(f.memberSigners[0]).recordReadiness();
  if (challengeFirst) {
    const proof = ethers.toUtf8Bytes("finalized-reject-for-member-zero");
    await f.factSource.setFact(ethers.keccak256(proof), {
      rosterHash: f.rosterHash,
      requestId,
      requestDigest: requestDigestFor(requestId),
      correctDecision: 2,
      factDigest: ethers.id("finalized-work-reward-fact"),
      finalized: true
    });
    await f.workRecorder.challengeDecision(
      requestId,
      f.memberSigners[0].address,
      ethers.concat(["0x01", proof])
    );
  }
  return requestId;
}

async function finalize(f) {
  await mineTo(f.challengeEnd);
  await f.workRecorder.finalizeEpoch();
}

describe("AttestorWorkRewardIndexV1 local finalized-work consumption gate", function () {
  it("binds the exact recorder, treasury, assets and pre-epoch registration", async function () {
    const f = await fixture();
    expect(await f.workRecorder.workRewardIndex()).to.equal(await f.workRewardIndex.getAddress());
    expect(await f.workRewardIndex.workRecorder()).to.equal(await f.workRecorder.getAddress());
    expect(await f.workRewardIndex.treasury()).to.equal(await f.treasury.getAddress());
    expect(await f.treasury.workRewardIndex()).to.equal(await f.workRewardIndex.getAddress());
    expect(await f.treasury.workRecorder()).to.equal(await f.workRecorder.getAddress());
    expect(await f.workRewardIndex.rewardAssets(0)).to.equal(f.assets[0]);
    expect(await f.workRewardIndex.rewardAssets(1)).to.equal(f.assets[1]);
    await expect(f.workRewardIndex.registerTreasury())
      .to.be.revertedWithCustomError(f.workRewardIndex, "TreasuryAlreadyRegistered");
  });

  it("rejects indexing before finalization, foreign assets and direct treasury consumption", async function () {
    const f = await fixture();
    await expect(f.workRewardIndex.indexFinalizedWork(f.assets[0]))
      .to.be.revertedWithCustomError(f.workRewardIndex, "WorkEpochNotFinalized");
    await expect(f.workRewardIndex.indexFinalizedWork(await f.bondVault.getAddress()))
      .to.be.revertedWithCustomError(f.workRewardIndex, "WrongRewardAsset");
    await expect(f.treasury.consumeFinalizedWorkRewards(f.assets[0]))
      .to.be.revertedWithCustomError(f.treasury, "UnauthorizedWorkRewardIndex");
  });

  it("allocates finalized readiness and participation while removing a challenged decision", async function () {
    const f = await fixture();
    await recordWeightedWork(f, { challengeFirst: true });
    await collectFee(f, 0, "finalized-work-fee", 140_000n);
    await finalize(f);
    await f.workRewardIndex.indexFinalizedWork(f.assets[0]);

    expect(await f.workRewardIndex.indexedReadinessReward(f.assets[0], f.memberSigners[0].address))
      .to.equal(12_000n);
    expect(await f.workRewardIndex.indexedParticipationReward(f.assets[0], f.memberSigners[0].address))
      .to.equal(0n);
    for (const member of f.memberSigners.slice(1, 6)) {
      expect(await f.workRewardIndex.indexedReadinessReward(f.assets[0], member.address)).to.equal(6_000n);
      expect(await f.workRewardIndex.indexedParticipationReward(f.assets[0], member.address)).to.equal(2_916n);
    }
    expect(await f.workRewardIndex.indexedReadinessReward(f.assets[0], f.memberSigners[6].address))
      .to.equal(0n);
    expect(await f.workRewardIndex.indexedParticipationReward(f.assets[0], f.memberSigners[6].address))
      .to.equal(2_916n);
    expect(await f.workRewardIndex.totalIndexedReadiness(f.assets[0])).to.equal(42_000n);
    expect(await f.workRewardIndex.totalIndexedParticipation(f.assets[0])).to.equal(17_496n);
    expect(await f.workRewardIndex.participationRemainder(f.assets[0])).to.equal(4n);
    expect(await f.workRewardIndex.indexedFinalizationDigest(f.assets[0]))
      .to.equal(await f.workRecorder.finalizationDigest());
  });

  it("retains integer rounding in treasury accounting and rejects repeat indexing", async function () {
    const f = await fixture();
    await recordWeightedWork(f, { challengeFirst: true });
    await collectFee(f, 0, "rounding-work-fee", 140_000n);
    await finalize(f);
    const treasuryBalance = await f.tokenA.balanceOf(await f.treasury.getAddress());
    await f.workRewardIndex.indexFinalizedWork(f.assets[0]);
    expect(await f.tokenA.balanceOf(await f.treasury.getAddress())).to.equal(treasuryBalance);
    expect(await f.workRewardIndex.readinessRemainder(f.assets[0])).to.equal(0n);
    expect(await f.workRewardIndex.participationRemainder(f.assets[0])).to.equal(4n);
    expect(await f.treasury.workRewardsConsumed(f.assets[0])).to.equal(true);
    await expect(f.workRewardIndex.indexFinalizedWork(f.assets[0]))
      .to.be.revertedWithCustomError(f.workRewardIndex, "WorkRewardsAlreadyIndexed");
  });

  it("keeps both fee assets isolated under the same finalized weights", async function () {
    const f = await fixture();
    await recordWeightedWork(f);
    await collectFee(f, 0, "isolated-a", 140_000n);
    await collectFee(f, 1, "isolated-b", 280_000n);
    await finalize(f);
    await f.workRewardIndex.indexFinalizedWork(f.assets[0]);
    expect(await f.workRewardIndex.workRewardsIndexed(f.assets[1])).to.equal(false);
    expect(await f.workRewardIndex.totalIndexedReadiness(f.assets[0])).to.equal(42_000n);
    await f.workRewardIndex.indexFinalizedWork(f.assets[1]);
    expect(await f.workRewardIndex.totalIndexedReadiness(f.assets[1])).to.equal(84_000n);
    expect(await f.workRewardIndex.totalIndexedParticipation(f.assets[1])).to.equal(35_000n);
    expect(await f.workRewardIndex.totalIndexedParticipation(f.assets[0])).to.equal(17_500n);
  });

  it("excludes confirmed fees collected before and after the exact work epoch", async function () {
    const f = await fixture();
    await collectFee(f, 0, "pre-epoch-fee", 140_000n);
    expect(await f.treasury.epochReadinessRewardPool(f.assets[0])).to.equal(0n);
    await recordWeightedWork(f);
    await collectFee(f, 0, "in-epoch-fee", 140_000n);
    await mineTo(f.epochEnd);
    await collectFee(f, 0, "post-epoch-fee", 140_000n);
    expect(await f.treasury.epochReadinessRewardPool(f.assets[0])).to.equal(42_000n);
    expect(await f.treasury.epochParticipationRewardPool(f.assets[0])).to.equal(17_500n);
    await finalize(f);
    await f.workRewardIndex.indexFinalizedWork(f.assets[0]);
    expect(await f.workRewardIndex.totalIndexedReadiness(f.assets[0])).to.equal(42_000n);
    expect(await f.workRewardIndex.totalIndexedParticipation(f.assets[0])).to.equal(17_500n);
  });

  it("leaves a zero-weight epoch completely unassigned instead of inventing recipients", async function () {
    const f = await fixture();
    await mineBefore(f.epochStart);
    await collectFee(f, 0, "zero-work-fee", 140_000n);
    await finalize(f);
    await f.workRewardIndex.indexFinalizedWork(f.assets[0]);
    expect(await f.workRewardIndex.totalIndexedReadiness(f.assets[0])).to.equal(0n);
    expect(await f.workRewardIndex.totalIndexedParticipation(f.assets[0])).to.equal(0n);
    expect(await f.workRewardIndex.readinessRemainder(f.assets[0])).to.equal(42_000n);
    expect(await f.workRewardIndex.participationRemainder(f.assets[0])).to.equal(17_500n);
  });

  it("rejects alternate indices and registration at or after epoch start", async function () {
    const f = await fixture({ registerIndex: false });
    await expect(
      ethers.deployContract("AttestorWorkRewardIndexV1", [
        await f.workRecorder.getAddress(),
        await f.treasury.getAddress(),
        f.assets
      ])
    ).to.be.revertedWithCustomError(f.workRewardIndex, "InvalidWorkRecorder");
    await mineTo(f.epochStart);
    await expect(f.workRewardIndex.registerTreasury())
      .to.be.revertedWithCustomError(f.treasury, "WorkRewardRegistrationTooLate");
    expect(await f.treasury.workRewardIndex()).to.equal(ethers.ZeroAddress);
  });
});
