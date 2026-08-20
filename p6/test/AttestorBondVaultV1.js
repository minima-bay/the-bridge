import { expect } from "../../p4/node_modules/chai/index.js";
import { network } from "../../p4/node_modules/hardhat/dist/src/index.js";

const { ethers } = await network.create();

const BRIDGE_ID = ethers.id("VALUELESS_CANONICAL_BRIDGE_V1");
const POLICY_HASH = ethers.id("RESEARCH_POLICY_V1");
const DOSSIER_ROOT = ethers.id("RESEARCH_DOSSIERS_V1");
const EQUAL_BOND = 100_000n;
const INDIVIDUAL_BPS = 8_000n;
const MUTUAL_BPS = 2_000n;

async function fixture(options = {}) {
  const signers = await ethers.getSigners();
  const memberSigners = signers.slice(1, 8);
  const members = memberSigners.map((signer) => signer.address);
  const token = await ethers.deployContract("MockValuelessBondToken");
  const vault = await ethers.deployContract("AttestorBondVaultV1");
  const rewardIndex = await ethers.deployContract("MockAttestorRewardIndex");
  const workRecorder = await ethers.deployContract("MockAttestorWorkRecorder");
  await token.waitForDeployment();
  await vault.waitForDeployment();
  await rewardIndex.waitForDeployment();
  await workRecorder.waitForDeployment();
  let readinessAddress = await vault.getAddress();
  let mockReadiness;
  if (options.foreignReadiness) {
    mockReadiness = await ethers.deployContract("MockAttestorBondReadiness");
    await mockReadiness.waitForDeployment();
    readinessAddress = await mockReadiness.getAddress();
  }
  const currentBlock = await ethers.provider.getBlockNumber();
  const activationBlock = BigInt(currentBlock + 100);
  const proposal = {
    bridgeId: BRIDGE_ID,
    epoch: 1n,
    activationBlock,
    bondReadiness: readinessAddress,
    rewardIndex: await rewardIndex.getAddress(),
    workRecorder: await workRecorder.getAddress(),
    bondAsset: await token.getAddress(),
    equalBondAmount: EQUAL_BOND,
    minimumSelfBondBps: 3_000n,
    individualSlashBps: INDIVIDUAL_BPS,
    mutualSlashBps: MUTUAL_BPS,
    exposureCapBps: 8_000n,
    policyHash: POLICY_HASH,
    dossierRoot: DOSSIER_ROOT
  };
  const registry = await ethers.deployContract("AttestorRosterRegistryV1", [proposal, members]);
  await registry.waitForDeployment();
  const rosterHash = await registry.rosterHash();
  if (options.register !== false && !options.foreignReadiness) await vault.registerRoster(await registry.getAddress());
  return {
    signers,
    memberSigners,
    members,
    token,
    vault,
    rewardIndex,
    registry,
    mockReadiness,
    rosterHash,
    activationBlock
  };
}

async function fundAndApprove(token, vault, signer, amount = EQUAL_BOND) {
  await token.mint(signer.address, amount);
  await token.connect(signer).approve(await vault.getAddress(), amount);
}

async function postAll(f) {
  for (const signer of f.memberSigners) {
    await fundAndApprove(f.token, f.vault, signer);
    await f.vault.connect(signer).postBond(f.rosterHash);
  }
}

async function acceptAll(f) {
  for (const signer of f.memberSigners) await f.registry.connect(signer).acceptRoster(f.rosterHash);
}

async function mineTo(target) {
  const current = BigInt(await ethers.provider.getBlockNumber());
  if (current < target) await ethers.provider.send("hardhat_mine", [`0x${(target - current).toString(16)}`]);
}

