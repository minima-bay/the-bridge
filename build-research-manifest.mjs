import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "research-manifest.json");
const include = [
  "README.md",
  "USDTM-ZK-PROTOTYPE.md",
  "feasibility-findings-2026-08-18.md",
  "minima-core-zk-verifier-rfc-2026-08-18.md",
  "minima-core-native-verifier-proposal-2026-08-18.md",
  "minima-core-contact-draft-2026-08-19.md",
  "minima-consensus-fixture-spec-v1.md",
  "bridge-public-inputs-v1.md",
  "reserve-covenant-transition-spec-v1.md",
  "proof-system-selection-matrix.md",
  "adversarial-verification-plan.md",
  "usdtm-p1-threat-model.md",
  "usdtm-p2-canonical-schema-v1.md",
  "usdtm-p3-reference-state-machine.md",
  "usdtm-p4-vault-status.md",
  "usdtm-p7-threshold-attestation-v1.md",
  "bridge-asset-lanes-v1.md",
  "generic-attestation-schema-v1.md",
  "generic-mainnet-ceremony.mjs",
  "mainnet-ceremony-state.json",
  "generic-mainnet-v2-ceremony.mjs",
  "mainnet-v2-ceremony-state.json",
  "open-decisions.md",
  "build-research-manifest.mjs",
  "validate-rfc-fixtures.mjs",
  "validate-usdtm-control.mjs",
  "validate-usdtm-scope.mjs",
  "validate-usdtm-p1-model.mjs",
  "usdtm-p2-primary-encoder.mjs",
  "usdtm-p2-independent-encoder.mjs",
  "validate-usdtm-p2-cancellation.mjs",
  "usdtm-p2-records-primary.mjs",
  "usdtm-p2-records-independent.mjs",
  "validate-usdtm-p2-records.mjs",
  "usdtm-p3-reference.mjs",
  "validate-usdtm-p4-vault-model.mjs",
  "validate-usdtm-p4-evm.mjs",
  "validate-minima-core-zk-surface.mjs",
  "validate-usdtm-p7-threshold.mjs",
  "validate-bridge-asset-lanes.mjs",
  "generic-attestation-primary.mjs",
  "generic-attestation-independent.mjs",
  "validate-generic-attestation-records.mjs",
  "validate-generic-lane-txpow.mjs",
  "validate-minima-treekey-signatures.mjs",
  "p7/TreeKeySignatureBenchmark.java",
  "p7/GenericLaneTxPowBenchmark.java",
  "p4/package.json",
  "p4/package-lock.json",
  "p4/hardhat.config.js",
  "p4/.gitignore",
  "p4/test/USDTmVaultV1.js",
  "p4/test/NativeAssetVaultV1.js",
  "p4/contracts/USDTmVaultV1.sol",
  "p4/contracts/MockUSDT6.sol",
  "p4/contracts/MockMinimaProofVerifier.sol",
  "p4/contracts/NativeAssetVaultV1.sol",
  "p4/contracts/MockNativeReceiver.sol",
  "capture-minima-consensus-fixtures.mjs",
  "validate-minima-consensus-fixture.mjs",
  "minima-runtime-probe.mjs",
  "minima-kernel-probe.mjs",
  "winterfell-sha3-instrumentation-notes.md"
];

const fixtureFiles = fs.readdirSync(path.join(root, "fixtures"))
  .filter((name) => !name.endsWith(".sha256"))
  .map((name) => `fixtures/${name}`)
  .sort();

const evidenceFiles = fs.readdirSync(path.join(root, "evidence"))
  .filter((name) => !name.endsWith(".sha256"))
  .map((name) => `evidence/${name}`)
  .sort();

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
}

function evidenceSidecarMatches(file) {
  const sidecar = path.join(root, `${file}.sha256`);
  if (!fs.existsSync(sidecar)) return false;
  const recorded = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0].toLowerCase();
  return recorded === digest(file);
}

const files = [...include, ...fixtureFiles, ...evidenceFiles].map((file) => {
  const stat = fs.statSync(path.join(root, file));
  return { file, bytes: stat.size, sha256: digest(file) };
});

