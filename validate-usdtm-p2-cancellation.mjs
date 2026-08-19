#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancellationLayout, encodeCancellationPrimary, hashCancellationPrimary } from './usdtm-p2-primary-encoder.mjs';
import { encodeCancellationIndependent, hashCancellationIndependent } from './usdtm-p2-independent-encoder.mjs';

const sourcePath = fileURLToPath(import.meta.url);
const root = dirname(sourcePath);
const fixturePath = resolve(root, 'fixtures', 'usdtm-p2-cancellation-v1.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const emitEvidence = process.argv.includes('--evidence');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assertions = [];
const ok = (name, condition) => {
  if (!condition) throw new Error(name);
  assertions.push(name);
};

const primary = encodeCancellationPrimary(fixture.record);
const independent = encodeCancellationIndependent(fixture.record);
ok('fixture schema is exact', fixture.schema === 'usdtm-p2-cancellation/v1');
ok('primary encoding is exactly 512 bytes', primary.length === 512 && fixture.encodedBytes === 512);
ok('independent encoding is exactly 512 bytes', independent.length === 512);
ok('independent encoders agree byte for byte', primary.equals(independent));
ok('primary hash matches fixed fixture', hashCancellationPrimary(fixture.record) === fixture.expectedSha256);
ok('independent hash matches fixed fixture', hashCancellationIndependent(fixture.record) === fixture.expectedSha256);

function mutate(name, kind, width, value) {
  if (kind === 'ascii') return `${value}X`;
  if (kind === 'hex') return `${value[0] === 'f' ? 'e' : 'f'}${value.slice(1)}`;
  const max = (1n << BigInt(width * 8)) - 1n;
  const current = BigInt(value);
  return String(current === max ? current - 1n : current + 1n);
}

const mutations = [];
for (const [name, kind, width] of cancellationLayout) {
  const changed = { ...fixture.record, [name]: mutate(name, kind, width, fixture.record[name]) };
  const a = encodeCancellationPrimary(changed);
  const b = encodeCancellationIndependent(changed);
  const detected = a.equals(b) && sha256(a) !== fixture.expectedSha256;
  ok(`security-bound field mutation changes digest: ${name}`, detected);
  mutations.push({ field: name, detected });
}

const forbidden = [
  ['Ethereum REFUNDED is not PENDING', { ethereumRecordStatus: '2' }],
  ['Minima RELEASED is not EMPTY', { expectedMinimaNullifierStatus: '1' }],
  ['Minima CANCELLED is not EMPTY', { expectedMinimaNullifierStatus: '2' }],
  ['RELEASE action is not CANCEL', { action: '2' }],
];
for (const [name, patch] of forbidden) {
  const changed = { ...fixture.record, ...patch };
  ok(name, hashCancellationPrimary(changed) !== fixture.expectedSha256 && hashCancellationIndependent(changed) !== fixture.expectedSha256);
}

const result = {
  schema: 'usdtm-p2-cancellation-validation/v1',
  createdAtUtc: new Date().toISOString(),
  status: 'passed',
  validator: basename(sourcePath),
  validatorSha256: sha256(readFileSync(sourcePath)),
  fixture: 'fixtures/usdtm-p2-cancellation-v1.json',
  fixtureSha256: sha256(readFileSync(fixturePath)),
  encodedBytes: primary.length,
  recordSha256: fixture.expectedSha256,
  assertionCount: assertions.length,
  fieldMutationCount: mutations.length,
  mutationsDetected: mutations.filter((item) => item.detected).length,
  forbiddenStateOrActionCount: forbidden.length,
  limitations: [
    'This validator covers the cancellation authorization record only; the separate current P2 record validator covers deposit, refund, redemption, payout-batch and client-state bytes.',
    'Authority scheme 1 and its 32-byte key are schema values only; no Minima signature opcode or runtime verification executed.',
    'The fixture proves deterministic local bytes and mutation sensitivity, not source inclusion, finality, ZK verification, KISS execution or mineability.',
    'No network, transaction, token, vault, funds or mainnet action occurred.',
  ],
};

if (emitEvidence) {
  const stamp = result.createdAtUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `usdtm-p2-cancellation-validation-${stamp}.json`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(evidencePath, serialized, 'utf8');
  const evidenceSha256 = sha256(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`, 'utf8');
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
