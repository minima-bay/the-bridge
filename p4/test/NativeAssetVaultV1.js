import { expect } from "chai";
import { network } from "hardhat";
import { readFileSync } from "node:fs";

const { ethers } = await network.create();

const FIXED_SUPPLY = ethers.parseEther("10") + 1n;
const EPOCH = 1n;
const NETWORK_ID = ethers.id("MINIMA_MAINNET");
const BRIDGE_ID = ethers.id("VALUELESS_GENERIC_BRIDGE_V1");
const TOKEN_ID = ethers.id("VALUELESS_ETHM_TOKEN_V1");
const RESERVE_COMMITMENT = ethers.id("VALUELESS_ETHM_RESERVE_V1");

async function deployFixture() {
  const [deployer, depositor, refundRecipient, redemptionRecipient] = await ethers.getSigners();
  const verifier = await ethers.deployContract("MockMinimaProofVerifier");
  await verifier.waitForDeployment();
  const vault = await ethers.deployContract("NativeAssetVaultV1", [
    await verifier.getAddress(),
    NETWORK_ID,
    BRIDGE_ID,
    TOKEN_ID,
    RESERVE_COMMITMENT,
    EPOCH,
    FIXED_SUPPLY
  ]);
  await vault.waitForDeployment();
  return { deployer, depositor, refundRecipient, redemptionRecipient, verifier, vault };
}

async function accept(fixture, amount = ethers.parseEther("1"), suffix = "one", refundAddress) {
  const { depositor, refundRecipient, vault } = fixture;
  const messageId = ethers.id(`native-message-${suffix}`);
  const minimaRecipient = ethers.id(`native-minima-recipient-${suffix}`);
  const authority = ethers.id(`native-cancellation-authority-${suffix}`);
  const recipient = refundAddress ?? refundRecipient.address;
  const recordId = await vault.recordIdFor(messageId);
  await vault.connect(depositor).acceptNativeDeposit(
    messageId,
    minimaRecipient,
    recipient,
    authority,
    { value: amount }
  );
  return { recordId, messageId, minimaRecipient, authority, amount, refundRecipient: recipient };
}

async function setCancellation(fixture, accepted, proof, overrides = {}) {
  const { verifier, vault } = fixture;
  const value = [
    overrides.recordId ?? accepted.recordId,
    overrides.messageId ?? accepted.messageId,
    overrides.amount ?? accepted.amount,
    overrides.recipient ?? accepted.refundRecipient,
    overrides.runtimeIdentity ?? await vault.runtimeIdentity(),
    overrides.settled ?? true
  ];
  await verifier.setCancellation(ethers.keccak256(proof), value);
}

async function setRedemption(fixture, proof, overrides = {}) {
  const { verifier, redemptionRecipient, vault } = fixture;
  const value = [
    overrides.redemptionId ?? ethers.id("native-redemption-one"),
    overrides.amount ?? ethers.parseEther("0.4"),
    overrides.recipient ?? redemptionRecipient.address,
    overrides.runtimeIdentity ?? await vault.runtimeIdentity(),
    overrides.settled ?? true
  ];
  await verifier.setRedemption(ethers.keccak256(proof), value);
  return value;
}

async function snapshot(fixture, recordId, redemptionId) {
  const { vault } = fixture;
  return {
    record: recordId === undefined ? undefined : Array.from(await vault.deposits(recordId)),
    accepted: await vault.cumulativeAcceptedAtoms(),
    refunded: await vault.cumulativeRefundedAtoms(),
    paid: await vault.cumulativePaidRedemptionAtoms(),
    accounted: await vault.accountedNativeAtoms(),
    used: await vault.usedCapacityAtoms(),
    payoutCount: await vault.payoutRecordCount(),
    consumed: redemptionId === undefined ? undefined : await vault.consumedRedemptions(redemptionId),
    rawBalance: await ethers.provider.getBalance(await vault.getAddress()),
    unaccounted: await vault.unaccountedNativeWei()
  };
}

