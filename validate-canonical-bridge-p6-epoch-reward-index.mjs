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
const testOutput = run(["test", "./test/AttestorEpochRewardIndexV1.js", "--build-profile", "production"]);
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
  "AttestorEpochRewardIndexV1.sol",
  "AttestorEpochRewardIndexV1.json"
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 8) throw new Error("Expected exactly 8 epoch-reward-index tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");

const callableFunctions = artifact.abi.filter((item) => item.type === "function");
const prohibitedPattern = /(claim|withdraw|redeem|release|transfer|sweep|rescue|slash|owner|admin|upgrade)/i;
const prohibitedFunctions = callableFunctions.filter((item) => prohibitedPattern.test(item.name));
const payableFunctions = callableFunctions.filter((item) => item.stateMutability === "payable");
if (prohibitedFunctions.length !== 0 || payableFunctions.length !== 0) {
  throw new Error("Reward index unexpectedly exposes a payable, privileged, claim or release function");
}

const result = {
  schema: "canonical-bridge-p6-epoch-reward-index-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  decision: "D-USDTM-026",
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  rewardIndexSourceSha256: fileSha("p6/contracts/AttestorEpochRewardIndexV1.sol"),
  treasurySourceSha256: fileSha("p6/contracts/AttestorFeeRewardTreasuryV1.sol"),
  bondVaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  exposureControllerSourceSha256: fileSha("p6/contracts/AttestorExposureControllerV1.sol"),
  laneFixtureSourceSha256: fileSha("p6/contracts/MockFeeLane.sol"),
  workRecorderFixtureSourceSha256: fileSha("p6/contracts/MockAttestorWorkRecorder.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  testSourceSha256: fileSha("p6/test/AttestorEpochRewardIndexV1.js"),
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
  payableFunctionCount: payableFunctions.length,
  privilegedClaimOrReleaseFunctionCount: prohibitedFunctions.length,
  provedLocally: [
    "The exact reward index is committed by the unanimous roster and bound to one bond vault, predicted treasury and two isolated fee assets.",
    "Only the bond vault can checkpoint a contribution change, and only the bound treasury can index confirmed bond-risk rewards.",
    "Every fully bonded member pool receives an equal bond-risk amount, avoiding a first-five signer reward race.",
    "Within one member pool, the member self-bond and voluntary depositor positions accrue pro rata to their recorded slashable capital.",
    "Reward-per-share debt prevents a future contribution change from inheriting already indexed rewards.",
    "USDT-like and ETH-like fee rewards use independent indexed accounting without a conversion oracle.",
    "Repeated confirmed-fee allocations accumulate, while indivisible epoch and per-share rounding remains unclaimed in treasury custody.",
    "Insufficient live bond custody rejects indexing and atomically rolls back fee custody and settlement-fee consumption.",
    "The index is non-custodial and exposes no payable, owner, administrator, upgrade, claim, withdrawal, transfer, slash, sweep or rescue function."
  ],
  blockers: [
    "Only the objectively measurable bond-risk bucket is indexed; readiness and participation records now finalize separately but are not allocated here.",
    "No culpability forfeiture, post-slash balance update or payout claim exists.",
    "Current one-way bonds cannot exercise a real post-index withdrawal or replacement checkpoint path.",
    "The existing P4 lanes are not integrated and the native-ETH fee representation remains a production adapter decision.",
    "Reward percentages, fee assets and legal treatment remain open under O-USDTM-013.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "This is local capital-weighted accounting at each confirmed fee event, not a complete availability or participation epoch.",
    "All members, depositors, assets, settlements, fees and reward values are disposable local fixtures.",
    "No public deployment, claim, payout, real fee, principal, security deposit, signature, Minima node action or chain transaction occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-epoch-reward-index-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
