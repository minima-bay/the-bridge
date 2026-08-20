import { expect } from "../../p4/node_modules/chai/index.js";
import { network } from "../../p4/node_modules/hardhat/dist/src/index.js";

const { ethers } = await network.create();

const EQUAL_BOND = 100_000n;
const MINIMUM_SELF_BOND = 30_000n;
const MAXIMUM_DELEGATED_BOND = 70_000n;

async function fixture() {
  const signers = await ethers.getSigners();
  const memberSigners = signers.slice(1, 8);
  const members = memberSigners.map((signer) => signer.address);
  const depositor = signers[8];
  const token = await ethers.deployContract("MockValuelessBondToken");
  const vault = await ethers.deployContract("AttestorBondVaultV1");
  const rewardIndex = await ethers.deployContract("MockAttestorRewardIndex");
  const workRecorder = await ethers.deployContract("MockAttestorWorkRecorder");
  await token.waitForDeployment();
  await vault.waitForDeployment();
  await rewardIndex.waitForDeployment();
  await workRecorder.waitForDeployment();
  const currentBlock = await ethers.provider.getBlockNumber();
  const activationBlock = BigInt(currentBlock + 100);
  const proposal = {
    bridgeId: ethers.id("VALUELESS_CANONICAL_BRIDGE_V1"),
    epoch: 1n,
    activationBlock,
    bondReadiness: await vault.getAddress(),
    rewardIndex: await rewardIndex.getAddress(),
    workRecorder: await workRecorder.getAddress(),
    bondAsset: await token.getAddress(),
    equalBondAmount: EQUAL_BOND,
    minimumSelfBondBps: 3_000n,
    individualSlashBps: 8_000n,
    mutualSlashBps: 2_000n,
    exposureCapBps: 8_000n,
    policyHash: ethers.id("DELEGATED_SECURITY_POOL_RESEARCH_POLICY_V1"),
    dossierRoot: ethers.id("RESEARCH_DOSSIERS_V1")
  };
  const registry = await ethers.deployContract("AttestorRosterRegistryV1", [proposal, members]);
  await registry.waitForDeployment();
  const rosterHash = await registry.rosterHash();
  await vault.registerRoster(await registry.getAddress());
  return { signers, memberSigners, members, depositor, token, vault, registry, rosterHash, activationBlock };
}

async function fundAndApprove(f, signer, amount) {
  await f.token.mint(signer.address, amount);
  await f.token.connect(signer).approve(await f.vault.getAddress(), amount);
}

async function contribute(f, contributor, member, amount) {
  await fundAndApprove(f, contributor, amount);
  await f.vault.connect(contributor).contributeBond(f.rosterHash, member.address, amount);
}

