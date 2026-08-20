import { expect } from "../../p4/node_modules/chai/index.js";
import { network } from "../../p4/node_modules/hardhat/dist/src/index.js";

const { ethers } = await network.create();

const BRIDGE_ID = ethers.id("VALUELESS_CANONICAL_BRIDGE_V1");
const POLICY_HASH = ethers.id("RESEARCH_POLICY_V1");
const DOSSIER_ROOT = ethers.id("RESEARCH_DOSSIERS_V1");
const EPOCH = 1n;
const EQUAL_BOND = 100_000n;
const MINIMUM_SELF_BOND_BPS = 3_000n;
const INDIVIDUAL_SLASH_BPS = 8_000n;
const MUTUAL_SLASH_BPS = 2_000n;
const EXPOSURE_CAP_BPS = 8_000n;

async function fixture(overrides = {}) {
  const signers = await ethers.getSigners();
  const memberSigners = signers.slice(1, 8);
  const members = overrides.members ?? memberSigners.map((signer) => signer.address);
  const currentBlock = await ethers.provider.getBlockNumber();
  const activationBlock = overrides.activationBlock ?? BigInt(currentBlock + 50);
  const bondReadiness = await ethers.deployContract("MockAttestorBondReadiness");
  const rewardIndex = await ethers.deployContract("MockAttestorRewardIndex");
  const workRecorder = await ethers.deployContract("MockAttestorWorkRecorder");
  await bondReadiness.waitForDeployment();
  await rewardIndex.waitForDeployment();
  await workRecorder.waitForDeployment();
  const proposal = {
    bridgeId: overrides.bridgeId ?? BRIDGE_ID,
    epoch: overrides.epoch ?? EPOCH,
    activationBlock,
    bondReadiness: overrides.bondReadiness ?? await bondReadiness.getAddress(),
    rewardIndex: overrides.rewardIndex ?? await rewardIndex.getAddress(),
    workRecorder: overrides.workRecorder ?? await workRecorder.getAddress(),
    bondAsset: overrides.bondAsset ?? signers[8].address,
    equalBondAmount: overrides.equalBondAmount ?? EQUAL_BOND,
    minimumSelfBondBps: overrides.minimumSelfBondBps ?? MINIMUM_SELF_BOND_BPS,
    individualSlashBps: overrides.individualSlashBps ?? INDIVIDUAL_SLASH_BPS,
    mutualSlashBps: overrides.mutualSlashBps ?? MUTUAL_SLASH_BPS,
    exposureCapBps: overrides.exposureCapBps ?? EXPOSURE_CAP_BPS,
    policyHash: overrides.policyHash ?? POLICY_HASH,
    dossierRoot: overrides.dossierRoot ?? DOSSIER_ROOT
  };
  const registry = await ethers.deployContract("AttestorRosterRegistryV1", [proposal, members]);
  await registry.waitForDeployment();
  return { registry, bondReadiness, rewardIndex, workRecorder, signers, memberSigners, members, activationBlock, proposal };
}

async function acceptAll(registry, memberSigners) {
  const rosterHash = await registry.rosterHash();
  for (const signer of memberSigners) await registry.connect(signer).acceptRoster(rosterHash);
}

async function mineTo(target) {
  const current = BigInt(await ethers.provider.getBlockNumber());
  if (current >= target) return;
  const count = target - current;
  await ethers.provider.send("hardhat_mine", [`0x${count.toString(16)}`]);
}

