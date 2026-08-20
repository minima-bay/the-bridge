import { canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';
import { verifyConfirmationProof, verifyDefinitivelyNotSettled } from './generic-bridge-transaction-lifecycle.mjs';

const TX_RE = /^0x[0-9a-f]{64}$/i;

function verdict(ok, code, details = {}) {
  return { schema: 'generic-bridge-p9-chain-reconciler-verdict/v1', ok, code, details };
}

function fail(code, details = {}) { return verdict(false, code, details); }
function pass(code, details = {}) { return verdict(true, code, details); }

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

function exactIds(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((value, index) => String(value).toUpperCase() === String(expected[index]).toUpperCase());
}

function validateExpected(expected) {
  if (!expected || !TX_RE.test(expected.transactionId || '') || !Array.isArray(expected.inputCoinIds)
    || expected.inputCoinIds.length === 0 || !expected.inputCoinIds.every((entry) => TX_RE.test(entry || ''))
    || !Array.isArray(expected.outputs) || expected.outputs.length === 0
    || !expected.outputs.every((entry) => TX_RE.test(entry?.coinid || ''))
    || !Number.isSafeInteger(expected.minimumConfirmations) || expected.minimumConfirmations < 1) {
    return fail('EXPECTED_SETTLEMENT_INVALID');
  }
  return pass('EXPECTED_SETTLEMENT_VALID');
}

export class ExactMinimaChainReconciler {
  constructor({ source }) { this.source = source; }

  #capabilities() {
    if (!this.source || this.source.capabilities?.canonicalChainBound !== true
      || this.source.capabilities?.completeTransactionLookup !== true
      || this.source.capabilities?.completeMempoolLookup !== true
      || this.source.capabilities?.completeCoinLineageLookup !== true
      || this.source.capabilities?.typedResponses !== true
      || typeof this.source.getChainAnchor !== 'function'
      || typeof this.source.getTransaction !== 'function'
      || typeof this.source.getMempoolTransaction !== 'function'
      || typeof this.source.getInputCoins !== 'function'
      || typeof this.source.getOutputCoins !== 'function'
      || typeof this.source.getConflictingSpends !== 'function') return fail('CHAIN_SOURCE_CAPABILITY_MISSING');
    return pass('CHAIN_SOURCE_CAPABILITIES_VALID');
  }

  async #anchor() {
    let response;
    try { response = await this.source.getChainAnchor(); }
    catch (error) { return fail('CHAIN_ANCHOR_UNKNOWN', { error: error?.name || 'ERROR' }); }
    const blockNumber = exactInteger(response?.blockNumber);
    if (response?.ok !== true || blockNumber === null || blockNumber < 1 || !TX_RE.test(response?.blockId || '')
      || !TX_RE.test(response?.cumulativeWorkDigest || '')) return fail('CHAIN_ANCHOR_UNKNOWN');
    return pass('CHAIN_ANCHOR_ACCEPTED', { blockNumber, blockId: response.blockId,
      cumulativeWorkDigest: response.cumulativeWorkDigest });
  }

  async confirmation(expected) {
    const capabilities = this.#capabilities();
    if (!capabilities.ok) return capabilities;
    const expectedVerdict = validateExpected(expected);
    if (!expectedVerdict.ok) return expectedVerdict;
    const anchor = await this.#anchor();
    if (!anchor.ok) return anchor;
    let found;
    try { found = await this.source.getTransaction({ transactionId: expected.transactionId,
      anchor: anchor.details }); }
    catch (error) { return fail('CONFIRM_SOURCE_UNKNOWN', { error: error?.name || 'ERROR' }); }
    if (found?.ok !== true || documentedBoolean(found.searchComplete) !== true
      || documentedBoolean(found.onchain) === null) return fail('CONFIRM_SOURCE_UNKNOWN');
    if (documentedBoolean(found.onchain) === false) {
      const pendingProof = { onchain: false };
      const checked = verifyConfirmationProof(pendingProof, expected);
      return fail(checked.code, { proof: pendingProof, anchor: anchor.details });
    }
    const blockNumber = exactInteger(found.blockNumber);
    if (blockNumber === null || blockNumber < 1 || blockNumber > anchor.details.blockNumber
      || !found.transaction || found.transaction.transactionid?.toUpperCase() !== expected.transactionId.toUpperCase()
      || !exactIds(found.transaction.inputs?.map((entry) => entry?.coinid), expected.inputCoinIds)
      || canonicalJson(found.transaction.outputs) !== canonicalJson(expected.outputs)) {
      return fail('CONFIRM_SOURCE_BODY_MISMATCH');
    }
    const confirmations = anchor.details.blockNumber - blockNumber + 1;
    const successorDigest = sha256Hex(canonicalJson(found.transaction.outputs));
    const proof = {
      onchain: true,
      confirmations,
      transaction: structuredClone(found.transaction),
      successorDigest,
      chainAnchorBlock: anchor.details.blockNumber,
      chainAnchorId: anchor.details.blockId,
    };
    const checked = verifyConfirmationProof(proof, { ...expected, successorDigest });
    if (!checked.ok) return fail(checked.code, { proof, anchor: anchor.details });
    if (successorDigest !== expected.successorDigest) return fail('CONFIRM_EXPECTED_SUCCESSOR_DIGEST_MISMATCH', {
      derived: successorDigest, expected: expected.successorDigest,
    });
    return pass('CONFIRMED_EXACT_FROM_CHAIN', { proof, anchor: anchor.details });
  }

  async definitiveNonSettlement(expected, { validityEndBlock }) {
    const capabilities = this.#capabilities();
    if (!capabilities.ok) return capabilities;
    const expectedVerdict = validateExpected(expected);
    if (!expectedVerdict.ok) return expectedVerdict;
    if (!Number.isSafeInteger(validityEndBlock) || validityEndBlock < 1) return fail('VALIDITY_END_INVALID');
    const anchor = await this.#anchor();
    if (!anchor.ok) return anchor;
    if (anchor.details.blockNumber <= validityEndBlock) return fail('VALIDITY_NOT_EXPIRED', {
      anchorBlock: anchor.details.blockNumber, validityEndBlock,
    });
    let transaction;
    let mempool;
    let inputs;
    let outputs;
    let conflicts;
    try {
      [transaction, mempool, inputs, outputs, conflicts] = await Promise.all([
        this.source.getTransaction({ transactionId: expected.transactionId, anchor: anchor.details }),
        this.source.getMempoolTransaction({ transactionId: expected.transactionId, anchor: anchor.details }),
        this.source.getInputCoins({ coinIds: expected.inputCoinIds, anchor: anchor.details }),
        this.source.getOutputCoins({ coinIds: expected.outputs.map((entry) => entry.coinid), anchor: anchor.details }),
        this.source.getConflictingSpends({ coinIds: expected.inputCoinIds, anchor: anchor.details }),
      ]);
    } catch (error) {
      return fail('NON_SETTLEMENT_SOURCE_UNKNOWN', { error: error?.name || 'ERROR' });
    }
    const transactionOnchain = documentedBoolean(transaction?.onchain);
    const mempoolPresent = documentedBoolean(mempool?.present);
    if (transaction?.ok !== true || documentedBoolean(transaction.searchComplete) !== true || transactionOnchain !== false
      || mempool?.ok !== true || documentedBoolean(mempool.searchComplete) !== true || mempoolPresent !== false
      || inputs?.ok !== true || documentedBoolean(inputs.searchComplete) !== true
      || outputs?.ok !== true || documentedBoolean(outputs.searchComplete) !== true
      || conflicts?.ok !== true || documentedBoolean(conflicts.searchComplete) !== true) {
      return fail('NON_SETTLEMENT_SOURCE_UNKNOWN');
    }
    if (!exactIds(inputs.coins?.map((entry) => entry?.coinid), expected.inputCoinIds)
      || inputs.coins.some((entry) => documentedBoolean(entry.unspent) !== true)) {
      return fail('PREDECESSOR_NOT_PROVED_UNSPENT');
    }
    const expectedOutputIds = expected.outputs.map((entry) => entry.coinid);
    if (!exactIds(outputs.coins?.map((entry) => entry?.coinid), expectedOutputIds)
      || outputs.coins.some((entry) => documentedBoolean(entry.present) !== false)) {
      return fail('PREDICTED_OUTPUT_ABSENCE_NOT_PROVED');
    }
    if (!Array.isArray(conflicts.spends) || conflicts.spends.length !== 0) {
      return fail('CONFLICTING_SUCCESSOR_OBSERVED', { conflicts: conflicts.spends });
    }
    const proof = {
      onchain: false,
      mempoolPresent: false,
      searchComplete: true,
      predecessorInputsUnspent: true,
      predictedOutputsAbsent: true,
      validityExpired: true,
      chainAnchorBlock: anchor.details.blockNumber,
      chainAnchorId: anchor.details.blockId,
      transactionId: expected.transactionId,
      predecessorInputIds: [...expected.inputCoinIds],
      predictedOutputIds: expectedOutputIds,
      cumulativeWorkDigest: anchor.details.cumulativeWorkDigest,
    };
    const checked = verifyDefinitivelyNotSettled(proof, expected);
    if (!checked.ok) return fail(checked.code, { proof });
    return pass('DEFINITELY_NOT_SETTLED_FROM_CHAIN', {
      proof,
      evidenceDigest: checked.details.evidenceDigest,
      anchor: anchor.details,
    });
  }
}
