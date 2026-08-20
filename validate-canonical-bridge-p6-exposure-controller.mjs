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
const testOutput = run(["test", "./test/AttestorExposureControllerV1.js", "--build-profile", "production"]);

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
  "AttestorExposureControllerV1.sol",
  "AttestorExposureControllerV1.json"
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 7) throw new Error("Expected exactly 7 passing P6 exposure-controller tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");
if (!artifact.bytecode?.startsWith("0x") || !artifact.deployedBytecode?.startsWith("0x")) {
  throw new Error("Compiled P6 exposure-controller bytecode is missing");
}

const callableFunctions = artifact.abi.filter((item) => item.type === "function");
const payableFunctions = callableFunctions.filter((item) => item.stateMutability === "payable");
const privilegedPattern = /(owner|admin|upgrade|setLane|replaceLane|raiseCap|forgive|sweep|rescue)/i;
const privilegedFunctions = callableFunctions.filter((item) => privilegedPattern.test(item.name));
if (payableFunctions.length !== 0) throw new Error("Exposure controller unexpectedly has a payable function");
if (privilegedFunctions.length !== 0) throw new Error("Exposure controller unexpectedly has a privileged function");

const result = {
  schema: "canonical-bridge-p6-exposure-controller-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  controllerSourceSha256: fileSha("p6/contracts/AttestorExposureControllerV1.sol"),
  laneFixtureSourceSha256: fileSha("p6/contracts/MockExposureLane.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  bondVaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  rewardCheckpointFixtureSourceSha256: fileSha("p6/contracts/MockAttestorRewardIndex.sol"),
  workRecorderFixtureSourceSha256: fileSha("p6/contracts/MockAttestorWorkRecorder.sol"),
  testSourceSha256: fileSha("p6/test/AttestorExposureControllerV1.js"),
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
  privilegedFunctionCount: privilegedFunctions.length,
  provedLocally: [
    "Exactly two ordered lane contracts, their lane IDs, the bond vault and the controller address are committed by the roster policy hash.",
    "One aggregate cap is derived as equal bond times quorum times the immutable safety factor.",
    "Both lanes consume the same aggregate capacity rather than counting the committee bond twice.",
    "Settlement identities cannot replay across lanes, and resolution identities cannot replay.",
    "Inactive or underbonded rosters cannot increase liability.",
    "Authorized lanes can release only their own liability even while security is underbonded.",
    "Releasing liability reopens shared capacity without changing the immutable maximum.",
    "The controller has no payable, owner, administrator, upgrade, lane-replacement or cap-raising function."
  ],
  blockers: [
    "The existing P4 ERC-20 and native lane vaults are not wired to this controller; tests use disposable forwarding lanes.",
    "Retirement, replacement continuity, unresolved-slash state and security-runway pause are not yet integrated.",
    "The two-lane policy uses one illustrative bond denomination and does not solve multi-asset valuation.",
    "Production deterministic deployment requires an audited CREATE2 factory or equivalent commitment process.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "The local lane fixtures are deliberately callable by anyone and prove controller accounting only, not lane authorization logic.",
    "All addresses, liability amounts and bonds are disposable local fixtures.",
    "No public deployment, real asset, wallet signature, Minima node action or chain transaction occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-exposure-controller-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
