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
const FEE_POLICY = {
  attestorBps: 5_000n,
  safetyBps: 2_000n,
  relayerBps: 1_000n,
  operationsBps: 2_000n,
  readinessBps: 6_000n,
  participationBps: 2_500n,
  bondRiskBps: 1_500n
};
const MINIMUM_BUDGETS = [1_000n, 2_000n];
const MINIMUM_RUNWAYS = [3n, 2n];

async function fixture(treasuryOverrides = {}) {
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
  const rewardIndex = await ethers.deployContract("AttestorEpochRewardIndexV1", [
    await bondVault.getAddress(),
    predictedTreasury,
    [await tokenA.getAddress(), await tokenB.getAddress()]
  ]);
  await laneA.waitForDeployment();
  await laneB.waitForDeployment();
  await rewardIndex.waitForDeployment();
  const lanes = [await laneA.getAddress(), await laneB.getAddress()];
  const laneIds = [LANE_A_ID, LANE_B_ID];
  const assets = [await tokenA.getAddress(), await tokenB.getAddress()];
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
    bondAsset: await tokenA.getAddress(),
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
  expect(await controller.getAddress()).to.equal(predictedController);
  const treasury = await ethers.deployContract("AttestorFeeRewardTreasuryV1", [
    await controller.getAddress(),
    await rewardIndex.getAddress(),
    treasuryOverrides.assets ?? assets,
    treasuryOverrides.minimumBudgets ?? MINIMUM_BUDGETS,
    treasuryOverrides.minimumRunways ?? MINIMUM_RUNWAYS,
    treasuryOverrides.policy ?? FEE_POLICY
  ]);
  await treasury.waitForDeployment();
  expect(await treasury.getAddress()).to.equal(predictedTreasury);
  await bondVault.registerRoster(await registry.getAddress());
  return {
    signers,
    memberSigners,
    tokenA,
    tokenB,
    assets,
    bondVault,
    lanes,
    laneA,
    laneB,
    registry,
    controller,
    rewardIndex,
    treasury,
    rosterHash: await registry.rosterHash(),
    activationBlock
  };
}

async function activate(f) {
  for (const member of f.memberSigners) {
    await f.tokenA.mint(member.address, EQUAL_BOND);
    await f.tokenA.connect(member).approve(await f.bondVault.getAddress(), EQUAL_BOND);
    await f.bondVault.connect(member).postBond(f.rosterHash);
    await f.registry.connect(member).acceptRoster(f.rosterHash);
  }
  const current = BigInt(await ethers.provider.getBlockNumber());
  if (current < f.activationBlock) {
    await ethers.provider.send("hardhat_mine", [`0x${(f.activationBlock - current).toString(16)}`]);
  }
  await f.registry.activate();
}

