import { canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

const TX_RE = /^0x[0-9a-f]{64}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

function verdict(ok, code, details = {}) {
  return { schema: 'generic-bridge-transaction-lifecycle-verdict/v1', ok, code, details };
}

function documentedBoolean(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function exactInteger(value) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const converted = Number(value);
    if (Number.isSafeInteger(converted)) return converted;
  }
  return null;
}

export function normalizeTxncheck(response, expected) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return verdict(false, 'CHECK_UNKNOWN');
  const required = [
    ['validamounts', response.validamounts],
    ['allsignaturesvalid', response.allsignaturesvalid],
    ['validtransaction', response.validtransaction],
    ['basic', response.valid?.basic],
    ['mmrproofs', response.valid?.mmrproofs],
    ['scripts', response.valid?.scripts],
  ];
  let explicitRejection = false;
  for (const [name, value] of required) {
    const normalized = documentedBoolean(value);
    if (normalized === null) return verdict(false, 'CHECK_UNKNOWN', { field: name });
    if (normalized === false) explicitRejection = true;
  }
  const inputs = exactInteger(response.inputs);
  const outputs = exactInteger(response.outputs);
  const signatures = exactInteger(response.signatures);
  const mmrproofs = exactInteger(response.mmrproofs);
  const scripts = exactInteger(response.scripts);
  if (inputs === null || outputs === null || signatures === null || mmrproofs === null || scripts === null
    || !Array.isArray(response.coins) || !Array.isArray(expected.coinDifferences) || expected.coinDifferences.length === 0) {
    return verdict(false, 'CHECK_UNKNOWN');
  }
  if (inputs !== expected.inputs || outputs !== expected.outputs || signatures !== expected.signatures
    || mmrproofs !== expected.mmrproofs || scripts !== expected.scripts) explicitRejection = true;
  if (response.coins.length !== expected.coinDifferences.length) return verdict(false, 'CHECK_UNKNOWN', { field: 'coins.length' });
  for (let index = 0; index < response.coins.length; index += 1) {
    const coin = response.coins[index];
    const expectedCoin = expected.coinDifferences[index];
    if (!coin || !Object.hasOwn(coin, 'difference') || !coin.tokenid) return verdict(false, 'CHECK_UNKNOWN', { field: 'coins' });
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(String(coin.difference))) return verdict(false, 'CHECK_UNKNOWN', { field: 'coins.difference' });
    if (String(coin.tokenid).toUpperCase() !== String(expectedCoin.tokenId).toUpperCase()
      || !/^[-+]?0(?:\.0+)?$/.test(String(coin.difference))
      || !/^[-+]?0(?:\.0+)?$/.test(String(expectedCoin.difference))) explicitRejection = true;
  }
  return explicitRejection ? verdict(false, 'CHECK_REJECTED') : verdict(true, 'CHECK_ACCEPTED');
}

export function classifyPostResult(reply, error = null, expectedTransactionId = null) {
  if (error) return verdict(false, 'POST_UNKNOWN', { transport: true });
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return verdict(false, 'POST_UNKNOWN');
  const status = documentedBoolean(reply.status);
  if (status === true) {
    const size = exactInteger(reply.size);
    if (!TX_RE.test(reply.txpowid || '') || !TX_RE.test(reply.transactionid || '')
      || !expectedTransactionId || reply.transactionid.toUpperCase() !== expectedTransactionId.toUpperCase()
      || size === null || size <= 0 || size >= 65536) return verdict(false, 'POST_UNKNOWN');
    return verdict(true, 'POST_ACCEPTED', { txpowId: reply.txpowid, bytes: size });
  }
  if (status === false && reply.broadcast === false && reply.code === 'PRE_BROADCAST_REFUSAL') {
    return verdict(false, 'POST_DEFINITE_REFUSAL');
  }
  return verdict(false, 'POST_UNKNOWN');
}

function exactIdList(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => String(value).toUpperCase() === String(expected[index]).toUpperCase());
}