const fixtureDigest = `0x${digest("fixtures/bridge-public-inputs-v1.json")}`;
const validatorDigest = `0x${digest("validate-rfc-fixtures.mjs")}`;
const matchingEvidence = evidenceFiles
  .filter((file) => /^evidence\/rfc-fixture-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item && evidenceSidecarMatches(item.file) && item.data.passed === true && item.data.fixtureSha256 === fixtureDigest && item.data.validatorSha256 === validatorDigest)
  .sort((a, b) => String(a.data.createdAt).localeCompare(String(b.data.createdAt)));

const currentFixtureEvidence = matchingEvidence.length > 0 ? matchingEvidence.at(-1).file : null;

const consensusFixtureFiles = fixtureFiles
  .filter((file) => /^fixtures\/minima-consensus-mainnet-\d{8}T\d{6}Z\.json$/.test(file))
  .sort();
const currentConsensusFixture = consensusFixtureFiles.length > 0 ? consensusFixtureFiles.at(-1) : null;
const currentConsensusFixtureSha256 = currentConsensusFixture ? digest(currentConsensusFixture) : null;
const consensusValidatorSha256 = digest("validate-minima-consensus-fixture.mjs");
const matchingConsensusEvidence = evidenceFiles
  .filter((file) => /^evidence\/minima-consensus-fixture-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item
    && item.data.passed === true
    && evidenceSidecarMatches(item.file)
    && item.data.fixture === path.basename(currentConsensusFixture || "")
    && item.data.fixtureSha256 === currentConsensusFixtureSha256
    && item.data.validatorSha256 === consensusValidatorSha256)
  .sort((a, b) => String(a.data.createdAtUtc).localeCompare(String(b.data.createdAtUtc)));
const currentConsensusFixtureEvidence = matchingConsensusEvidence.length > 0
  ? matchingConsensusEvidence.at(-1).file
  : null;

const controlDocumentSha256 = digest("USDTM-ZK-PROTOTYPE.md");
const controlValidatorSha256 = digest("validate-usdtm-control.mjs");
const matchingControlEvidence = evidenceFiles
  .filter((file) => /^evidence\/usdtm-control-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item
    && item.data.status === "passed"
    && evidenceSidecarMatches(item.file)
    && item.data.documentSha256 === controlDocumentSha256
    && item.data.validatorSha256 === controlValidatorSha256)
  .sort((a, b) => String(a.data.createdAtUtc).localeCompare(String(b.data.createdAtUtc)));
const currentControlEvidence = matchingControlEvidence.length > 0
  ? matchingControlEvidence.at(-1).file
  : null;

const p1ModelValidatorSha256 = digest("validate-usdtm-p1-model.mjs");
const matchingP1ModelEvidence = evidenceFiles
  .filter((file) => /^evidence\/usdtm-p1-model-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item
    && item.data.schema === "usdtm-p1-model-validation/v2"
    && item.data.status === "passed"
    && item.data.validatorSha256 === p1ModelValidatorSha256
    && item.data.finalityAssumptionCounterexampleObserved === true
    && evidenceSidecarMatches(item.file))
  .sort((a, b) => String(a.data.createdAtUtc).localeCompare(String(b.data.createdAtUtc)));
const currentP1ModelEvidence = matchingP1ModelEvidence.length > 0
  ? matchingP1ModelEvidence.at(-1).file
  : null;

const p2CancellationValidatorSha256 = digest("validate-usdtm-p2-cancellation.mjs");
const p2CancellationFixtureSha256 = digest("fixtures/usdtm-p2-cancellation-v1.json");
const matchingP2CancellationEvidence = evidenceFiles
  .filter((file) => /^evidence\/usdtm-p2-cancellation-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item
    && item.data.schema === "usdtm-p2-cancellation-validation/v1"
    && item.data.status === "passed"
    && item.data.validatorSha256 === p2CancellationValidatorSha256
    && item.data.fixtureSha256 === p2CancellationFixtureSha256
    && item.data.encodedBytes === 512
    && item.data.fieldMutationCount === item.data.mutationsDetected
    && evidenceSidecarMatches(item.file))
  .sort((a, b) => String(a.data.createdAtUtc).localeCompare(String(b.data.createdAtUtc)));
const currentP2CancellationEvidence = matchingP2CancellationEvidence.length > 0
  ? matchingP2CancellationEvidence.at(-1).file
  : null;

