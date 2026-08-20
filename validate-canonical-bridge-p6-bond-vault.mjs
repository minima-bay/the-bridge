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
const testOutput = run(["test", "./test/AttestorBondVaultV1.js", "--build-profile", "production"]);

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

if (!match || Number(match[1]) !== 8) throw new Error("Expected exactly 8 passing P6 bond-vault tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) {
  throw new Error("Optimizer profile mismatch");
}
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");
if (!artifact.bytecode?.startsWith("0x") || !artifact.deployedBytecode?.startsWith("0x")) {
  throw new Error("Compiled P6 bond-vault bytecode is missing");
}

const callableFunctions = artifact.abi.filter((item) => item.type === "function");
const payableFunctions = callableFunctions.filter((item) => item.stateMutability === "payable");
const forbiddenPattern = /(owner|admin|upgrade|withdraw|slash|sweep|rescue)/i;
const forbiddenFunctions = callableFunctions.filter((item) => forbiddenPattern.test(item.name));
if (payableFunctions.length !== 0) throw new Error("Bond vault unexpectedly has a payable function");
if (forbiddenFunctions.length !== 0) throw new Error("Bond vault unexpectedly has a privileged or release function");

const result = {
  schema: "canonical-bridge-p6-bond-vault-validation/v1",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  vaultSourceSha256: fileSha("p6/contracts/AttestorBondVaultV1.sol"),
  rosterSourceSha256: fileSha("p6/contracts/AttestorRosterRegistryV1.sol"),
  tokenFixtureSourceSha256: fileSha("p6/contracts/MockValuelessBondToken.sol"),
  rewardCheckpointFixtureSourceSha256: fileSha("p6/contracts/MockAttestorRewardIndex.sol"),
  workRecorderFixtureSourceSha256: fileSha("p6/contracts/MockAttestorWorkRecorder.sol"),
  testSourceSha256: fileSha("p6/test/AttestorBondVaultV1.js"),
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
  privilegedOrReleaseFunctionCount: forbiddenFunctions.length,
  provedLocally: [
    "A roster is registered only when its complete onchain fields reproduce its domain-separated hash and point back to this vault.",
    "Each of seven authorized members can post exactly one equal bond in the exact roster asset.",
    "The 80 percent individual and 20 percent mutual tranches partition the complete equal bond.",
    "The roster commits a minimum self-bond amount that delegated capital cannot replace.",
    "Roster readiness remains false until all seven exact bonds are accounted.",
    "Readiness becomes false if current aggregate custody falls below the accounted obligation for the bond asset.",
    "Fee-on-transfer, false-return, reverting and reentrant token behavior fails atomically.",
    "A no-return token is accepted only when the exact measured balance delta arrives.",
    "Unsolicited balances do not create member credit or readiness.",
    "The roster-committed reward index checkpoints contributor debt before any successful bond-balance increase.",
    "The vault exposes no payable, owner, administrator, upgrade, withdrawal, slash, sweep or rescue function."
  ],
  blockers: [
    "No withdrawal is implemented until liability, challenge, adjudication, claim and exit-delay gates exist.",
    "Local readiness and participation records exist separately, but no work-reward allocation, production objective slashing or claim distribution is implemented.",
    "The bond asset and economic values remain illustrative founder decisions.",
    "The bridge signature format still lacks an Ethereum-verifiable culpable-signer proof.",
    "P9 remains a partial pass and cannot authorize production bridge operation."
  ],
  limitations: [
    "The token, members and amounts are disposable local fixtures; no public contract or real bond exists.",
    "Current aggregate balance coverage does not prove economic quality, beneficial ownership or future behavior of a selected asset.",
    "No wallet signature, public transaction, token issuance, Minima node action or real asset was used."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `canonical-bridge-p6-bond-vault-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
