#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const emitEvidence = process.argv.includes('--evidence');
const file = resolve(positional[0] || 'USDTM-ZK-PROTOTYPE.md');
const text = readFileSync(file, 'utf8');
const failures = [];

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function ids(pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function requireUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) failures.push(`${label} is duplicated: ${value}`);
    seen.add(value);
  }
}

const requiredSections = [
  '## 1. Control panel',
  '## 2. Product definition',
  '## 3. Binding decision log',
  '## 4. Open founder decisions',
  '## 5. Findings log',
  '## 6. Phase board',
  '## 7. Detailed execution plan',
  '## 8. Evidence ladder',
  '## 9. Evidence register',
  '## 10. Execution journal',
  '## 12. Stop conditions',
];

for (const section of requiredSections) {
  requireCondition(text.includes(section), `missing required section: ${section}`);
}

requireCondition(!text.includes('\u2014'), 'document contains a forbidden em dash');
requireCondition(text.includes('Status: active research, valueless only'), 'top-level status is missing or changed');
requireCondition(text.includes('| Production status | Prohibited |'), 'production prohibition is missing');
requireCondition(text.includes('| Funds status | Purpose-created valueless USDTm and ETHm are locked in mainnet test covenants; no real USDT, ETH or production asset is present |'), 'valueless-only funds boundary is missing');
requireCondition(text.includes('R + I = F'), 'reserve conservation invariant is missing');
requireCondition(text.includes('I + P <= L'), 'collateral invariant is missing');
requireCondition(text.includes('PENDING`, `RELEASED`, `CANCELLED` and `REFUNDED'), 'proof-safe deposit lifecycle is missing');
requireCondition(text.includes('equal-amount lookalike'), 'reserve lookalike attack is missing');
requireCondition(text.includes('`F - 1`'), 'positive reserve floor and source capacity bound are missing');
requireCondition(text.includes('settlement-finality assumption'), 'late-fork conditional safety assumption is missing');
requireCondition(text.includes('fixed sibling output 1'), 'constructive reserve sibling topology is missing');
requireCondition(text.includes('`O-USDTM-002` through `O-USDTM-017`'), 'production gate does not include all founder decisions');
requireCondition(text.includes('validate-usdtm-scope.mjs'), 'file-scope validator is not referenced');
requireCondition(text.includes('runs with already-shipped mainnet primitives and'), 'stock-Core-only P7 boundary is missing');
requireCondition(text.includes('A locally modified Core would be a different network'), 'private Core fork exclusion is missing');
requireCondition(text.includes('must not be posted'), 'closed external-contact decision is missing');
requireCondition(text.includes('Every exact branch mines on Minima mainnet'), 'P8 mainnet mining requirement is missing');
requireCondition(text.includes('Exact transactions mine on Minima mainnet'), 'P9 mainnet mining requirement is missing');
requireCondition(text.includes('durable write-ahead state outside the rollback domain'), 'durable pre-sign WOTS reservation is missing');
requireCondition(text.includes('`D-USDTM-017`'), 'hybrid architecture decision is missing');
requireCondition(text.includes('Five-of-seven is a benchmark configuration, not a production-final quorum'), '5-of-7 benchmark limitation is missing');
requireCondition(text.includes('colluding-quorum counterexample'), 'threshold collusion boundary is missing');
requireCondition(text.includes('validate-usdtm-p7-threshold.mjs'), 'P7 threshold semantic validator is not referenced');
requireCondition(text.includes('No signer-only unrestricted spend exists'), 'threshold reserve branch does not prohibit signer-only spend');
requireCondition(text.includes('20,625 bytes'), 'offline five-signature measurement is missing');
requireCondition(text.includes('validate-minima-treekey-signatures.mjs'), 'TreeKey signature validator is not referenced');
requireCondition(text.includes('`D-USDTM-018`'), 'generic asset-lane decision is missing');
requireCondition(text.includes('18.446744073709551615 ETH'), 'exact single-limb ETH bound is missing');
requireCondition(text.includes('forced ETH'), 'forced native-balance boundary is missing');
requireCondition(text.includes('validate-bridge-asset-lanes.mjs'), 'generic asset-lane validator is not referenced');
requireCondition(text.includes('No branch may consume or recreate another lane'), 'cross-lane reserve isolation rule is missing');
requireCondition(text.includes('444 bytes'), 'generic canonical record size is missing');
requireCondition(text.includes('32,054 bytes'), 'native complete synthetic TxPoW measurement is missing');
requireCondition(text.includes('553') && text.includes('instructions'), 'executed P7 instruction measurement is missing');
requireCondition(text.includes('`O-USDTM-016`'), 'historical replay founder decision is missing');
requireCondition(text.includes('quorum-journal assumption'), 'historical replay trust boundary is missing');
requireCondition(text.includes('`D-USDTM-020`'), 'accepted historical replay decision is missing');
requireCondition(text.includes('`D-USDTM-021`'), 'authorized valueless mainnet ceremony is missing');
requireCondition(text.includes('P7 LIVE MAINNET REFUTATION'), 'live P7 refutation is missing');
requireCondition(text.includes('`D-USDTM-022`') && text.includes('P7 LIVE V2 MAINNET GATE PASSED')
  && text.includes('| `P8` | NOW |'), 'authorized v2 live pass or P8 handoff is missing');