describe("AttestorBondVaultV1 open delegated-security accounting", function () {
  it("lets a public depositor back one chosen attestor while preserving the self-bond floor", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await contribute(f, f.depositor, member, MAXIMUM_DELEGATED_BOND);
    expect(await f.vault.memberReady(f.rosterHash, member.address)).to.equal(false);
    await contribute(f, member, member, MINIMUM_SELF_BOND);
    expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(EQUAL_BOND);
    expect(await f.vault.selfBond(f.rosterHash, member.address)).to.equal(MINIMUM_SELF_BOND);
    expect(await f.vault.delegatedBond(f.rosterHash, member.address)).to.equal(MAXIMUM_DELEGATED_BOND);
    expect(await f.vault.contributorBond(f.rosterHash, member.address, f.depositor.address))
      .to.equal(MAXIMUM_DELEGATED_BOND);
    expect(await f.vault.memberReady(f.rosterHash, member.address)).to.equal(true);
  });

  it("reserves the minimum self-bond capacity and rejects excess delegation atomically", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await contribute(f, f.depositor, member, MAXIMUM_DELEGATED_BOND);
    const secondDepositor = f.signers[9];
    await fundAndApprove(f, secondDepositor, 1n);
    await expect(f.vault.connect(secondDepositor).contributeBond(f.rosterHash, member.address, 1n))
      .to.be.revertedWithCustomError(f.vault, "DelegatedCapacityExceeded")
      .withArgs(MAXIMUM_DELEGATED_BOND + 1n, MAXIMUM_DELEGATED_BOND);
    expect(await f.token.balanceOf(secondDepositor.address)).to.equal(1n);
    expect(await f.vault.contributorBond(f.rosterHash, member.address, secondDepositor.address)).to.equal(0n);
  });

  it("does not count an almost-complete pool until the attestor finishes the self-bond", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await contribute(f, f.depositor, member, MAXIMUM_DELEGATED_BOND);
    await contribute(f, member, member, MINIMUM_SELF_BOND - 1n);
    expect(await f.vault.postedBond(f.rosterHash, member.address)).to.equal(EQUAL_BOND - 1n);
    expect(await f.vault.memberReady(f.rosterHash, member.address)).to.equal(false);
    expect((await f.vault.epochBonds(f.rosterHash)).postedCount).to.equal(0n);
    await contribute(f, member, member, 1n);
    expect(await f.vault.memberReady(f.rosterHash, member.address)).to.equal(true);
    expect((await f.vault.epochBonds(f.rosterHash)).postedCount).to.equal(1n);
  });

  it("activates only after every attestor pool has its full bond and minimum self-bond", async function () {
    const f = await fixture();
    await fundAndApprove(f, f.depositor, MAXIMUM_DELEGATED_BOND * 7n);
    for (const member of f.memberSigners) {
      await f.vault.connect(f.depositor).contributeBond(f.rosterHash, member.address, MAXIMUM_DELEGATED_BOND);
      await contribute(f, member, member, MINIMUM_SELF_BOND);
      await f.registry.connect(member).acceptRoster(f.rosterHash);
    }
    expect(await f.vault.allBondsPosted(f.rosterHash)).to.equal(true);
    const current = BigInt(await ethers.provider.getBlockNumber());
    if (current < f.activationBlock) {
      await ethers.provider.send("hardhat_mine", [`0x${(f.activationBlock - current).toString(16)}`]);
    }
    await f.registry.activate();
    expect(await f.registry.active()).to.equal(true);
  });

  it("rejects zero contributions, nonmember targets and member overfunding", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await expect(f.vault.connect(f.depositor).contributeBond(f.rosterHash, member.address, 0n))
      .to.be.revertedWithCustomError(f.vault, "ZeroContribution");
    await expect(f.vault.connect(f.depositor).contributeBond(f.rosterHash, f.signers[9].address, 1n))
      .to.be.revertedWithCustomError(f.vault, "NotRosterMember");
    await contribute(f, member, member, EQUAL_BOND);
    await fundAndApprove(f, f.depositor, 1n);
    await expect(f.vault.connect(f.depositor).contributeBond(f.rosterHash, member.address, 1n))
      .to.be.revertedWithCustomError(f.vault, "MemberBondCapacityExceeded")
      .withArgs(EQUAL_BOND + 1n, EQUAL_BOND);
  });

  it("applies exact balance-delta and reentrancy protection to public contributions", async function () {
    const f = await fixture();
    const member = f.memberSigners[0];
    await fundAndApprove(f, f.depositor, MAXIMUM_DELEGATED_BOND);
    await f.token.configure(100n, 0, ethers.ZeroAddress, "0x");
    await expect(
      f.vault.connect(f.depositor).contributeBond(f.rosterHash, member.address, MAXIMUM_DELEGATED_BOND)
    ).to.be.revertedWithCustomError(f.vault, "IncorrectReceivedAmount");
    expect(await f.vault.delegatedBond(f.rosterHash, member.address)).to.equal(0n);

    const callback = f.vault.interface.encodeFunctionData("contributeBond", [f.rosterHash, member.address, 1n]);
    await f.token.configure(0, 0, await f.vault.getAddress(), callback);
    await expect(
      f.vault.connect(f.depositor).contributeBond(f.rosterHash, member.address, MAXIMUM_DELEGATED_BOND)
    ).to.be.revertedWithCustomError(f.vault, "TransferFailed");
    expect(await f.vault.delegatedBond(f.rosterHash, member.address)).to.equal(0n);
    expect(await f.token.balanceOf(f.depositor.address)).to.equal(MAXIMUM_DELEGATED_BOND);
  });
});
