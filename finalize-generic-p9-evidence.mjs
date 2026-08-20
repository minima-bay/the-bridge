#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WotsWriteAheadGuard, loadWotsPolicy, sha256Hex } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(root, 'evidence');
const policyPath = path.join(root, 'p9-wots-policy.json');
const journalDir = 'C:\\Users\\Charles\\Documents\\Crypto\\Minima\\WotsGuards\\BridgeTestSigners-P9';
const selected = {
  genesis: 'generic-p9-wots-journal-genesis-retired-20260819T204219Z.json',
  stale: 'generic-p9-wots-stale-node-retired-authenticated-20260819T204228Z.json',
  current: 'generic-p9-wots-current-node-retired-authenticated-20260819T204252Z.json',
};

async function readVerified(name) {
  const file = path.join(evidenceDir, name);
  const bytes = await fs.readFile(file);
  const sidecar = (await fs.readFile(`${file}.sha256`, 'utf8')).trim().split(/\s+/)[0];
  const actual = sha256Hex(bytes);
  if (sidecar !== actual) throw new Error(`sidecar mismatch: ${name}`);
  return { name, sha256: actual, value: JSON.parse(bytes.toString('utf8')) };
}

async function newest(prefix) {
  const names = (await fs.readdir(evidenceDir)).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort();
  if (!names.length) throw new Error(`no evidence for ${prefix}`);
  return readVerified(names.at(-1));
}

const [genesis, stale, current, guardValidation, boundaryValidation, authorityValidation,
  reconcilerValidation, loadedPolicy] = await Promise.all([
  readVerified(selected.genesis),
  readVerified(selected.stale),
  readVerified(selected.current),
  newest('generic-p9-wots-guard-'),
  newest('generic-p9-transaction-boundaries-'),
  newest('generic-p9-signing-authority-'),
  newest('generic-p9-chain-reconciler-'),
  loadWotsPolicy(policyPath),
]);
if (!loadedPolicy.verdict.ok || loadedPolicy.policy.signingEnabled !== false) throw new Error('final live policy is not retired');
if (genesis.value.verdict?.details?.policyHash !== loadedPolicy.policyHash) throw new Error('genesis policy hash is stale');
if (stale.value.verdict?.code !== 'COUNTER_ROLLBACK' || current.value.verdict?.code !== 'NODE_ACCEPTED') throw new Error('node verdicts differ');
if (!stale.value.wrapperRun?.stoppedCleanly || !stale.value.wrapperRun?.disposableCloneRemoved
  || !current.value.wrapperRun?.stoppedCleanly || !stale.value.wrapperRun?.rpcAuthenticated
  || !current.value.wrapperRun?.rpcAuthenticated) throw new Error('wrapper cleanup or RPC auth evidence differs');
if (guardValidation.value.result !== 'PASS' || boundaryValidation.value.result !== 'PASS'
  || authorityValidation.value.result !== 'PASS' || reconcilerValidation.value.result !== 'PASS') {
  throw new Error('offline validation is not passing');
}

function conservativeWrapperSummary(run) {
  return {
    cleanupRecordedAt: run.cleanupRecordedAt,
    mode: run.mode,
    coreJarSha256: run.coreJarSha256,
    p2pManagerEnabled: run.p2pManagerEnabled,
    rpcAuthenticated: run.rpcAuthenticated,
    rpcBindObservedBySourceInspection: run.rpcBindObservedBySourceInspection,
    isolatedBasePort: run.isolatedBasePort,
    isolatedRpcPort: run.isolatedRpcPort,
    staleSourceManifestSha256: run.staleSourceManifestSha256,
    staleCloneManifestMatched: run.staleCloneManifestMatched,
    processExitObservedAfterQuitAttempt: run.stoppedCleanly === true,
    gracefulQuitProven: false,
    disposableCloneRemoved: run.disposableCloneRemoved,
    originalPortsClosed: run.originalPortsClosed,
    isolatedPortsClosed: run.isolatedPortsClosed,
    networkIsolationProven: false,
    commandAllowlist: structuredClone(run.commandAllowlist),
  };
}

const observation = {
  nodeName: loadedPolicy.policy.nodeName,
  coreVersion: loadedPolicy.policy.coreVersion,
  committee: structuredClone(loadedPolicy.policy.committee),
  keys: loadedPolicy.policy.protectedKeys.map((entry) => ({
    publicKey: entry.publicKey,
    uses: current.value.protectedCounters[entry.id],
    ...current.value.protectedTreeKeyShape[entry.id],
  })),
};
const guard = new WotsWriteAheadGuard({
  policyPath,
  journalDir,
  forbiddenRoots: [
    'C:\\Users\\Charles\\Documents\\Crypto\\Minima\\Nodes\\BridgeTestSigners',
    'C:\\Users\\Charles\\Documents\\Crypto\\Minima\\Nodes\\BridgeTestSigners-backups',
  ],
});
const finalInspection = await guard.inspect(observation);
if (finalInspection.code !== 'NODE_ACCEPTED_RETIRED') throw new Error(`final external journal failed: ${finalInspection.code}`);

