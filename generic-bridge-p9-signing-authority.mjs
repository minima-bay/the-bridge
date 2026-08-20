import { canonicalJson } from './wots-write-ahead-guard.mjs';

const TX_RE = /^0x[0-9a-f]{64}$/i;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function verdict(ok, code, details = {}) {
  return { schema: 'generic-bridge-p9-signing-authority-verdict/v1', ok, code, details };
}

function fail(code, details = {}) { return verdict(false, code, details); }
function pass(code, details = {}) { return verdict(true, code, details); }

function exactCheckpoint(details) {
  if (!details || !ID_RE.test(details.guardId || '') || !HASH_RE.test(details.policyHash || '')
    || !Number.isSafeInteger(details.lastSeq) || details.lastSeq < 0 || !HASH_RE.test(details.lastHash || '')
    || !Number.isSafeInteger(details.journalBytes) || details.journalBytes < 1) return null;
  return {
    guardId: details.guardId,
    policyHash: details.policyHash,
    lastSeq: details.lastSeq,
    lastHash: details.lastHash,
    journalBytes: details.journalBytes,
  };
}

function checkpointsEqual(left, right) {
  return canonicalJson(exactCheckpoint(left)) === canonicalJson(exactCheckpoint(right));
}

function normalizeOperationResult(value) {
  if (value && typeof value === 'object' && typeof value.ok === 'boolean') return value;
  return pass('OPERATION_COMPLETED', { value });
}

function usesById(observation, publicKeysById) {
  if (!observation || !Array.isArray(observation.keys)) return null;
  const observedByPublicKey = new Map();
  for (const entry of observation.keys) {
    const publicKey = String(entry?.publicKey ?? entry?.publickey ?? '').toUpperCase();
    const rawUses = entry?.uses ?? entry?.use ?? entry?.usesCount;
    const uses = typeof rawUses === 'string' && /^(0|[1-9]\d*)$/.test(rawUses) ? Number(rawUses) : rawUses;
    if (!/^0X[0-9A-F]{64}$/.test(publicKey) || !Number.isSafeInteger(uses) || uses < 0
      || observedByPublicKey.has(publicKey)) return null;
    observedByPublicKey.set(publicKey, uses);
  }
  const result = {};
  for (const [keyId, publicKey] of Object.entries(publicKeysById)) {
    const uses = observedByPublicKey.get(String(publicKey).toUpperCase());
    if (!Number.isSafeInteger(uses)) return null;
    result[keyId] = uses;
  }
  return result;
}

export class StrictMinimaOperationGateway {
  constructor({ transport, publicKeysById }) {
    if (typeof transport !== 'function') throw new TypeError('transport must be a function');
    if (!publicKeysById || typeof publicKeysById !== 'object' || Array.isArray(publicKeysById)) {
      throw new TypeError('publicKeysById must be an object');
    }
    this.transport = transport;
    this.publicKeysById = Object.freeze({ ...publicKeysById });
    this.operationTail = Promise.resolve();
  }

  async #exclusive(callback) {
    const previous = this.operationTail;
    let release;
    this.operationTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await callback(); }
    finally { release(); }
  }

  async invoke(operation, request = {}) {
    if (operation === 'sign-one') {
      const publicKey = this.publicKeysById[request.keyId];
      if (!publicKey || !ID_RE.test(request.keyId || '') || !ID_RE.test(request.customTransactionId || '')
        || !TX_RE.test(request.transactionId || '') || !HASH_RE.test(request.transactionDigest || '')) {
        return fail('SIGN_REQUEST_INVALID');
      }
      return this.#exclusive(async () => normalizeOperationResult(await this.transport(Object.freeze({
        operation: 'conditional-txnsign',
        customTransactionId: request.customTransactionId,
        transactionId: request.transactionId,
        transactionDigest: request.transactionDigest,
        publicKey,
      }))));
    }
    if (operation === 'observe-counters') {
      return this.#exclusive(async () => normalizeOperationResult(
        await this.transport(Object.freeze({ operation: 'keys-list-protected' })),
      ));
    }
    if (operation === 'load-transaction') {
      if (!ID_RE.test(request.customTransactionId || '')) return fail('LOAD_TRANSACTION_REQUEST_INVALID');
      return this.#exclusive(async () => normalizeOperationResult(await this.transport(Object.freeze({
        operation: 'txnlist-one', customTransactionId: request.customTransactionId,
      }))));
    }
    return fail('RPC_OPERATION_NOT_ALLOWED', { operation: String(operation || '') });
  }
}

