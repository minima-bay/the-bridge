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
const testOutput = run(["test", "./test/AttestorDelegatedSecurityPoolV1.js", "--build-profile", "production"]);

const buildInfoDirectory = resolve(p6, "artifacts", "build-info");
const buildInfoFile = readdirSync(buildInfoDirectory)
  .filter((name) => name.endsWith(".json") && !name.endsWith(".output.json"))
  .sort()
  .at(-1);
if (!buildInfoFile) throw new Error("No P6 Hardhat build-info input found");
const buildInfo = JSON.parse(readFileSync(resolve(buildInfoDirectory, buildInfoFile), "utf8"));
const artifactPath = resolve(p6, "artifacts", "contracts", "AttestorBondVaultV1.sol", "AttestorBondVaultV1.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 6) throw new Error("Expected exactly 6 delegated-security-pool tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");

const callableFunctions = artifact.abi.filter((item) => item.type === "function");
const prohibitedPoolPattern = /(withdraw|redeem|transferShare|transferPosition|approveShare|mintShare|burnShare)/i;
const prohibitedPoolFunctions = callableFunctions.filter((item) => prohibitedPoolPattern.test(item.name));
if (prohibitedPoolFunctions.length !== 0) {
  throw new Error("Delegated security accounting unexpectedly exposes a transferable or releasable position");
}

const result = {
  schema: "canonical-bridge-p6-delegated-security-pool-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  decision: "D-USDTM-026",
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  vaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  rewardCheckpointFixtureSourceSha256: fileSha("p6/contracts/MockAttestorRewardIndex.sol"),
  workRecorderFixtureSourceSha256: fileSha("p6/contracts/MockAttestorWorkRecorder.sol"),
  testSourceSha256: fileSha("p6/test/AttestorDelegatedSecurityPoolV1.js"),
  configSha256: fileSha("p6/hardhat.config.js"),
  packageLockSha256: fileSha("p4/package-lock.json"),
  pinnedHardhatResolutionVerified: true,
  compiler: buildInfo.solcLongVersion,
  hardhat: buildInfo.toolVersions.hardhat,
  evmTarget: buildInfo.input.settings.evmVersion,
  optimizer: buildInfo.input.settings.optimizer,
  mochaTestsPassed: Number(match[1]),
  compilationObserved: /Compiled \d+ Solidity files?/.test(compileOutput),
  prohibitedTransferOrReleaseFunctionCount: prohibitedPoolFunctions.length,
  provedLocally: [
    "A public security depositor can choose one approved attestor and contribute only to that attestor's bond accounting.",
    "Delegated capital cannot consume the immutable minimum self-bond capacity.",
    "An attestor pool is not ready until its complete equal bond and minimum self-bond are both present.",
    "All seven mixed self/delegated pools can satisfy the existing unanimous roster activation gate.",
    "Zero, nonmember-target, excess-delegation and overfunding attempts reject atomically.",
    "Public contributions inherit exact balance-delta and callback-reentrancy protection.",
    "Depositor positions are internal non-transferable accounting with no withdrawal or redemption function."
  ],
  blockers: [
    "A separate local index accounts bond-risk rewards, and a separate work recorder challenge-finalizes action weights, but work-reward allocation and payout claims are not implemented.",
    "Objective slashing, first-loss execution and post-slash share accounting are not implemented.",
    "Asynchronous withdrawal requests, challenge windows and final claims are not implemented.",
    "The illustrative 30 percent self-bond is not a selected production value.",
    "Legal treatment and production asset selection remain open under O-USDTM-013.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "This is deliberately one-way local accounting because safe release depends on later risk gates.",
    "Bridge principal is not present in these contracts or tests; the separation claim is architectural and interface-scoped.",
    "No public deployment, security deposit, reward, real asset, signature, Minima node action or chain transaction occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-delegated-security-pool-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
