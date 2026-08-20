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
const testOutput = run(["test", "./test/AttestorRosterRegistryV1.js", "--build-profile", "production"]);

const buildInfoDirectory = resolve(p6, "artifacts", "build-info");
const buildInfoFile = readdirSync(buildInfoDirectory)
  .filter((name) => name.endsWith(".json") && !name.endsWith(".output.json"))
  .sort()
  .at(-1);
if (!buildInfoFile) throw new Error("No P6 Hardhat build-info input found");
const buildInfo = JSON.parse(readFileSync(resolve(buildInfoDirectory, buildInfoFile), "utf8"));
const artifactPath = resolve(p6, "artifacts", "contracts", "AttestorRosterRegistryV1.sol", "AttestorRosterRegistryV1.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);

if (!match || Number(match[1]) !== 7) throw new Error("Expected exactly 7 passing P6 EVM tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");
if (!artifact.bytecode?.startsWith("0x") || !artifact.deployedBytecode?.startsWith("0x")) {
  throw new Error("Compiled P6 bytecode is missing");
}

const callableFunctions = artifact.abi.filter((item) => item.type === "function");
const payableFunctions = callableFunctions.filter((item) => item.stateMutability === "payable");
const privilegedNames = new Set(["owner", "admin", "upgradeTo", "upgradeToAndCall", "transferOwnership"]);
const privilegedFunctions = callableFunctions.filter((item) => privilegedNames.has(item.name));
if (payableFunctions.length !== 0) throw new Error("Moneyless roster unexpectedly has a payable function");
if (privilegedFunctions.length !== 0) throw new Error("Moneyless roster unexpectedly has a privileged function");

const result = {
  schema: "canonical-bridge-p6-roster-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  contractSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  mockBondReadinessSourceSha256: fileSha("p6/contracts/MockAttestorBondReadiness.sol"),
  mockRewardIndexSourceSha256: fileSha("p6/contracts/MockAttestorRewardIndex.sol"),
  mockWorkRecorderSourceSha256: fileSha("p6/contracts/MockAttestorWorkRecorder.sol"),
  testSourceSha256: fileSha("p6/test/AttestorRosterRegistryV1.js"),
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
    "Exactly seven unique nonzero candidates and a five-member operating quorum are pinned.",
    "All seven candidates must accept the exact ordered roster and policy commitment before activation.",
    "A candidate may withdraw acceptance before activation, and incomplete or not-fully-bonded rosters cannot activate.",
    "The activation delay, bridge identity, chain context, equal-bond proposal, reward index, work recorder, slash allocation, exposure cap, policy hash and dossier root are committed.",
    "A nonzero bounded minimum self-bond percentage is committed for every candidate pool.",
    "The registry has no payable, owner, administrator or upgrade function."
  ],
  blockers: [
    "Candidate identities, background-check dossiers, bond asset and exact self-bond and economic values remain governance decisions.",
    "The registry itself does not custody funds; local bond-risk indexing and work records exist, but work-reward allocation, withdrawal, production objective slashing and claims do not.",
    "The bridge message signature format does not yet attribute an objectively slashable signer set.",
    "P9 remains a partial pass, so this P6 component cannot authorize production bridge operation."
  ],
  limitations: [
    "This is a local moneyless Hardhat model, not a deployed contract or selected production roster.",
    "The candidate addresses and economic values used by the tests are disposable illustrative values.",
    "No wallet signature, public transaction, token, bond, collateral, node action or real asset was used."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-roster-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
