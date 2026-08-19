import { expect } from "chai";
import { network } from "hardhat";
import { readFileSync } from "node:fs";

const { ethers } = await network.create();

const FIXED_SUPPLY = 1_000_000n;
const EPOCH = 1n;
const NETWORK_ID = ethers.id("MINIMA_MAINNET");
const BRIDGE_ID = ethers.id("VALUELESS_USDTM_BRIDGE_V1");
const TOKEN_ID = ethers.id("VALUELESS_USDTM_TOKEN_V1");
const RESERVE_COMMITMENT = ethers.id("VALUELESS_USDTM_RESERVE_V1");

async function deployFixture() {
  const [deployer, depositor, refundRecipient, redemptionRecipient] = await ethers.getSigners();
  const token = await ethers.deployContract("MockUSDT6");
  const verifier = await ethers.deployContract("MockMinimaProofVerifier");
  await token.waitForDeployment();
  await verifier.waitForDeployment();
  const vault = await ethers.deployContract("USDTmVaultV1", [
    await token.getAddress(),
    await verifier.getAddress(),
    NETWORK_ID,
    BRIDGE_ID,
    TOKEN_ID,
    RESERVE_COMMITMENT,
    EPOCH,
    FIXED_SUPPLY
  ]);
  await vault.waitForDeployment();
  return { deployer, depositor, refundRecipient, redemptionRecipient, token, verifier, vault };
}

async function accept(fixture, amount = 100n, suffix = "one") {
  const { depositor, refundRecipient, token, vault } = fixture;
  const messageId = ethers.id(`message-${suffix}`);
  const minimaRecipient = ethers.id(`minima-recipient-${suffix}`);
  const authority = ethers.id(`cancellation-authority-${suffix}`);
  await token.mint(depositor.address, amount);
  await token.connect(depositor).approve(await vault.getAddress(), amount);
  const recordId = await vault.recordIdFor(messageId);
  await vault.connect(depositor).acceptDeposit(
    messageId,
    amount,
    minimaRecipient,
    refundRecipient.address,
    authority
  );
  return { recordId, messageId, minimaRecipient, authority, amount };
}

async function setCancellation(fixture, accepted, proof, overrides = {}) {
  const { verifier, refundRecipient, vault } = fixture;
  const value = [
    overrides.recordId ?? accepted.recordId,
    overrides.messageId ?? accepted.messageId,
    overrides.amount ?? accepted.amount,
    overrides.recipient ?? refundRecipient.address,
    overrides.runtimeIdentity ?? await vault.runtimeIdentity(),
    overrides.settled ?? true
  ];
  await verifier.setCancellation(ethers.keccak256(proof), value);
}

async function setRedemption(fixture, proof, overrides = {}) {
  const { verifier, redemptionRecipient, vault } = fixture;
  const value = [
    overrides.redemptionId ?? ethers.id("redemption-one"),
    overrides.amount ?? 40n,
    overrides.recipient ?? redemptionRecipient.address,
    overrides.runtimeIdentity ?? await vault.runtimeIdentity(),
    overrides.settled ?? true
  ];
  await verifier.setRedemption(ethers.keccak256(proof), value);
  return value;
}

async function stateSnapshot(fixture, recordId, redemptionId) {
  const { token, vault, refundRecipient, redemptionRecipient } = fixture;
  const record = recordId === undefined ? undefined : await vault.deposits(recordId);
  return {
    record: record === undefined ? undefined : Array.from(record),
    accepted: await vault.cumulativeAcceptedAtoms(),
    refunded: await vault.cumulativeRefundedAtoms(),
    paid: await vault.cumulativePaidRedemptionAtoms(),
    payoutRecordCount: await vault.payoutRecordCount(),
    used: await vault.usedCapacityAtoms(),
    consumed: redemptionId === undefined ? undefined : await vault.consumedRedemptions(redemptionId),
    vaultBalance: await token.balanceOf(await vault.getAddress()),
    refundBalance: await token.balanceOf(refundRecipient.address),
    redemptionBalance: await token.balanceOf(redemptionRecipient.address)
  };
}

function maskImmutableRanges(bytecode, immutableReferences) {
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  for (const ranges of Object.values(immutableReferences)) {
    for (const range of ranges) bytes.fill(0, range.start, range.start + range.length);
  }
  return `0x${bytes.toString("hex")}`;
}