export class FencedAnchoredWotsAuthority {
  constructor({
    guard,
    fence,
    anchor,
    signerGateway,
    observeCounters,
    verifyTransactionBinding,
    signerDomain,
    publicKeysById,
  }) {
    this.guard = guard;
    this.fence = fence;
    this.anchor = anchor;
    this.signerGateway = signerGateway;
    this.observeCounters = observeCounters;
    this.verifyTransactionBinding = verifyTransactionBinding;
    this.signerDomain = signerDomain;
    this.publicKeysById = Object.freeze({ ...(publicKeysById || {}) });
  }

  #capabilityVerdict() {
    if (!ID_RE.test(this.signerDomain || '')) return fail('SIGNER_DOMAIN_INVALID');
    if (!this.guard || typeof this.guard.checkpoint !== 'function') return fail('LOCAL_GUARD_CAPABILITY_MISSING');
    if (!this.fence || this.fence.capabilities?.globalAcrossRestores !== true
      || this.fence.capabilities?.monotonicTokens !== true
      || this.fence.capabilities?.exclusiveLease !== true
      || this.fence.capabilities?.noAutomaticExpiryDuringOperation !== true
      || this.fence.capabilities?.revocationAcknowledgedBeforeReassignment !== true
      || typeof this.fence.acquire !== 'function' || typeof this.fence.assertHeld !== 'function'
      || typeof this.fence.release !== 'function') return fail('GLOBAL_FENCE_CAPABILITY_MISSING');
    if (!this.anchor || this.anchor.capabilities?.independentRollbackDomain !== true
      || this.anchor.capabilities?.durableCompareAndSwap !== true
      || typeof this.anchor.read !== 'function' || typeof this.anchor.initialize !== 'function'
      || typeof this.anchor.compareAndSwap !== 'function') return fail('MONOTONIC_ANCHOR_CAPABILITY_MISSING');
    if (!this.signerGateway || typeof this.signerGateway.invoke !== 'function') return fail('STRICT_SIGNER_GATEWAY_MISSING');
    if (typeof this.observeCounters !== 'function' || typeof this.verifyTransactionBinding !== 'function') {
      return fail('SIGNING_OBSERVER_CAPABILITY_MISSING');
    }
    if (!Object.keys(this.publicKeysById).length) return fail('PROTECTED_KEY_MAP_MISSING');
    return pass('AUTHORITY_CAPABILITIES_VALID');
  }

  async #acquire(operation) {
    const capabilities = this.#capabilityVerdict();
    if (!capabilities.ok) return capabilities;
    let lease;
    try {
      lease = await this.fence.acquire({ signerDomain: this.signerDomain, operation });
    } catch (error) {
      return fail('GLOBAL_FENCE_UNAVAILABLE', { error: error?.name || 'ERROR' });
    }
    if (!lease?.ok || !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1
      || !ID_RE.test(lease.leaseId || '')) return fail('GLOBAL_FENCE_NOT_ACQUIRED', { fence: lease });
    return pass('GLOBAL_FENCE_ACQUIRED', { lease });
  }

  async #assertHeld(lease) {
    try {
      const held = await this.fence.assertHeld({ signerDomain: this.signerDomain,
        leaseId: lease.leaseId, fencingToken: lease.fencingToken });
      return held?.ok === true ? pass('GLOBAL_FENCE_HELD') : fail('GLOBAL_FENCE_LOST', { fence: held });
    } catch (error) {
      return fail('GLOBAL_FENCE_LOST', { error: error?.name || 'ERROR' });
    }
  }

  async #release(lease) {
    try {
      const released = await this.fence.release({ signerDomain: this.signerDomain,
        leaseId: lease.leaseId, fencingToken: lease.fencingToken });
      return released?.ok === true ? pass('GLOBAL_FENCE_RELEASED') : fail('GLOBAL_FENCE_RELEASE_FAILED');
    } catch (error) {
      return fail('GLOBAL_FENCE_RELEASE_FAILED', { error: error?.name || 'ERROR' });
    }
  }

  async #localCheckpoint() {
    const checkpoint = await this.guard.checkpoint();
    if (!checkpoint?.ok) return fail('LOCAL_JOURNAL_CHECKPOINT_REJECTED', { guard: checkpoint });
    const normalized = exactCheckpoint(checkpoint.details);
    return normalized ? pass('LOCAL_JOURNAL_CHECKPOINT_VALID', { checkpoint: normalized })
      : fail('LOCAL_JOURNAL_CHECKPOINT_INVALID');
  }

  async #readAnchor() {
    let anchored;
    try { anchored = await this.anchor.read({ signerDomain: this.signerDomain }); }
    catch (error) { return fail('MONOTONIC_ANCHOR_UNAVAILABLE', { error: error?.name || 'ERROR' }); }
    if (!anchored?.ok) return fail('MONOTONIC_ANCHOR_READ_REJECTED', { anchor: anchored });
    const checkpoint = exactCheckpoint(anchored.checkpoint);
    return checkpoint ? pass('MONOTONIC_ANCHOR_READ', { checkpoint }) : fail('MONOTONIC_ANCHOR_INVALID');
  }

  async #verifyLocalMatchesAnchor() {
    const local = await this.#localCheckpoint();
    if (!local.ok) return local;
    const anchored = await this.#readAnchor();
    if (!anchored.ok) return anchored;
    if (!checkpointsEqual(local.details.checkpoint, anchored.details.checkpoint)) {
      return fail('LOCAL_JOURNAL_ANCHOR_MISMATCH', {
        local: local.details.checkpoint,
        anchored: anchored.details.checkpoint,
      });
    }
    return pass('LOCAL_JOURNAL_ANCHORED', { checkpoint: local.details.checkpoint });
  }

  async bootstrapAnchor() {
    const acquired = await this.#acquire('bootstrap-anchor');
    if (!acquired.ok) return acquired;
    const lease = acquired.details.lease;
    let outcome;
    try {
      const held = await this.#assertHeld(lease);
      if (!held.ok) outcome = held;
      else {
        const local = await this.#localCheckpoint();
        if (!local.ok) outcome = local;
        else {
          let initialized;
          try {
            initialized = await this.anchor.initialize({ signerDomain: this.signerDomain,
              checkpoint: local.details.checkpoint, fencingToken: lease.fencingToken });
          } catch (error) {
            initialized = fail('MONOTONIC_ANCHOR_INITIALIZE_FAILED', { error: error?.name || 'ERROR' });
          }
          outcome = initialized?.ok === true
            ? pass('MONOTONIC_ANCHOR_INITIALIZED', { checkpoint: local.details.checkpoint })
            : fail('MONOTONIC_ANCHOR_INITIALIZE_FAILED', { anchor: initialized });
        }
      }
    } finally {
      const released = await this.#release(lease);
      if (!released.ok && (!outcome || outcome.ok)) outcome = released;
    }
    return outcome;
  }

  async startupCheck() {
    const capabilities = this.#capabilityVerdict();
    if (!capabilities.ok) return capabilities;
    return this.#verifyLocalMatchesAnchor();
  }

  async #anchoredMutationHeld(lease, method, request) {
    const heldBefore = await this.#assertHeld(lease);
    if (!heldBefore.ok) return heldBefore;
    const before = await this.#verifyLocalMatchesAnchor();
    if (!before.ok) return before;
    const mutation = await this.guard[method](request);
    if (!mutation?.ok) return fail('LOCAL_GUARD_MUTATION_REJECTED', { method, guard: mutation });
    const after = await this.#localCheckpoint();
    if (!after.ok) return fail('LOCAL_JOURNAL_AHEAD_ANCHOR', { method, cause: after });
    let advanced;
    try {
      advanced = await this.anchor.compareAndSwap({
        signerDomain: this.signerDomain,
        expected: before.details.checkpoint,
        next: after.details.checkpoint,
        fencingToken: lease.fencingToken,
      });
    } catch (error) {
      return fail('LOCAL_JOURNAL_AHEAD_ANCHOR', { method, error: error?.name || 'ERROR' });
    }
    if (advanced?.ok !== true) return fail('LOCAL_JOURNAL_AHEAD_ANCHOR', { method, anchor: advanced });
    const heldAfter = await this.#assertHeld(lease);
    if (!heldAfter.ok) return heldAfter;
    return pass('ANCHORED_GUARD_MUTATION_RECORDED', { method, guard: mutation,
      checkpoint: after.details.checkpoint, fencingToken: lease.fencingToken });
  }

  async #mutate(method, request) {
    const acquired = await this.#acquire(method);
    if (!acquired.ok) return acquired;
    const lease = acquired.details.lease;
    let outcome;
    try { outcome = await this.#anchoredMutationHeld(lease, method, request); }
    finally {
      const released = await this.#release(lease);
      if (!released.ok && (!outcome || outcome.ok)) outcome = released;
    }
    return outcome;
  }

  async inspect(observation, options = {}) {
    const anchored = await this.#verifyLocalMatchesAnchor();
    if (!anchored.ok) return anchored;
    return this.guard.inspect(observation, options);
  }

  async checkpoint() { return this.guard.checkpoint(); }
  async reserve(request) { return this.#mutate('reserve', request); }
  async commit(request) { return this.#mutate('commit', request); }
  async halt(request) { return this.#mutate('halt', request); }
  async recordCheck(request) { return this.#mutate('recordCheck', request); }
  async beginPost(request) { return this.#mutate('beginPost', request); }
  async recordPost(request) { return this.#mutate('recordPost', request); }
  async confirm(request) { return this.#mutate('confirm', request); }
  async reconcileNotSettled(request) { return this.#mutate('reconcileNotSettled', request); }
  async beginSigningStep() { return fail('GUARDED_SIGNING_EXECUTION_REQUIRED'); }

  async #haltHeld(lease, intentId, reason, observation) {
    const observedUses = usesById(observation, this.publicKeysById) || {};
    return this.#anchoredMutationHeld(lease, 'halt', { intentId, reason, observedUses });
  }

  async executeSigningStep(request) {
    if (!ID_RE.test(request.intentId || '') || !ID_RE.test(request.customTransactionId || '')
      || !TX_RE.test(request.transactionId || '') || !HASH_RE.test(request.transactionDigest || '')
      || !Array.isArray(request.keyIds) || !Array.isArray(request.completedKeyIds)
      || !request.keyIds.includes(request.nextKeyId) || !this.publicKeysById[request.nextKeyId]) {
      return fail('GUARDED_SIGN_REQUEST_INVALID');
    }
    const acquired = await this.#acquire(`sign:${request.nextKeyId}`);
    if (!acquired.ok) return acquired;
    const lease = acquired.details.lease;
    let outcome;
    try {
      const firstBinding = await this.verifyTransactionBinding(request);
      if (firstBinding?.ok !== true) outcome = fail('TRANSACTION_BINDING_REJECTED_BEFORE_SIGN_STEP', { binding: firstBinding });
      else {
        const observationBefore = await this.observeCounters();
        const beforeUses = usesById(observationBefore, this.publicKeysById);
        if (!beforeUses) outcome = fail('COUNTER_OBSERVATION_INVALID_BEFORE_SIGN_STEP');
        else {
          const authorized = await this.#anchoredMutationHeld(lease, 'beginSigningStep', {
            intentId: request.intentId,
            transactionId: request.transactionId,
            transactionDigest: request.transactionDigest,
            keyIds: request.keyIds,
            completedKeyIds: request.completedKeyIds,
            nextKeyId: request.nextKeyId,
            observation: observationBefore,
          });
          if (!authorized.ok) outcome = authorized;
          else {
            const secondBinding = await this.verifyTransactionBinding(request);
            if (secondBinding?.ok !== true) {
              const halted = await this.#haltHeld(lease, request.intentId, 'DURABILITY_RECOVERY_REQUIRED', observationBefore);
              outcome = fail('TRANSACTION_BINDING_CHANGED_AFTER_SIGN_STEP', { halted, binding: secondBinding });
            } else {
              const heldBeforeRpc = await this.#assertHeld(lease);
              if (!heldBeforeRpc.ok) outcome = heldBeforeRpc;
              else {
                let signed;
                try {
                  signed = await this.signerGateway.invoke('sign-one', {
                    keyId: request.nextKeyId,
                    customTransactionId: request.customTransactionId,
                    transactionId: request.transactionId,
                    transactionDigest: request.transactionDigest,
                  });
                } catch (error) {
                  signed = fail('SIGNING_RPC_FAILED', { error: error?.name || 'ERROR' });
                }
                if (signed?.ok !== true) {
                  const observationAfterError = await this.observeCounters().catch(() => null);
                  const afterErrorUses = usesById(observationAfterError, this.publicKeysById);
                  const haltReason = !afterErrorUses ? 'COUNTER_OBSERVATION_AMBIGUOUS'
                    : (canonicalJson(afterErrorUses) === canonicalJson(beforeUses)
                      ? 'DURABILITY_RECOVERY_REQUIRED' : 'PARTIAL_COUNTER_ADVANCE');
                  const halted = await this.#haltHeld(lease, request.intentId,
                    haltReason,
                    observationAfterError || {});
                  outcome = fail('SIGNING_RPC_FAILED', { signer: signed, halted });
                } else {
                  const heldAfterRpc = await this.#assertHeld(lease);
                  if (!heldAfterRpc.ok) outcome = fail('GLOBAL_FENCE_LOST_AFTER_SIGN', { fence: heldAfterRpc });
                  else {
                    const observationAfter = await this.observeCounters().catch(() => null);
                    const afterUses = usesById(observationAfter, this.publicKeysById);
                    const expectedAfter = { ...beforeUses, [request.nextKeyId]: beforeUses[request.nextKeyId] + 1 };
                    if (!afterUses || canonicalJson(afterUses) !== canonicalJson(expectedAfter)) {
                      const halted = await this.#haltHeld(lease, request.intentId,
                        afterUses ? 'PARTIAL_COUNTER_ADVANCE' : 'COUNTER_OBSERVATION_AMBIGUOUS',
                        observationAfter || {});
                      outcome = fail('POST_SIGN_COUNTER_MISMATCH', { expected: expectedAfter, observed: afterUses, halted });
                    } else {
                      outcome = pass('GUARDED_SIGN_STEP_COMPLETED', {
                        keyId: request.nextKeyId,
                        fencingToken: lease.fencingToken,
                        checkpoint: authorized.details.checkpoint,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    } finally {
      const released = await this.#release(lease);
      if (!released.ok && (!outcome || outcome.ok)) outcome = released;
    }
    return outcome;
  }
}

export const P9_SIGNING_AUTHORITY_CONSTANTS = Object.freeze({ TX_RE, ID_RE, HASH_RE });
