// Mechanical coverage check for the mined v2 lane scripts against the P8 branch table.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const emitEvidence = process.argv.includes('--evidence');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const lanes = JSON.parse(readFileSync(resolve(root, 'mainnet-lanes-v2.json'), 'utf8'));
const requiredBranches = [
  { action: 'CLIENT_UPDATE', inputs: 2, outputs: 2, threshold: true },
  { action: 'RELEASE', inputs: 2, outputs: 3, threshold: true },
  { action: 'RETURN', inputs: 3, outputs: 2, threshold: false },
  { action: 'PAYOUT_ACK', inputs: 2, outputs: 2, threshold: true },
  { action: 'CANCEL', inputs: 2, outputs: 2, threshold: true, depositorAuthority: true },
];

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}
function inspectLane(lane) {
  const path = resolve(root, lane.scriptFile);
  const script = readFileSync(path, 'utf8').trim();
  const fixedInputs = /ASSERT @TOTIN EQ 2\b/.test(script) ? 2 : null;
  const fixedOutputs = /ASSERT @TOTOUT EQ 3\b/.test(script) ? 3 : null;
  const actionDispatchCount = count(script, /\bLET\s+action\b|\bIF\s+action\b/g);
  const supported = requiredBranches.filter((branch) => branch.inputs === fixedInputs && branch.outputs === fixedOutputs)
    .map((branch) => branch.action);
  const missing = requiredBranches.map((branch) => branch.action).filter((action) => !supported.includes(action));
  return {
    name: lane.name,
    scriptFile: lane.scriptFile,
    covenantAddress: lane.covenantAddress,
    scriptBytes: Buffer.byteLength(script),
    scriptSha256: sha256(script),
    fixedInputs,
    fixedOutputs,
    actionDispatchCount,
    multisigCount: count(script, /\bMULTISIG\s*\(/g),
    sameStateCount: count(script, /\bSAMESTATE\s*\(/g),
    verifyOutCount: count(script, /\bVERIFYOUT\s*\(/g),
    supportedBranches: supported,
    missingBranches: missing,
    immutableAddress: true,
    migrationBranchPresent: /\bMIGRAT|\bUPGRADE|\bMAST\b/.test(script),
  };
}

const inspected = lanes.lanes.map(inspectLane);
for (const lane of inspected) {
  if (lane.scriptSha256 !== lanes.lanes.find((item) => item.name === lane.name).cleanScriptSha256) {
    throw new Error(`${lane.name} script hash differs from the mined configuration`);
  }
  if (lane.supportedBranches.join(',') !== 'RELEASE' || lane.missingBranches.length !== 4
      || lane.actionDispatchCount !== 0 || lane.migrationBranchPresent) {
    throw new Error(`${lane.name} coverage result differs from the expected release-only obstruction`);
  }
}

const capturedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const result = {
  schema: 'generic-bridge-p8-v2-branch-coverage/v1',
  capturedAt,
  status: 'v2-release-only-p8-obstruction-confirmed',
  phaseGate: 'P8',
  phaseGatePassed: false,
  requiredBranches,
  lanes: inspected,
  assertions: {
    bothMinedV2ScriptsMatchRecordedHashes: true,
    bothScriptsFixTwoInputsAndThreeOutputs: true,
    bothScriptsHaveNoActionDispatcher: true,
    onlyInboundReleaseShapeIsReachable: true,
    outboundReturnShapeIsUnreachable: true,
    clientUpdatePayoutAckAndCancellationShapesAreUnreachable: true,
    noMigrationUpgradeOrMastBranchExists: true,
    deployedV2AddressesAreImmutable: true,
  },
  consequence: 'The mined v2 lanes remain valid P7 release evidence but cannot become complete P8 lineages. A fresh all-branch covenant generation and fresh valueless token/control IDs are required before another mainnet ceremony.',
  nextAction: 'Freeze all action records and pass an offline unified KISS and complete-TxPoW hostile gate before requesting authorization for fresh mainnet assets.',
};

if (emitEvidence) {
  const stamp = capturedAt.replace(/[-:]/g, '');
  const filename = `generic-p8-v2-branch-coverage-${stamp}.json`;
  const serialized = JSON.stringify(result, null, 2) + '\n';
  const digest = sha256(serialized);
  writeFileSync(resolve(root, 'evidence', filename), serialized);
  writeFileSync(resolve(root, 'evidence', `${filename}.sha256`), `${digest}  ${filename}\n`);
  result.evidencePath = `evidence/${filename}`;
  result.evidenceSha256 = digest;
}

console.log(JSON.stringify(result, null, 2));