function latestMatchingEvidence(pattern, predicate) {
  const matches = evidenceFiles
    .filter((file) => pattern.test(file))
    .map((file) => {
      try { return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) }; }
      catch { return null; }
    })
    .filter((item) => item && evidenceSidecarMatches(item.file) && predicate(item.data))
    .sort((a, b) => String(a.data.createdAtUtc).localeCompare(String(b.data.createdAtUtc)));
  return matches.length > 0 ? matches.at(-1).file : null;
}

const p2RecordsValidatorSha256 = digest("validate-usdtm-p2-records.mjs");
const p2RecordsFixtureSha256 = digest("fixtures/usdtm-p2-records-v1.json");
const currentP2RecordsEvidence = latestMatchingEvidence(/^evidence\/usdtm-p2-record-validation-.*\.json$/, (data) =>
  data.schema === "usdtm-p2-record-validation/v1"
  && data.status === "passed"
  && data.validatorSha256 === p2RecordsValidatorSha256
  && data.fixtureSha256 === p2RecordsFixtureSha256
  && data.recordCount === 5
  && data.fieldMutationCount === data.mutationsDetected);

const p3ReferenceValidatorSha256 = digest("usdtm-p3-reference.mjs");
const currentP3ReferenceEvidence = latestMatchingEvidence(/^evidence\/usdtm-p3-reference-validation-.*\.json$/, (data) =>
  data.schema === "usdtm-p3-reference-validation/v1"
  && data.status === "passed"
  && data.validatorSha256 === p3ReferenceValidatorSha256
  && data.deliberateMutationCount === data.mutationsDetected);

const p4VaultModelValidatorSha256 = digest("validate-usdtm-p4-vault-model.mjs");
const currentP4VaultModelEvidence = latestMatchingEvidence(/^evidence\/usdtm-p4-vault-model-validation-.*\.json$/, (data) =>
  data.schema === "usdtm-p4-vault-model-validation/v1"
  && data.status === "partial-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === p4VaultModelValidatorSha256
  && data.vaultSourceSha256 === digest("p4/contracts/USDTmVaultV1.sol")
  && data.mockTokenSourceSha256 === digest("p4/contracts/MockUSDT6.sol")
  && data.mockVerifierSourceSha256 === digest("p4/contracts/MockMinimaProofVerifier.sol"));

const p4EvmValidatorSha256 = digest("validate-usdtm-p4-evm.mjs");
const currentP4EvmEvidence = latestMatchingEvidence(/^evidence\/usdtm-p4-evm-validation-.*\.json$/, (data) =>
  data.schema === "generic-bridge-p4-evm-validation/v2"
  && data.status === "local-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === p4EvmValidatorSha256
  && data.packageLockSha256 === digest("p4/package-lock.json")
  && data.configSha256 === digest("p4/hardhat.config.js")
  && data.testSourceSha256 === digest("p4/test/USDTmVaultV1.js")
  && data.nativeTestSourceSha256 === digest("p4/test/NativeAssetVaultV1.js")
  && data.vaultSourceSha256 === digest("p4/contracts/USDTmVaultV1.sol")
  && data.nativeVaultSourceSha256 === digest("p4/contracts/NativeAssetVaultV1.sol")
  && data.nativeReceiverSourceSha256 === digest("p4/contracts/MockNativeReceiver.sol")
  && data.compiler === "0.8.24+commit.e11b9ed9"
  && data.hardhat === "3.13.0"
  && data.mochaTestsPassed === 22
  && data.dependencyAudit?.critical === 0
  && data.dependencyAudit?.high === 0
  && data.dependencyAudit?.moderate === 0);

const minimaCoreSurfaceValidatorSha256 = digest("validate-minima-core-zk-surface.mjs");
const currentMinimaCoreSurfaceEvidence = latestMatchingEvidence(/^evidence\/minima-core-zk-surface-.*\.json$/, (data) =>
  data.schema === "minima-core-zk-surface-inspection/v1"
  && data.status === "source-inspected"
  && data.phaseGatePassed === false
  && data.validatorSha256 === minimaCoreSurfaceValidatorSha256
  && data.repository === "https://github.com/minima-global/Minima.git"
  && data.commit === "52542f25605a28a776e9b3b43b0808a05dceab01"
  && data.javaFilesScanned === 456
  && data.checks?.noNativeZkFunctionFound === true
  && data.checks?.witnessHasOnlyThreeProofCollections === true);

