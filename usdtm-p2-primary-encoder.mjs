#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export const cancellationLayout = [
  ['domainTag', 'ascii', 32],
  ['schemaVersion', 'uint', 2],
  ['action', 'uint', 2],
  ['sourceChainId', 'uint', 8],
  ['sourceGenesisCommitment', 'hex', 32],
  ['destinationNetworkId', 'hex', 32],
  ['sourceBridgeDeploymentId', 'hex', 32],
  ['vaultAddress', 'hex', 20],
  ['destinationBridgeDeploymentId', 'hex', 32],
  ['reserveCovenantCommitment', 'hex', 32],
  ['sourceTokenAddress', 'hex', 20],
  ['destinationTokenId', 'hex', 32],
  ['sourceRecordId', 'hex', 32],
  ['messageId', 'hex', 32],
  ['sourceAmountAtoms', 'uint', 16],
  ['destinationAmountAtoms', 'uint', 16],
  ['decimalScale', 'uint', 4],
  ['minimaRecipient', 'hex', 32],
  ['refundRecipient', 'hex', 20],
  ['authorityScheme', 'uint', 2],
  ['authorityPublicKey', 'hex', 32],
  ['configurationEpoch', 'uint', 8],
  ['ethereumRecordStatus', 'uint', 1],
  ['expectedMinimaNullifierStatus', 'uint', 1],
  ['proofProgramVersion', 'uint', 4],
  ['verifierVersion', 'uint', 4],
  ['verificationKeyHash', 'hex', 32],
];

function encodeField(name, kind, width, value) {
  if (kind === 'ascii') {
    const bytes = Buffer.from(value, 'ascii');
    if (bytes.length > width || bytes.toString('ascii') !== value) throw new Error(`invalid ${name}`);
    const out = Buffer.alloc(width);
    bytes.copy(out);
    return out;
  }
  if (kind === 'hex') {
    if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${width * 2}}$`).test(value)) throw new Error(`invalid ${name}`);
    return Buffer.from(value, 'hex');
  }
  const number = BigInt(value);
  if (number < 0n || number >= (1n << BigInt(width * 8))) throw new Error(`out-of-range ${name}`);
  const out = Buffer.alloc(width);
  let remaining = number;
  for (let index = width - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return out;
}

export function encodeCancellationPrimary(record) {
  const exactKeys = cancellationLayout.map(([name]) => name);
  if (JSON.stringify(Object.keys(record)) !== JSON.stringify(exactKeys)) throw new Error('record fields or order differ from canonical layout');
  const encoded = Buffer.concat(cancellationLayout.map(([name, kind, width]) => encodeField(name, kind, width, record[name])));
  if (encoded.length !== 512) throw new Error('canonical cancellation record is not 512 bytes');
  return encoded;
}

export const hashCancellationPrimary = (record) => createHash('sha256').update(encodeCancellationPrimary(record)).digest('hex');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = JSON.parse(readFileSync(resolve(root, 'fixtures', 'usdtm-p2-cancellation-v1.json'), 'utf8'));
  const encoded = encodeCancellationPrimary(fixture.record);
  console.log(JSON.stringify({ bytes: encoded.length, encodedHex: encoded.toString('hex'), sha256: hashCancellationPrimary(fixture.record) }, null, 2));
}
