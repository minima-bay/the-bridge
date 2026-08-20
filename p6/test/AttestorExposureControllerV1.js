import { expect } from "../../p4/node_modules/chai/index.js";
import { network } from "../../p4/node_modules/hardhat/dist/src/index.js";

const { ethers } = await network.create();

const BRIDGE_ID = ethers.id("VALUELESS_CANONICAL_BRIDGE_V1");
const DOSSIER_ROOT = ethers.id("RESEARCH_DOSSIERS_V1");
const POLICY_DOMAIN = ethers.id("CANONICAL_BRIDGE_EXPOSURE_POLICY_V1");
const LANE_A_ID = ethers.id("VALUELESS_USDTM_LANE_V1");
const LANE_B_ID = ethers.id("VALUELESS_ETHM_LANE_V1");
const EQUAL_BOND = 100_000n;
const MAXIMUM_LIABILITY = 400_000n;

async function fixture() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const memberSigners = signers.slice(1, 8);
  const members = memberSigners.map((signer) => signer.address);
  const token = await ethers.deployContract("MockValuelessBondToken");
  const bondVault = await ethers.deployContract("AttestorBondVaultV1");
  const rewardIndex = await ethers.deployContract("MockAttestorRewardIndex");
  const workRecorder = await ethers.deployContract("MockAttestorWorkRecorder");
  await token.waitForDeployment();
  await bondVault.waitForDeployment();
  await rewardIndex.waitForDeployment();
  await workRecorder.waitForDeployment();

  const nextNonce = await ethers.provider.getTransactionCount(deployer.address);
  const predictedController = ethers.getCreateAddress({ from: deployer.address, nonce: nextNonce + 3 });
  const laneA = await ethers.deployContract("MockExposureLane", [predictedController, LANE_A_ID]);
  const laneB = await ethers.deployContract("MockExposureLane", [predictedController, LANE_B_ID]);
  await laneA.waitForDeployment();
  await laneB.waitForDeployment();
  const laneAddresses = [await laneA.getAddress(), await laneB.getAddress()];
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
        laneAddresses,
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
    bondAsset: await token.getAddress(),
    equalBondAmount: EQUAL_BOND,
    minimumSelfBondBps: 3_000n,
    individualSlashBps: 8_000n,
    mutualSlashBps: 2_000n,
    exposureCapBps: 8_000n,
    policyHash,
    dossierRoot: DOSSIER_ROOT
  };
  const registry = await ethers.deployContract("AttestorRosterRegistryV1", [proposal, members]);
  await registry.waitForDeployment();
  const controller = await ethers.deployContract("AttestorExposureControllerV1", [
    await registry.getAddress(),
    await bondVault.getAddress(),
    laneAddresses,
    laneIds
  ]);
  await controller.waitForDeployment();
  expect(await controller.getAddress()).to.equal(predictedController);
  await bondVault.registerRoster(await registry.getAddress());
  return {
    signers,
    memberSigners,
    token,
    bondVault,
    laneA,
    laneB,
    laneAddresses,
    laneIds,
    registry,
    controller,
    rosterHash: await registry.rosterHash(),
    activationBlock
  };
}

async function activate(f) {
  for (const member of f.memberSigners) {
    await f.token.mint(member.address, EQUAL_BOND);
    await f.token.connect(member).approve(await f.bondVault.getAddress(), EQUAL_BOND);
    await f.bondVault.connect(member).postBond(f.rosterHash);
    await f.registry.connect(member).acceptRoster(f.rosterHash);
  }
  const current = BigInt(await ethers.provider.getBlockNumber());
  if (current < f.activationBlock) {
    await ethers.provider.send("hardhat_mine", [`0x${(f.activationBlock - current).toString(16)}`]);
  }
  await f.registry.activate();
}