const p7ThresholdValidatorSha256 = digest("validate-usdtm-p7-threshold.mjs");
const currentP7ThresholdEvidence = latestMatchingEvidence(/^evidence\/usdtm-p7-threshold-validation-.*\.json$/, (data) =>
  data.schema === "usdtm-p7-threshold-validation/v1"
  && data.status === "semantic-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === p7ThresholdValidatorSha256
  && data.committeeSize === 7
  && data.threshold === 5
  && data.colludingQuorumFalseClaimAccepted === true
  && data.exactSignedTxPowMeasured === false
  && data.mainnetTransactionMined === false
  && data.operatorIndependenceProved === false);

const treeKeyValidatorSha256 = digest("validate-minima-treekey-signatures.mjs");
const treeKeyHarnessSha256 = digest("p7/TreeKeySignatureBenchmark.java");
const currentTreeKeySignatureEvidence = latestMatchingEvidence(/^evidence\/minima-treekey-signature-validation-.*\.json$/, (data) =>
  data.schema === "usdtm-minima-treekey-signature-validation/v1"
  && data.status === "offline-partial-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === treeKeyValidatorSha256
  && data.harnessSha256 === treeKeyHarnessSha256
  && data.coreCommit === "52542f25605a28a776e9b3b43b0808a05dceab01"
  && data.benchmark?.operators === 5
  && data.benchmark?.fiveSerializedSignaturesBytes === 20625
  && data.benchmark?.allSignaturesVerified === true
  && data.exactSignedTxPowMeasured === false
  && data.mainnetTransactionMined === false);

const assetLaneValidatorSha256 = digest("validate-bridge-asset-lanes.mjs");
const currentAssetLaneEvidence = latestMatchingEvidence(/^evidence\/generic-bridge-asset-lane-validation-.*\.json$/, (data) =>
  data.schema === "generic-bridge-asset-lane-validation/v1"
  && data.status === "semantic-and-source-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === assetLaneValidatorSha256
   && data.laneCount === 2
   && data.assertionCount === 48
   && data.atomicRejectCount === 14
  && data.ethExactWeiModeled === true
  && data.ethSingleLimbMaximumWei === "18446744073709551615"
  && data.forcedEthExcludedFromAttributableCollateral === true
  && data.crossLaneReplayRejected === true
  && data.crossLaneStateIsolationChecked === true
  && data.tokenCreate18DecimalsRuntimeExecuted === false
  && data.kissRuntimeExecuted === false);

const genericAttestationValidatorSha256 = digest("validate-generic-attestation-records.mjs");
const currentGenericAttestationEvidence = latestMatchingEvidence(/^evidence\/generic-attestation-validation-.*\.json$/, (data) =>
  data.schema === "generic-bridge-attestation-validation/v1"
  && data.status === "canonical-bytes-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === genericAttestationValidatorSha256
  && data.recordBytes === 444
  && data.fieldCount === 31
  && data.laneCount === 2
  && data.mutationCount === 62
  && data.transactionBoundSignatures === true
  && data.mainnetTransactionMined === false);

