#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const p6 = resolve(root, "p6");
const hardhatCli = resolve(root, "p4", "node_modules", "hardhat", "dist", "src", "cli.js");
const emitEvidence = process.argv.includes("--evidence");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fileSha = (relative) => sha(readFileSync(resolve(root, relative)));

const p4HardhatPackage = realpathSync(resolve(root, "p4", "node_modules", "hardhat", "package.json"));
const p6HardhatPackage = realpathSync(resolve(root, "p6", "node_modules", "hardhat", "package.json"));
if (p4HardhatPackage !== p6HardhatPackage) {
  throw new Error("P6 must resolve the exact pinned P4 Hardhat installation");
}

function run(args) {
  return execFileSync(process.execPath, [hardhatCli, ...args], {
    cwd: p6,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

run(["clean"]);
const compileOutput = run(["compile", "--build-profile", "production"]);
const testOutput = run(["test", "./test/AttestorWorkEpochV1.js", "--build-profile", "production"]);
const buildInfoDirectory = resolve(p6, "artifacts", "build-info");
const buildInfoFile = readdirSync(buildInfoDirectory)
  .filter((name) => name.endsWith(".json") && !name.endsWith(".output.json"))
  .sort()
  .at(-1);
if (!buildInfoFile) throw new Error("No P6 Hardhat build-info input found");
const buildInfo = JSON.parse(readFileSync(resolve(buildInfoDirectory, buildInfoFile), "utf8"));
const artifactPath = resolve(
  p6,
  "artifacts",
  "contracts",
  "AttestorWorkEpochV1.sol",
  "AttestorWorkEpochV1.json"
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const verifierArtifactPath = resolve(
  p6,
  "artifacts",
  "contracts",
  "ObjectiveDecisionVerifierV1.sol",
  "ObjectiveDecisionVerifierV1.json"
);
const verifierArtifact = JSON.parse(readFileSync(verifierArtifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 12) throw new Error("Expected exactly 12 work-epoch tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");

const callableFunctions = [...artifact.abi, ...verifierArtifact.abi].filter((item) => item.type === "function");
const prohibitedPattern = /(claim|withdraw|redeem|release|transfer|payout|sweep|rescue|slash|owner|admin|upgrade)/i;
const prohibitedFunctions = callableFunctions.filter((item) => prohibitedPattern.test(item.name));
const payableFunctions = callableFunctions.filter((item) => item.stateMutability === "payable");
if (prohibitedFunctions.length !== 0 || payableFunctions.length !== 0) {
  throw new Error("Work recorder unexpectedly exposes a payable, privileged, payout or custody function");
}

const result = {
  schema: "canonical-bridge-p6-work-epoch-validation/v2",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  workEpochSourceSha256: fileSha("p6/contracts/AttestorWorkEpochV1.sol"),
  objectiveDecisionVerifierSourceSha256: fileSha("p6/contracts/ObjectiveDecisionVerifierV1.sol"),
  finalizedFactSourceFixtureSha256: fileSha("p6/contracts/MockFinalizedDecisionFactSource.sol"),
  laneFixtureSourceSha256: fileSha("p6/contracts/MockFeeLane.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  bondVaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  exposureControllerSourceSha256: fileSha("p6/contracts/AttestorExposureControllerV1.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  testSourceSha256: fileSha("p6/test/AttestorWorkEpochV1.js"),
  configSha256: fileSha("p6/hardhat.config.js"),
  packageLockSha256: fileSha("p4/package-lock.json"),
  pinnedHardhatResolutionVerified: true,
  compiler: buildInfo.solcLongVersion,
  hardhat: buildInfo.toolVersions.hardhat,
  evmTarget: buildInfo.input.settings.evmVersion,
  optimizer: buildInfo.input.settings.optimizer,
  mochaTestsPassed: Number(match[1]),
  compilationObserved: /Compiled \d+ Solidity files?/.test(compileOutput),
  creationBytecodeBytes: (artifact.bytecode.length - 2) / 2,
  creationBytecodeSha256: sha(Buffer.from(artifact.bytecode.slice(2), "hex")),
  deployedBytecodeBytes: (artifact.deployedBytecode.length - 2) / 2,
  deployedBytecodeSha256: sha(Buffer.from(artifact.deployedBytecode.slice(2), "hex")),
  verifierCreationBytecodeBytes: (verifierArtifact.bytecode.length - 2) / 2,
  verifierCreationBytecodeSha256: sha(Buffer.from(verifierArtifact.bytecode.slice(2), "hex")),
  verifierDeployedBytecodeBytes: (verifierArtifact.deployedBytecode.length - 2) / 2,
  verifierDeployedBytecodeSha256: sha(Buffer.from(verifierArtifact.deployedBytecode.slice(2), "hex")),
  payableFunctionCount: payableFunctions.length,
  privilegedPayoutOrCustodyFunctionCount: prohibitedFunctions.length,
  provedLocally: [
    "The unanimous roster commits one exact work-recorder address, preventing an alternate recorder from claiming the epoch.",
    "A direct approved-member transaction records at most one readiness heartbeat per fixed window while the roster is active and all seven bonds remain posted.",
    "Only either exact exposure-controller lane can register a globally unique request identity and bounded decision deadline while the roster remains active and fully bonded.",
    "Each bonded roster member can submit exactly one timely APPROVE or REJECT record per request, both choices receive the same participation weight, and every record requires the member's valid accountability signature.",
    "The accountability signature is EIP-712 bound to the chain, verifier, work recorder, roster, request identity, request digest and exact decision.",
    "An exact immutable-source finalized fact proving the opposite decision removes exactly one participation unit.",
    "Two same-member EIP-712 signatures for opposite decisions on the exact same request objectively prove accountability equivocation without an external truth oracle.",
    "Malformed, high-s, wrong-chain, foreign-signer, foreign-digest, duplicate, outsider, inactive-roster, underbonded, nonfinal, same-decision and late records or proofs reject without changing weight.",
    "Anyone can finalize the immutable seven-member readiness and participation totals only after the complete challenge period.",
    "A hash-chain accumulator commits every accepted heartbeat, request, signed decision and successful challenge in order; failed attempts do not mutate it.",
    "The finalization digest binds the chain, recorder, roster, epoch windows, complete work accumulator, record counts, ordered member weights, totals and successful challenge count.",
    "The recorder is non-custodial and exposes no payable, owner, administrator, upgrade, payout, claim, withdrawal, release, transfer, slash, sweep or rescue function."
  ],
  blockers: [
    "The heartbeat proves only that an approved Ethereum key acted while the roster was active and fully bonded; it does not prove node uptime, Minima connectivity or correct offchain service.",
    "The decision record proves who submitted APPROVE or REJECT and when; it does not prove that the external bridge fact or decision was correct.",
    "The finalized-fact source is a disposable mutable fixture; no Ethereum or Minima finality proof is verified by it.",
    "The accountability ECDSA key is not yet inseparably bound to the member's Minima WOTS fund-moving authorization, so cross-chain culpable-signer attribution remains unproved.",
    "The lane request digest is caller supplied; production P4 adapters must bind it to canonical settlement data and prevent request spam.",
    "There is no challenge bond, challenger reward, culpability classification, forfeiture, slashing or appeal policy.",
    "A separate source-bound index now consumes the finalized weights, but claims, payouts and post-challenge forfeiture remain absent.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "This is a local objective-action record and delayed-finalization lifecycle, not a complete attestor correctness or availability proof.",
    "The fact source, lanes, members, bonds, assets, requests, decisions and evidence are disposable local fixtures.",
    "Disposable local ECDSA accountability signatures were generated. No Minima WOTS signature, public deployment, bridge transfer, reward, payout, slash, Minima node action or public-chain transaction occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-work-epoch-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