const sources = ['p9-wots-policy.json', 'wots-write-ahead-guard.mjs', 'validate-wots-write-ahead-guard.mjs',
  'generic-bridge-transaction-lifecycle.mjs', 'validate-generic-p9-transaction-boundaries.mjs',
  'generic-bridge-p9-signing-authority.mjs', 'validate-generic-p9-signing-authority.mjs',
  'generic-bridge-p9-chain-reconciler.mjs', 'validate-generic-p9-chain-reconciler.mjs',
  'verify-p9-wots-node.mjs', 'invoke-p9-wots-node-verification.ps1', 'generic-mainnet-p8-live-branches.mjs',
  'generic-mainnet-v2-live-release.mjs', 'generic-mainnet-v2-genesis.mjs', 'finalize-generic-p9-evidence.mjs'];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async (name) => [name, sha256Hex(await fs.readFile(path.join(root, name)))])));
if (guardValidation.value.schema !== 'generic-p9-wots-guard-validation/v1'
  || boundaryValidation.value.schema !== 'generic-p9-transaction-boundary-validation/v1'
  || authorityValidation.value.schema !== 'generic-p9-signing-authority-validation/v1'
  || reconcilerValidation.value.schema !== 'generic-p9-chain-reconciler-validation/v1') {
  throw new Error('selected validation artifact schema differs');
}
const expectedGuardSources = {
  policy: sourceSha256['p9-wots-policy.json'],
  guard: sourceSha256['wots-write-ahead-guard.mjs'],
  validator: sourceSha256['validate-wots-write-ahead-guard.mjs'],
};
const expectedBoundarySources = {
  policy: sourceSha256['p9-wots-policy.json'],
  guard: sourceSha256['wots-write-ahead-guard.mjs'],
  lifecycle: sourceSha256['generic-bridge-transaction-lifecycle.mjs'],
  validator: sourceSha256['validate-generic-p9-transaction-boundaries.mjs'],
};
const expectedAuthoritySources = Object.fromEntries([
  'p9-wots-policy.json',
  'wots-write-ahead-guard.mjs',
  'generic-bridge-p9-signing-authority.mjs',
  'generic-bridge-transaction-lifecycle.mjs',
  'validate-generic-p9-signing-authority.mjs',
].map((name) => [name, sourceSha256[name]]));
const expectedReconcilerSources = Object.fromEntries([
  'wots-write-ahead-guard.mjs',
  'generic-bridge-transaction-lifecycle.mjs',
  'generic-bridge-p9-chain-reconciler.mjs',
  'validate-generic-p9-chain-reconciler.mjs',
].map((name) => [name, sourceSha256[name]]));
if (JSON.stringify(guardValidation.value.sourceSha256) !== JSON.stringify(expectedGuardSources)
  || JSON.stringify(boundaryValidation.value.sourceSha256) !== JSON.stringify(expectedBoundarySources)
  || JSON.stringify(authorityValidation.value.sourceSha256) !== JSON.stringify(expectedAuthoritySources)
  || JSON.stringify(reconcilerValidation.value.sourceSha256) !== JSON.stringify(expectedReconcilerSources)) {
  throw new Error('selected validation artifact source hashes differ from current sources');
}
const createdAt = new Date().toISOString();
const report = {
  schema: 'generic-p9-partial-evidence/v1',
  createdAt,
  result: 'PARTIAL_PASS_P9_REMAINS_NOW',
  phaseGatePassed: false,
  livePolicy: {
    policyHash: loadedPolicy.policyHash,
    signingEnabled: loadedPolicy.policy.signingEnabled,
    retirementReason: loadedPolicy.policy.retirementReason,
    protectedKeys: loadedPolicy.policy.protectedKeys.length,
    exactMinimumUses: finalInspection.details.minimumUses,
    treeKeyShape: { size: loadedPolicy.policy.treeKeySize, depth: loadedPolicy.policy.treeKeyDepth,
      maximumUses: loadedPolicy.policy.maximumUsesPerTreeKey },
  },
  externalJournal: {
    path: journalDir,
    outsideNodeAndBackupDomains: true,
    entries: finalInspection.details.journalEntries,
    lastHash: finalInspection.details.lastHash,
    finalInspectionCode: finalInspection.code,
    signingDomainRetired: true,
  },
  offlineValidation: {
    guard: { artifact: guardValidation.name, sha256: guardValidation.sha256, assertions: guardValidation.value.assertions,
      mutations: guardValidation.value.mutationCount, propertySteps: guardValidation.value.propertySteps },
    transactionBoundaries: { artifact: boundaryValidation.name, sha256: boundaryValidation.sha256,
      assertions: boundaryValidation.value.assertions, crashCases: boundaryValidation.value.crashCases,
      hostileCases: boundaryValidation.value.hostileCases },
    signingAuthority: { artifact: authorityValidation.name, sha256: authorityValidation.sha256,
      assertions: authorityValidation.value.assertions, hostileCases: authorityValidation.value.hostileCases,
      concurrencyCases: authorityValidation.value.concurrencyCases },
    chainReconciler: { artifact: reconcilerValidation.name, sha256: reconcilerValidation.sha256,
      assertions: reconcilerValidation.value.assertions, hostileCases: reconcilerValidation.value.hostileCases },
  },
  nodeObservations: {
    genesis: { artifact: genesis.name, sha256: genesis.sha256 },
    stale: { artifact: stale.name, sha256: stale.sha256, counterObservationVerdict: stale.value.verdict.code,
      signingAuthorizationVerdict: 'SIGNING_DOMAIN_RETIRED', counters: stale.value.protectedCounters,
      wrapperCleanup: conservativeWrapperSummary(stale.value.wrapperRun) },
    current: { artifact: current.name, sha256: current.sha256, counterObservationVerdict: current.value.verdict.code,
      signingAuthorizationVerdict: 'SIGNING_DOMAIN_RETIRED', counters: current.value.protectedCounters,
      wrapperCleanup: conservativeWrapperSummary(current.value.wrapperRun) },
  },
  hostileReviewCorrections: [
    'Event-envelope field smuggling rejected by event-specific payload whitelists.',
    'Durable one-shot SIGN_STEP replaces reusable signing authorization inside one journal store.',
    'HALT cannot later COMMIT or resume signing.',
    'POST_ATTEMPT is durable before broadcast and duplicate post callbacks are blocked.',
    'POST_ATTEMPT binds the intent to the reserved custom transaction, transaction body and expected settlement.',
    'Negative reconciliation cannot clear an unknown post with evidence for a different transaction specification.',
    'Typed non-settlement requires explicit false onchain and mempool fields, exact inputs and outputs, an expired validity window and a chain anchor.',
    'Token accounting is nonempty and pins token IDs, witness counts and zero differences.',
    'Loaded unsigned transaction body is rechecked before reserve, every sign step and post.',
    'Live TreeKey shape is pinned to size 64, depth 3 and 262144 maximum uses.',
    'Legacy live sign and post entrypoints are disabled pending a fenced P9 adapter.',
    'Later RPC observations use random in-memory Basic authentication and record post-cleanup state.',
    'A production-shaped authority interface requires a global non-expiring fence and advances an independent checkpoint before conditional signing.',
    'The conditional signing gateway serializes its allowlist and rechecks the exact loaded transaction digest immediately before signing.',
    'The exact-chain reconciler derives confirmation and negative reconciliation from one consistent typed source model.',
  ],
  adverseFinding: {
    code: 'P9_STALE_CLONE_NETWORK_ISOLATION_NOT_PROVED',
    statement: 'The first stale-clone run exposed wildcard RPC without authentication, and all clone runs exposed the Core wire listener on a wildcard base port. The wrapper issued no signing command, but outside access was not excluded.',
    consequence: 'The P8 fixture key domain is permanently retired from future signing. Earlier node artifacts are historical only and cannot prove that no external signature occurred.',
  },
  unresolvedBlockers: [
    'The global fence is a dependency-injected interface; no real cross-host non-expiring authority is deployed.',
    'The independent monotonic checkpoint is a dependency-injected interface; no real WORM or separately durable service is deployed.',
    'Windows directory-entry fsync is not proved by Node.js.',
    'The real live constructor is locked rather than integrated with a real globally fenced authority and strict node gateway.',
    'Exact safe clone verification still needs an authorized measured network-isolation control for the wildcard Minima wire listener.',
    'The reconciler uses a consistent fake source; no trusted complete live-chain source implements its interface.',
  ],
  boundaries: {
    newMainnetTransactions: 0,
    newWotsSignaturesAuthorizedOrCreatedByThisSlice: 0,
    realAssetsAuthorized: false,
    oneControllerFixture: true,
    ethereumFactsSynthetic: true,
    genericMinimaConsensusLightClientExists: false,
    independentOperatorDecentralizationProved: false,
  },
  sourceSha256,
};
const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputPath = path.join(evidenceDir, `generic-p9-partial-${stamp}.json`);
const bytes = `${JSON.stringify(report, null, 2)}\n`;
await fs.writeFile(outputPath, bytes);
await fs.writeFile(`${outputPath}.sha256`, `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${path.basename(outputPath)}\n`);
console.log(JSON.stringify({ outputPath, sha256: sha256Hex(bytes), result: report.result,
  guardAssertions: report.offlineValidation.guard.assertions,
  transactionAssertions: report.offlineValidation.transactionBoundaries.assertions,
  authorityAssertions: report.offlineValidation.signingAuthority.assertions,
  reconcilerAssertions: report.offlineValidation.chainReconciler.assertions }, null, 2));
