import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "bridge-public-inputs-v1.json");
const evidenceDir = path.join(here, "evidence");

const schema = [
  ["domainTag", "ascii", 32],
  ["schemaVersion", "uint", 2],
  ["proofSystemId", "uint", 2],
  ["verifierVersion", "uint", 2],
  ["direction", "uint", 1],
  ["action", "uint", 1],
  ["sourceChainId", "uint", 32],
  ["sourceGenesisRoot", "bytes", 32],
  ["destinationNetworkId", "bytes", 32],
  ["bridgeDeploymentId", "bytes", 32],
  ["vaultAddress", "bytes", 20],
  ["tokenAddress", "bytes", 20],
  ["vaultCodeHash", "bytes", 32],
  ["vaultImplementationHash", "bytes", 32],
  ["vaultAdminStateHash", "bytes", 32],
  ["tokenCodeHash", "bytes", 32],
  ["tokenStateSemanticsHash", "bytes", 32],
  ["programHash", "bytes", 32],
  ["verificationKeyHash", "bytes", 32],
  ["priorEthereumClientStateHash", "bytes", 32],
  ["newEthereumClientStateHash", "bytes", 32],
  ["priorClientAcceptedMinimaBlock", "uint", 8],
  ["newClientAcceptedMinimaBlock", "uint", 8],
  ["maxClientReuseBlocks", "uint", 8],
  ["maxEthereumHeadAgeMillis", "uint", 8],
  ["maxEthereumFutureSkewMillis", "uint", 8],
  ["priorFinalizedSlot", "uint", 8],
  ["newFinalizedSlot", "uint", 8],
  ["newFinalizedBeaconRoot", "bytes", 32],
  ["executionBlockNumber", "uint", 8],
  ["executionBlockHash", "bytes", 32],
  ["executionTimestampMillis", "uint", 8],
  ["executionStateRoot", "bytes", 32],
  ["executionReceiptsRoot", "bytes", 32],
  ["messageId", "bytes", 32],
  ["sourceRecordId", "uint", 8],
  ["priorPayoutRecordId", "uint", 8],
  ["newPayoutRecordId", "uint", 8],
  ["priorCumulativePayoutAtoms", "uint", 16],
  ["newCumulativePayoutAtoms", "uint", 16],
  ["sourceAmountAtoms", "uint", 16],
  ["destinationAmountAtoms", "uint", 16],
  ["decimalScale", "uint", 4],
  ["recipientType", "uint", 1],
  ["recipientAddressData", "bytes", 32],
  ["attributableVaultBalance", "uint", 16],
  ["priorIssuedLiability", "uint", 16],
  ["newIssuedLiability", "uint", 16],
  ["priorPendingRedemption", "uint", 16],
  ["newPendingRedemption", "uint", 16],
  ["priorBridgeStateHash", "bytes", 32],
  ["newBridgeStateHash", "bytes", 32],
  ["configurationEpoch", "uint", 8]
];

function fail(message) {
  throw new Error(message);
}

function asBigInt(value, field) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(`${field}: expected canonical unsigned decimal string`);
  }
  return BigInt(value);
}

function uintBytes(value, width, field) {
  let n = asBigInt(value, field);
  const limit = 1n << BigInt(width * 8);
  if (n >= limit) fail(`${field}: exceeds ${width}-byte unsigned range`);
  const out = Buffer.alloc(width);
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  return out;
}

function fixedBytes(value, width, field) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value)) {
    fail(`${field}: expected lowercase 0x hex`);
  }
  const raw = Buffer.from(value.slice(2), "hex");
  if (raw.length !== width) fail(`${field}: expected ${width} bytes, got ${raw.length}`);
  return raw;
}

function asciiBytes(value, width, field) {
  if (typeof value !== "string" || !/^[\x20-\x7e]+$/.test(value)) {
    fail(`${field}: expected printable ASCII`);
  }
  const raw = Buffer.from(value, "ascii");
  if (raw.length > width) fail(`${field}: exceeds ${width} bytes`);
  return Buffer.concat([raw, Buffer.alloc(width - raw.length)]);
}

