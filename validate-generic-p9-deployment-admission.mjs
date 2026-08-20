#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deploymentProfileDigest,
  evaluateP9DeploymentReadiness,
  validateP9DeploymentProfile,
} from './generic-bridge-p9-deployment-admission.mjs';
import { sha256Hex } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const emitEvidence = process.argv.includes('--evidence');
let assertions = 0;
let hostileCases = 0;

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function expectCode(value, code, label) {
  check(value?.code === code, `${label}: expected ${code}, received ${value?.code}`);
  return value;
}

function clone(value) { return structuredClone(value); }
function hash(seed) { return sha256Hex(`p9-deployment:${seed}`); }

const profilePath = path.join(root, 'p9-deployment-profile.json');
const designProfile = JSON.parse(await fs.readFile(profilePath, 'utf8'));

const design = expectCode(validateP9DeploymentProfile(designProfile),
  'DESIGN_PROFILE_ACCEPTED', 'selected design profile accepted');
check(design.ok === true && design.phaseGatePassed === false && design.authorizationGranted === false,
  'design validation cannot pass P9 or authorize operation');
check(design.details.profileDigest === deploymentProfileDigest(designProfile),
  'design digest is deterministic');
expectCode(validateP9DeploymentProfile(designProfile, { requireAssigned: true }),
  'DEPLOYMENT_ASSIGNMENT_REQUIRED', 'unassigned provider profile is not deployment-ready');

function assignedProfile() {
  const value = clone(designProfile);
  value.profileStage = 'deployment';
  value.signerDomain = 'fresh-valueless-domain-candidate';
  value.fence.trustDomainId = hash('cloudflare-account');
  value.fence.operatorIdentityDigest = hash('fence-operator');
  value.checkpoint.trustDomainId = hash('aws-account');
  value.checkpoint.operatorIdentityDigest = hash('checkpoint-operator');
  return value;
}

const assigned = assignedProfile();
const assignedVerdict = expectCode(validateP9DeploymentProfile(assigned, { requireAssigned: true }),
  'DEPLOYMENT_PROFILE_ACCEPTED_DISABLED', 'fully assigned disabled profile accepted');
check(assignedVerdict.details.activation === 'disabled', 'accepted deployment profile remains disabled');

function hostileProfile(label, mutate, code) {
  const value = assignedProfile();
  mutate(value);
  expectCode(validateP9DeploymentProfile(value, { requireAssigned: true }), code, label);
  hostileCases += 1;
}

hostileProfile('same provider account rollback domain rejected', (value) => {
  value.checkpoint.trustDomainId = value.fence.trustDomainId;
}, 'ROLLBACK_DOMAINS_NOT_INDEPENDENT');
hostileProfile('same operator control rejected', (value) => {
  value.checkpoint.operatorIdentityDigest = value.fence.operatorIdentityDigest;
}, 'ROLLBACK_DOMAINS_NOT_INDEPENDENT');
hostileProfile('expiring signer lease rejected', (value) => {
  value.fence.automaticExpirySeconds = 30;
}, 'FENCE_POLICY_UNSAFE');
hostileProfile('unsafe stale recovery rejected', (value) => {
  value.fence.staleRecoveryPolicy = 'break-after-timeout';
}, 'FENCE_POLICY_UNSAFE');
hostileProfile('governance-mode checkpoint rejected', (value) => {
  value.checkpoint.complianceMode = false;
}, 'CHECKPOINT_POLICY_UNSAFE');
hostileProfile('short checkpoint retention rejected', (value) => {
  value.checkpoint.minimumRetentionDays = 30;
}, 'CHECKPOINT_POLICY_UNSAFE');
hostileProfile('checkpoint without conditional head rejected', (value) => {
  value.checkpoint.conditionalCompareAndSwap = false;
}, 'CHECKPOINT_POLICY_UNSAFE');
hostileProfile('generic command gateway rejected', (value) => {
  value.gateway.genericCommandPassthrough = true;
}, 'GATEWAY_POLICY_UNSAFE');
hostileProfile('gateway operation removal rejected', (value) => {
  value.gateway.mutatingOperations.pop();
}, 'GATEWAY_POLICY_UNSAFE');
hostileProfile('gateway operation insertion rejected', (value) => {
  value.gateway.mutatingOperations.push('send-arbitrary');
}, 'GATEWAY_POLICY_UNSAFE');
hostileProfile('raw RPC exposure rejected', (value) => {
  value.gateway.rawRpcReachability = 'lan';
}, 'GATEWAY_POLICY_UNSAFE');
hostileProfile('network profile ignoring wildcard listeners rejected', (value) => {
  value.networkIsolation.nodeWildcardListenersExpected = false;
}, 'ISOLATION_POLICY_UNSAFE');
hostileProfile('network profile without external probe rejected', (value) => {
  value.networkIsolation.independentExternalDenialProbe = false;
}, 'ISOLATION_POLICY_UNSAFE');
hostileProfile('automatic stale-lock break rejected', (value) => {
  value.networkIsolation.automaticStaleLockBreak = true;
}, 'ISOLATION_POLICY_UNSAFE');
hostileProfile('incomplete chain lookup rejected', (value) => {
  value.chainSource.completeCoinLineageLookup = false;
}, 'CHAIN_SOURCE_POLICY_INCOMPLETE');
hostileProfile('secret-bearing profile rejected', (value) => {
  value.gateway.rpcPassword = 'must-not-exist';
}, 'SECRET_FIELD_FORBIDDEN');
hostileProfile('profile field smuggling rejected', (value) => {
  value.phaseGatePassed = true;
}, 'DEPLOYMENT_PROFILE_SHAPE_INVALID');
hostileProfile('enabled activation rejected', (value) => {
  value.activation = 'enabled';
}, 'DEPLOYMENT_PROFILE_IDENTITY_INVALID');