const genericTxpowValidatorSha256 = digest("validate-generic-lane-txpow.mjs");
const genericTxpowHarnessSha256 = digest("p7/GenericLaneTxPowBenchmark.java");
const currentGenericTxpowEvidence = latestMatchingEvidence(/^evidence\/generic-p7-txpow-validation-.*\.json$/, (data) =>
  data.schema === "generic-bridge-p7-txpow-validation/v1"
  && data.status === "offline-complete-synthetic-pass"
  && data.phaseGatePassed === false
  && data.validatorSha256 === genericTxpowValidatorSha256
  && data.harnessSha256 === genericTxpowHarnessSha256
  && data.coreCommit === "52542f25605a28a776e9b3b43b0808a05dceab01"
  && data.laneCount === 2
  && data.exactOfflineSignedTxPowMeasured === true
  && data.syntheticCoinProofs === true
  && data.nodeTxncheckExecutedByThisOfflineHarness === false
  && data.eighteenDecimalTokenUsedByThisHarness === false
  && data.candidateV2MainnetTransitionMined === true
  && data.mutationsPerLane === 66
   && data.lanes?.every((lane) => lane.controlScriptPassed === true
     && lane.reserveScriptPassed === true
     && lane.equalHeadControlPassed === true
     && lane.equalHeadReservePassed === true
     && lane.staleOriginalSignaturesRejected === true
     && lane.staleSignatureRecordFieldMutationsRejected === 31
     && lane.authorizedStructuralMutationsRejected === 14
     && lane.freshlySignedPreservedStatePortsRejected === 6
     && lane.mutationsRejected?.payoutCursorAdvanceWithoutAck === true
     && lane.mutationsRejected?.payoutCumulativeAdvanceWithoutAck === true
     && lane.mutationsRejected?.equalHeadChangedBalance === true
     && lane.mutationsRejected?.equalHeadChangedBlockHash === true
     && lane.mutationsRejected?.sourceTimeBeyondFutureSkew === true
     && lane.mutationsRejected?.sourceTimeBeyondMaximumAge === true
     && lane.mutationsRejected?.acceptedHeadBlockInFuture === true
     && lane.mutationsRejected?.acceptedHeadBlockRollback === true
     && lane.mutationsRejected?.acceptedHeadBlockBeyondPostingLag === true
     && Object.values(lane.acceptedHeadBlockBoundaries || {}).length === 4
     && Object.values(lane.acceptedHeadBlockBoundaries || {}).every((value) => value === true)
     && lane.serializedTxPowBytes < 65536
     && lane.controlInstructions < 1024
     && lane.equalHeadControlInstructions < 1024));

