import { createHash } from 'node:crypto';

const layout = [
  { name: 'schemaVersion', bytes: 2 }, { name: 'direction', bytes: 1 },
  { name: 'laneVersion', bytes: 2 }, { name: 'sourceAssetKind', bytes: 1 },
  { name: 'sourceDecimals', bytes: 1 }, { name: 'destinationDecimals', bytes: 1 },
  { name: 'sourceQuantumAtoms', bytes: 8 }, { name: 'destinationQuantumAtoms', bytes: 8 },
  { name: 'laneExposureCapDestinationAtoms', bytes: 8 }, { name: 'ethereumChainId', bytes: 8 },
  { name: 'minimaNetwork', bytes: 32, hex: true }, { name: 'ethereumVault', bytes: 20, hex: true },
  { name: 'sourceAsset', bytes: 20, hex: true }, { name: 'laneId', bytes: 32, hex: true },
  { name: 'destinationTokenId', bytes: 32, hex: true }, { name: 'reserveCovenant', bytes: 32, hex: true },
  { name: 'depositId', bytes: 32, hex: true }, { name: 'amountSourceAtoms', bytes: 8 },
  { name: 'amountDestinationAtoms', bytes: 8 }, { name: 'minimaRecipient', bytes: 32, hex: true },
  { name: 'finalizedBlockNumber', bytes: 8 }, { name: 'finalizedBlockHash', bytes: 32, hex: true },
  { name: 'sourceRecordHash', bytes: 32, hex: true }, { name: 'vaultStateVersion', bytes: 8 },
  { name: 'vaultBalanceSourceAtoms', bytes: 8 }, { name: 'vaultPayoutCursor', bytes: 8 },
  { name: 'vaultCumulativePaidSourceAtoms', bytes: 8 }, { name: 'committeeEpoch', bytes: 4 },
  { name: 'committeeRoot', bytes: 32, hex: true }, { name: 'configurationEpoch', bytes: 8 },
  { name: 'sourceExecutionTimeMilliseconds', bytes: 8 },
];

export function independentlyEncode(record) {
  if (Object.keys(record).sort().join('|') !== layout.map(({ name }) => name).sort().join('|')) {
    throw new Error('independent encoder rejected field set');
  }
  const total = layout.reduce((sum, item) => sum + item.bytes, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const item of layout) {
    if (item.hex) {
      if (typeof record[item.name] !== 'string' || record[item.name].length !== item.bytes * 2 + 2 || !/^0x[0-9a-f]+$/.test(record[item.name])) {
        throw new Error(`independent encoder rejected ${item.name}`);
      }
      const bytes = Uint8Array.from(record[item.name].slice(2).match(/../g).map((part) => Number.parseInt(part, 16)));
      out.set(bytes, cursor);
    } else {
      let value = BigInt(record[item.name]);
      if (value < 0n || value >= 2n ** BigInt(item.bytes * 8)) throw new Error(`independent encoder overflow ${item.name}`);
      for (let index = item.bytes - 1; index >= 0; index -= 1) {
        out[cursor + index] = Number(value % 256n);
        value /= 256n;
      }
    }
    cursor += item.bytes;
  }
  return Buffer.from(out);
}

export function independentlyDigest(record) {
  const domain = createHash('sha3-256').update(Buffer.from('BRIDGE_LANE_ATTESTATION_V1', 'ascii')).digest();
  return `0x${createHash('sha3-256').update(Buffer.concat([domain, independentlyEncode(record)])).digest('hex')}`;
}