describe("AttestorExposureControllerV1 local aggregate-cap gate", function () {
  it("binds two ordered lanes and derives one discounted quorum-bond cap", async function () {
    const f = await fixture();
    expect(await f.controller.rosterHash()).to.equal(f.rosterHash);
    expect(await f.controller.maximumAggregateLiability()).to.equal(MAXIMUM_LIABILITY);
    expect(await f.controller.lanes(0)).to.equal(f.laneAddresses[0]);
    expect(await f.controller.lanes(1)).to.equal(f.laneAddresses[1]);
    expect(await f.controller.laneIds(0)).to.equal(LANE_A_ID);
    expect(await f.controller.laneIds(1)).to.equal(LANE_B_ID);
    expect(await f.controller.authorizedLane(f.laneAddresses[0])).to.equal(true);
    expect(await f.controller.authorizedLane(f.laneAddresses[1])).to.equal(true);
  });

  it("rejects another controller deployment because its address is outside the committed policy", async function () {
    const f = await fixture();
    await expect(
      ethers.deployContract("AttestorExposureControllerV1", [
        await f.registry.getAddress(),
        await f.bondVault.getAddress(),
        f.laneAddresses,
        f.laneIds
      ])
    ).to.be.rejected;
  });

  it("rejects outsiders, zero identities, zero amounts and inactive-roster increases", async function () {
    const f = await fixture();
    await expect(f.controller.increaseLiability(ethers.id("direct"), 1n))
      .to.be.revertedWithCustomError(f.controller, "UnauthorizedLane");
    await expect(f.laneA.increase(ethers.ZeroHash, 1n))
      .to.be.revertedWithCustomError(f.controller, "ZeroIdentity");
    await expect(f.laneA.increase(ethers.id("zero"), 0n))
      .to.be.revertedWithCustomError(f.controller, "ZeroAmount");
    await expect(f.laneA.increase(ethers.id("inactive"), 1n))
      .to.be.revertedWithCustomError(f.controller, "RosterInactive");
  });

  it("shares one cap across both lanes and blocks cross-lane settlement replay", async function () {
    const f = await fixture();
    await activate(f);
    const first = ethers.id("settlement-first");
    await f.laneA.increase(first, 250_000n);
    await expect(f.laneB.increase(first, 1n))
      .to.be.revertedWithCustomError(f.controller, "SettlementAlreadyConsumed");
    await f.laneB.increase(ethers.id("settlement-second"), 150_000n);
    expect(await f.controller.laneLiability(LANE_A_ID)).to.equal(250_000n);
    expect(await f.controller.laneLiability(LANE_B_ID)).to.equal(150_000n);
    expect(await f.controller.totalLiability()).to.equal(MAXIMUM_LIABILITY);
    await expect(f.laneA.increase(ethers.id("over-cap"), 1n))
      .to.be.revertedWithCustomError(f.controller, "LiabilityCapExceeded")
      .withArgs(MAXIMUM_LIABILITY + 1n, MAXIMUM_LIABILITY);
  });

  it("releases liability without requiring active security and opens shared capacity", async function () {
    const f = await fixture();
    await activate(f);
    await f.laneA.increase(ethers.id("a-one"), 300_000n);
    await f.laneB.increase(ethers.id("b-one"), 100_000n);
    await f.token.confiscate(await f.bondVault.getAddress(), 1n);
    await expect(f.laneA.increase(ethers.id("blocked-underbonded"), 1n))
      .to.be.revertedWithCustomError(f.controller, "BondsNotReady");
    await f.laneA.release(ethers.id("release-a"), 50_000n);
    expect(await f.controller.totalLiability()).to.equal(350_000n);
    await f.token.mint(await f.bondVault.getAddress(), 1n);
    await f.laneB.increase(ethers.id("b-two"), 50_000n);
    expect(await f.controller.totalLiability()).to.equal(MAXIMUM_LIABILITY);
  });

  it("rejects duplicate, zero and oversized releases without changing accounting", async function () {
    const f = await fixture();
    await activate(f);
    await f.laneA.increase(ethers.id("liability"), 100_000n);
    await expect(f.laneA.release(ethers.ZeroHash, 1n))
      .to.be.revertedWithCustomError(f.controller, "ZeroIdentity");
    await expect(f.laneA.release(ethers.id("zero-release"), 0n))
      .to.be.revertedWithCustomError(f.controller, "ZeroAmount");
    await expect(f.laneA.release(ethers.id("too-much"), 100_001n))
      .to.be.revertedWithCustomError(f.controller, "ReleaseExceedsLaneLiability")
      .withArgs(100_001n, 100_000n);
    const resolution = ethers.id("valid-release");
    await f.laneA.release(resolution, 40_000n);
    await expect(f.laneA.release(resolution, 1n))
      .to.be.revertedWithCustomError(f.controller, "ResolutionAlreadyConsumed");
    expect(await f.controller.laneLiability(LANE_A_ID)).to.equal(60_000n);
    expect(await f.controller.totalLiability()).to.equal(60_000n);
  });

  it("does not allow one lane to release another lane's liability", async function () {
    const f = await fixture();
    await activate(f);
    await f.laneA.increase(ethers.id("lane-a-only"), 75_000n);
    await expect(f.laneB.release(ethers.id("foreign-release"), 1n))
      .to.be.revertedWithCustomError(f.controller, "ReleaseExceedsLaneLiability")
      .withArgs(1n, 0n);
    expect(await f.controller.totalLiability()).to.equal(75_000n);
  });
});