const scopeValidatorSha256 = digest("validate-usdtm-scope.mjs");
const poolRoot = path.resolve(root, "..", "..", "..");
const repositoryRoot = String(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: poolRoot, encoding: "utf8", windowsHide: true })).trim();
const repositoryHead = String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).trim();
const protectedTreeHash = String(execFileSync("git", ["rev-parse", "HEAD:Pool/2_development"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).trim();
const currentRepositoryStatus = String(execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).trim();
const currentChangedPaths = currentRepositoryStatus ? currentRepositoryStatus.split(/\r?\n/).filter(Boolean) : [];
const scopeAllowedPrefix = "Pool/1_working_files/working-files/zk-light-client-research/";
const scopeAllowedExact = new Set(["Pool/1_working_files/working-files/zk-light-client-bridge-research-plan-2026-08-18.md"]);
const currentNormalizedPaths = currentChangedPaths.map((line) => {
  const normalized = line.replace(/\\/g, "/");
  const raw = normalized.match(/^(?:[ MADRCU?!]{2}\s+|[MADRCU?!]\s+)(.*)$/)?.[1] || normalized;
  return raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
});
const currentOutsideAllowlist = currentNormalizedPaths.filter((candidate) =>
  !candidate.startsWith(scopeAllowedPrefix) && !scopeAllowedExact.has(candidate));
const currentProtectedStatusText = String(execFileSync("git", ["status", "--short", "--untracked-files=all", "--", "Pool/2_development"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).trim();
const currentProtectedChanges = currentProtectedStatusText ? currentProtectedStatusText.split(/\r?\n/).filter(Boolean) : [];
const allScopeEvidence = evidenceFiles
  .filter((file) => /^evidence\/usdtm-scope-validation-.*\.json$/.test(file))
  .map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((item) => item && evidenceSidecarMatches(item.file))
  .sort((a, b) => String(a.data.createdAtUtc).localeCompare(String(b.data.createdAtUtc)));
const latestScopeEvidence = allScopeEvidence.length > 0 ? allScopeEvidence.at(-1) : null;
const currentScopeEvidence = latestScopeEvidence
  && latestScopeEvidence.data.status === "passed"
    && latestScopeEvidence.data.validatorSha256 === scopeValidatorSha256
    && latestScopeEvidence.data.protectedPath === "Pool/2_development"
    && latestScopeEvidence.data.repositoryHead === repositoryHead
    && latestScopeEvidence.data.protectedTreeHash === protectedTreeHash
    && latestScopeEvidence.data.outsideAllowlistCount === 0
    && latestScopeEvidence.data.protectedChangedPathCount === 0
  ? latestScopeEvidence.file
  : null;

if (!currentFixtureEvidence) throw new Error("No current RFC fixture evidence with a valid sidecar");
if (!currentConsensusFixtureEvidence) throw new Error("No current consensus fixture evidence with a valid sidecar");
if (!currentControlEvidence) throw new Error("No current control evidence with a valid sidecar");
if (!currentP1ModelEvidence) throw new Error("No current P1 model evidence with a valid sidecar");
if (!currentP2CancellationEvidence) throw new Error("No current P2 cancellation evidence with a valid sidecar");
if (!currentP2RecordsEvidence) throw new Error("No current P2 record evidence with a valid sidecar");
if (!currentP3ReferenceEvidence) throw new Error("No current P3 reference evidence with a valid sidecar");
if (!currentP4VaultModelEvidence) throw new Error("No current P4 partial-model evidence with a valid sidecar");
if (!currentP4EvmEvidence) throw new Error("No current P4 EVM evidence with a valid sidecar");
if (!currentMinimaCoreSurfaceEvidence) throw new Error("No current Minima Core ZK-surface evidence with a valid sidecar");
if (!currentP7ThresholdEvidence) throw new Error("No current P7 threshold semantic evidence with a valid sidecar");
if (!currentTreeKeySignatureEvidence) throw new Error("No current TreeKey signature-size evidence with a valid sidecar");
if (!currentAssetLaneEvidence) throw new Error("No current generic asset-lane evidence with a valid sidecar");
if (!currentGenericAttestationEvidence) throw new Error("No current generic attestation evidence with a valid sidecar");
if (!currentGenericTxpowEvidence) throw new Error("No current generic P7 TxPoW evidence with a valid sidecar");
if (currentOutsideAllowlist.length > 0 || currentProtectedChanges.length > 0) {
  throw new Error(`Current repository scope is dirty outside the research allowlist: ${currentOutsideAllowlist.length} outside path(s), ${currentProtectedChanges.length} protected path(s)`);
}
if (!currentScopeEvidence) throw new Error("No passed scope evidence matching current HEAD and protected tree");

const manifest = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "no-funds ZK light-client and native Minima verifier research",
  exclusions: [
    "upstream bare repository internals",
    "generated .sha256 sidecars",
    "this manifest itself"
  ],
  currentFixtureEvidence,
  currentFixtureSha256: fixtureDigest,
  currentValidatorSha256: validatorDigest,
  currentConsensusFixture,
  currentConsensusFixtureSha256,
  currentConsensusValidatorSha256: consensusValidatorSha256,
  currentConsensusFixtureEvidence,
  controlDocumentSha256,
  controlValidatorSha256,
  currentControlEvidence,
  p1ModelValidatorSha256,
  currentP1ModelEvidence,
  p2CancellationValidatorSha256,
  p2CancellationFixtureSha256,
  currentP2CancellationEvidence,
  p2RecordsValidatorSha256,
  p2RecordsFixtureSha256,
  currentP2RecordsEvidence,
  p3ReferenceValidatorSha256,
  currentP3ReferenceEvidence,
  p4VaultModelValidatorSha256,
  currentP4VaultModelEvidence,
  p4EvmValidatorSha256,
  currentP4EvmEvidence,
  minimaCoreSurfaceValidatorSha256,
  currentMinimaCoreSurfaceEvidence,
  p7ThresholdValidatorSha256,
  currentP7ThresholdEvidence,
  treeKeyValidatorSha256,
  treeKeyHarnessSha256,
  currentTreeKeySignatureEvidence,
  assetLaneValidatorSha256,
  currentAssetLaneEvidence,
  genericAttestationValidatorSha256,
  currentGenericAttestationEvidence,
  genericTxpowValidatorSha256,
  genericTxpowHarnessSha256,
  currentGenericTxpowEvidence,
  scopeValidatorSha256,
  currentScopeEvidence,
  repositoryHead,
  protectedTreeHash,
  manifestGeneratorSha256: digest("build-research-manifest.mjs"),
  files
};

fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, files: files.length }, null, 2));