export function verifyConfirmationProof(proof, expected) {
  if (!proof || typeof proof !== 'object') return verdict(false, 'CONFIRM_UNKNOWN');
  const onchain = documentedBoolean(proof.onchain);
  if (onchain === null) return verdict(false, 'CONFIRM_UNKNOWN', { field: 'onchain' });
  if (proof.conflictingTransactionId && String(proof.conflictingTransactionId).toUpperCase() !== expected.transactionId.toUpperCase()) {
    return verdict(false, 'CONFLICTING_SUCCESSOR', { transactionId: proof.conflictingTransactionId });
  }
  if (onchain === false) return verdict(false, 'CONFIRM_PENDING');
  const confirmations = exactInteger(proof.confirmations);
  const transaction = proof.transaction;
  if (confirmations === null || !transaction || !TX_RE.test(transaction.transactionid || '')) return verdict(false, 'CONFIRM_UNKNOWN');
  if (transaction.transactionid.toUpperCase() !== expected.transactionId.toUpperCase()) return verdict(false, 'CONFIRM_TRANSACTION_MISMATCH');
  const inputIds = transaction.inputs?.map((entry) => entry?.coinid);
  if (!exactIdList(inputIds, expected.inputCoinIds)) return verdict(false, 'CONFIRM_INPUT_MISMATCH');
  if (canonicalJson(transaction.outputs) !== canonicalJson(expected.outputs)) return verdict(false, 'CONFIRM_OUTPUT_MISMATCH');
  if (proof.successorDigest !== expected.successorDigest) return verdict(false, 'CONFIRM_SUCCESSOR_MISMATCH');
  if (confirmations < expected.minimumConfirmations) return verdict(false, 'CONFIRM_PENDING', { confirmations });
  return verdict(true, 'CONFIRMED_EXACT', { confirmations, successorDigest: proof.successorDigest });
}

export function verifyDefinitivelyNotSettled(proof, expected) {
  const onchain = documentedBoolean(proof?.onchain);
  const mempoolPresent = documentedBoolean(proof?.mempoolPresent);
  const expectedOutputIds = expected.outputs.map((entry) => entry.coinid);
  if (!proof || onchain !== false || mempoolPresent !== false || proof.searchComplete !== true
    || proof.predecessorInputsUnspent !== true || proof.predictedOutputsAbsent !== true || proof.validityExpired !== true
    || !Number.isSafeInteger(proof.chainAnchorBlock) || proof.chainAnchorBlock <= 0 || !TX_RE.test(proof.chainAnchorId || '')
    || proof.transactionId?.toUpperCase() !== expected.transactionId.toUpperCase()
    || !exactIdList(proof.predecessorInputIds, expected.inputCoinIds)
    || !exactIdList(proof.predictedOutputIds, expectedOutputIds)) {
    return verdict(false, 'NOT_SETTLED_UNKNOWN');
  }
  return verdict(true, 'DEFINITELY_NOT_SETTLED', { evidenceDigest: sha256Hex(canonicalJson(proof)) });
}

export class SimulatedLifecycleCrash extends Error {
  constructor(stage) { super(`simulated lifecycle crash at ${stage}`); this.name = 'SimulatedLifecycleCrash'; this.stage = stage; }
}

export class RecoverySafeTransactionLifecycle {
  constructor({ guard, observeCounters, loadTransactionSnapshot, signOne, finalizeExplicitWitness, runTxncheck,
    postSignedTransaction, chainReconciler = null }) {
    this.guard = guard;
    this.observeCounters = observeCounters;
    this.loadTransactionSnapshot = loadTransactionSnapshot;
    this.signOne = signOne;
    this.finalizeExplicitWitness = finalizeExplicitWitness;
    this.runTxncheck = runTxncheck;
    this.postSignedTransaction = postSignedTransaction;
    this.chainReconciler = chainReconciler;
  }