describe("AttestorFeeRewardTreasuryV1 local fee-separation gate", function () {
  it("binds the two controller lanes to isolated fee assets and immutable illustrative policy", async function () {
    const f = await fixture();
    expect(await f.treasury.rosterHash()).to.equal(f.rosterHash);
    expect(await f.treasury.lanes(0)).to.equal(f.lanes[0]);
    expect(await f.treasury.lanes(1)).to.equal(f.lanes[1]);
    expect(await f.treasury.assets(0)).to.equal(f.assets[0]);
    expect(await f.treasury.assets(1)).to.equal(f.assets[1]);
    expect(await f.treasury.securityRunwayEpochs(f.assets[0])).to.equal(0n);
    expect(await f.treasury.securityRunwayReady(f.assets[0])).to.equal(false);
  });

  it("collects only a confirmed fee and preserves the lane principal exactly", async function () {
    const f = await fixture();
    await activate(f);
    const settlementId = ethers.id("confirmed-fee-a");
    const principal = 100_000n;
    const fee = 10_000n;
    await f.tokenA.mint(f.lanes[0], principal + fee);
    await f.laneA.settleAndCollect(
      await f.treasury.getAddress(),
      f.assets[0],
      settlementId,
      principal,
      fee
    );
    const ledger = await f.treasury.assetLedgers(f.assets[0]);
    expect(ledger.totalProtocolFees).to.equal(fee);
    expect(ledger.attestorRewardPool).to.equal(5_000n);
    expect(ledger.readinessRewardPool).to.equal(3_000n);
    expect(ledger.participationRewardPool).to.equal(1_250n);
    expect(ledger.bondRiskRewardPool).to.equal(750n);
    expect(ledger.safetyReserve).to.equal(2_000n);
    expect(ledger.relayerBudget).to.equal(1_000n);
    expect(ledger.operationsBudget).to.equal(2_000n);
    expect(await f.tokenA.balanceOf(f.lanes[0])).to.equal(principal);
    expect(await f.tokenA.balanceOf(await f.treasury.getAddress())).to.equal(fee);
    expect(await f.treasury.securityRunwayEpochs(f.assets[0])).to.equal(5n);
    expect(await f.treasury.securityRunwayReady(f.assets[0])).to.equal(true);
  });

  it("rejects outsiders, unconfirmed or foreign-lane identities, replay and zero values", async function () {
    const f = await fixture();
    await activate(f);
    await expect(f.treasury.collectConfirmedFee(ethers.id("outsider"), 1n))
      .to.be.revertedWithCustomError(f.treasury, "UnauthorizedLane");
    await expect(f.laneA.collectExisting(await f.treasury.getAddress(), f.assets[0], ethers.ZeroHash, 1n))
      .to.be.revertedWithCustomError(f.treasury, "ZeroIdentity");
    await expect(f.laneA.collectExisting(await f.treasury.getAddress(), f.assets[0], ethers.id("missing"), 1n))
      .to.be.revertedWithCustomError(f.treasury, "SettlementNotConfirmedForLane");

    const settlementId = ethers.id("lane-a-only");
    await f.laneA.confirmOnly(settlementId, 1n);
    await f.tokenA.mint(f.lanes[0], 2n);
    await f.tokenB.mint(f.lanes[1], 2n);
    await expect(f.laneB.collectExisting(await f.treasury.getAddress(), f.assets[1], settlementId, 1n))
      .to.be.revertedWithCustomError(f.treasury, "SettlementNotConfirmedForLane");
    await expect(f.laneA.collectExisting(await f.treasury.getAddress(), f.assets[0], settlementId, 0n))
      .to.be.revertedWithCustomError(f.treasury, "ZeroAmount");
    await f.laneA.collectExisting(await f.treasury.getAddress(), f.assets[0], settlementId, 1n);
    await expect(f.laneA.collectExisting(await f.treasury.getAddress(), f.assets[0], settlementId, 1n))
      .to.be.revertedWithCustomError(f.treasury, "FeeAlreadyCollected");
  });

  it("rolls the liability transition and fee collection back together when the shared cap rejects", async function () {
    const f = await fixture();
    await activate(f);
    const settlementId = ethers.id("over-cap-atomic");
    await f.tokenA.mint(f.lanes[0], 100n);
    await expect(
      f.laneA.settleAndCollect(
        await f.treasury.getAddress(),
        f.assets[0],
        settlementId,
        MAXIMUM_LIABILITY + 1n,
        100n
      )
    ).to.be.revertedWithCustomError(f.controller, "LiabilityCapExceeded");
    expect(await f.controller.settlementLane(settlementId)).to.equal(ethers.ZeroAddress);
    expect(await f.treasury.feeSettlementConsumed(settlementId)).to.equal(false);
    expect(await f.tokenA.balanceOf(f.lanes[0])).to.equal(100n);
    expect((await f.treasury.assetLedgers(f.assets[0])).totalProtocolFees).to.equal(0n);
  });

  it("keeps all integer rounding inside the isolated fee ledgers", async function () {
    const f = await fixture();
    await activate(f);
    const settlementId = ethers.id("rounding-fee");
    await f.tokenA.mint(f.lanes[0], 7n);
    await f.laneA.settleAndCollect(await f.treasury.getAddress(), f.assets[0], settlementId, 1n, 7n);
    const ledger = await f.treasury.assetLedgers(f.assets[0]);
    expect(ledger.attestorRewardPool).to.equal(3n);
    expect(ledger.readinessRewardPool).to.equal(1n);
    expect(ledger.participationRewardPool).to.equal(0n);
    expect(ledger.bondRiskRewardPool).to.equal(2n);
    expect(ledger.safetyReserve).to.equal(1n);
    expect(ledger.relayerBudget).to.equal(0n);
    expect(ledger.operationsBudget).to.equal(3n);
    expect(
      ledger.attestorRewardPool + ledger.safetyReserve + ledger.relayerBudget + ledger.operationsBudget
    ).to.equal(7n);
  });

  it("fails atomically on fee-on-transfer, false-return and callback reentrancy, but accepts exact no-return", async function () {
    const f = await fixture();
    await activate(f);
    const treasuryAddress = await f.treasury.getAddress();

    const feeSettlement = ethers.id("fee-on-transfer");
    await f.laneA.confirmOnly(feeSettlement, 1n);
    await f.tokenA.mint(f.lanes[0], 100n);
    await f.tokenA.configure(100n, 0, ethers.ZeroAddress, "0x");
    await expect(f.laneA.collectExisting(treasuryAddress, f.assets[0], feeSettlement, 100n))
      .to.be.revertedWithCustomError(f.treasury, "IncorrectReceivedAmount");
    expect(await f.treasury.feeSettlementConsumed(feeSettlement)).to.equal(false);
    expect(await f.tokenA.balanceOf(f.lanes[0])).to.equal(100n);

    await f.tokenA.configure(0n, 1, ethers.ZeroAddress, "0x");
    await expect(f.laneA.collectExisting(treasuryAddress, f.assets[0], feeSettlement, 100n))
      .to.be.revertedWithCustomError(f.treasury, "TransferFailed");

    const callback = f.treasury.interface.encodeFunctionData("collectConfirmedFee", [feeSettlement, 1n]);
    await f.tokenA.configure(0n, 0, treasuryAddress, callback);
    await expect(f.laneA.collectExisting(treasuryAddress, f.assets[0], feeSettlement, 100n))
      .to.be.revertedWithCustomError(f.treasury, "TransferFailed");
    expect(await f.treasury.feeSettlementConsumed(feeSettlement)).to.equal(false);

    await f.tokenA.configure(0n, 3, ethers.ZeroAddress, "0x");
    await f.laneA.collectExisting(treasuryAddress, f.assets[0], feeSettlement, 100n);
    expect(await f.treasury.feeSettlementConsumed(feeSettlement)).to.equal(true);
  });

  it("accepts one-way bootstrap security funds and keeps each asset runway isolated", async function () {
    const f = await fixture();
    const contributor = f.signers[8];
    await f.tokenA.mint(contributor.address, 3_000n);
    await f.tokenB.mint(contributor.address, 3_999n);
    await f.tokenA.connect(contributor).approve(await f.treasury.getAddress(), 3_000n);
    await f.tokenB.connect(contributor).approve(await f.treasury.getAddress(), 3_999n);
    await f.treasury.connect(contributor).fundBootstrapSecurity(f.assets[0], 3_000n);
    await f.treasury.connect(contributor).fundBootstrapSecurity(f.assets[1], 3_999n);
    expect(await f.treasury.securityRunwayEpochs(f.assets[0])).to.equal(3n);
    expect(await f.treasury.securityRunwayReady(f.assets[0])).to.equal(true);
    expect(await f.treasury.securityRunwayEpochs(f.assets[1])).to.equal(1n);
    expect(await f.treasury.securityRunwayReady(f.assets[1])).to.equal(false);
    await expect(f.treasury.connect(contributor).fundBootstrapSecurity(f.signers[9].address, 1n))
      .to.be.revertedWithCustomError(f.treasury, "AssetNotConfigured");
  });

  it("rejects malformed allocation, runway and duplicate-asset deployments", async function () {
    await expect(fixture({ policy: { ...FEE_POLICY, operationsBps: 1_999n } })).to.be.rejected;
    await expect(fixture({ minimumBudgets: [0n, 2_000n] })).to.be.rejected;
    const reference = await fixture();
    await expect(fixture({ assets: [reference.assets[0], reference.assets[0]] })).to.be.rejected;
  });
});