function maskImmutableRanges(bytecode, immutableReferences) {
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  for (const ranges of Object.values(immutableReferences)) {
    for (const range of ranges) bytes.fill(0, range.start, range.start + range.length);
  }
  return `0x${bytes.toString("hex")}`;
}

describe("NativeAssetVaultV1 local EVM gate", function () {
  it("pins the native lane identity, exact local runtime and one-atom reserve floor", async function () {
    const { verifier, vault } = await deployFixture();
    expect(await vault.SOURCE_ASSET_KIND()).to.equal(0n);
    expect(await vault.SOURCE_ASSET()).to.equal(ethers.ZeroAddress);
    expect(await vault.SOURCE_DECIMALS()).to.equal(18n);
    expect(await vault.SINGLE_LIMB_MAX_ATOMS()).to.equal((1n << 64n) - 1n);
    expect(await vault.minimaProofVerifier()).to.equal(await verifier.getAddress());
    expect(await vault.destinationTokenId()).to.equal(TOKEN_ID);
    expect(await vault.fixedCapacityAtoms()).to.equal(FIXED_SUPPLY - 1n);
    expect(await vault.laneId()).to.not.equal(ethers.ZeroHash);
    expect(await vault.runtimeIdentity()).to.not.equal(ethers.ZeroHash);
    const artifact = JSON.parse(readFileSync(new URL("../artifacts/contracts/NativeAssetVaultV1.sol/NativeAssetVaultV1.json", import.meta.url), "utf8"));
    const deployedRuntime = await ethers.provider.getCode(await vault.getAddress());
    expect(maskImmutableRanges(deployedRuntime, artifact.immutableReferences)).to.equal(artifact.deployedBytecode);

    await expect(
      ethers.deployContract("NativeAssetVaultV1", [
        await verifier.getAddress(),
        NETWORK_ID,
        BRIDGE_ID,
        TOKEN_ID,
        RESERVE_COMMITMENT,
        EPOCH,
        (1n << 64n) + 1n
      ])
    ).to.be.revertedWithCustomError(vault, "InvalidRecord");
  });

  it("accepts exact msg.value only through the named deposit entrypoint", async function () {
    const fixture = await deployFixture();
    const accepted = await accept(fixture, ethers.parseEther("1.25"), "exact");
    const record = await fixture.vault.deposits(accepted.recordId);
    expect(record.status).to.equal(1n);
    expect(record.amount).to.equal(ethers.parseEther("1.25"));
    expect(await fixture.vault.accountedNativeAtoms()).to.equal(ethers.parseEther("1.25"));
    await expect(
      fixture.depositor.sendTransaction({ to: await fixture.vault.getAddress(), value: 1n })
    ).to.be.revertedWithCustomError(fixture.vault, "DirectNativeTransfer");
    await expect(
      fixture.vault.connect(fixture.depositor).acceptNativeDeposit(
        ethers.id("zero-value"),
        ethers.id("recipient"),
        fixture.refundRecipient.address,
        ethers.id("authority")
      )
    ).to.be.revertedWithCustomError(fixture.vault, "InvalidRecipient");
  });

  it("excludes forced ETH from attributable collateral and used capacity", async function () {
    const fixture = await deployFixture();
    await accept(fixture, ethers.parseEther("1"), "forced");
    const force = await ethers.deployContract("ForceNative", [], { value: ethers.parseEther("2") });
    await force.waitForDeployment();
    await force.force(await fixture.vault.getAddress());
    expect(await ethers.provider.getBalance(await fixture.vault.getAddress())).to.equal(ethers.parseEther("3"));
    expect(await fixture.vault.accountedNativeAtoms()).to.equal(ethers.parseEther("1"));
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(ethers.parseEther("1"));
    expect(await fixture.vault.unaccountedNativeWei()).to.equal(ethers.parseEther("2"));
  });

  it("reverts a native over-capacity deposit atomically", async function () {
    const fixture = await deployFixture();
    await expect(
      fixture.vault.connect(fixture.depositor).acceptNativeDeposit(
        ethers.id("over-capacity"),
        ethers.id("recipient"),
        fixture.refundRecipient.address,
        ethers.id("authority"),
        { value: FIXED_SUPPLY }
      )
    ).to.be.revertedWithCustomError(fixture.vault, "CapacityExceeded");
    expect(await fixture.vault.accountedNativeAtoms()).to.equal(0n);
    expect(await ethers.provider.getBalance(await fixture.vault.getAddress())).to.equal(0n);
  });

  it("refunds the exact settled native deposit once", async function () {
    const fixture = await deployFixture();
    const accepted = await accept(fixture);
    const proof = ethers.toUtf8Bytes("native-cancellation-proof");
    await setCancellation(fixture, accepted, proof);
    const recipientBefore = await ethers.provider.getBalance(fixture.refundRecipient.address);
    await expect(fixture.vault.refund(proof))
      .to.emit(fixture.vault, "DepositRefunded")
      .withArgs(accepted.recordId, accepted.amount, fixture.refundRecipient.address);
    expect(await ethers.provider.getBalance(fixture.refundRecipient.address)).to.equal(recipientBefore + accepted.amount);
    expect(await fixture.vault.accountedNativeAtoms()).to.equal(0n);
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(0n);
    await expect(fixture.vault.refund(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
  });

  it("rejects malformed native cancellation proofs without mutation", async function () {
    const cases = [
      { label: "unknown", noFixture: true },
      { label: "unsettled", overrides: { settled: false } },
      { label: "record", overrides: { recordId: ethers.id("wrong-record") } },
      { label: "amount", overrides: { amount: 99n } },
      { label: "recipient", overrides: { recipient: ethers.Wallet.createRandom().address } },
      { label: "runtime", overrides: { runtimeIdentity: ethers.id("wrong-runtime") } }
    ];
    for (const item of cases) {
      const fixture = await deployFixture();
      const accepted = await accept(fixture, 100n, item.label);
      const proof = ethers.toUtf8Bytes(`native-cancel-${item.label}`);
      if (!item.noFixture) await setCancellation(fixture, accepted, proof, item.overrides);
      const before = await snapshot(fixture, accepted.recordId);
      await expect(fixture.vault.refund(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
      expect(await snapshot(fixture, accepted.recordId)).to.deep.equal(before);
    }
  });

  it("pays an exact settled native redemption once and never uses forced surplus as capacity", async function () {
    const fixture = await deployFixture();
    await accept(fixture, ethers.parseEther("1"), "redeem");
    const force = await ethers.deployContract("ForceNative", [], { value: ethers.parseEther("2") });
    await force.waitForDeployment();
    await force.force(await fixture.vault.getAddress());
    const proof = ethers.toUtf8Bytes("native-redemption-proof");
    const redemption = await setRedemption(fixture, proof);
    const recipientBefore = await ethers.provider.getBalance(fixture.redemptionRecipient.address);
    await fixture.vault.payRedemption(proof);
    expect(await ethers.provider.getBalance(fixture.redemptionRecipient.address)).to.equal(recipientBefore + redemption[1]);
    expect(await fixture.vault.accountedNativeAtoms()).to.equal(ethers.parseEther("0.6"));
    expect(await fixture.vault.unaccountedNativeWei()).to.equal(ethers.parseEther("2"));
    await expect(fixture.vault.payRedemption(proof)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");

    const oversized = ethers.toUtf8Bytes("forced-surplus-redemption");
    await setRedemption(fixture, oversized, { redemptionId: ethers.id("forced-surplus"), amount: ethers.parseEther("1") });
    await expect(fixture.vault.payRedemption(oversized)).to.be.revertedWithCustomError(fixture.vault, "ProofRejected");
  });

  it("rolls native refund and redemption state back when the receiver rejects ETH", async function () {
    const fixture = await deployFixture();
    const receiver = await ethers.deployContract("MockNativeReceiver");
    await receiver.waitForDeployment();
    await receiver.configure(1, ethers.ZeroAddress, "0x");
    const accepted = await accept(fixture, ethers.parseEther("1"), "receiver-fail", await receiver.getAddress());
    const cancelProof = ethers.toUtf8Bytes("native-cancel-receiver-fail");
    await setCancellation(fixture, accepted, cancelProof);
    const beforeRefund = await snapshot(fixture, accepted.recordId);
    await expect(fixture.vault.refund(cancelProof)).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
    expect(await snapshot(fixture, accepted.recordId)).to.deep.equal(beforeRefund);

    const redeemProof = ethers.toUtf8Bytes("native-redeem-receiver-fail");
    const redemption = await setRedemption(fixture, redeemProof, { recipient: await receiver.getAddress() });
    const beforeRedeem = await snapshot(fixture, accepted.recordId, redemption[0]);
    await expect(fixture.vault.payRedemption(redeemProof)).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
    expect(await snapshot(fixture, accepted.recordId, redemption[0])).to.deep.equal(beforeRedeem);
  });

  it("blocks refund-to-redemption and redemption-to-refund native callbacks", async function () {
    for (const direction of ["refund", "redemption"]) {
      const fixture = await deployFixture();
      const receiver = await ethers.deployContract("MockNativeReceiver");
      await receiver.waitForDeployment();
      const accepted = await accept(
        fixture,
        ethers.parseEther("1"),
        `reentry-${direction}`,
        direction === "refund" ? await receiver.getAddress() : undefined
      );
      const cancelProof = ethers.toUtf8Bytes(`native-cancel-reentry-${direction}`);
      const redeemProof = ethers.toUtf8Bytes(`native-redeem-reentry-${direction}`);
      await setCancellation(fixture, accepted, cancelProof);
      const redemption = await setRedemption(fixture, redeemProof, {
        recipient: direction === "redemption" ? await receiver.getAddress() : fixture.redemptionRecipient.address
      });
      const callback = direction === "refund"
        ? fixture.vault.interface.encodeFunctionData("payRedemption", [redeemProof])
        : fixture.vault.interface.encodeFunctionData("refund", [cancelProof]);
      await receiver.configure(2, await fixture.vault.getAddress(), callback);
      const before = await snapshot(fixture, accepted.recordId, redemption[0]);
      const operation = direction === "refund"
        ? fixture.vault.refund(cancelProof)
        : fixture.vault.payRedemption(redeemProof);
      await expect(operation).to.be.revertedWithCustomError(fixture.vault, "TransferFailed");
      expect(await snapshot(fixture, accepted.recordId, redemption[0])).to.deep.equal(before);
    }
  });

  it("preserves native accounting and append-only payout records across a mixed lifecycle", async function () {
    const fixture = await deployFixture();
    const first = await accept(fixture, ethers.parseEther("1"), "mixed-first");
    const second = await accept(fixture, ethers.parseEther("2"), "mixed-second");
    const redemptionProof = ethers.toUtf8Bytes("native-mixed-redemption");
    const redemption = await setRedemption(fixture, redemptionProof, { amount: ethers.parseEther("0.5") });
    await fixture.vault.payRedemption(redemptionProof);
    const cancellationProof = ethers.toUtf8Bytes("native-mixed-cancellation");
    await setCancellation(fixture, second, cancellationProof);
    await fixture.vault.refund(cancellationProof);

    expect(await fixture.vault.cumulativeAcceptedAtoms()).to.equal(ethers.parseEther("3"));
    expect(await fixture.vault.cumulativeRefundedAtoms()).to.equal(ethers.parseEther("2"));
    expect(await fixture.vault.cumulativePaidRedemptionAtoms()).to.equal(ethers.parseEther("0.5"));
    expect(await fixture.vault.accountedNativeAtoms()).to.equal(ethers.parseEther("0.5"));
    expect(await fixture.vault.usedCapacityAtoms()).to.equal(ethers.parseEther("0.5"));
    expect((await fixture.vault.deposits(first.recordId)).status).to.equal(1n);
    expect((await fixture.vault.deposits(second.recordId)).status).to.equal(2n);
    expect(await fixture.vault.consumedRedemptions(redemption[0])).to.equal(true);
    expect((await fixture.vault.payoutRecords(1n)).cumulativePaidAtoms).to.equal(ethers.parseEther("0.5"));
  });
});