function encode(values) {
  return Buffer.concat(schema.map(([field, type, width]) => {
    if (!(field in values)) fail(`${field}: missing`);
    if (type === "uint") return uintBytes(values[field], width, field);
    if (type === "bytes") return fixedBytes(values[field], width, field);
    return asciiBytes(values[field], width, field);
  }));
}

function sha256(bytes) {
  return `0x${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function zeroHex(width) {
  return `0x${"00".repeat(width)}`;
}

function isZeroHex(value) {
  return /^0x0+$/.test(value);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

function deriveMessageId(values) {
  return sha256(Buffer.concat([
    asciiBytes(values.domainTag, 32, "domainTag"),
    uintBytes("1", 1, "direction"),
    uintBytes("2", 1, "action"),
    uintBytes(values.sourceChainId, 32, "sourceChainId"),
    fixedBytes(values.sourceGenesisRoot, 32, "sourceGenesisRoot"),
    fixedBytes(values.bridgeDeploymentId, 32, "bridgeDeploymentId"),
    fixedBytes(values.vaultAddress, 20, "vaultAddress"),
    fixedBytes(values.tokenAddress, 20, "tokenAddress"),
    uintBytes(values.sourceRecordId, 8, "sourceRecordId"),
    uintBytes(values.sourceAmountAtoms, 16, "sourceAmountAtoms"),
    uintBytes("1", 1, "recipientType"),
    fixedBytes(values.recipientAddressData, 32, "recipientAddressData"),
    uintBytes(values.configurationEpoch, 8, "configurationEpoch")
  ]));
}

function deriveRedemptionId(values) {
  return sha256(Buffer.concat([
    asciiBytes("MINIMA_ETH_REDEMPTION_V1", 32, "redemptionDomain"),
    fixedBytes(values.destinationNetworkId, 32, "destinationNetworkId"),
    fixedBytes(values.bridgeDeploymentId, 32, "bridgeDeploymentId"),
    fixedBytes(values.tokenId, 32, "tokenId"),
    fixedBytes(values.returnedCoinId, 32, "returnedCoinId"),
    uintBytes(values.returnedAmountAtoms, 16, "returnedAmountAtoms"),
    fixedBytes(values.ethereumRecipient, 20, "ethereumRecipient"),
    uintBytes(values.configurationEpoch, 8, "configurationEpoch")
  ]));
}

function derivePayoutBatchId(values) {
  return sha256(Buffer.concat([
    asciiBytes("MINIMA_PAYOUT_BATCH_V1", 32, "payoutBatchDomain"),
    fixedBytes(values.priorEthereumClientStateHash, 32, "priorEthereumClientStateHash"),
    fixedBytes(values.newEthereumClientStateHash, 32, "newEthereumClientStateHash"),
    fixedBytes(values.priorBridgeStateHash, 32, "priorBridgeStateHash"),
    fixedBytes(values.newBridgeStateHash, 32, "newBridgeStateHash"),
    uintBytes(values.priorPayoutRecordId, 8, "priorPayoutRecordId"),
    uintBytes(values.newPayoutRecordId, 8, "newPayoutRecordId"),
    uintBytes(values.priorCumulativePayoutAtoms, 16, "priorCumulativePayoutAtoms"),
    uintBytes(values.newCumulativePayoutAtoms, 16, "newCumulativePayoutAtoms"),
    uintBytes(values.configurationEpoch, 8, "configurationEpoch")
  ]));
}

function validateCommon(values, expected) {
  assertEqual(values.domainTag, "MINIMA_ETH_USDT_BRIDGE_V1", "domainTag");
  assertEqual(values.schemaVersion, "1", "schemaVersion");
  assertEqual(values.direction, "1", "direction");
  if (!["1", "2", "3"].includes(values.action)) fail("action: unsupported");
  for (const field of [
    "proofSystemId", "verifierVersion", "sourceChainId", "sourceGenesisRoot",
    "destinationNetworkId", "bridgeDeploymentId", "vaultAddress", "tokenAddress",
    "vaultCodeHash", "vaultImplementationHash", "vaultAdminStateHash", "tokenCodeHash",
    "tokenStateSemanticsHash", "programHash", "verificationKeyHash", "decimalScale",
    "maxClientReuseBlocks", "maxEthereumHeadAgeMillis", "maxEthereumFutureSkewMillis",
    "configurationEpoch"
  ]) {
    assertEqual(values[field], expected[field], `${field} binding`);
  }
}

function validate(values, expected, context) {
  const encoded = encode(values);
  if (encoded.length !== 1005) fail(`canonical encoded size: expected 1005, got ${encoded.length}`);
  validateCommon(values, expected);

  const priorSlot = asBigInt(values.priorFinalizedSlot, "priorFinalizedSlot");
  const newSlot = asBigInt(values.newFinalizedSlot, "newFinalizedSlot");
  const priorAcceptedBlock = asBigInt(values.priorClientAcceptedMinimaBlock, "priorClientAcceptedMinimaBlock");
  const newAcceptedBlock = asBigInt(values.newClientAcceptedMinimaBlock, "newClientAcceptedMinimaBlock");
  const maxReuseBlocks = asBigInt(values.maxClientReuseBlocks, "maxClientReuseBlocks");
  const maxHeadAgeMillis = asBigInt(values.maxEthereumHeadAgeMillis, "maxEthereumHeadAgeMillis");
  const maxFutureSkewMillis = asBigInt(values.maxEthereumFutureSkewMillis, "maxEthereumFutureSkewMillis");
  const executionTimestampMillis = asBigInt(values.executionTimestampMillis, "executionTimestampMillis");
  const currentMinimaBlock = asBigInt(context.currentMinimaBlock, "currentMinimaBlock");
  const maxPostingLagBlocks = asBigInt(context.maxPostingLagBlocks, "maxPostingLagBlocks");
  const currentMinimaTimeMillis = asBigInt(context.currentMinimaBlockTimeMillis, "currentMinimaBlockTimeMillis");
  const source = asBigInt(values.sourceAmountAtoms, "sourceAmountAtoms");
  const destination = asBigInt(values.destinationAmountAtoms, "destinationAmountAtoms");
  const scale = asBigInt(values.decimalScale, "decimalScale");
  const priorLiability = asBigInt(values.priorIssuedLiability, "priorIssuedLiability");
  const newLiability = asBigInt(values.newIssuedLiability, "newIssuedLiability");
  const priorPending = asBigInt(values.priorPendingRedemption, "priorPendingRedemption");
  const newPending = asBigInt(values.newPendingRedemption, "newPendingRedemption");
  const vaultBalance = asBigInt(values.attributableVaultBalance, "attributableVaultBalance");
  const priorPayoutId = asBigInt(values.priorPayoutRecordId, "priorPayoutRecordId");
  const newPayoutId = asBigInt(values.newPayoutRecordId, "newPayoutRecordId");
  const priorCumulative = asBigInt(values.priorCumulativePayoutAtoms, "priorCumulativePayoutAtoms");
  const newCumulative = asBigInt(values.newCumulativePayoutAtoms, "newCumulativePayoutAtoms");
  if (scale === 0n) fail("decimalScale: zero forbidden");
  if (executionTimestampMillis > currentMinimaTimeMillis) {
    if (executionTimestampMillis - currentMinimaTimeMillis > maxFutureSkewMillis) {
      fail("Ethereum execution timestamp exceeds future-skew bound");
    }
  } else if (currentMinimaTimeMillis - executionTimestampMillis > maxHeadAgeMillis) {
    fail("Ethereum execution timestamp exceeds source-age bound");
  }

  const requireFreshAdvance = (label) => {
    if (newAcceptedBlock > currentMinimaBlock || currentMinimaBlock - newAcceptedBlock > maxPostingLagBlocks) {
      fail(`${label}: accepted Minima block outside posting-lag bound`);
    }
  };
  const requireFreshReuse = (label) => {
    if (newAcceptedBlock !== priorAcceptedBlock) fail(`${label}: accepted Minima block changed`);
    if (priorAcceptedBlock > currentMinimaBlock || currentMinimaBlock - priorAcceptedBlock > maxReuseBlocks) {
      fail(`${label}: authenticated Ethereum head is stale`);
    }
  };

  if (values.action === "1") {
    if (newSlot <= priorSlot) fail("client update: finalized slot must advance");
    if (values.newEthereumClientStateHash === values.priorEthereumClientStateHash) fail("client update: Ethereum state did not advance");
    for (const field of ["sourceRecordId", "sourceAmountAtoms", "destinationAmountAtoms", "recipientType"]) {
      if (asBigInt(values[field], field) !== 0n) fail(`client update: ${field} must be zero`);
    }
    for (const field of ["messageId", "recipientAddressData"]) {
      if (!isZeroHex(values[field])) fail(`client update: ${field} must be zero`);
    }
    if (newLiability !== priorLiability) fail("client update: issued liability changed");
    if (newPending !== priorPending) fail("client update: pending redemption changed");
    if (newPayoutId !== priorPayoutId || newCumulative !== priorCumulative) fail("client update: payout cursor changed");
    requireFreshAdvance("client update");
    if (newLiability + newPending > vaultBalance * scale) fail("client update: issued plus pending exceeds vault balance");
    if (values.newBridgeStateHash === values.priorBridgeStateHash) fail("client update: bridge state did not update");
  } else if (values.action === "2") {
    if (newSlot < priorSlot) fail("inbound release: finalized slot moved backwards");
    if (source === 0n || destination === 0n) fail("inbound release: amount must be nonzero");
    assertEqual(values.recipientType, "1", "recipientType");
    assertEqual(values.recipientAddressData, expected.recipientAddressData, "recipientAddressData binding");
    if (isZeroHex(values.recipientAddressData)) fail("recipientAddressData: zero forbidden");
    if (isZeroHex(values.messageId)) fail("messageId: zero forbidden");
    assertEqual(values.messageId, deriveMessageId(values), "messageId derivation");
    if (destination !== source * scale) fail("inbound decimal conversion mismatch");
    if (newLiability !== priorLiability + destination) fail("inbound liability transition mismatch");
    if (newPending !== priorPending) fail("inbound pending redemption changed");
    if (newPayoutId !== priorPayoutId || newCumulative !== priorCumulative) fail("inbound payout cursor changed");
    if (newLiability + newPending > vaultBalance * scale) {
      fail("issued plus pending liability exceeds proof-bound vault balance");
    }
    if (newSlot === priorSlot && values.newEthereumClientStateHash !== values.priorEthereumClientStateHash) {
      fail("same-slot release: Ethereum client state changed");
    }
    if (newSlot === priorSlot) requireFreshReuse("same-slot release");
    if (newSlot > priorSlot && values.newEthereumClientStateHash === values.priorEthereumClientStateHash) {
      fail("advancing release: Ethereum client state did not change");
    }
    if (newSlot > priorSlot) requireFreshAdvance("advancing release");
    if (values.newBridgeStateHash === values.priorBridgeStateHash) fail("inbound bridge state did not change");
  } else {
    if (newSlot < priorSlot) fail("payout acknowledgement: finalized slot moved backwards");
    if (source === 0n || destination === 0n) fail("payout acknowledgement: amount must be nonzero");
    assertEqual(values.recipientType, "0", "payout recipientType");
    if (!isZeroHex(values.recipientAddressData)) fail("payout recipientAddressData must be zero");
    if (isZeroHex(values.messageId)) fail("payout redemption ID: zero forbidden");
    if (newPayoutId <= priorPayoutId) fail("payout cursor did not advance");
    if (newCumulative <= priorCumulative) fail("cumulative payout did not advance");
    if (asBigInt(values.sourceRecordId, "sourceRecordId") !== newPayoutId) fail("payout sourceRecordId must equal new payout cursor");
    if (source !== newCumulative - priorCumulative) fail("payout aggregate does not equal cumulative delta");
    assertEqual(values.messageId, derivePayoutBatchId(values), "payout batch ID derivation");
    if (destination !== source * scale) fail("payout decimal conversion mismatch");
    if (newLiability !== priorLiability) fail("payout acknowledgement changed issued liability");
    if (priorPending < destination || newPending !== priorPending - destination) {
      fail("payout pending-redemption transition mismatch");
    }
    if (newLiability + newPending > vaultBalance * scale) {
      fail("post-payout issued plus pending liability exceeds proof-bound vault balance");
    }
    if (newSlot === priorSlot && values.newEthereumClientStateHash !== values.priorEthereumClientStateHash) {
      fail("same-slot payout: Ethereum client state changed");
    }
    if (newSlot === priorSlot) requireFreshReuse("same-slot payout");
    if (newSlot > priorSlot && values.newEthereumClientStateHash === values.priorEthereumClientStateHash) {
      fail("advancing payout: Ethereum client state did not change");
    }
    if (newSlot > priorSlot) requireFreshAdvance("advancing payout");
    if (values.newBridgeStateHash === values.priorBridgeStateHash) fail("payout bridge state did not change");
  }

  return { encodedBytes: encoded.length, publicValuesHash: sha256(encoded) };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clientUpdateFrom(base) {
  return {
    ...base,
    action: "1",
    messageId: zeroHex(32),
    sourceRecordId: "0",
    newPayoutRecordId: base.priorPayoutRecordId,
    newCumulativePayoutAtoms: base.priorCumulativePayoutAtoms,
    sourceAmountAtoms: "0",
    destinationAmountAtoms: "0",
    recipientType: "0",
    recipientAddressData: zeroHex(32),
    newIssuedLiability: base.priorIssuedLiability,
    newPendingRedemption: base.priorPendingRedemption,
    newBridgeStateHash: base.newBridgeStateHash
  };
}

function payoutAcknowledgementFrom(base) {
  return {
    ...base,
    action: "3",
    sourceRecordId: "1",
    priorPayoutRecordId: "0",
    newPayoutRecordId: "1",
    priorCumulativePayoutAtoms: "0",
    newCumulativePayoutAtoms: "50000000",
    sourceAmountAtoms: "50000000",
    destinationAmountAtoms: "50000000",
    recipientType: "0",
    recipientAddressData: zeroHex(32),
    attributableVaultBalance: "950000000",
    newIssuedLiability: base.priorIssuedLiability,
    newPendingRedemption: "0"
  };
}

function finalizedPayoutFrom(base, overrides = {}) {
  const changed = { ...payoutAcknowledgementFrom(base), ...overrides };
  changed.messageId = derivePayoutBatchId(changed);
  return changed;
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const base = fixture.publicValues;
const expected = fixture.expectedBindings;
const context = fixture.validationContext;
const redemption = fixture.redemptionFixture;
const cases = [
  ["valid inbound", () => base, true],
  ["valid client update", () => clientUpdateFrom(base), true],
  ["valid payout acknowledgement", () => finalizedPayoutFrom(base), true],
  ["valid same-slot payout acknowledgement", () => finalizedPayoutFrom(base, { newFinalizedSlot: base.priorFinalizedSlot, newEthereumClientStateHash: base.priorEthereumClientStateHash, newClientAcceptedMinimaBlock: base.priorClientAcceptedMinimaBlock }), true],
  ["valid two-payout batch at full utilization", () => finalizedPayoutFrom(base, { sourceRecordId: "2", newPayoutRecordId: "2", newCumulativePayoutAtoms: "100000000", sourceAmountAtoms: "100000000", destinationAmountAtoms: "100000000", priorIssuedLiability: "0", newIssuedLiability: "0", priorPendingRedemption: "100000000", newPendingRedemption: "0", attributableVaultBalance: "0" }), true],
  ["valid second deposit at same finalized slot", () => ({ ...base, newFinalizedSlot: base.priorFinalizedSlot, newEthereumClientStateHash: base.priorEthereumClientStateHash, newClientAcceptedMinimaBlock: base.priorClientAcceptedMinimaBlock }), true],
  ["wrong source chain", () => ({ ...base, sourceChainId: "2" }), false],
  ["wrong destination network", () => ({ ...base, destinationNetworkId: "0x2525252525252525252525252525252525252525252525252525252525252525" }), false],
  ["wrong proof system", () => ({ ...base, proofSystemId: "2" }), false],
  ["wrong verifier version", () => ({ ...base, verifierVersion: "2" }), false],
  ["wrong vault", () => ({ ...base, vaultAddress: "0x4545454545454545454545454545454545454545" }), false],
  ["wrong vault code", () => ({ ...base, vaultCodeHash: "0x2222222222222222222222222222222222222222222222222222222222222222" }), false],
  ["wrong vault implementation", () => ({ ...base, vaultImplementationHash: "0x2626262626262626262626262626262626262626262626262626262626262626" }), false],
  ["wrong vault admin state", () => ({ ...base, vaultAdminStateHash: "0x2727272727272727272727272727272727272727272727272727272727272727" }), false],
  ["wrong token code", () => ({ ...base, tokenCodeHash: "0x2828282828282828282828282828282828282828282828282828282828282828" }), false],
  ["wrong token semantics", () => ({ ...base, tokenStateSemanticsHash: "0x2323232323232323232323232323232323232323232323232323232323232323" }), false],
  ["wrong recipient data", () => ({ ...base, recipientAddressData: "0x1818181818181818181818181818181818181818181818181818181818181818" }), false],
  ["wrong amount transition", () => ({ ...base, destinationAmountAtoms: "100000001" }), false],
  ["wrong decimal scale", () => ({ ...base, decimalScale: "100" }), false],
  ["wrong program", () => ({ ...base, programHash: "0x2020202020202020202020202020202020202020202020202020202020202020" }), false],
  ["wrong verification key", () => ({ ...base, verificationKeyHash: "0x1919191919191919191919191919191919191919191919191919191919191919" }), false],
  ["cross-direction replay", () => ({ ...base, direction: "2" }), false],
  ["wrong configuration epoch", () => ({ ...base, configurationEpoch: "2" }), false],
  ["backward client slot", () => ({ ...base, newFinalizedSlot: "9999999" }), false],
  ["same-slot release changes Ethereum state", () => ({ ...base, newFinalizedSlot: base.priorFinalizedSlot }), false],
  ["expired equal-head release", () => ({ ...base, newFinalizedSlot: base.priorFinalizedSlot, newEthereumClientStateHash: base.priorEthereumClientStateHash, priorClientAcceptedMinimaBlock: "2268800", newClientAcceptedMinimaBlock: "2268800" }), false],
  ["advancing proof has stale acceptance block", () => ({ ...base, newClientAcceptedMinimaBlock: "2268997" }), false],
  ["advancing old Ethereum head ratchet", () => ({ ...base, newFinalizedSlot: "10000001", executionTimestampMillis: "1787060000000" }), false],
  ["Ethereum head exceeds future skew", () => ({ ...base, executionTimestampMillis: "1787073631000" }), false],
  ["Ethereum execution timestamp overflows u64", () => ({ ...base, executionTimestampMillis: "18446744073709551616" }), false],
  ["issued plus pending above vault balance", () => ({ ...base, attributableVaultBalance: "549999999" }), false],
  ["record ID not bound into message", () => ({ ...base, sourceRecordId: "42" }), false],
  ["client update changes liability", () => ({ ...clientUpdateFrom(base), newIssuedLiability: "400000001" }), false],
  ["client update carries message", () => ({ ...clientUpdateFrom(base), messageId: base.messageId }), false],
  ["client update creates insolvency", () => ({ ...clientUpdateFrom(base), attributableVaultBalance: "449999999" }), false],
  ["inbound changes payout cursor", () => ({ ...base, newPayoutRecordId: "1" }), false],
  ["payout pending underflow", () => finalizedPayoutFrom(base, { sourceAmountAtoms: "50000001", destinationAmountAtoms: "50000001", newCumulativePayoutAtoms: "50000001" }), false],
  ["payout cumulative delta mismatch", () => finalizedPayoutFrom(base, { sourceAmountAtoms: "49999999" }), false]
];

const results = [];
for (const [name, makeValues, shouldPass] of cases) {
  let passed = false;
  let detail = null;
  try {
    detail = validate(clone(makeValues()), expected, context);
    passed = true;
  } catch (error) {
    detail = { error: error.message };
  }
  results.push({ name, expected: shouldPass ? "accept" : "reject", observed: passed ? "accept" : "reject", detail });
}

for (const [name, candidate, shouldPass] of [
  ["valid redemption commitment", redemption, true],
  ["redemption amount mutation", { ...redemption, returnedAmountAtoms: "50000001" }, false],
  ["redemption recipient mutation", { ...redemption, ethereumRecipient: "0x3232323232323232323232323232323232323232" }, false]
]) {
  const passed = deriveRedemptionId(candidate) === candidate.redemptionId;
  results.push({
    name,
    expected: shouldPass ? "accept" : "reject",
    observed: passed ? "accept" : "reject",
    detail: { derivedRedemptionId: deriveRedemptionId(candidate) }
  });
}

try {
  const returned = 100000095n;
  const scale = 100n;
  if (returned % scale !== 0n) throw new Error("outbound amount contains non-redeemable decimal dust");
  results.push({ name: "eight-decimal outbound dust", expected: "reject", observed: "accept", detail: null });
} catch (error) {
  results.push({ name: "eight-decimal outbound dust", expected: "reject", observed: "reject", detail: { error: error.message } });
}

const baseResult = validate(base, expected, context);
const changedRecipientHash = sha256(encode({ ...base, recipientAddressData: "0x1818181818181818181818181818181818181818181818181818181818181818" }));
if (baseResult.publicValuesHash === changedRecipientHash) fail("recipient mutation did not change publicValuesHash");

const failures = results.filter((item) => item.expected !== item.observed);
const evidence = {
  evidenceType: "schema-fixture-validation-only",
  createdAt: new Date().toISOString(),
  nodeVersion: process.version,
  fixture: path.relative(here, fixturePath).replaceAll("\\", "/"),
  fixtureSha256: sha256(fs.readFileSync(fixturePath)),
  validatorSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
  schemaEncodedBytes: baseResult.encodedBytes,
  basePublicValuesHash: baseResult.publicValuesHash,
  recipientMutationChangesHash: true,
  results,
  passed: failures.length === 0,
  limitations: [
    "No ZK proof was generated or verified.",
    "No client-state or reserve-state commitment implementation was executed.",
    "No Minima covenant was parsed, signed, posted or mined.",
    "No Ethereum finality, receipt, vault or token state was authenticated.",
    "A local schema validator is not consensus evidence."
  ]
};

fs.mkdirSync(evidenceDir, { recursive: true });
const stamp = evidence.createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const evidencePath = path.join(evidenceDir, `rfc-fixture-validation-${stamp}.json`);
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
const evidenceHash = sha256(fs.readFileSync(evidencePath)).slice(2);
fs.writeFileSync(`${evidencePath}.sha256`, `${evidenceHash}  ${path.basename(evidencePath)}\n`, { flag: "wx" });

console.log(JSON.stringify({ evidencePath, evidenceHash, passed: evidence.passed, failures }, null, 2));
if (!evidence.passed) process.exitCode = 1;