  async #verifyLoadedTransaction(spec) {
    const snapshot = await this.loadTransactionSnapshot({ customTransactionId: spec.customTransactionId });
    if (!snapshot || snapshot.customTransactionId !== spec.customTransactionId
      || snapshot.transactionId?.toUpperCase() !== spec.transactionId.toUpperCase()
      || canonicalJson(snapshot.unsignedBody) !== canonicalJson(spec.unsignedBody)
      || sha256Hex(canonicalJson(snapshot.unsignedBody)) !== spec.transactionDigest) {
      return verdict(false, 'LOADED_TRANSACTION_BINDING_MISMATCH');
    }
    return verdict(true, 'LOADED_TRANSACTION_BOUND');
  }

  async signAndCheck(spec, { crashAt = null } = {}) {
    if (!TX_RE.test(spec.transactionId || '') || !HASH_RE.test(spec.transactionDigest || '') || !spec.customTransactionId
      || !spec.unsignedBody || sha256Hex(canonicalJson(spec.unsignedBody)) !== spec.transactionDigest
      || !spec.expectedConfirmation || spec.expectedConfirmation.transactionId?.toUpperCase() !== spec.transactionId.toUpperCase()
      || !Array.isArray(spec.keyIds) || spec.keyIds.length === 0 || new Set(spec.keyIds).size !== spec.keyIds.length
      || spec.witnessStrategy !== 'txnsign-then-txnmmr-then-explicit-txnscript') {
      return verdict(false, 'UNSIGNED_SPEC_INVALID');
    }
    const settlementDigest = sha256Hex(canonicalJson(spec.expectedConfirmation));
    if (spec.unsignedVerified !== true) return verdict(false, 'UNSIGNED_STRUCTURE_REJECTED');
    const loadedBeforeReserve = await this.#verifyLoadedTransaction(spec);
    if (!loadedBeforeReserve.ok) return loadedBeforeReserve;
    if (crashAt === 'before-reserve') throw new SimulatedLifecycleCrash(crashAt);
    let observation = await this.observeCounters();
    const reserve = await this.guard.reserve({
      intentId: spec.intentId,
      settlementId: spec.settlementId,
      customTransactionId: spec.customTransactionId,
      transactionId: spec.transactionId,
      transactionDigest: spec.transactionDigest,
      settlementDigest,
      keyIds: spec.keyIds,
      observation,
      ...(spec.supersedesIntentId ? { supersedesIntentId: spec.supersedesIntentId } : {}),
    });
    if (!reserve.ok) return verdict(false, 'RESERVATION_REJECTED', { guard: reserve });
    if (crashAt === 'after-reserve') throw new SimulatedLifecycleCrash(crashAt);
    const completedKeyIds = [];
    for (const keyId of spec.keyIds) {
      const loadedBeforeSign = await this.#verifyLoadedTransaction(spec);
      if (!loadedBeforeSign.ok) {
        if (completedKeyIds.length > 0) {
          const observedAfterMutation = await this.observeCounters().catch(() => null);
          const halted = await this.guard.halt({
            intentId: spec.intentId,
            reason: observedAfterMutation ? 'PARTIAL_COUNTER_ADVANCE' : 'COUNTER_OBSERVATION_AMBIGUOUS',
            observedUses: observedAfterMutation?.usesById || {},
          });
          return verdict(false, 'LOADED_TRANSACTION_BINDING_MISMATCH', { halted });
        }
        return loadedBeforeSign;
      }
      if (typeof this.guard.executeSigningStep === 'function') {
        const execution = await this.guard.executeSigningStep({
          intentId: spec.intentId,
          customTransactionId: spec.customTransactionId,
          transactionId: spec.transactionId,
          transactionDigest: spec.transactionDigest,
          keyIds: spec.keyIds,
          completedKeyIds,
          nextKeyId: keyId,
        });
        if (!execution.ok) return verdict(false, 'GUARDED_SIGN_STEP_REJECTED', { authority: execution });
        completedKeyIds.push(keyId);
        if (crashAt === `after-sign-${completedKeyIds.length}`) throw new SimulatedLifecycleCrash(crashAt);
        continue;
      }
      observation = await this.observeCounters();
      const authorization = await this.guard.beginSigningStep({
        intentId: spec.intentId,
        transactionId: spec.transactionId,
        transactionDigest: spec.transactionDigest,
        keyIds: spec.keyIds,
        completedKeyIds,
        nextKeyId: keyId,
        observation,
      });
      if (!authorization.ok) return verdict(false, 'SIGNING_AUTHORIZATION_REJECTED', { guard: authorization });
      if (crashAt === `after-sign-step-${completedKeyIds.length + 1}`) throw new SimulatedLifecycleCrash(crashAt);
      try {
        await this.signOne({ keyId, intentId: spec.intentId, transactionId: spec.transactionId });
      } catch (error) {
        const observedAfterError = await this.observeCounters().catch(() => null);
        await this.guard.halt({
          intentId: spec.intentId,
          reason: observedAfterError ? 'PARTIAL_COUNTER_ADVANCE' : 'COUNTER_OBSERVATION_AMBIGUOUS',
          observedUses: observedAfterError?.usesById || {},
        });
        return verdict(false, 'SIGNING_HALTED', { keyId, error: error?.name || 'ERROR' });
      }
      completedKeyIds.push(keyId);
      if (crashAt === `after-sign-${completedKeyIds.length}`) throw new SimulatedLifecycleCrash(crashAt);
    }
    observation = await this.observeCounters();
    const commit = await this.guard.commit({ intentId: spec.intentId, observation, outcome: 'signed' });
    if (!commit.ok) return verdict(false, 'COUNTER_COMMIT_REJECTED', { guard: commit });
    if (crashAt === 'after-commit') throw new SimulatedLifecycleCrash(crashAt);
    const witness = await this.finalizeExplicitWitness({ intentId: spec.intentId, transactionId: spec.transactionId });
    if (witness?.strategy !== spec.witnessStrategy || witness?.transactionId?.toUpperCase() !== spec.transactionId.toUpperCase()) {
      return verdict(false, 'WITNESS_FINALIZATION_REJECTED');
    }
    if (crashAt === 'after-witness') throw new SimulatedLifecycleCrash(crashAt);
    const checked = normalizeTxncheck(await this.runTxncheck({ intentId: spec.intentId }), spec.expectedCheck);
    if (crashAt === 'after-check-before-record') throw new SimulatedLifecycleCrash(crashAt);
    if (checked.code === 'CHECK_UNKNOWN') return checked;
    const recorded = await this.guard.recordCheck({ intentId: spec.intentId, verdict: checked.ok ? 'PASS' : 'REJECT' });
    if (!recorded.ok) return verdict(false, 'CHECK_JOURNAL_REJECTED', { guard: recorded });
    return checked;
  }

  async post(spec) {
    const loaded = await this.#verifyLoadedTransaction(spec);
    if (!loaded.ok) return loaded;
    const attempt = await this.guard.beginPost({
      intentId: spec.intentId,
      customTransactionId: spec.customTransactionId,
      transactionId: spec.transactionId,
      transactionDigest: spec.transactionDigest,
      settlementDigest: sha256Hex(canonicalJson(spec.expectedConfirmation)),
    });
    if (!attempt.ok) return verdict(false, 'POST_NOT_AUTHORIZED', { guard: attempt });
    let reply;
    let error;
    try { reply = await this.postSignedTransaction({ intentId: spec.intentId, transactionId: spec.transactionId }); }
    catch (caught) { error = caught; }
    const outcome = classifyPostResult(reply, error, spec.transactionId);
    const guardOutcome = outcome.code === 'POST_ACCEPTED' ? 'ACCEPTED'
      : (outcome.code === 'POST_DEFINITE_REFUSAL' ? 'DEFINITE_REFUSAL' : 'UNKNOWN');
    const recorded = await this.guard.recordPost({ intentId: spec.intentId, outcome: guardOutcome });
    if (!recorded.ok) return verdict(false, 'POST_JOURNAL_REJECTED', { guard: recorded, outcome });
    return outcome;
  }

  async confirm(spec, proof) {
    const confirmed = verifyConfirmationProof(proof, spec.expectedConfirmation);
    if (!confirmed.ok) return confirmed;
    const recorded = await this.guard.confirm({
      intentId: spec.intentId,
      minedTransactionId: spec.transactionId,
      successorDigest: spec.expectedConfirmation.successorDigest,
      settlementDigest: sha256Hex(canonicalJson(spec.expectedConfirmation)),
    });
    if (!recorded.ok) return verdict(false, 'CONFIRM_JOURNAL_REJECTED', { guard: recorded });
    return confirmed;
  }

  async reconcileNotSettled(spec, proof) {
    const reconciled = verifyDefinitivelyNotSettled(proof, spec.expectedConfirmation);
    if (!reconciled.ok) return reconciled;
    const recorded = await this.guard.reconcileNotSettled({
      intentId: spec.intentId,
      customTransactionId: spec.customTransactionId,
      transactionId: spec.transactionId,
      transactionDigest: spec.transactionDigest,
      settlementDigest: sha256Hex(canonicalJson(spec.expectedConfirmation)),
      evidenceDigest: reconciled.details.evidenceDigest,
    });
    if (!recorded.ok) return verdict(false, 'RECONCILIATION_JOURNAL_REJECTED', { guard: recorded });
    return reconciled;
  }

  async confirmFromChain(spec) {
    if (!this.chainReconciler || typeof this.chainReconciler.confirmation !== 'function') {
      return verdict(false, 'CHAIN_RECONCILER_NOT_CONFIGURED');
    }
    const derived = await this.chainReconciler.confirmation(spec.expectedConfirmation);
    if (!derived?.ok) return verdict(false, 'CHAIN_CONFIRMATION_REJECTED', { reconciler: derived });
    return this.confirm(spec, derived.details.proof);
  }

  async reconcileNotSettledFromChain(spec, { validityEndBlock }) {
    if (!this.chainReconciler || typeof this.chainReconciler.definitiveNonSettlement !== 'function') {
      return verdict(false, 'CHAIN_RECONCILER_NOT_CONFIGURED');
    }
    const derived = await this.chainReconciler.definitiveNonSettlement(spec.expectedConfirmation, { validityEndBlock });
    if (!derived?.ok) return verdict(false, 'CHAIN_NON_SETTLEMENT_REJECTED', { reconciler: derived });
    return this.reconcileNotSettled(spec, derived.details.proof);
  }
}