describe("USDTmVaultV1 local EVM gate", function () {
  it("pins immutable identity, matches deployed runtime and reserves one atom from fixed capacity", async function () {
    const { token, verifier, vault } = await deployFixture();
    expect(await vault.token()).to.equal(await token.getAddress());
    expect(await vault.minimaProofVerifier()).to.equal(await verifier.getAddress());
    expect(await vault.destinationNetworkId()).to.equal(NETWORK_ID);
    expect(await vault.destinationBridgeDeploymentId()).to.equal(BRIDGE_ID);
    expect(await vault.destinationTokenId()).to.equal(TOKEN_ID);
    expect(await vault.reserveCovenantCommitment()).to.equal(RESERVE_COMMITMENT);
    expect(await vault.configurationEpoch()).to.equal(EPOCH);
    expect(await vault.fixedCapacityAtoms()).to.equal(FIXED_SUPPLY - 1n);
    expect(await vault.runtimeIdentity()).to.not.equal(ethers.ZeroHash);
    const artifact = JSON.parse(readFileSync(new URL("../artifacts/contracts/USDTmVaultV1.sol/USDTmVaultV1.json", import.meta.url), "utf8"));
    const deployedRuntime = await ethers.provider.getCode(await vault.getAddress());
    expect(maskImmutableRanges(deployedRuntime, artifact.immutableReferences)).to.equal(artifact.deployedBytecode);
  });

  it("uses measured balance delta for a fee-on-transfer deposit", async function () {
    const fixture = await deployFixture();
    await fixture.token.configure(1000, 0, ethers.ZeroAddress, "0x");
    const accepted = await accept(fixture, 100n, "fee");
    const record = await fixture.vault.deposits(accepted.recordId);
    expect(record.status).to.equal(1n);
    expect(record.amount).to.equal(90n);
    expect(await fixture.vault.cumulativeAcceptedAtoms()).to.equal(90n);
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(90n);
    expect(await fixture.token.balanceOf(await fixture.vault.getAddress())).to.equal(90n);
  });

  it("accepts an ERC20 with no return data and rejects false or reverting transferFrom", async function () {
    for (const behavior of [1, 2]) {
      const fixture = await deployFixture();
      await fixture.token.configure(0, behavior, ethers.ZeroAddress, "0x");
      await fixture.token.mint(fixture.depositor.address, 100n);
      await fixture.token.connect(fixture.depositor).approve(await fixture.vault.getAddress(), 100n);
      await expect(
        fixture.vault.connect(fixture.depositor).acceptDeposit(
          ethers.id(`bad-${behavior}`),
          100n,
          ethers.id("minima"),
          fixture.refundRecipient.address,
          ethers.id("authority")
        )
      ).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
      expect(await fixture.vault.cumulativeAcceptedAtoms()).to.equal(0n);
      expect(await fixture.token.balanceOf(await fixture.vault.getAddress())).to.equal(0n);
    }

    const noReturn = await deployFixture();
    await noReturn.token.configure(0, 3, ethers.ZeroAddress, "0x");
    await accept(noReturn, 100n, "no-return");
    expect(await noReturn.vault.cumulativeAcceptedAtoms()).to.equal(100n);
  });

  it("reverts an over-capacity receipt atomically", async function () {
    const fixture = await deployFixture();
    const amount = FIXED_SUPPLY;
    await fixture.token.mint(fixture.depositor.address, amount);
    await fixture.token.connect(fixture.depositor).approve(await fixture.vault.getAddress(), amount);
    await expect(
      fixture.vault.connect(fixture.depositor).acceptDeposit(
        ethers.id("over-capacity"),
        amount,
        ethers.id("minima"),
        fixture.refundRecipient.address,
        ethers.id("authority")
      )
    ).to.be.revertedWithCustomError(fixture.vault, "CapacityExceeded");
    expect(await fixture.vault.cumulativeAcceptedAtoms()).to.equal(0n);
    expect(await fixture.token.balanceOf(await fixture.vault.getAddress())).to.equal(0n);
    expect(await fixture.token.balanceOf(fixture.depositor.address)).to.equal(amount);
  });

  it("refunds only the exact settled cancellation and cannot replay it", async function () {
    const fixture = await deployFixture();
    const accepted = await accept(fixture);
    const proof = ethers.toUtf8Bytes("cancellation-proof");
    await setCancellation(fixture, accepted, proof);
    await expect(fixture.vault.refund(proof))
      .to.emit(fixture.vault, "DepositRefunded")
      .withArgs(accepted.recordId, accepted.amount, fixture.refundRecipient.address);
    const record = await fixture.vault.deposits(accepted.recordId);
    expect(record.status).to.equal(2n);
    expect(await fixture.vault.cumulativeRefundedAtoms()).to.equal(accepted.amount);
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(0n);
    expect(await fixture.token.balanceOf(fixture.refundRecipient.address)).to.equal(accepted.amount);
    await expect(fixture.vault.refund(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
  });

  it("rejects malformed, unsettled and field-mismatched cancellation proofs", async function () {
    const cases = [
      { label: "unknown", noFixture: true },
      { label: "unsettled", overrides: { settled: false } },
      { label: "record", overrides: { recordId: ethers.id("wrong-record") } },
      { label: "message", overrides: { messageId: ethers.id("wrong-message") } },
      { label: "amount", overrides: { amount: 99n } },
      { label: "recipient", overrides: { recipient: ethers.Wallet.createRandom().address } },
      { label: "runtime", overrides: { runtimeIdentity: ethers.id("wrong-runtime") } }
    ];
    for (const item of cases) {
      const fixture = await deployFixture();
      const accepted = await accept(fixture, 100n, item.label);
      const proof = ethers.toUtf8Bytes(`cancel-${item.label}`);
      if (!item.noFixture) await setCancellation(fixture, accepted, proof, item.overrides);
      const before = await stateSnapshot(fixture, accepted.recordId);
      await expect(fixture.vault.refund(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
      expect(await stateSnapshot(fixture, accepted.recordId)).to.deep.equal(before);
    }
  });

  it("pays an exact settled redemption once and restores capacity", async function () {
    const fixture = await deployFixture();
    await accept(fixture, 100n, "redeem");
    const proof = ethers.toUtf8Bytes("redemption-proof");
    const redemption = await setRedemption(fixture, proof, { amount: 40n });
    await expect(fixture.vault.payRedemption(proof))
      .to.emit(fixture.vault, "RedemptionPaid")
      .withArgs(1n, redemption[0], 40n, fixture.redemptionRecipient.address, 40n);
    expect(await fixture.vault.consumedRedemptions(redemption[0])).to.equal(true);
    expect(await fixture.vault.cumulativePaidRedemptionAtoms()).to.equal(40n);
    expect(await fixture.vault.payoutRecordCount()).to.equal(1n);
    const payoutRecord = await fixture.vault.payoutRecords(1n);
    expect(payoutRecord.redemptionId).to.equal(redemption[0]);
    expect(payoutRecord.amount).to.equal(40n);
    expect(payoutRecord.recipient).to.equal(fixture.redemptionRecipient.address);
    expect(payoutRecord.cumulativePaidAtoms).to.equal(40n);
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(60n);
    expect(await fixture.token.balanceOf(fixture.redemptionRecipient.address)).to.equal(40n);
    await expect(fixture.vault.payRedemption(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
  });

  it("rejects fake, unsettled, zero, oversized and malformed redemption proofs without mutation", async function () {
    const cases = [
      { label: "unknown", noFixture: true },
      { label: "unsettled", overrides: { settled: false } },
      { label: "zero-id", overrides: { redemptionId: ethers.ZeroHash } },
      { label: "zero-amount", overrides: { amount: 0n } },
      { label: "zero-recipient", overrides: { recipient: ethers.ZeroAddress } },
      { label: "runtime", overrides: { runtimeIdentity: ethers.id("wrong-runtime") } },
      { label: "oversized", overrides: { amount: 101n } }
    ];
    for (const item of cases) {
      const fixture = await deployFixture();
      await accept(fixture, 100n, item.label);
      const proof = ethers.toUtf8Bytes(`redeem-${item.label}`);
      let redemptionId = ethers.ZeroHash;
      if (!item.noFixture) {
        const redemption = await setRedemption(fixture, proof, item.overrides);
        redemptionId = redemption[0];
      }
      const before = await stateSnapshot(fixture, undefined, redemptionId);
      await expect(fixture.vault.payRedemption(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
      expect(await stateSnapshot(fixture, undefined, redemptionId)).to.deep.equal(before);
    }
  });

  it("rolls refund and redemption state back when the token returns false", async function () {
    const fixture = await deployFixture();
    const accepted = await accept(fixture, 100n, "rollback");
    const cancelProof = ethers.toUtf8Bytes("cancel-rollback");
    const redeemProof = ethers.toUtf8Bytes("redeem-rollback");
    await setCancellation(fixture, accepted, cancelProof);
    const redemption = await setRedemption(fixture, redeemProof, { amount: 40n });
    await fixture.token.configure(0, 1, ethers.ZeroAddress, "0x");

    const beforeRefund = await stateSnapshot(fixture, accepted.recordId, redemption[0]);
    await expect(fixture.vault.refund(cancelProof)).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
    expect(await stateSnapshot(fixture, accepted.recordId, redemption[0])).to.deep.equal(beforeRefund);

    const beforeRedemption = await stateSnapshot(fixture, accepted.recordId, redemption[0]);
    await expect(fixture.vault.payRedemption(redeemProof)).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
    expect(await stateSnapshot(fixture, accepted.recordId, redemption[0])).to.deep.equal(beforeRedemption);
  });

  it("blocks refund-to-redemption callback reentry and reverts the whole outer operation", async function () {
    const fixture = await deployFixture();
    const accepted = await accept(fixture, 100n, "refund-reentry");
    const cancelProof = ethers.toUtf8Bytes("cancel-refund-reentry");
    const redeemProof = ethers.toUtf8Bytes("redeem-refund-reentry");
    await setCancellation(fixture, accepted, cancelProof);
    const redemption = await setRedemption(fixture, redeemProof, { amount: 40n });
    const callback = fixture.vault.interface.encodeFunctionData("payRedemption", [redeemProof]);
    await fixture.token.configure(0, 0, await fixture.vault.getAddress(), callback);
    const before = await stateSnapshot(fixture, accepted.recordId, redemption[0]);
    await expect(fixture.vault.refund(cancelProof)).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
    expect(await stateSnapshot(fixture, accepted.recordId, redemption[0])).to.deep.equal(before);
  });

  it("blocks redemption-to-refund callback reentry and reverts the whole outer operation", async function () {
    const fixture = await deployFixture();
    const accepted = await accept(fixture, 100n, "redeem-reentry");
    const cancelProof = ethers.toUtf8Bytes("cancel-redeem-reentry");
    const redeemProof = ethers.toUtf8Bytes("redeem-redeem-reentry");
    await setCancellation(fixture, accepted, cancelProof);
    const redemption = await setRedemption(fixture, redeemProof, { amount: 40n });
    const callback = fixture.vault.interface.encodeFunctionData("refund", [cancelProof]);
    await fixture.token.configure(0, 0, await fixture.vault.getAddress(), callback);
    const before = await stateSnapshot(fixture, accepted.recordId, redemption[0]);
    await expect(fixture.vault.payRedemption(redeemProof)).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
    expect(await stateSnapshot(fixture, accepted.recordId, redemption[0])).to.deep.equal(before);
  });

  it("preserves capacity, token balance and append-only payout invariants across a mixed lifecycle", async function () {
    const fixture = await deployFixture();
    const first = await accept(fixture, 100n, "mixed-first");
    const second = await accept(fixture, 200n, "mixed-second");
    const redemptionProof = ethers.toUtf8Bytes("mixed-redemption");
    const redemption = await setRedemption(fixture, redemptionProof, {
      redemptionId: ethers.id("mixed-redemption-id"),
      amount: 50n
    });
    await fixture.vault.payRedemption(redemptionProof);
    const cancellationProof = ethers.toUtf8Bytes("mixed-cancellation");
    await setCancellation(fixture, second, cancellationProof);
    await fixture.vault.refund(cancellationProof);

    expect(await fixture.vault.cumulativeAcceptedAtoms()).to.equal(300n);
    expect(await fixture.vault.cumulativeRefundedAtoms()).to.equal(200n);
    expect(await fixture.vault.cumulativePaidRedemptionAtoms()).to.equal(50n);
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(50n);
    expect(await fixture.token.balanceOf(await fixture.vault.getAddress())).to.equal(50n);
    expect((await fixture.vault.deposits(first.recordId)).status).to.equal(1n);
    expect((await fixture.vault.deposits(second.recordId)).status).to.equal(2n);
    expect(await fixture.vault.consumedRedemptions(redemption[0])).to.equal(true);
    expect(await fixture.vault.payoutRecordCount()).to.equal(1n);
    expect((await fixture.vault.payoutRecords(1n)).cumulativePaidAtoms).to.equal(50n);
  });
});
