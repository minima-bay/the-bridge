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
const testOutput = run(["test", "./test/AttestorFeeRewardTreasuryV1.js", "--build-profile", "production"]);

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
  "AttestorFeeRewardTreasuryV1.sol",
  "AttestorFeeRewardTreasuryV1.json"
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 8) throw new Error("Expected exactly 8 fee-reward-treasury tests");
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
  throw new Error("Treasury unexpectedly exposes a payable, privileged or release function");
}

const result = {
  schema: "canonical-bridge-p6-fee-reward-treasury-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  decision: "D-USDTM-026",
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  treasurySourceSha256: fileSha("p6/contracts/AttestorFeeRewardTreasuryV1.sol"),
  rewardIndexSourceSha256: fileSha("p6/contracts/AttestorEpochRewardIndexV1.sol"),
  exposureControllerSourceSha256: fileSha("p6/contracts/AttestorExposureControllerV1.sol"),
  bondVaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  workRecorderFixtureSourceSha256: fileSha("p6/contracts/MockAttestorWorkRecorder.sol"),
  laneFixtureSourceSha256: fileSha("p6/contracts/MockFeeLane.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  testSourceSha256: fileSha("p6/test/AttestorFeeRewardTreasuryV1.js"),
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
  privilegedOrReleaseFunctionCount: prohibitedFunctions.length,
  provedLocally: [
    "Only the exact two exposure-controller lanes can collect a fee, and only after the same lane has confirmed the one-use settlement identity.",
    "A lane's fee asset and runway remain isolated from the other lane, with no cross-asset valuation or subsidy.",
    "The complete received fee is split into attestor, safety, relayer and operations ledgers without touching the lane principal.",
    "The attestor ledger is further split into readiness, participation and bond-risk pools, with rounding retained inside those fee ledgers.",
    "The bond-risk pool is atomically sent to the roster-committed non-custodial index for pro-rata member and delegated-security-depositor accounting.",
    "Cap rejection rolls the liability transition and fee collection back atomically in the production-shaped lane call.",
    "Fee-on-transfer, false-return and callback-reentrant token behavior fails atomically; exact no-return behavior is accepted.",
    "One-way bootstrap security funds contribute to an asset-specific minimum security-runway calculation.",
    "The treasury exposes no payable, owner, administrator, upgrade, claim, withdrawal, release, slash, sweep or rescue function."
  ],
  blockers: [
    "The existing P4 lane vaults do not yet route confirmed fees to this treasury; tests use disposable atomic lane callers.",
    "The exposure controller does not yet enforce the treasury's runway result before accepting new liability.",
    "A separate source-bound index now allocates challenge-finalized readiness and participation weights, but no forfeiture or depositor/member claim exists.",
    "The illustrative 50/20/10/20 protocol split and 60/25/15 attestor split are not selected production values.",
    "Objective slashing, asynchronous security-pool withdrawal and legal treatment remain open under O-USDTM-013.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "This is deliberately one-way local custody because payout safety depends on later attribution and risk gates.",
    "The fee assets, lane callers, members, settlements, budgets and amounts are disposable local fixtures.",
    "No public deployment, bridge fee, reward, principal, security deposit, signature, Minima node action or chain transaction occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-fee-reward-treasury-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
