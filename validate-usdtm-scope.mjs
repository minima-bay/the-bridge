#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const researchRoot = dirname(fileURLToPath(import.meta.url));
const poolRoot = resolve(researchRoot, '..', '..', '..');
const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: poolRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const protectedPath = 'Pool/2_development';
const allowedPrefix = 'Pool/1_working_files/working-files/zk-light-client-research/';
const allowedExact = new Set([
  'Pool/1_working_files/working-files/zk-light-client-bridge-research-plan-2026-08-18.md',
]);
const emitEvidence = process.argv.includes('--evidence');

function git(args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const status = git(['status', '--short', '--untracked-files=all']);
const protectedStatus = git(['status', '--short', '--untracked-files=all', '--', protectedPath]);
const head = git(['rev-parse', 'HEAD']);
const protectedTreeHash = git(['rev-parse', `HEAD:${protectedPath}`]);
const changedPaths = status ? status.split(/\r?\n/).filter(Boolean) : [];
const normalizedPaths = changedPaths.map((line) => {
  const normalized = line.replace(/\\/g, '/');
  const raw = normalized.match(/^(?:[ MADRCU?!]{2}\s+|[MADRCU?!]\s+)(.*)$/)?.[1] || normalized;
  return raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
});
const outsideAllowlist = changedPaths.filter((line, index) => {
  const candidate = normalizedPaths[index];
  return !candidate.startsWith(allowedPrefix) && !allowedExact.has(candidate);
});
const protectedChanges = protectedStatus ? protectedStatus.split(/\r?\n/).filter(Boolean) : [];
const result = {
  status: outsideAllowlist.length === 0 && protectedChanges.length === 0 ? 'passed' : 'failed',
  scope: 'current repository delta allowlist plus protected Pool/2_development check',
  repositoryHead: head,
  protectedPath,
  protectedTreeHash,
  repositoryChangedPathCount: changedPaths.length,
  changedPaths,
  allowedPrefix,
  allowedExact: [...allowedExact],
  outsideAllowlistCount: outsideAllowlist.length,
  outsideAllowlist,
  protectedChangedPathCount: protectedChanges.length,
  protectedChanges,
  limitation: 'This proves only that the current uncommitted repository delta is confined to the allowlist and that the protected path is clean relative to the recorded HEAD and tree. No trusted pre-slice baseline was preserved, so it does not attribute commits, concurrent work or transient writes.',
};

if (emitEvidence) {
  const evidenceRoot = resolve(researchRoot, 'evidence');
  mkdirSync(evidenceRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(evidenceRoot, `usdtm-scope-validation-${stamp}.json`);
  const validatorText = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const evidence = {
    schema: 'usdtm-scope-validation/v1',
    createdAtUtc: new Date().toISOString(),
    validator: basename(fileURLToPath(import.meta.url)),
    validatorSha256: sha256(validatorText),
    ...result,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(evidencePath, serialized, 'utf8');
  const evidenceHash = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceHash}  ${basename(evidencePath)}\n`, 'utf8');
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceHash;
}

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'passed' ? 0 : 1;
