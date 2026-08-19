#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const repo = resolve(root, "upstream", "minima-core");
const src = resolve(repo, "src");
const emitEvidence = process.argv.includes("--evidence");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(path, "utf8");
const git = (...args) => String(execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true })).trim();

function javaFiles(directory, output = []) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) javaFiles(path, output);
    else if (name.endsWith(".java")) output.push(path);
  }
  return output;
}

const registryPath = resolve(src, "org", "minima", "kissvm", "functions", "MinimaFunction.java");
const witnessPath = resolve(src, "org", "minima", "objects", "Witness.java");
const magicPath = resolve(src, "org", "minima", "objects", "Magic.java");
const contractPath = resolve(src, "org", "minima", "kissvm", "Contract.java");
const checkSigPath = resolve(src, "org", "minima", "kissvm", "functions", "sigs", "CHECKSIG.java");
const proofPath = resolve(src, "org", "minima", "kissvm", "functions", "sha", "PROOF.java");
const registry = read(registryPath);
const witness = read(witnessPath);
const magic = read(magicPath);
const contract = read(contractPath);
const allJava = javaFiles(src);
const zkPattern = /VERIFYZK|BLSVERIFY|PAIRING|ECRECOVER|Groth16|zero.?knowledge|zk.?proof|SNARK|STARK/i;
const zkMatches = [];
for (const file of allJava) {
  const lines = read(file).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (zkPattern.test(line)) zkMatches.push({ file: relative(repo, file).replaceAll("\\", "/"), line: index + 1, text: line.trim() });
  });
}

const checks = {
  officialRemote: /^https:\/\/github\.com\/minima-global\/Minima(?:\.git)?$/.test(git("remote", "get-url", "origin")),
  functionRegistryHasCurrentCryptoSurface: registry.includes("new SHA2(), new SHA3(), new PROOF()") && registry.includes("new SIGNEDBY(), new MULTISIG(), new CHECKSIG()"),
  noNativeZkFunctionFound: zkMatches.length === 0,
  witnessHasOnlyThreeProofCollections: witness.includes("ArrayList<Signature> mSignatureProofs") && witness.includes("ArrayList<CoinProof> mCoinProofs") && witness.includes("ArrayList<ScriptProof> mScriptProofs") && !witness.includes("ZK"),
  hardTxpowLimit64KiB: magic.includes("MINMAX_TXPOW_SIZE") && magic.includes("64*1024"),
  hardKissLimit1024: magic.includes("MINMAX_KISSVM_OPERATIONS") && magic.includes("new MiniNumber(1024)"),
  contractDefaultLimit1024: contract.includes("MAX_INSTRUCTIONS = 1024"),
  checkSigPresent: read(checkSigPath).includes("class CHECKSIG extends MinimaFunction"),
  mmrProofPresent: read(proofPath).includes("class PROOF extends MinimaFunction")
};
for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`Source check failed: ${name}`);

const files = [registryPath, witnessPath, magicPath, contractPath, checkSigPath, proofPath].map((path) => ({
  file: relative(repo, path).replaceAll("\\", "/"),
  sha256: sha(readFileSync(path))
}));
const result = {
  schema: "minima-core-zk-surface-inspection/v1",
  createdAtUtc: new Date().toISOString(),
  status: "source-inspected",
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  repository: git("remote", "get-url", "origin"),
  commit: git("rev-parse", "HEAD"),
  commitDate: git("show", "-s", "--format=%cI", "HEAD"),
  shallowClone: git("rev-parse", "--is-shallow-repository") === "true",
  javaFilesScanned: allJava.length,
  zkSurfaceMatches: zkMatches,
  checks,
  inspectedFiles: files,
  conclusion: "The inspected Core source has no native general ZK verifier and no generic proof-witness collection. The native-verifier path requires a consensus-level Core change, which D-USDTM-016 excludes. A proof-only bridge now needs an exact verifier built entirely from already-shipped primitives under current limits.",
  blocker: "No exact stock-Core verifier has been demonstrated within the 1,024-operation and 64 KiB limits; a Core fork, new opcode or maintainer commitment cannot pass the revised P7 gate.",
  limitations: [
    "Source inspection is not node runtime, consensus activation, benchmark or mined-transaction evidence.",
    "The clone is pinned to one official commit; later Core revisions may change the surface.",
    "No Core fork, build, network message, wallet command, signature, token or transaction occurred."
  ]
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidencePath = resolve(root, "evidence", `minima-core-zk-surface-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
