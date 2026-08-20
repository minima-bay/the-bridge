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
const testOutput = run([
  "test",
  "./test/AttestorWorkRewardIndexV1.js",
  "--build-profile",
  "production"
]);
const buildInfoDirectory = resolve(p6, "artifacts", "build-info");
const buildInfoFile = readdirSync(buildInfoDirectory)
  .filter((name) => name.endsWith(".json") && !name.endsWith(".output.json"))
  .sort()
  .at(-1);
if (!buildInfoFile) throw new Error("No P6 Hardhat build-info input found");
const buildInfo = JSON.parse(readFileSync(resolve(buildInfoDirectory, buildInfoFile), "utf8"));
const indexArtifact = JSON.parse(readFileSync(resolve(
  p6,
  "artifacts",
  "contracts",
  "AttestorWorkRewardIndexV1.sol",
  "AttestorWorkRewardIndexV1.json"
), "utf8"));
const treasuryArtifact = JSON.parse(readFileSync(resolve(
  p6,
  "artifacts",
  "contracts",
  "AttestorFeeRewardTreasuryV1.sol",
  "AttestorFeeRewardTreasuryV1.json"
), "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 8) throw new Error("Expected exactly 8 work-reward-index tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");

const callableFunctions = [...indexArtifact.abi, ...treasuryArtifact.abi]
  .filter((item) => item.type === "function");
const prohibitedPattern = /^(owner|admin|upgrade|claim|withdraw|redeem|release|transfer|payout|slash|sweep|rescue)/i;
const prohibitedFunctions = callableFunctions.filter((item) => prohibitedPattern.test(item.name));
const payableFunctions = callableFunctions.filter((item) => item.stateMutability === "payable");
if (prohibitedFunctions.length !== 0 || payableFunctions.length !== 0) {
  throw new Error("Work reward path unexpectedly exposes a payable, privileged, payout or custody escape function");
}

const result = {
  schema: "canonical-bridge-p6-work-reward-index-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  workRewardIndexSourceSha256: fileSha("p6/contracts/AttestorWorkRewardIndexV1.sol"),
  workEpochSourceSha256: fileSha("p6/contracts/AttestorWorkEpochV1.sol"),
  objectiveDecisionVerifierSourceSha256: fileSha("p6/contracts/ObjectiveDecisionVerifierV1.sol"),
  finalizedFactSourceFixtureSha256: fileSha("p6/contracts/MockFinalizedDecisionFactSource.sol"),
  feeTreasurySourceSha256: fileSha("p6/contracts/AttestorFeeRewardTreasuryV1.sol"),
  epochRewardIndexSourceSha256: fileSha("p6/contracts/AttestorEpochRewardIndexV1.sol"),
  bondVaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  exposureControllerSourceSha256: fileSha("p6/contracts/AttestorExposureControllerV1.sol"),
  laneFixtureSourceSha256: fileSha("p6/contracts/MockFeeLane.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  testSourceSha256: fileSha("p6/test/AttestorWorkRewardIndexV1.js"),
  configSha256: fileSha("p6/hardhat.config.js"),
  packageLockSha256: fileSha("p4/package-lock.json"),
  pinnedHardhatResolutionVerified: true,
  compiler: buildInfo.solcLongVersion,
  hardhat: buildInfo.toolVersions.hardhat,
  evmTarget: buildInfo.input.settings.evmVersion,
  optimizer: buildInfo.input.settings.optimizer,
  mochaTestsPassed: Number(match[1]),
  compilationObserved: /Compiled \d+ Solidity files?/.test(compileOutput),
  indexCreationBytecodeBytes: (indexArtifact.bytecode.length - 2) / 2,
  indexCreationBytecodeSha256: sha(Buffer.from(indexArtifact.bytecode.slice(2), "hex")),
  indexDeployedBytecodeBytes: (indexArtifact.deployedBytecode.length - 2) / 2,
  indexDeployedBytecodeSha256: sha(Buffer.from(indexArtifact.deployedBytecode.slice(2), "hex")),
  treasuryCreationBytecodeBytes: (treasuryArtifact.bytecode.length - 2) / 2,
  treasuryCreationBytecodeSha256: sha(Buffer.from(treasuryArtifact.bytecode.slice(2), "hex")),
  treasuryDeployedBytecodeBytes: (treasuryArtifact.deployedBytecode.length - 2) / 2,
  treasuryDeployedBytecodeSha256: sha(Buffer.from(treasuryArtifact.deployedBytecode.slice(2), "hex")),
  payableFunctionCount: payableFunctions.length,
  privilegedPayoutOrCustodyEscapeFunctionCount: prohibitedFunctions.length,
  provedLocally: [
    "The roster, recorder, treasury, exposure controller, bond index and one future work-reward index form one exact immutable deployment graph.",
    "The work-reward index must register with the exact treasury before the work epoch starts, and neither an alternate index nor late registration can replace it.",
    "Only confirmed bridge fees collected within the exact inclusive work-epoch block interval contribute readiness and participation amounts to that epoch.",
    "Only challenge-finalized readiness and participation weights can consume the two epoch-specific pools, permissionlessly and exactly once per configured fee asset.",
    "A successfully challenged decision contributes no participation reward, while timely APPROVE and REJECT decisions otherwise receive equal participation weight.",
    "Readiness and participation are allocated independently and proportionally across the exact seven finalized members.",
    "The two fee assets remain isolated; indexing one asset cannot consume or mutate the other asset's epoch pools or member balances.",
    "Integer division remainders and any zero-weight bucket stay explicitly unassigned in treasury custody instead of being invented, swept or awarded.",
    "Indexing changes accounting only: the treasury token balance is unchanged and neither the recorder nor index takes custody.",
    "The index and treasury expose no payable, owner, administrator, upgrade, claim, withdrawal, redemption, release, transfer, payout, slash, sweep or rescue entrypoint."
  ],
  blockers: [
    "The finalized-fact source is still a disposable local fixture, not a production Ethereum or Minima finality verifier.",
    "The lane request digest is not yet proven to be the canonical P4 settlement preimage.",
    "The Ethereum accountability key is not yet inseparably bound to the same member's Minima WOTS authorization.",
    "Indexed work rewards are accounting records only; no production-safe claim or payout lifecycle exists.",
    "No post-challenge culpability, forfeiture, slashing, appeal or insurance-loss allocation lifecycle exists.",
    "The fee split, epoch length, readiness windows and challenge delay remain illustrative policy parameters.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "This validates deterministic local indexing of one finalized work epoch, not the honesty, availability or independence of an attestor set.",
    "All assets, lanes, members, bonds, work records, finality facts, fees and settlements were disposable local fixtures.",
    "No claim, payout, slash, public deployment, public-chain transaction, Minima node action or Minima WOTS signature occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-work-reward-index-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