describe("AttestorBondVaultV1 local custody gate", function () {
  it("registers only the self-consistent roster and partitions the full equal bond", async function () {
    const f = await fixture({ register: false });
    await expect(f.vault.registerRoster(f.signers[9].address))
      .to.be.revertedWithCustomError(f.vault, "InvalidRegistry");
    await expect(f.vault.registerRoster(await f.registry.getAddress()))
      .to.emit(f.vault, "RosterRegistered")
      .withArgs(
        f.rosterHash,
        await f.registry.getAddress(),
        await f.token.getAddress(),
        EQUAL_BOND,
        30_000n,
        80_000n,
        20_000n
      );
    const config = await f.vault.epochBonds(f.rosterHash);
    expect(config.registry).to.equal(await f.registry.getAddress());
    expect(config.asset).to.equal(await f.token.getAddress());
    expect(config.equalBondAmount).to.equal(EQUAL_BOND);
    expect(config.minimumSelfBondAmount).to.equal(30_000n);
    expect(config.individualTrancheAmount).to.equal(80_000n);
    expect(config.mutualTrancheAmount).to.equal(20_000n);
    expect(config.individualTrancheAmount + config.mutualTrancheAmount).to.equal(EQUAL_BOND);
    await expect(f.vault.registerRoster(await f.registry.getAddress()))
      .to.be.revertedWithCustomError(f.vault, "RosterAlreadyRegistered");
  });

  it("rejects a roster committed to another readiness contract", async function () {
    const f = await fixture({ register: false, foreignReadiness: true });
    await expect(f.vault.registerRoster(await f.registry.getAddress()))
      .to.be.revertedWithCustomError(f.vault, "WrongReadinessContract");
  });

  it("accepts one exact bond from a member and rejects outsiders and duplicates", async function () {
    const f = await fixture();
    await expect(f.vault.connect(f.signers[9]).postBond(f.rosterHash))
      .to.be.revertedWithCustomError(f.vault, "NotRosterMember");
    const member = f.memberSigners[0];
    await fundAndApprove(f.token, f.vault, member);
    await expect(f.vault.connect(member).postBond(f.rosterHash))
      .to.emit(f.vault, "BondPosted")
      .withArgs(f.rosterHash, member.address, EQUAL_BOND, 1n, EQUAL_BOND);
    expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(EQUAL_BOND);
    expect(await f.token.balanceOf(await f.vault.getAddress())).to.equal(EQUAL_BOND);
    await expect(f.vault.connect(member).postBond(f.rosterHash))
      .to.be.revertedWithCustomError(f.vault, "BondAlreadyPosted");
  });

  it("reports readiness only after all seven exact bonds and then permits roster activation", async function () {
    const f = await fixture();
    await acceptAll(f);
    await postAll(f);
    expect(await f.vault.allBondsPosted(f.rosterHash)).to.equal(true);
    const config = await f.vault.epochBonds(f.rosterHash);
    expect(config.postedCount).to.equal(7n);
    expect(config.totalBonded).to.equal(EQUAL_BOND * 7n);
    expect(await f.vault.requiredCustodyByAsset(await f.token.getAddress())).to.equal(EQUAL_BOND * 7n);
    await f.token.confiscate(await f.vault.getAddress(), 1n);
    expect(await f.vault.allBondsPosted(f.rosterHash)).to.equal(false);
    await f.token.mint(await f.vault.getAddress(), 1n);
    expect(await f.vault.allBondsPosted(f.rosterHash)).to.equal(true);
    await mineTo(f.activationBlock);
    await expect(f.registry.activate()).to.emit(f.registry, "RosterActivated");
    expect(await f.registry.active()).to.equal(true);
  });

  it("rejects fee-on-transfer bonds atomically and ignores unsolicited balances", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await f.token.mint(await f.vault.getAddress(), 11n);
    await fundAndApprove(f.token, f.vault, member);
    await f.token.configure(100n, 0, ethers.ZeroAddress, "0x");
    await expect(f.vault.connect(member).postBond(f.rosterHash))
      .to.be.revertedWithCustomError(f.vault, "IncorrectReceivedAmount")
      .withArgs(EQUAL_BOND, 99_000n);
    expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(0n);
    expect((await f.vault.epochBonds(f.rosterHash)).postedCount).to.equal(0n);
    expect(await f.token.balanceOf(member.address)).to.equal(EQUAL_BOND);
    expect(await f.token.balanceOf(await f.vault.getAddress())).to.equal(11n);
  });

  it("fails closed on false and reverting token responses without accounting a bond", async function () {
    for (const behavior of [1, 2]) {
      const f = await fixture();
      const member = f.memberSigners[0];
      await fundAndApprove(f.token, f.vault, member);
      await f.token.configure(0, behavior, ethers.ZeroAddress, "0x");
      await expect(f.vault.connect(member).postBond(f.rosterHash))
        .to.be.revertedWithCustomError(f.vault, "TransferFailed");
      expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(0n);
      expect(await f.token.balanceOf(member.address)).to.equal(EQUAL_BOND);
      expect(await f.token.balanceOf(await f.vault.getAddress())).to.equal(0n);
    }
  });

  it("accepts a standard no-return token response only when the exact balance delta arrives", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await fundAndApprove(f.token, f.vault, member);
    await f.token.configure(0, 3, ethers.ZeroAddress, "0x");
    await f.vault.connect(member).postBond(f.rosterHash);
    expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(EQUAL_BOND);
    expect(await f.token.balanceOf(await f.vault.getAddress())).to.equal(EQUAL_BOND);
  });

  it("blocks token-callback reentrancy and rolls the complete attempted bond back", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await fundAndApprove(f.token, f.vault, member);
    const callback = f.vault.interface.encodeFunctionData("postBond", [f.rosterHash]);
    await f.token.configure(0, 0, await f.vault.getAddress(), callback);
    await expect(f.vault.connect(member).postBond(f.rosterHash))
      .to.be.revertedWithCustomError(f.vault, "TransferFailed");
    expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(0n);
    expect((await f.vault.epochBonds(f.rosterHash)).postedCount).to.equal(0n);
    expect(await f.token.balanceOf(member.address)).to.equal(EQUAL_BOND);
    expect(await f.token.balanceOf(await f.vault.getAddress())).to.equal(0n);
  });
});