function validProbe(profile) {
  return {
    schema: 'generic-bridge-p9-deployment-probe/v1',
    runId: 'synthetic-offline-hostile-run',
    createdAt: '2026-08-20T00:00:00Z',
    profileDigest: deploymentProfileDigest(profile),
    sourceSha256: {
      admissionModule: hash('admission-module'),
      chainAdapterBuild: hash('chain-adapter-build'),
      checkpointBuild: hash('checkpoint-build'),
      fenceBuild: hash('fence-build'),
      gatewayBuild: hash('gateway-build'),
      probeHarness: hash('probe-harness'),
      profile: deploymentProfileDigest(profile),
    },
    fence: {
      concurrentContenders: 4,
      winners: 1,
      monotonicTokensObserved: true,
      blockedOperationReassignmentRejected: true,
      partitionFailedClosed: true,
      auditDigest: hash('fence-audit'),
    },
    checkpoint: {
      casConflictRejected: true,
      staleFenceRejected: true,
      immutableOverwriteRejected: true,
      pairedLocalRollbackDetected: true,
      prepareCrashFailedClosed: true,
      commitCrashFailedClosed: true,
      independentCredentialSet: true,
      historyDigest: hash('checkpoint-history'),
    },
    gateway: {
      genericCommandRejected: true,
      transactionMutationRejectedInsideGateway: true,
      concurrentMutationSerialized: true,
      coordinatorRawRpcDenied: true,
      lanRawRpcDenied: true,
      credentialAbsentFromProcessArgs: true,
      probeDigest: hash('gateway-probe'),
    },
    networkIsolation: {
      effectivePolicyReadBack: true,
      wildcardListenersObserved: true,
      externalWireDenied: true,
      externalRpcDenied: true,
      gatewayRpcAllowed: true,
      postStopAllPortsClosed: true,
      probeDigest: hash('network-probe'),
    },
    chainSource: {
      exactConfirmationPassed: true,
      pendingRemainedPending: true,
      conflictHalted: true,
      completeNegativeAfterExpiryPassed: true,
      incompleteSearchFailedClosed: true,
      probeDigest: hash('chain-probe'),
    },
    cleanup: {
      nodeStopped: true,
      listenersClosed: true,
      disposableCloneRemoved: true,
      evidencePersistedAfterCleanup: true,
    },
    boundaries: {
      realAssets: false,
      productionDeployment: false,
      newWotsSignatures: 0,
      mainnetTransactions: 0,
    },
  };
}

const syntheticProbe = validProbe(assigned);
const readiness = expectCode(evaluateP9DeploymentReadiness(assigned, syntheticProbe),
  'DEPLOYMENT_CONTROLS_OBSERVED_AUTHORIZATION_STILL_REQUIRED', 'complete synthetic probe admitted');
check(readiness.phaseGatePassed === false && readiness.authorizationGranted === false,
  'even a complete probe cannot self-authorize or pass P9');

function hostileProbe(label, mutate, code) {
  const value = validProbe(assigned);
  mutate(value);
  expectCode(evaluateP9DeploymentReadiness(assigned, value), code, label);
  hostileCases += 1;
}

