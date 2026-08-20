#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const emitEvidence = process.argv.includes('--evidence');

function git(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const repositoryRoot = git(['rev-parse', '--show-toplevel']);
const head = git(['rev-parse', 'HEAD']);
const status = git(['status', '--short', '--untracked-files=all']);
const changedPaths = status ? status.split(/\r?\n/).filter(Boolean) : [];
const rootMatches = resolve(repositoryRoot) === resolve(projectRoot);
const result = {
  status: rootMatches ? 'passed' : 'failed',
  schema: 'bridge-standalone-scope-validation/v2',
  scope: 'standalone Bay-level The Bridge repository',
  repositoryRoot,
  projectRoot,
  repositoryHead: head,
  rootMatches,
  repositoryChangedPathCount: changedPaths.length,
  changedPaths,
  outsideRepositoryChangedPathCount: 0,
  limitation: 'Git can attest only to paths inside this standalone repository. The Bay parent repository and sibling projects require their own scoped review.',
};

if (emitEvidence) {
  const evidenceRoot = resolve(projectRoot, 'evidence');
  mkdirSync(evidenceRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(evidenceRoot, `bridge-standalone-scope-validation-${stamp}.json`);
  const validatorText = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const evidence = {
    ...result,
    createdAtUtc: new Date().toISOString(),
    validator: basename(fileURLToPath(import.meta.url)),
    validatorSha256: sha256(validatorText),
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
