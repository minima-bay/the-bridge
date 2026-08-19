#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const p4 = resolve(root, "p4");
const emitEvidence = process.argv.includes("--evidence");
const npmCli = process.platform === "win32"
  ? resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : null;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fileSha = (relative) => sha(readFileSync(resolve(root, relative)));

function run(args) {
  const executable = npmCli ? process.execPath : "npm";
  const effectiveArgs = npmCli ? [npmCli, ...args] : args;
  return execFileSync(executable, effectiveArgs, {
    cwd: p4,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

run(["exec", "--", "hardhat", "clean"]);
const compileOutput = run(["run", "compile"]);
const testOutput = run(["test"]);
const auditOutput = run(["audit", "--audit-level=high", "--json"]);
const audit = JSON.parse(auditOutput);

const buildInfoDirectory = resolve(p4, "artifacts", "build-info");
const buildInfoFile = readdirSync(buildInfoDirectory)
  .filter((name) => name.endsWith(".json") && !name.endsWith(".output.json"))
  .sort()
  .at(-1);
if (!buildInfoFile) throw new Error("No Hardhat build-info input found");
const buildInfo = JSON.parse(readFileSync(resolve(buildInfoDirectory, buildInfoFile), "utf8"));
const artifactPath = resolve(p4, "artifacts", "contracts", "USDTmVaultV1.sol", "USDTmVaultV1.json");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const nativeArtifactPath = resolve(p4, "artifacts", "contracts", "NativeAssetVaultV1.sol", "NativeAssetVaultV1.json");
const nativeArtifact = JSON.parse(readFileSync(nativeArtifactPath, "utf8"));
const match = testOutput.match(/(\d+) passing/);
if (!match || Number(match[1]) !== 22) throw new Error("Expected exactly 22 passing EVM tests");
if (buildInfo.solcLongVersion !== "0.8.24+commit.e11b9ed9") throw new Error("Unexpected Solidity compiler build");
if (buildInfo.toolVersions?.hardhat !== "3.13.0") throw new Error("Unexpected Hardhat version");
if (buildInfo.input?.settings?.optimizer?.enabled !== true || buildInfo.input.settings.optimizer.runs !== 200) throw new Error("Optimizer profile mismatch");
if (buildInfo.input?.settings?.evmVersion !== "shanghai") throw new Error("Unexpected EVM target");
if (!artifact.bytecode?.startsWith("0x") || !artifact.deployedBytecode?.startsWith("0x")) throw new Error("Compiled bytecode is missing");
if (!nativeArtifact.bytecode?.startsWith("0x") || !nativeArtifact.deployedBytecode?.startsWith("0x")) throw new Error("Compiled native bytecode is missing");
const auditCounts = audit.metadata?.vulnerabilities ?? {};
if ((auditCounts.critical ?? 0) !== 0 || (auditCounts.high ?? 0) !== 0 || (auditCounts.moderate ?? 0) !== 0) throw new Error("Dependency audit has moderate-or-higher findings");

const result = {
  schema: "generic-bridge-p4-evm-validation/v2",
  createdAtUtc: new Date().toISOString(),
  status: "local-pass",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  packageLockSha256: fileSha("p4/package-lock.json"),
  configSha256: fileSha("p4/hardhat.config.js"),
  testSourceSha256: fileSha("p4/test/USDTmVaultV1.js"),
  nativeTestSourceSha256: fileSha("p4/test/NativeAssetVaultV1.js"),
  vaultSourceSha256: fileSha("p4/contracts/USDTmVaultV1.sol"),
  nativeVaultSourceSha256: fileSha("p4/contracts/NativeAssetVaultV1.sol"),
  nativeReceiverSourceSha256: fileSha("p4/contracts/MockNativeReceiver.sol"),
  compiler: buildInfo.solcLongVersion,
  hardhat: buildInfo.toolVersions.hardhat,
  evmTarget: buildInfo.input.settings.evmVersion,
  optimizer: buildInfo.input.settings.optimizer,
  mochaTestsPassed: Number(match[1]),
  compilationObserved: /Compiled \d+ Solidity files/.test(compileOutput),
  creationBytecodeBytes: (artifact.bytecode.length - 2) / 2,
  creationBytecodeSha256: sha(Buffer.from(artifact.bytecode.slice(2), "hex")),
  deployedBytecodeTemplateBytes: (artifact.deployedBytecode.length - 2) / 2,
  deployedBytecodeTemplateSha256: sha(Buffer.from(artifact.deployedBytecode.slice(2), "hex")),
  nativeCreationBytecodeBytes: (nativeArtifact.bytecode.length - 2) / 2,
  nativeCreationBytecodeSha256: sha(Buffer.from(nativeArtifact.bytecode.slice(2), "hex")),
  nativeDeployedBytecodeTemplateBytes: (nativeArtifact.deployedBytecode.length - 2) / 2,
  nativeDeployedBytecodeTemplateSha256: sha(Buffer.from(nativeArtifact.deployedBytecode.slice(2), "hex")),
  dependencyAudit: {
    critical: auditCounts.critical ?? 0,
    high: auditCounts.high ?? 0,
    moderate: auditCounts.moderate ?? 0,
    low: auditCounts.low ?? 0,
    info: auditCounts.info ?? 0
  },
  blockers: [
    "Bay law 14 still requires an independent hostile review of both ERC-20 and native-asset P4 lanes before the phase gate can pass.",
    "The generic canonical lane-record bytes and native ETH proof-verifier binding are not yet frozen."
  ],
  limitations: [
    "This is local Hardhat EVM execution with a mock token, native ETH and a mock proof verifier, not a public-chain deployment.",
    "MockMinimaProofVerifier proves interface behavior only and never establishes Minima proof authenticity; that is intentionally outside P4.",
    "The 11 low dependency-audit findings are transitive optional verification and ignition tooling findings with no available fix in the pinned toolbox graph.",
    "Forced ETH is tested with a throwaway SELFDESTRUCT helper; EIP-6780 retains the transfer behavior but changes code-deletion semantics.",
    "No public network, wallet, signature, transaction post, token creation, persistent vault deployment, funds or mainnet action occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `usdtm-p4-evm-validation-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