hostileProbe('foreign profile probe rejected', (value) => {
  value.profileDigest = hash('foreign-profile');
}, 'DEPLOYMENT_PROBE_PROFILE_MISMATCH');
hostileProbe('two fence winners rejected', (value) => {
  value.fence.winners = 2;
}, 'GLOBAL_FENCE_NOT_MEASURED');
hostileProbe('string contender count rejected', (value) => {
  value.fence.concurrentContenders = '4';
}, 'GLOBAL_FENCE_NOT_MEASURED');
hostileProbe('operation reassignment during block rejected', (value) => {
  value.fence.blockedOperationReassignmentRejected = false;
}, 'GLOBAL_FENCE_NOT_MEASURED');
hostileProbe('checkpoint CAS ambiguity rejected', (value) => {
  value.checkpoint.casConflictRejected = false;
}, 'INDEPENDENT_CHECKPOINT_NOT_MEASURED');
hostileProbe('paired rollback not detected rejected', (value) => {
  value.checkpoint.pairedLocalRollbackDetected = false;
}, 'INDEPENDENT_CHECKPOINT_NOT_MEASURED');
hostileProbe('shared checkpoint credentials rejected', (value) => {
  value.checkpoint.independentCredentialSet = false;
}, 'INDEPENDENT_CHECKPOINT_NOT_MEASURED');
hostileProbe('generic command accepted rejected', (value) => {
  value.gateway.genericCommandRejected = false;
}, 'STRICT_GATEWAY_NOT_MEASURED');
hostileProbe('coordinator raw RPC reachability rejected', (value) => {
  value.gateway.coordinatorRawRpcDenied = false;
}, 'STRICT_GATEWAY_NOT_MEASURED');
hostileProbe('external wire exposure rejected', (value) => {
  value.networkIsolation.externalWireDenied = false;
}, 'NETWORK_ISOLATION_NOT_MEASURED');
hostileProbe('gateway unable to reach isolated RPC rejected', (value) => {
  value.networkIsolation.gatewayRpcAllowed = false;
}, 'NETWORK_ISOLATION_NOT_MEASURED');
hostileProbe('incomplete chain source accepted rejected', (value) => {
  value.chainSource.incompleteSearchFailedClosed = false;
}, 'CHAIN_SOURCE_NOT_MEASURED');
hostileProbe('cleanup before evidence rejected', (value) => {
  value.cleanup.evidencePersistedAfterCleanup = false;
}, 'CLEANUP_NOT_PROVED');
hostileProbe('signature outside authorization boundary rejected', (value) => {
  value.boundaries.newWotsSignatures = 1;
}, 'PROBE_AUTHORIZATION_BOUNDARY_EXCEEDED');
hostileProbe('secret-bearing probe rejected', (value) => {
  value.rpcPassword = 'must-not-exist';
}, 'SECRET_FIELD_FORBIDDEN');
hostileProbe('probe field smuggling rejected', (value) => {
  value.authorizationGranted = true;
}, 'DEPLOYMENT_PROBE_SHAPE_INVALID');
hostileProbe('unbound probe source rejected', (value) => {
  value.sourceSha256.probeHarness = 'not-a-hash';
}, 'DEPLOYMENT_PROBE_SOURCE_BINDING_INVALID');
hostileProbe('missing gateway build binding rejected', (value) => {
  delete value.sourceSha256.gatewayBuild;
}, 'DEPLOYMENT_PROBE_SOURCE_BINDING_INVALID');

const sourceFiles = [
  'P9-DEPLOYMENT-ARCHITECTURE.md',
  'p9-deployment-profile.json',
  'generic-bridge-p9-deployment-admission.mjs',
  'validate-generic-p9-deployment-admission.mjs',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name, sha256Hex(await fs.readFile(path.join(root, name))),
])));

const result = {
  schema: 'generic-p9-deployment-admission-validation/v1',
  createdAt: new Date().toISOString(),
  result: 'PASS',
  phaseGatePassed: false,
  authorizationGranted: false,
  evidenceLevel: 'offline selected-provider profile and fail-closed deployment-admission model',
  selectedFenceCandidate: 'Cloudflare Durable Object',
  selectedCheckpointCandidate: 'AWS DynamoDB conditional head plus S3 Object Lock compliance history',
  currentProfileStage: designProfile.profileStage,
  currentActivation: designProfile.activation,
  currentProfileDigest: design.details.profileDigest,
  assertions,
  hostileCases,
  proved: [
    'The selected design profile requires distinct provider, account and operator rollback domains for fence and checkpoint.',
    'TTL lease expiry, automatic stale recovery, generic RPC passthrough, raw RPC exposure and incomplete chain lookup are rejected.',
    'The checkpoint protocol requires conditional head advancement plus compliance-mode immutable history and crash-closed prepare/CAS/commit evidence.',
    'A deployment probe must bind the exact profile and source hashes and prove fence, checkpoint, gateway, network, chain and post-cleanup observations.',
    'Neither profile validation nor a complete probe can pass P9 or grant authorization.',
  ],
  notProved: [
    'No Cloudflare or AWS resource, account, credential, firewall, VM, gateway or live chain adapter was created or contacted by this validator.',
    'Provider documentation supports the candidate capability selection but is not measured deployment evidence.',
    'No node was started and no key, signature, transaction, post, token, real asset or production operator was created.',
  ],
  boundaries: {
    nodeStartups: 0,
    newWotsSignatures: 0,
    mainnetTransactions: 0,
    realAssets: false,
    productionDeployment: false,
  },
  sourceSha256,
};

if (emitEvidence) {
  const stamp = result.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = path.join(root, 'evidence', `generic-p9-deployment-admission-${stamp}.json`);
  const body = `${JSON.stringify(result, null, 2)}\n`;
  await fs.writeFile(evidencePath, body);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  await fs.writeFile(`${evidencePath}.sha256`, `${digest}  ${path.basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.sha256 = digest;
}

console.log(JSON.stringify(result, null, 2));
