#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAIN, FIELDS, RECORD_BYTES, encodeRecord, fieldOffsets, recordDigest } from './generic-attestation-primary.mjs';
import { independentlyDigest, independentlyEncode } from './generic-attestation-independent.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = fileURLToPath(import.meta.url);
const fixturePath = resolve(root, 'fixtures', 'generic-attestation-records-v1.json');
const emitEvidence = process.argv.includes('--evidence');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
let assertions = 0;
let mutationCount = 0;

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function sha(data) {
  return createHash('sha256').update(data).digest('hex');
}

function mutatedValue(record, name, width, kind) {
  if (kind === 'hex') {
    const last = record[name].at(-1);
    return `${record[name].slice(0, -1)}${last === '0' ? '1' : '0'}`;
  }
  const original = BigInt(record[name]);
  const max = (1n << BigInt(width * 8)) - 1n;
  return (original === max ? original - 1n : original + 1n).toString();
}

check(fixture.schema === 'generic-bridge-attestation-fixtures/v1', 'fixture schema');
check(RECORD_BYTES === 444, 'canonical record must remain 444 bytes');
check(fixture.records.length === 2, 'two lane fixtures required');

const results = [];
for (const item of fixture.records) {
  const primary = encodeRecord(item.record);
  const independent = independentlyEncode(item.record);
  check(primary.length === RECORD_BYTES, `${item.name} primary length`);
  check(independent.length === RECORD_BYTES, `${item.name} independent length`);
  check(primary.equals(independent), `${item.name} cross-encoder bytes`);
  check(recordDigest(item.record) === independentlyDigest(item.record), `${item.name} cross-encoder digest`);

  if (item.name === 'native-ethm') {
    check(item.record.sourceAssetKind === '0', 'ETH source kind');
    check(item.record.sourceAsset === `0x${'00'.repeat(20)}`, 'ETH zero-address sentinel');
    check(item.record.sourceDecimals === '18' && item.record.destinationDecimals === '18', 'ETH exact decimals');
    check(item.record.amountSourceAtoms === item.record.amountDestinationAtoms, 'ETH exact wei parity');
    check(BigInt(item.record.laneExposureCapDestinationAtoms) <= (1n << 64n) - 1n, 'ETH cap fits uint64');
  } else {
    check(item.record.sourceAssetKind === '1', 'ERC-20 source kind');
    check(item.record.sourceAsset !== `0x${'00'.repeat(20)}`, 'ERC-20 token is nonzero');
    check(item.record.sourceDecimals === '6' && item.record.destinationDecimals === '6', 'ERC-20 exact decimals');
  }

  const baselineDigest = recordDigest(item.record);
  for (const [name, width, kind] of FIELDS) {
    const mutated = { ...item.record, [name]: mutatedValue(item.record, name, width, kind) };
    check(recordDigest(mutated) !== baselineDigest, `${item.name} mutation detected: ${name}`);
    mutationCount += 1;
  }

  results.push({
    name: item.name,
    recordBytes: primary.length,
    encodedHex: `0x${primary.toString('hex')}`,
    recordDigest: baselineDigest,
  });
}

const offsets = fieldOffsets();
check(offsets.sourceExecutionTimeMilliseconds.offset + offsets.sourceExecutionTimeMilliseconds.width === RECORD_BYTES, 'offset table covers record');

const result = {
  schema: 'generic-bridge-attestation-validation/v1',
  status: 'canonical-bytes-pass',
  phaseGatePassed: false,
  validator: basename(sourcePath),
  validatorSha256: sha(readFileSync(sourcePath)),
  fixtureSha256: sha(readFileSync(fixturePath)),
  primaryEncoderSha256: sha(readFileSync(resolve(root, 'generic-attestation-primary.mjs'))),
  independentEncoderSha256: sha(readFileSync(resolve(root, 'generic-attestation-independent.mjs'))),
  domain: DOMAIN,
  recordBytes: RECORD_BYTES,
  fieldCount: FIELDS.length,
  laneCount: results.length,
  assertionCount: assertions,
  mutationCount,
  offsets,
  records: results,
  transactionBoundSignatures: true,
  kissRuntimeExecuted: false,
  exactSignedTxPowMeasured: false,
  txncheckExecuted: false,
  mainnetTransactionMined: false,
  noNodeWalletTokenSignatureOrTransactionCommands: true,
};

if (emitEvidence) {
  const createdAtUtc = new Date().toISOString();
  const stamp = createdAtUtc.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = resolve(root, 'evidence', `generic-attestation-validation-${stamp}.json`);
  const serialized = `${JSON.stringify({ createdAtUtc, ...result }, null, 2)}\n`;
  writeFileSync(evidencePath, serialized);
  const evidenceSha256 = sha(serialized);
  writeFileSync(`${evidencePath}.sha256`, `${evidenceSha256}  ${basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.evidenceSha256 = evidenceSha256;
}

console.log(JSON.stringify(result, null, 2));
