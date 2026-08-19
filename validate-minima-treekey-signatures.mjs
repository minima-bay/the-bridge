#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const emitEvidence = process.argv.includes('--evidence');
const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const harness = resolve(root, 'p7', 'TreeKeySignatureBenchmark.java');
const coreRoot = resolve(root, 'upstream', 'minima-core');
const minimaJar = resolve(coreRoot, 'jar', 'minima.jar');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  }).trim();
}

const outputRoot = mkdtempSync(join(tmpdir(), 'usdtm-p7-treekey-'));
const resolvedTempBase = `${realpathSync(tmpdir())}${sep}`.toLowerCase();
const resolvedOutputRoot = realpathSync(outputRoot).toLowerCase();
if (!resolvedOutputRoot.startsWith(resolvedTempBase) || !basename(resolvedOutputRoot).startsWith('usdtm-p7-treekey-')) {
  throw new Error(`refusing temporary cleanup outside expected root: ${resolvedOutputRoot}`);
}

let benchmark;
try {
  run('javac', ['--release', '8', '-cp', minimaJar, '-d', outputRoot, harness], { cwd: root });
  const classpath = `${outputRoot};${minimaJar}`;
  benchmark = JSON.parse(run('java', ['-cp', classpath, 'TreeKeySignatureBenchmark'], { cwd: root }));
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}

const commit = run('git', ['rev-parse', 'HEAD'], { cwd: coreRoot });
const expectedCommit = '52542f25605a28a776e9b3b43b0808a05dceab01';
const expectedJarSha256 = 'b22182ec5c9389fe52c7cababa79e7e7966726b8996d6a31593f8ae69232af20';
const checks = {
  pinnedCoreCommit: commit === expectedCommit,
  pinnedJar: sha256(readFileSync(minimaJar)) === expectedJarSha256,
  expectedSchema: benchmark.schema === 'minima-treekey-signature-benchmark/v1',
  fiveOperators: benchmark.operators === 5,
  defaultThreeLevels: benchmark.proofLevelsPerSignature === 3,
  signaturesVerified: benchmark.allSignaturesVerified === true,
  positiveStableSize: benchmark.minimumSerializedSignatureBytes > 0
    && benchmark.minimumSerializedSignatureBytes === benchmark.maximumSerializedSignatureBytes,
  fiveSignatureSumExact: benchmark.fiveSerializedSignaturesBytes
    === benchmark.minimumSerializedSignatureBytes * benchmark.operators,
  signaturesAloneBelowTxpowLimit: benchmark.fiveSerializedSignaturesBytes < 65_536,
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length > 0) {
  console.error(`Minima TreeKey signature benchmark failed: ${failed.join(', ')}`);
  process.exit(1);
}

const result = {
  schema: 'usdtm-minima-treekey-signature-validation/v1',
  status: 'offline-partial-pass',
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha256(readFileSync(sourcePath)),
  harness: 'p7/TreeKeySignatureBenchmark.java',
  harnessSha256: sha256(readFileSync(harness)),
  repository: 'https://github.com/minima-global/Minima.git',
  coreCommit: commit,
  minimaJarSha256: sha256(readFileSync(minimaJar)),
  benchmark,
  checks,
  txpowHardLimitBytes: 65_536,
  bytesRemainingAfterFiveSerializedSignaturesOnly: 65_536 - benchmark.fiveSerializedSignaturesBytes,
  exactSignedTxPowMeasured: false,
  scriptProofAndCoinProofsIncluded: false,
  kissRuntimeExecuted: false,
  txncheckExecuted: false,
  mainnetTransactionMined: false,
  evidenceMeaning: 'Exact offline serialization of five deterministic throwaway default TreeKey signatures against the pinned official jar; not a complete witness or transaction.',
  noNodeWalletTokenOrTransactionCommands: true,
};

if (emitEvidence) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `minima-treekey-signature-validation-${stamp}.json`);
  const serialized = `${JSON.stringify({ createdAtUtc: new Date().toISOString(), ...result }, null, 2)}\n`;
  writeFileSync(evidencePath, serialized, 'utf8');
  const evidenceSha256 = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`, 'utf8');
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