requireCondition(text.includes('synthetic'), 'offline TxPoW evidence is not qualified as synthetic');

const phaseRows = [...text.matchAll(/^\| `(P\d+)` \| ([A-Z ]+) \|/gm)].map((match) => ({
  id: match[1],
  status: match[2],
}));
const expectedPhases = Array.from({ length: 14 }, (_, index) => `P${index}`);
requireCondition(phaseRows.length === expectedPhases.length, `expected 14 phase rows, found ${phaseRows.length}`);
requireUnique(phaseRows.map((row) => row.id), 'phase ID');
for (const phase of expectedPhases) {
  requireCondition(phaseRows.some((row) => row.id === phase), `missing phase row: ${phase}`);
}
const nowPhases = phaseRows.filter((row) => row.status === 'NOW');
requireCondition(nowPhases.length === 1, `expected exactly one NOW phase, found ${nowPhases.length}`);

const controlNow = text.match(/^\| NOW \| `([^`]+)` /m)?.[1];
requireCondition(Boolean(controlNow), 'control panel NOW phase is missing');
if (controlNow && nowPhases.length === 1) {
  requireCondition(controlNow === nowPhases[0].id, `control-panel NOW ${controlNow} disagrees with phase board ${nowPhases[0].id}`);
}

const decisionIds = ids(/^\| `(D-USDTM-\d+)` \|/gm);
const openIds = ids(/^\| `(O-USDTM-\d+)` \|/gm);
const findingIds = ids(/^\| `(F-USDTM-\d+)` \|/gm);
const evidenceIds = ids(/^\| `(E-USDTM-\d+)` \|/gm);

requireCondition(decisionIds.length >= 14, `expected at least 14 binding decisions, found ${decisionIds.length}`);
requireCondition(openIds.length >= 1, 'no open founder decisions were recorded');
requireCondition(findingIds.length >= 1, 'no findings were recorded');
requireCondition(evidenceIds.length >= 1, 'no evidence records were recorded');
requireUnique(decisionIds, 'decision ID');
requireUnique(openIds, 'open-decision ID');
requireUnique(findingIds, 'finding ID');
requireUnique(evidenceIds, 'evidence ID');

const evidenceReferences = [...new Set(
  [...text.matchAll(/`(evidence\/[A-Za-z0-9._-]+\.json)`/g)].map((match) => match[1]),
)];
for (const reference of evidenceReferences) {
  const artifact = resolve(dirname(file), reference);
  const sidecar = `${artifact}.sha256`;
  requireCondition(existsSync(artifact), `referenced evidence file is missing: ${reference}`);
  requireCondition(existsSync(sidecar), `referenced evidence sidecar is missing: ${reference}.sha256`);
  if (existsSync(artifact) && existsSync(sidecar)) {
    const actual = sha256(readFileSync(artifact));
    const recorded = readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0].toLowerCase();
    requireCondition(actual === recorded, `evidence sidecar mismatch: ${reference}`);
  }
}

const prohibitedClaims = [
  'production bridge is complete',
  'USDTm is Tether-issued',
  'USDTm is official USDT0',
  'native proof verification has passed',
];
for (const claim of prohibitedClaims) {
  requireCondition(!text.toLowerCase().includes(claim.toLowerCase()), `prohibited unsupported claim appears: ${claim}`);
}

if (failures.length) {
  console.error(`USDTm control validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const result = {
  status: 'passed',
  file,
  documentSha256: sha256(text),
  phaseCount: phaseRows.length,
  now: nowPhases[0].id,
  decisionCount: decisionIds.length,
  openDecisionCount: openIds.length,
  findingCount: findingIds.length,
  evidenceCount: evidenceIds.length,
  exactEvidenceReferencesChecked: evidenceReferences.length,
  noEmDash: true,
  fundsBoundary: 'valueless-only',
};

if (emitEvidence) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(dirname(file), 'evidence', `usdtm-control-validation-${stamp}.json`);
  const validatorText = readFileSync(new URL(import.meta.url), 'utf8');
  const evidence = {
    schema: 'usdtm-control-validation/v1',
    createdAtUtc: new Date().toISOString(),
    document: basename(file),
    documentSha256: result.documentSha256,
    validator: basename(new URL(import.meta.url).pathname),
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
