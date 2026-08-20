import { expect } from "../../p4/node_modules/chai/index.js";
import { network } from "../../p4/node_modules/hardhat/dist/src/index.js";

const { ethers } = await network.create();

const BRIDGE_ID = ethers.id("VALUELESS_CANONICAL_BRIDGE_V1");
const DOSSIER_ROOT = ethers.id("RESEARCH_DOSSIERS_V1");
const POLICY_DOMAIN = ethers.id("CANONICAL_BRIDGE_EXPOSURE_POLICY_V1");
const LANE_A_ID = ethers.id("VALUELESS_USDTM_LANE_V1");
const LANE_B_ID = ethers.id("VALUELESS_ETHM_LANE_V1");
const EQUAL_BOND = 100_000n;
const FEE_POLICY = {
  attestorBps: 5_000n,
  safetyBps: 2_000n,
  relayerBps: 1_000n,
  operationsBps: 2_000n,
  readinessBps: 6_000n,
  participationBps: 2_500n,
  bondRiskBps: 1_500n
};

async function fixture({ delegated = false } = {}) {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const memberSigners = signers.slice(1, 8);
  const members = memberSigners.map((signer) => signer.address);
  const tokenA = await ethers.deployContract("MockValuelessBondToken");
  const tokenB = await ethers.deployContract("MockValuelessBondToken");
  const bondVault = await ethers.deployContract("AttestorBondVaultV1");
  const workRecorder = await ethers.deployContract("MockAttestorWorkRecorder");
  await tokenA.waitForDeployment();
  await tokenB.waitForDeployment();
  await bondVault.waitForDeployment();
  await workRecorder.waitForDeployment();

  const nextNonce = await ethers.provider.getTransactionCount(deployer.address);
  const predictedController = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 4 });
  const predictedTreasury = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 5 });
  const laneA = await ethers.deployContract("MockFeeLane", [predictedController, LANE_A_ID]);
  const laneB = await ethers.deployContract("MockFeeLane", [predictedController, LANE_B_ID]);
  const assets = [await tokenA.getAddress(), await tokenB.getAddress()];
  const rewardIndex = await ethers.deployContract("AttestorEpochRewardIndexV1", [
    await bondVault.getAddress(),
    predictedTreasury,
    assets
  ]);
  await laneA.waitForDeployment();
  await laneB.waitForDeployment();
  await rewardIndex.waitForDeployment();
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
  const currentBlock = await ethers.provider.getBlockNumber();
  const activationBlock = BigInt(currentBlock + 100);
  const proposal = {
    bridgeId: BRIDGE_ID,
    epoch: 1n,
    activationBlock,
    bondReadiness: await bondVault.getAddress(),
    rewardIndex: await rewardIndex.getAddress(),
    workRecorder: await workRecorder.getAddress(),
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
  await registry.waitForDeployment();
  await controller.waitForDeployment();
  const treasury = await ethers.deployContract("AttestorFeeRewardTreasuryV1", [
    await controller.getAddress(),
    await rewardIndex.getAddress(),
    assets,
    [1_000n, 2_000n],
    [3n, 2n],
    FEE_POLICY
  ]);
  await treasury.waitForDeployment();
  expect(await controller.getAddress()).to.equal(predictedController);
  expect(await treasury.getAddress()).to.equal(predictedTreasury);
  await bondVault.registerRoster(await registry.getAddress());

  async function contribute(contributor, member, amount) {
    await tokenA.mint(contributor.address, amount);
    await tokenA.connect(contributor).approve(await bondVault.getAddress(), amount);
    await bondVault.connect(contributor).contributeBond(await registry.rosterHash(), member.address, amount);
  }

  if (delegated) {
    await contribute(signers[8], memberSigners[0], 35_000n);
    await contribute(signers[9], memberSigners[0], 35_000n);
    await contribute(memberSigners[0], memberSigners[0], 30_000n);
    for (const member of memberSigners.slice(1)) await contribute(member, member, EQUAL_BOND);
  } else {
    for (const member of memberSigners) await contribute(member, member, EQUAL_BOND);
  }
  const rosterHash = await registry.rosterHash();
  for (const member of memberSigners) await registry.connect(member).acceptRoster(rosterHash);
  const at = BigInt(await ethers.provider.getBlockNumber());
  if (at < activationBlock) {
    await ethers.provider.send("hardhat_mine", [`0x${(activationBlock - at).toString(16)}`]);
  }
  await registry.activate();
  return {
    signers,
    memberSigners,
    tokenA,
    tokenB,
    assets,
    bondVault,
    laneA,
    laneB,
    lanes,
    registry,
    controller,
    rewardIndex,
    treasury,
    rosterHash
  };
}

async function collect(f, laneNumber, settlementId, fee) {
  const lane = laneNumber === 0 ? f.laneA : f.laneB;
  const token = laneNumber === 0 ? f.tokenA : f.tokenB;
  await token.mint(f.lanes[laneNumber], fee);
  await lane.settleAndCollect(
    await f.treasury.getAddress(),
    f.assets[laneNumber],
    settlementId,
    1n,
    fee
  );
}

