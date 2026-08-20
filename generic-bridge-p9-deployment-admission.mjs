import { canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const PLACEHOLDER_RE = /^UNASSIGNED-[A-Z0-9-]{1,96}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const MUTATING_OPERATIONS = Object.freeze([
  'conditional-txnsign',
  'txncheck-exact',
  'txncreate-exact',
  'txndelete-confirmed-only',
  'txninput-exact',
  'txnmmr-exact',
  'txnoutput-exact',
  'txnpost-exact',
  'txnscript-exact',
  'txnstate-exact',
]);

const READ_OPERATIONS = Object.freeze([
  'keys-list-protected',
  'txnlist-one',
]);

const PROBE_SOURCE_KEYS = Object.freeze([
  'admissionModule',
  'chainAdapterBuild',
  'checkpointBuild',
  'fenceBuild',
  'gatewayBuild',
  'probeHarness',
  'profile',
]);

const SECRET_FIELD_RE = /^(?:api[-_]?key|authorization|credential|db[-_]?password|mnemonic|password|private[-_]?key|rpc[-_]?password|secret|seed)$/i;

function verdict(ok, code, details = {}) {
  return {
    schema: 'generic-bridge-p9-deployment-admission-verdict/v1',
    ok,
    code,
    phaseGatePassed: false,
    authorizationGranted: false,
    details,
  };
}

function fail(code, details = {}) { return verdict(false, code, details); }
function pass(code, details = {}) { return verdict(true, code, details); }

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isObject(value)
    && Object.keys(value).every((key) => allowed.includes(key))
    && allowed.every((key) => Object.hasOwn(value, key));
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function containsSecretField(value, trail = []) {
  if (!isObject(value) && !Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const next = [...trail, key];
    if (SECRET_FIELD_RE.test(key)) return next.join('.');
    const nested = containsSecretField(child, next);
    if (nested) return nested;
  }
  return null;
}

function assignedIdentity(value) {
  return typeof value === 'string' && HASH_RE.test(value);
}

function designIdentity(value) {
  return assignedIdentity(value) || (typeof value === 'string' && PLACEHOLDER_RE.test(value));
}

function validateFence(fence, requireAssigned) {
  if (!exactKeys(fence, [
    'provider', 'trustDomainId', 'operatorIdentityDigest', 'objectNameDerivation',
    'globallyUniqueCoordinator', 'singleThreadedCoordination',
    'transactionalStronglyConsistentStorage', 'monotonicFencingToken',
    'automaticExpirySeconds', 'reassignmentPolicy', 'staleRecoveryPolicy',
    'durableAuditHistory',
  ])) return fail('FENCE_PROFILE_SHAPE_INVALID');
  const identity = requireAssigned ? assignedIdentity : designIdentity;
  if (fence.provider !== 'cloudflare-durable-object'
    || !identity(fence.trustDomainId) || !identity(fence.operatorIdentityDigest)
    || fence.objectNameDerivation !== 'sha256-signer-domain'
    || fence.globallyUniqueCoordinator !== true
    || fence.singleThreadedCoordination !== true
    || fence.transactionalStronglyConsistentStorage !== true
    || fence.monotonicFencingToken !== true
    || fence.automaticExpirySeconds !== null
    || fence.reassignmentPolicy !== 'explicit-release-or-domain-retirement'
    || fence.staleRecoveryPolicy !== 'prove-gateway-stopped-or-retire-domain'
    || fence.durableAuditHistory !== true) return fail('FENCE_POLICY_UNSAFE');
  return pass('FENCE_PROFILE_VALID');
}

function validateCheckpoint(checkpoint, requireAssigned) {
  if (!exactKeys(checkpoint, [
    'provider', 'trustDomainId', 'operatorIdentityDigest', 'headStore', 'historyStore',
    'protocol', 'conditionalCompareAndSwap', 'stronglyConsistentHeadRead',
    'complianceMode', 'minimumRetentionDays', 'retentionCoversSignerLifetime',
    'alternateInitializationRejected', 'staleFencingTokenRejected',
  ])) return fail('CHECKPOINT_PROFILE_SHAPE_INVALID');
  const identity = requireAssigned ? assignedIdentity : designIdentity;
  if (checkpoint.provider !== 'aws-dynamodb-s3-object-lock'
    || !identity(checkpoint.trustDomainId) || !identity(checkpoint.operatorIdentityDigest)
    || checkpoint.headStore !== 'dynamodb-conditional-head'
    || checkpoint.historyStore !== 's3-object-lock-versioned-history'
    || checkpoint.protocol !== 'prepare-cas-commit/v1'
    || checkpoint.conditionalCompareAndSwap !== true
    || checkpoint.stronglyConsistentHeadRead !== true
    || checkpoint.complianceMode !== true
    || !Number.isSafeInteger(checkpoint.minimumRetentionDays)
    || checkpoint.minimumRetentionDays < 3650
    || checkpoint.retentionCoversSignerLifetime !== true
    || checkpoint.alternateInitializationRejected !== true
    || checkpoint.staleFencingTokenRejected !== true) return fail('CHECKPOINT_POLICY_UNSAFE');
  return pass('CHECKPOINT_PROFILE_VALID');
}

function validateGateway(gateway) {
  if (!exactKeys(gateway, [
    'deployment', 'coordinatorTransport', 'nodeRpcTransport', 'nodeRpcAuthentication',
    'rpcCredentialLifetime', 'genericCommandPassthrough', 'conditionalBindingInsideGateway',
    'serializesEveryMutation', 'rawRpcReachability', 'readOperations', 'mutatingOperations',
    'unknownOutcomePolicy', 'deletePolicy',
  ])) return fail('GATEWAY_PROFILE_SHAPE_INVALID');
  if (gateway.deployment !== 'single-purpose-attestor-gateway'
    || gateway.coordinatorTransport !== 'private-mtls'
    || gateway.nodeRpcTransport !== 'loopback-inside-isolated-guest'
    || gateway.nodeRpcAuthentication !== 'random-basic-auth-memory-only'
    || gateway.rpcCredentialLifetime !== 'one-process-run'
    || gateway.genericCommandPassthrough !== false
    || gateway.conditionalBindingInsideGateway !== true
    || gateway.serializesEveryMutation !== true
    || gateway.rawRpcReachability !== 'gateway-only'
    || !exactStringArray(gateway.readOperations, READ_OPERATIONS)
    || !exactStringArray(gateway.mutatingOperations, MUTATING_OPERATIONS)
    || gateway.unknownOutcomePolicy !== 'reconcile-before-any-retry'
    || gateway.deletePolicy !== 'confirmed-or-definitively-never-broadcast-only') {
    return fail('GATEWAY_POLICY_UNSAFE');
  }
  return pass('GATEWAY_PROFILE_VALID');
}

function validateIsolation(isolation) {
  if (!exactKeys(isolation, [
    'strategy', 'nodeWildcardListenersExpected', 'defaultInboundPolicy',
    'allowedNodeRpcPeer', 'allowedNodeWirePeers', 'preStartPolicyReadback',
    'listenerInterfaceObservation', 'independentExternalDenialProbe',
    'postStopListenerProbe', 'cleanupEvidencePersistedAfterCleanup',
    'automaticStaleLockBreak',
  ])) return fail('ISOLATION_PROFILE_SHAPE_INVALID');
  if (isolation.strategy !== 'disposable-vm-default-deny'
    || isolation.nodeWildcardListenersExpected !== true
    || isolation.defaultInboundPolicy !== 'deny'
    || isolation.allowedNodeRpcPeer !== 'local-signing-gateway-only'
    || !Array.isArray(isolation.allowedNodeWirePeers) || isolation.allowedNodeWirePeers.length !== 0
    || isolation.preStartPolicyReadback !== true
    || isolation.listenerInterfaceObservation !== true
    || isolation.independentExternalDenialProbe !== true
    || isolation.postStopListenerProbe !== true
    || isolation.cleanupEvidencePersistedAfterCleanup !== true
    || isolation.automaticStaleLockBreak !== false) return fail('ISOLATION_POLICY_UNSAFE');
  return pass('ISOLATION_PROFILE_VALID');
}

function validateChainSource(chainSource) {
  if (!exactKeys(chainSource, [
    'canonicalChainBound', 'completeTransactionLookup', 'completeMempoolLookup',
    'completeCoinLineageLookup', 'conflictingSpendLookup', 'typedResponses',
    'concreteChainAnchor', 'validityExpiryPolicy',
  ])) return fail('CHAIN_SOURCE_PROFILE_SHAPE_INVALID');
  if (chainSource.canonicalChainBound !== true
    || chainSource.completeTransactionLookup !== true
    || chainSource.completeMempoolLookup !== true
    || chainSource.completeCoinLineageLookup !== true
    || chainSource.conflictingSpendLookup !== true
    || chainSource.typedResponses !== true
    || chainSource.concreteChainAnchor !== true
    || chainSource.validityExpiryPolicy !== 'founder-approved-required') {
    return fail('CHAIN_SOURCE_POLICY_INCOMPLETE');
  }
  return pass('CHAIN_SOURCE_PROFILE_VALID');
}

export function deploymentProfileDigest(profile) {
  return sha256Hex(canonicalJson(profile));
}

export function validateP9DeploymentProfile(profile, { requireAssigned = false } = {}) {
  const secretField = containsSecretField(profile);
  if (secretField) return fail('SECRET_FIELD_FORBIDDEN', { path: secretField });
  if (!exactKeys(profile, [
    'schema', 'profileId', 'profileStage', 'purpose', 'signerDomain', 'activation',
    'retiredP8DomainNeverReuse', 'fence', 'checkpoint', 'gateway', 'networkIsolation',
    'chainSource', 'evidencePolicy',
  ])) return fail('DEPLOYMENT_PROFILE_SHAPE_INVALID');
  if (profile.schema !== 'generic-bridge-p9-deployment-profile/v1'
    || !ID_RE.test(profile.profileId || '') || !ID_RE.test(profile.signerDomain || '')
    || !['design', 'deployment'].includes(profile.profileStage)
    || profile.purpose !== 'valueless-research-only'
    || profile.activation !== 'disabled'
    || profile.retiredP8DomainNeverReuse !== true) return fail('DEPLOYMENT_PROFILE_IDENTITY_INVALID');
  if (requireAssigned && profile.profileStage !== 'deployment') return fail('DEPLOYMENT_ASSIGNMENT_REQUIRED');

  for (const check of [
    validateFence(profile.fence, requireAssigned),
    validateCheckpoint(profile.checkpoint, requireAssigned),
    validateGateway(profile.gateway),
    validateIsolation(profile.networkIsolation),
    validateChainSource(profile.chainSource),
  ]) {
    if (!check.ok) return check;
  }

  if (profile.fence.trustDomainId === profile.checkpoint.trustDomainId
    || profile.fence.operatorIdentityDigest === profile.checkpoint.operatorIdentityDigest) {
    return fail('ROLLBACK_DOMAINS_NOT_INDEPENDENT');
  }
  if (!exactKeys(profile.evidencePolicy, [
    'sourceHashesRequired', 'profileDigestRequired', 'externalProbeDigestRequired',
    'postCleanupEvidenceRequired', 'noSelfAssertedCapabilities', 'preserveAllFailureRecords',
  ]) || Object.values(profile.evidencePolicy).some((value) => value !== true)) {
    return fail('EVIDENCE_POLICY_INCOMPLETE');
  }

  const code = requireAssigned ? 'DEPLOYMENT_PROFILE_ACCEPTED_DISABLED' : 'DESIGN_PROFILE_ACCEPTED';
  return pass(code, {
    profileDigest: deploymentProfileDigest(profile),
    profileStage: profile.profileStage,
    activation: profile.activation,
    nextGate: requireAssigned ? 'MEASURED_DEPLOYMENT_CONTROLS' : 'ASSIGN_DISTINCT_TRUST_DOMAINS',
  });
}

function validateProbe(probe) {
  if (!exactKeys(probe, [
    'schema', 'runId', 'createdAt', 'profileDigest', 'sourceSha256', 'fence',
    'checkpoint', 'gateway', 'networkIsolation', 'chainSource', 'cleanup', 'boundaries',
  ])) return fail('DEPLOYMENT_PROBE_SHAPE_INVALID');
  if (probe.schema !== 'generic-bridge-p9-deployment-probe/v1'
    || !ID_RE.test(probe.runId || '') || !ISO_RE.test(probe.createdAt || '')
    || !HASH_RE.test(probe.profileDigest || '')) return fail('DEPLOYMENT_PROBE_IDENTITY_INVALID');
  if (!exactKeys(probe.sourceSha256, PROBE_SOURCE_KEYS)
    || Object.values(probe.sourceSha256).some((value) => !HASH_RE.test(value))) {
    return fail('DEPLOYMENT_PROBE_SOURCE_BINDING_INVALID');
  }
  return pass('DEPLOYMENT_PROBE_SHAPE_VALID');
}

export function evaluateP9DeploymentReadiness(profile, probe) {
  const profileVerdict = validateP9DeploymentProfile(profile, { requireAssigned: true });
  if (!profileVerdict.ok) return profileVerdict;
  const secretField = containsSecretField(probe);
  if (secretField) return fail('SECRET_FIELD_FORBIDDEN', { path: secretField });
  const probeVerdict = validateProbe(probe);
  if (!probeVerdict.ok) return probeVerdict;
  if (probe.profileDigest !== profileVerdict.details.profileDigest) {
    return fail('DEPLOYMENT_PROBE_PROFILE_MISMATCH');
  }

  if (!exactKeys(probe.fence, [
    'concurrentContenders', 'winners', 'monotonicTokensObserved',
    'blockedOperationReassignmentRejected', 'partitionFailedClosed', 'auditDigest',
  ]) || !Number.isSafeInteger(probe.fence.concurrentContenders)
    || probe.fence.concurrentContenders < 2 || !Number.isSafeInteger(probe.fence.winners)
    || probe.fence.winners !== 1
    || probe.fence.monotonicTokensObserved !== true
    || probe.fence.blockedOperationReassignmentRejected !== true
    || probe.fence.partitionFailedClosed !== true || !HASH_RE.test(probe.fence.auditDigest || '')) {
    return fail('GLOBAL_FENCE_NOT_MEASURED');
  }
  if (!exactKeys(probe.checkpoint, [
    'casConflictRejected', 'staleFenceRejected', 'immutableOverwriteRejected',
    'pairedLocalRollbackDetected', 'prepareCrashFailedClosed', 'commitCrashFailedClosed',
    'independentCredentialSet', 'historyDigest',
  ]) || probe.checkpoint.casConflictRejected !== true
    || probe.checkpoint.staleFenceRejected !== true
    || probe.checkpoint.immutableOverwriteRejected !== true
    || probe.checkpoint.pairedLocalRollbackDetected !== true
    || probe.checkpoint.prepareCrashFailedClosed !== true
    || probe.checkpoint.commitCrashFailedClosed !== true
    || probe.checkpoint.independentCredentialSet !== true
    || !HASH_RE.test(probe.checkpoint.historyDigest || '')) {
    return fail('INDEPENDENT_CHECKPOINT_NOT_MEASURED');
  }
  if (!exactKeys(probe.gateway, [
    'genericCommandRejected', 'transactionMutationRejectedInsideGateway',
    'concurrentMutationSerialized', 'coordinatorRawRpcDenied', 'lanRawRpcDenied',
    'credentialAbsentFromProcessArgs', 'probeDigest',
  ]) || Object.entries(probe.gateway).some(([key, value]) => key !== 'probeDigest' && value !== true)
    || !HASH_RE.test(probe.gateway.probeDigest || '')) return fail('STRICT_GATEWAY_NOT_MEASURED');
  if (!exactKeys(probe.networkIsolation, [
    'effectivePolicyReadBack', 'wildcardListenersObserved', 'externalWireDenied',
    'externalRpcDenied', 'gatewayRpcAllowed', 'postStopAllPortsClosed', 'probeDigest',
  ]) || Object.entries(probe.networkIsolation).some(([key, value]) => key !== 'probeDigest' && value !== true)
    || !HASH_RE.test(probe.networkIsolation.probeDigest || '')) return fail('NETWORK_ISOLATION_NOT_MEASURED');
  if (!exactKeys(probe.chainSource, [
    'exactConfirmationPassed', 'pendingRemainedPending', 'conflictHalted',
    'completeNegativeAfterExpiryPassed', 'incompleteSearchFailedClosed', 'probeDigest',
  ]) || Object.entries(probe.chainSource).some(([key, value]) => key !== 'probeDigest' && value !== true)
    || !HASH_RE.test(probe.chainSource.probeDigest || '')) return fail('CHAIN_SOURCE_NOT_MEASURED');
  if (!exactKeys(probe.cleanup, [
    'nodeStopped', 'listenersClosed', 'disposableCloneRemoved', 'evidencePersistedAfterCleanup',
  ]) || Object.values(probe.cleanup).some((value) => value !== true)) return fail('CLEANUP_NOT_PROVED');
  if (!exactKeys(probe.boundaries, [
    'realAssets', 'productionDeployment', 'newWotsSignatures', 'mainnetTransactions',
  ]) || probe.boundaries.realAssets !== false || probe.boundaries.productionDeployment !== false
    || probe.boundaries.newWotsSignatures !== 0 || probe.boundaries.mainnetTransactions !== 0) {
    return fail('PROBE_AUTHORIZATION_BOUNDARY_EXCEEDED');
  }

  return pass('DEPLOYMENT_CONTROLS_OBSERVED_AUTHORIZATION_STILL_REQUIRED', {
    profileDigest: profileVerdict.details.profileDigest,
    probeRunId: probe.runId,
    nextGate: 'INDEPENDENT_HOSTILE_REVIEW_AND_EXPLICIT_VALUELESS_AUTHORIZATION',
  });
}

export const P9_DEPLOYMENT_ADMISSION_CONSTANTS = Object.freeze({
  HASH_RE,
  ID_RE,
  MUTATING_OPERATIONS,
  PROBE_SOURCE_KEYS,
  READ_OPERATIONS,
});