describe("AttestorRosterRegistryV1 local research gate", function () {
  it("pins seven unique members, quorum five and the full economic proposal", async function () {
    const { registry, bondReadiness, rewardIndex, workRecorder, members, activationBlock, signers } = await fixture();
    expect(await registry.MEMBER_COUNT()).to.equal(7n);
    expect(await registry.QUORUM()).to.equal(5n);
    expect(await registry.bridgeId()).to.equal(BRIDGE_ID);
    expect(await registry.epoch()).to.equal(EPOCH);
    expect(await registry.activationBlock()).to.equal(activationBlock);
    expect(await registry.bondReadiness()).to.equal(await bondReadiness.getAddress());
    expect(await registry.rewardIndex()).to.equal(await rewardIndex.getAddress());
    expect(await registry.workRecorder()).to.equal(await workRecorder.getAddress());
    expect(await registry.bondAsset()).to.equal(signers[8].address);
    expect(await registry.equalBondAmount()).to.equal(EQUAL_BOND);
    expect(await registry.minimumSelfBondBps()).to.equal(MINIMUM_SELF_BOND_BPS);
    expect(await registry.individualSlashBps()).to.equal(INDIVIDUAL_SLASH_BPS);
    expect(await registry.mutualSlashBps()).to.equal(MUTUAL_SLASH_BPS);
    expect(await registry.exposureCapBps()).to.equal(EXPOSURE_CAP_BPS);
    expect(await registry.policyHash()).to.equal(POLICY_HASH);
    expect(await registry.dossierRoot()).to.equal(DOSSIER_ROOT);
    for (let i = 0; i < members.length; i += 1) {
      expect(await registry.members(i)).to.equal(members[i]);
      expect(await registry.isMember(members[i])).to.equal(true);
    }
    expect(await registry.active()).to.equal(false);
    expect(await registry.acceptedCount()).to.equal(0n);
  });

  it("rejects zero and duplicate candidates", async function () {
    const signers = await ethers.getSigners();
    const valid = signers.slice(1, 8).map((signer) => signer.address);
    const zero = [...valid];
    zero[3] = ethers.ZeroAddress;
    await expect(fixture({ members: zero })).to.be.rejected;
    const duplicate = [...valid];
    duplicate[6] = duplicate[0];
    await expect(fixture({ members: duplicate })).to.be.rejected;
  });

  it("rejects invalid identity, timing and economic commitments", async function () {
    const current = await ethers.provider.getBlockNumber();
    const cases = [
      { bridgeId: ethers.ZeroHash },
      { epoch: 0n },
      { activationBlock: BigInt(current) },
      { bondReadiness: ethers.ZeroAddress },
      { rewardIndex: ethers.ZeroAddress },
      { workRecorder: ethers.ZeroAddress },
      { bondAsset: ethers.ZeroAddress },
      { equalBondAmount: 0n },
      { minimumSelfBondBps: 0n },
      { minimumSelfBondBps: 10_001n },
      { individualSlashBps: 0n },
      { mutualSlashBps: 0n },
      { individualSlashBps: 7_000n, mutualSlashBps: 2_000n },
      { individualSlashBps: 8_000n, mutualSlashBps: 3_000n },
      { exposureCapBps: 0n },
      { exposureCapBps: 10_001n },
      { policyHash: ethers.ZeroHash },
      { dossierRoot: ethers.ZeroHash }
    ];
    for (const item of cases) await expect(fixture(item)).to.be.rejected;
  });

  it("allows only a member accepting the exact roster once", async function () {
    const { registry, memberSigners, signers } = await fixture();
    const rosterHash = await registry.rosterHash();
    await expect(registry.connect(signers[9]).acceptRoster(rosterHash))
      .to.be.revertedWithCustomError(registry, "NotMember");
    await expect(registry.connect(memberSigners[0]).acceptRoster(ethers.id("wrong")))
      .to.be.revertedWithCustomError(registry, "WrongRosterHash");
    await expect(registry.connect(memberSigners[0]).acceptRoster(rosterHash))
      .to.emit(registry, "RosterAccepted")
      .withArgs(memberSigners[0].address, rosterHash, 1n);
    await expect(registry.connect(memberSigners[0]).acceptRoster(rosterHash))
      .to.be.revertedWithCustomError(registry, "AlreadyAccepted");
  });

  it("lets any candidate opt out before activation and blocks incomplete activation", async function () {
    const { registry, bondReadiness, memberSigners, activationBlock } = await fixture();
    const rosterHash = await registry.rosterHash();
    await registry.connect(memberSigners[0]).acceptRoster(rosterHash);
    await expect(registry.connect(memberSigners[0]).withdrawAcceptance())
      .to.emit(registry, "AcceptanceWithdrawn")
      .withArgs(memberSigners[0].address, rosterHash, 0n);
    await expect(registry.connect(memberSigners[0]).withdrawAcceptance())
      .to.be.revertedWithCustomError(registry, "NotAccepted");
    await mineTo(activationBlock);
    await expect(registry.activate())
      .to.be.revertedWithCustomError(registry, "AcceptanceIncomplete")
      .withArgs(0n, 7n);
  });

  it("requires both unanimous acceptance and the activation delay", async function () {
    const { registry, bondReadiness, memberSigners, activationBlock } = await fixture();
    await acceptAll(registry, memberSigners);
    expect(await registry.acceptedCount()).to.equal(7n);
    await expect(registry.activate()).to.be.revertedWithCustomError(registry, "ActivationTooEarly");
    await mineTo(activationBlock);
    await expect(registry.activate()).to.be.revertedWithCustomError(registry, "BondsNotReady");
    await bondReadiness.setAllBondsPosted(await registry.rosterHash(), true);
    await expect(registry.activate())
      .to.emit(registry, "RosterActivated")
      .withArgs(await registry.rosterHash(), EPOCH, activationBlock);
    expect(await registry.active()).to.equal(true);
    await expect(registry.activate()).to.be.revertedWithCustomError(registry, "AlreadyActive");
    await expect(registry.connect(memberSigners[0]).withdrawAcceptance())
      .to.be.revertedWithCustomError(registry, "AlreadyActive");
  });

  it("commits ordering, contract address and chain context into the roster hash", async function () {
    const first = await fixture();
    const reordered = [...first.members];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    const second = await fixture({ members: reordered });
    const third = await fixture();
    expect(await first.registry.rosterHash()).to.not.equal(await second.registry.rosterHash());
    expect(await first.registry.rosterHash()).to.not.equal(await third.registry.rosterHash());
  });
});