describe("AttestorEpochRewardIndexV1 local bond-risk index", function () {
  it("binds the roster, bond vault, treasury and both isolated reward assets", async function () {
    const f = await fixture();
    expect(await f.registry.rewardIndex()).to.equal(await f.rewardIndex.getAddress());
    expect(await f.rewardIndex.bondVault()).to.equal(await f.bondVault.getAddress());
    expect(await f.rewardIndex.treasury()).to.equal(await f.treasury.getAddress());
    expect(await f.rewardIndex.rewardAssets(0)).to.equal(f.assets[0]);
    expect(await f.rewardIndex.rewardAssets(1)).to.equal(f.assets[1]);
  });

  it("indexes an equal bond-risk reward for every fully self-bonded member", async function () {
    const f = await fixture();
    await collect(f, 0, ethers.id("equal-index"), 140_000n);
    for (const member of f.memberSigners) {
      expect(
        await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, member.address)
      ).to.equal(1_500n);
    }
    expect(await f.rewardIndex.indexedBondRiskRewards(f.rosterHash, f.assets[0])).to.equal(10_500n);
    expect(await f.rewardIndex.unindexedRemainder(f.rosterHash, f.assets[0])).to.equal(0n);
  });

  it("shares only the bond-risk bucket pro rata between the member and chosen depositors", async function () {
    const f = await fixture({ delegated: true });
    const member = f.memberSigners[0];
    await collect(f, 0, ethers.id("delegated-index"), 140_000n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, member.address)
    ).to.equal(450n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, f.signers[8].address)
    ).to.equal(525n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, f.signers[9].address)
    ).to.equal(525n);
    expect((await f.treasury.assetLedgers(f.assets[0])).readinessRewardPool).to.equal(42_000n);
    expect((await f.treasury.assetLedgers(f.assets[0])).participationRewardPool).to.equal(17_500n);
  });

  it("keeps indexed reward balances isolated by fee asset", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await collect(f, 0, ethers.id("asset-a-index"), 140_000n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, member.address)
    ).to.equal(1_500n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[1], member.address, member.address)
    ).to.equal(0n);
    await collect(f, 1, ethers.id("asset-b-index"), 140_000n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, member.address)
    ).to.equal(1_500n);
    expect(
      await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[1], member.address, member.address)
    ).to.equal(1_500n);
  });

  it("accumulates repeated confirmed-fee indices without a first-five signer race", async function () {
    const f = await fixture();
    await collect(f, 0, ethers.id("repeat-one"), 140_000n);
    await collect(f, 0, ethers.id("repeat-two"), 140_000n);
    for (const member of f.memberSigners) {
      expect(
        await f.rewardIndex.indexedBondRiskOf(f.rosterHash, f.assets[0], member.address, member.address)
      ).to.equal(3_000n);
    }
  });

  it("retains indivisible epoch and per-share rounding as unclaimed treasury value", async function () {
    const f = await fixture();
    await collect(f, 0, ethers.id("index-rounding"), 10_000n);
    let sum = 0n;
    for (const member of f.memberSigners) {
      const amount = await f.rewardIndex.indexedBondRiskOf(
        f.rosterHash,
        f.assets[0],
        member.address,
        member.address
      );
      expect(amount).to.equal(107n);
      sum += amount;
    }
    expect(sum).to.equal(749n);
    expect(await f.rewardIndex.indexedBondRiskRewards(f.rosterHash, f.assets[0])).to.equal(749n);
    expect(await f.rewardIndex.unindexedRemainder(f.rosterHash, f.assets[0])).to.equal(1n);
    expect((await f.treasury.assetLedgers(f.assets[0])).bondRiskRewardPool).to.equal(750n);
  });

  it("rejects direct index mutation by outsiders and direct checkpoint spoofing", async function () {
    const f = await fixture();
    await expect(f.rewardIndex.creditBondRisk(f.rosterHash, f.assets[0], 1n))
      .to.be.revertedWithCustomError(f.rewardIndex, "UnauthorizedTreasury");
    await expect(
      f.rewardIndex.beforeBondChange(
        f.rosterHash,
        f.memberSigners[0].address,
        f.memberSigners[0].address,
        EQUAL_BOND
      )
    ).to.be.revertedWithCustomError(f.rewardIndex, "UnauthorizedBondVault");
  });

  it("rolls fee custody and indexing back if live bond custody becomes insufficient", async function () {
    const f = await fixture();
    const settlementId = ethers.id("index-underbonded");
    await f.laneA.confirmOnly(settlementId, 1n);
    await f.tokenA.mint(f.lanes[0], 10_000n);
    await f.tokenA.confiscate(await f.bondVault.getAddress(), 1n);
    await expect(
      f.laneA.collectExisting(await f.treasury.getAddress(), f.assets[0], settlementId, 10_000n)
    ).to.be.revertedWithCustomError(f.rewardIndex, "BondsNotReady");
    expect(await f.treasury.feeSettlementConsumed(settlementId)).to.equal(false);
    expect(await f.tokenA.balanceOf(f.lanes[0])).to.equal(10_000n);
    expect((await f.treasury.assetLedgers(f.assets[0])).totalProtocolFees).to.equal(0n);
  });
});
