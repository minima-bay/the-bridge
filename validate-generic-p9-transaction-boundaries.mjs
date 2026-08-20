#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RecoverySafeTransactionLifecycle,
  SimulatedLifecycleCrash,
  classifyPostResult,
  normalizeTxncheck,
  verifyConfirmationProof,
  verifyDefinitivelyNotSettled,
} from './generic-bridge-transaction-lifecycle.mjs';
import { WotsWriteAheadGuard, canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const livePolicyPath = path.join(root, 'p9-wots-policy.json');
const policy = JSON.parse(await fs.readFile(livePolicyPath, 'utf8'));
const emitEvidence = process.argv.includes('--evidence');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-p9-boundaries-'));
const testPolicy = { ...structuredClone(policy), guardId: 'bridge-transaction-p9-test', signingEnabled: true,
  retirementReason: 'Synthetic transaction-boundary test policy only.' };
const policyPath = path.join(work, 'test-policy.json');
await fs.writeFile(policyPath, `${JSON.stringify(testPolicy, null, 2)}\n`);
const forbiddenRoot = path.join(work, 'node-domain');
await fs.mkdir(forbiddenRoot);
let assertions = 0;
let crashCases = 0;
let hostileCases = 0;
const specRegistry = new Map();

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function expectCode(value, code, label) {
  check(value?.code === code, `${label}: expected ${code}, received ${value?.code}`);
  return value;
}

function tx(seed) { return `0x${sha256Hex(`tx:${seed}`)}`; }
function coin(seed) { return `0x${sha256Hex(`coin:${seed}`)}`; }
function digest(seed) { return sha256Hex(`digest:${seed}`); }

function observation(uses) {
  return {
    nodeName: policy.nodeName,
    coreVersion: policy.coreVersion,
    committee: structuredClone(policy.committee),
    keys: policy.protectedKeys.map((entry) => ({ publicKey: entry.publicKey, uses: uses[entry.id],
      maximumUses: policy.maximumUsesPerTreeKey, size: policy.treeKeySize, depth: policy.treeKeyDepth })),
  };
}

function initialUses() { return Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id, entry.minimumUses])); }

function acceptedCheck(signatures = 1) {
  return {
    inputs: 2,
    outputs: 2,
    signatures,
    mmrproofs: 2,
    scripts: 2,
    validamounts: true,
    allsignaturesvalid: true,
    validtransaction: true,
    valid: { basic: true, mmrproofs: true, scripts: true },
    coins: [{ tokenid: '0x01', difference: '0' }, { tokenid: '0x02', difference: '0.0' }],
  };
}

function expectedCheck(signatures = 1) {
  return {
    inputs: 2,
    outputs: 2,
    signatures,
    mmrproofs: 2,
    scripts: 2,
    coinDifferences: [{ tokenId: '0x01', difference: '0' }, { tokenId: '0x02', difference: '0' }],
  };
}

function spec(seed, keyIds = ['committee-0'], extras = {}) {
  const transactionId = tx(seed);
  const outputs = [
    { coinid: coin(`${seed}:control`), address: '0xAA', tokenid: '0x01', amount: '1', stateDigest: digest(`${seed}:state`) },
    { coinid: coin(`${seed}:reserve`), address: '0xAA', tokenid: '0x02', amount: '100' },
  ];
  const unsignedBody = {
    inputs: [coin(`${seed}:input-control`), coin(`${seed}:input-reserve`)],
    outputs,
    state: { 0: '2', 90: `0x${digest(`${seed}:record`)}` },
  };
  const value = {
    intentId: `intent-${seed}`,
    settlementId: `settlement-${seed}`,
    customTransactionId: `custom-${seed}`,
    transactionId,
    transactionDigest: sha256Hex(canonicalJson(unsignedBody)),
    unsignedBody,
    keyIds,
    unsignedVerified: true,
    witnessStrategy: 'txnsign-then-txnmmr-then-explicit-txnscript',
    expectedCheck: expectedCheck(keyIds.length),
    expectedConfirmation: {
      transactionId,
      inputCoinIds: [coin(`${seed}:input-control`), coin(`${seed}:input-reserve`)],
      outputs,
      successorDigest: digest(`${seed}:successor`),
      minimumConfirmations: 3,
    },
    ...extras,
  };
  specRegistry.set(value.customTransactionId, {
    customTransactionId: value.customTransactionId,
    transactionId: value.transactionId,
    unsignedBody: structuredClone(value.unsignedBody),
  });
  return value;
}

async function fixture(label, options = {}) {
  const base = path.join(work, label);
  await fs.mkdir(base);
  const journalDir = path.join(base, 'journal');
  const guard = new WotsWriteAheadGuard({ policyPath, journalDir, forbiddenRoots: [forbiddenRoot] });
  const uses = initialUses();
  expectCode(await guard.initialize(observation(uses)), 'JOURNAL_INITIALIZED', `${label} initialize`);
  const calls = [];
  let checkReply = options.checkReply ?? acceptedCheck(options.keyIds?.length || 1);
  let postMode = options.postMode || 'accepted';
  let settlementCount = 0;
  const lifecycle = new RecoverySafeTransactionLifecycle({
    guard,
    observeCounters: async () => { calls.push('observe'); return observation(uses); },
    loadTransactionSnapshot: async ({ customTransactionId }) => {
      calls.push('txnlist');
      const snapshot = specRegistry.get(customTransactionId);
      return snapshot ? structuredClone(snapshot) : null;
    },
    signOne: async ({ keyId }) => {
      calls.push(`sign:${keyId}`);
      const journal = await fs.readFile(path.join(journalDir, 'journal.jsonl'), 'utf8');
      check(journal.includes('"type":"RESERVE"'), 'durable reservation exists before sign callback');
      if (options.failSignKey === keyId) {
        if (options.advanceOnSignFailure) uses[keyId] += 1;
        throw new Error('injected sign failure');
      }
      uses[keyId] += 1;
      if (options.mutateAfterSign) {
        const snapshot = specRegistry.get(options.mutateAfterSign);
        if (snapshot) snapshot.unsignedBody.state[0] = '999';
      }
    },
    finalizeExplicitWitness: async ({ transactionId }) => {
      calls.push('txnmmr'); calls.push('txnscript-explicit');
      return { strategy: 'txnsign-then-txnmmr-then-explicit-txnscript', transactionId };
    },
    runTxncheck: async () => { calls.push('txncheck'); return structuredClone(checkReply); },
    postSignedTransaction: async ({ transactionId }) => {
      calls.push('txnpost');
      if (postMode === 'timeout-after-accept') { settlementCount = 1; throw new Error('transport timeout'); }
      if (postMode === 'truncated-after-accept') { settlementCount = 1; return { status: true, txpowid: 'truncated' }; }
      if (postMode === 'unknown-never-accepted') throw new Error('transport failed before broadcast');
      if (postMode === 'refusal') return { status: false, broadcast: false, code: 'PRE_BROADCAST_REFUSAL' };
      settlementCount = 1;
      return { status: true, txpowid: tx(`txpow:${transactionId}`), transactionid: transactionId, size: 20000 };
    },
  });
  return {
    base, journalDir, guard, uses, calls, lifecycle,
    setCheckReply(value) { checkReply = value; },
    setPostMode(value) { postMode = value; },
    settlementCount() { return settlementCount; },
  };
}

function exactProof(item) {
  return {
    onchain: true,
    confirmations: 3,
    transaction: {
      transactionid: item.transactionId,
      inputs: item.expectedConfirmation.inputCoinIds.map((coinid) => ({ coinid })),
      outputs: structuredClone(item.expectedConfirmation.outputs),
    },
    successorDigest: item.expectedConfirmation.successorDigest,
  };
}

try {
  const boolForms = [true, 1, '1', 'true'];
  for (const form of boolForms) {
    const reply = acceptedCheck();
    reply.validamounts = form;
    expectCode(normalizeTxncheck(reply, expectedCheck()), 'CHECK_ACCEPTED', `documented boolean ${String(form)}`);
  }
  for (const value of [undefined, null, 'yes', {}, 2, -1]) {
    const reply = acceptedCheck(); reply.validamounts = value;
    expectCode(normalizeTxncheck(reply, expectedCheck()), 'CHECK_UNKNOWN', `ambiguous check ${String(value)}`);
    hostileCases += 1;
  }
  for (const mutate of [
    (reply) => { reply.validtransaction = false; },
    (reply) => { reply.signatures = 0; },
    (reply) => { reply.coins[0].difference = '1'; },
    (reply) => { reply.valid.scripts = 'false'; },
  ]) {
    const reply = acceptedCheck(); mutate(reply);
    expectCode(normalizeTxncheck(reply, expectedCheck()), 'CHECK_REJECTED', 'explicit check rejection');
    hostileCases += 1;
  }
  const emptyCoins = acceptedCheck(); emptyCoins.coins = [];
  expectCode(normalizeTxncheck(emptyCoins, expectedCheck()), 'CHECK_UNKNOWN', 'empty token accounting rejected');
  expectCode(classifyPostResult(null, new Error('timeout'), tx('direct')), 'POST_UNKNOWN', 'transport timeout');
  expectCode(classifyPostResult({ status: true, txpowid: 'bad' }, null, tx('direct')), 'POST_UNKNOWN', 'truncated accepted reply');
  expectCode(classifyPostResult({ status: false, broadcast: false, code: 'PRE_BROADCAST_REFUSAL' }), 'POST_DEFINITE_REFUSAL', 'definite refusal');
  expectCode(classifyPostResult({ status: 'truthy', txpowid: tx('bad'), size: 1 }, null, tx('direct')), 'POST_UNKNOWN', 'truthiness rejected');

  const success = await fixture('success');
  const successSpec = spec('success-a');
  expectCode(await success.lifecycle.signAndCheck(successSpec), 'CHECK_ACCEPTED', 'successful signed check');
  const reserveIndex = success.calls.findIndex((entry) => entry.startsWith('sign:'));
  check(reserveIndex >= 1, 'observation and guard authorization precede signing');
  check(success.calls.indexOf('txnmmr') > reserveIndex, 'txnmmr follows signing');
  check(success.calls.indexOf('txnscript-explicit') > success.calls.indexOf('txnmmr'), 'explicit script follows txnmmr');
  check(success.calls.indexOf('txncheck') > success.calls.indexOf('txnscript-explicit'), 'txncheck follows explicit witness');
  expectCode(await success.lifecycle.post(successSpec), 'POST_ACCEPTED', 'post accepted is not confirmation');
  const pendingProof = exactProof(successSpec); pendingProof.onchain = false;
  expectCode(await success.lifecycle.confirm(successSpec, pendingProof), 'CONFIRM_PENDING', 'post acceptance remains pending');
  const foreignConfirmationSpec = spec('success-confirm-foreign', ['committee-1'], { intentId: successSpec.intentId });
  const foreignConfirmation = await success.lifecycle.confirm(foreignConfirmationSpec, exactProof(foreignConfirmationSpec));
  expectCode(foreignConfirmation, 'CONFIRM_JOURNAL_REJECTED', 'cross-spec confirmation rejected');
  expectCode(foreignConfirmation.details.guard, 'CONFIRMATION_INVALID', 'guard identifies cross-spec confirmation');
  hostileCases += 1;
  expectCode(await success.lifecycle.confirm(successSpec, exactProof(successSpec)), 'CONFIRMED_EXACT', 'exact body and onchain confirmation');
  check(success.settlementCount() === 1, 'one successor settlement');
  const duplicate = spec('success-duplicate', ['committee-1'], { settlementId: successSpec.settlementId });
  const duplicateResult = await success.lifecycle.signAndCheck(duplicate);
  expectCode(duplicateResult, 'RESERVATION_REJECTED', 'confirmed settlement duplicate blocked');
  expectCode(duplicateResult.details.guard, 'SETTLEMENT_RETRY_BLOCKED', 'guard reports confirmed duplicate');

  const postBinding = await fixture('post-binding');
  const postBindingA = spec('post-binding-a');
  const postBindingB = spec('post-binding-b', ['committee-1'], { intentId: postBindingA.intentId });
  expectCode(await postBinding.lifecycle.signAndCheck(postBindingA), 'CHECK_ACCEPTED', 'post binding source checked');
  const postCallsBeforeSwap = postBinding.calls.filter((entry) => entry === 'txnpost').length;
  const swappedPost = await postBinding.lifecycle.post(postBindingB);
  expectCode(swappedPost, 'POST_NOT_AUTHORIZED', 'cross-spec post rejected before broadcast');
  expectCode(swappedPost.details.guard, 'POST_BINDING_MISMATCH', 'guard identifies cross-spec post');
  check(postBinding.calls.filter((entry) => entry === 'txnpost').length === postCallsBeforeSwap,
    'cross-spec post never reaches broadcast callback');
  hostileCases += 1;

  const swapped = await fixture('swapped-body');
  const swappedSpec = spec('swapped-body-a');
  specRegistry.get(swappedSpec.customTransactionId).unsignedBody.outputs[0].amount = '999';
  expectCode(await swapped.lifecycle.signAndCheck(swappedSpec), 'LOADED_TRANSACTION_BINDING_MISMATCH', 'swapped body rejected before reservation');
  check(!swapped.calls.some((entry) => entry.startsWith('sign:')), 'swapped body never reaches signing');

  const changedBetweenSignsSpec = spec('changed-between-signs', ['committee-0', 'committee-1']);
  const changedBetweenSigns = await fixture('changed-between-signs', { mutateAfterSign: changedBetweenSignsSpec.customTransactionId, keyIds: changedBetweenSignsSpec.keyIds });
  expectCode(await changedBetweenSigns.lifecycle.signAndCheck(changedBetweenSignsSpec), 'LOADED_TRANSACTION_BINDING_MISMATCH',
    'body mutation between signatures rejected');
  check(changedBetweenSigns.uses['committee-0'] === 13 && changedBetweenSigns.uses['committee-1'] === 12,
    'only prefix leaf advanced before mutation halt');

  for (const stage of ['before-reserve', 'after-reserve', 'after-sign-step-1', 'after-sign-1', 'after-commit', 'after-witness', 'after-check-before-record']) {
    const crash = await fixture(`crash-${stage}`);
    const crashSpec = spec(`crash-${stage}`);
    let caught = null;
    try { await crash.lifecycle.signAndCheck(crashSpec, { crashAt: stage }); } catch (error) { caught = error; }
    check(caught instanceof SimulatedLifecycleCrash && caught.stage === stage, `${stage} crash injected`);
    if (stage === 'before-reserve') {
      expectCode(await crash.guard.inspect(observation(crash.uses)), 'NODE_ACCEPTED', `${stage} zero reservation`);
    } else if (stage === 'after-reserve' || stage === 'after-sign-step-1') {
      expectCode(await crash.guard.inspect(observation(crash.uses)), 'COUNTER_ROLLBACK', `${stage} leaf retired before sign`);
    } else if (stage === 'after-sign-1') {
      expectCode(await crash.guard.commit({ intentId: crashSpec.intentId, observation: observation(crash.uses) }), 'COMMIT_RECORDED', `${stage} recover exact increment`);
    } else {
      const retry = spec(`${stage}-retry`, ['committee-1'], { settlementId: crashSpec.settlementId });
      const retried = await crash.lifecycle.signAndCheck(retry);
      expectCode(retried, 'RESERVATION_REJECTED', `${stage} blocks unresolved retry`);
      expectCode(retried.details.guard, 'SETTLEMENT_RETRY_BLOCKED', `${stage} typed unresolved state`);
    }
    crashCases += 1;
  }

  const fiveKeys = ['committee-0', 'committee-1', 'committee-2', 'committee-3', 'committee-4'];
  for (let signed = 1; signed <= fiveKeys.length; signed += 1) {
    const crash = await fixture(`prefix-${signed}`, { keyIds: fiveKeys });
    const item = spec(`prefix-${signed}`, fiveKeys);
    let caught;
    try { await crash.lifecycle.signAndCheck(item, { crashAt: `after-sign-${signed}` }); } catch (error) { caught = error; }
    check(caught instanceof SimulatedLifecycleCrash, `prefix ${signed} crash`);
    for (let index = 0; index < fiveKeys.length; index += 1) {
      const floor = policy.protectedKeys.find((entry) => entry.id === fiveKeys[index]).minimumUses;
      check(crash.uses[fiveKeys[index]] === floor + (index < signed ? 1 : 0), `prefix ${signed} counter ${index}`);
    }
    if (signed < fiveKeys.length) {
      expectCode(await crash.guard.beginSigningStep({
        intentId: item.intentId,
        transactionId: item.transactionId,
        transactionDigest: item.transactionDigest,
        keyIds: fiveKeys,
        completedKeyIds: fiveKeys.slice(0, signed),
        nextKeyId: fiveKeys[signed],
        observation: observation(crash.uses),
      }), 'SIGN_STEP_RECORDED', `prefix ${signed} exact-resume durable step`);
    } else {
      expectCode(await crash.guard.commit({ intentId: item.intentId, observation: observation(crash.uses) }), 'COMMIT_RECORDED', 'all-five recovery commit');
    }
    crashCases += 1;
  }

  const signFailure = await fixture('sign-failure', { failSignKey: 'committee-1', advanceOnSignFailure: true, keyIds: fiveKeys });
  const failureResult = await signFailure.lifecycle.signAndCheck(spec('sign-failure', fiveKeys));
  expectCode(failureResult, 'SIGNING_HALTED', 'mixed-prefix sign failure halted');
  const failureRetry = await signFailure.lifecycle.signAndCheck(spec('sign-failure-retry', ['committee-5'], {
    settlementId: 'settlement-sign-failure', supersedesIntentId: 'intent-sign-failure',
  }));
  expectCode(failureRetry, 'RESERVATION_REJECTED', 'halted settlement never auto-clears');

  const rejected = await fixture('check-rejected', { checkReply: (() => { const reply = acceptedCheck(); reply.valid.scripts = false; return reply; })() });
  const rejectedSpec = spec('check-rejected');
  expectCode(await rejected.lifecycle.signAndCheck(rejectedSpec), 'CHECK_REJECTED', 'rejected transition recorded after leaf use');
  check(rejected.uses['committee-0'] === 13, 'rejected check leaf accounted');
  const correctedSpec = spec('check-corrected', ['committee-1'], {
    settlementId: rejectedSpec.settlementId,
    supersedesIntentId: rejectedSpec.intentId,
  });
  rejected.setCheckReply(acceptedCheck());
  expectCode(await rejected.lifecycle.signAndCheck(correctedSpec), 'CHECK_ACCEPTED', 'corrected attempt uses explicit supersession and fresh leaf');
  check(rejected.uses['committee-0'] === 13 && rejected.uses['committee-1'] === 13, 'no rejected leaf reused');

  for (const mode of ['timeout-after-accept', 'truncated-after-accept']) {
    const ambiguous = await fixture(`post-${mode}`, { postMode: mode });
    const item = spec(`post-${mode}`);
    expectCode(await ambiguous.lifecycle.signAndCheck(item), 'CHECK_ACCEPTED', `${mode} check`);
    expectCode(await ambiguous.lifecycle.post(item), 'POST_UNKNOWN', `${mode} typed unknown`);
    check(ambiguous.settlementCount() === 1, `${mode} fake chain accepted once`);
    const postsBeforeRetry = ambiguous.calls.filter((entry) => entry === 'txnpost').length;
    expectCode(await ambiguous.lifecycle.post(item), 'POST_NOT_AUTHORIZED', `${mode} cannot rebroadcast before reconciliation`);
    check(ambiguous.calls.filter((entry) => entry === 'txnpost').length === postsBeforeRetry, `${mode} second broadcast callback not reached`);
    const retry = spec(`${mode}-retry`, ['committee-1'], { settlementId: item.settlementId });
    expectCode(await ambiguous.lifecycle.signAndCheck(retry), 'RESERVATION_REJECTED', `${mode} no rebuild`);
    expectCode(await ambiguous.lifecycle.confirm(item, exactProof(item)), 'CONFIRMED_EXACT', `${mode} reconciled exact transaction`);
    check(ambiguous.settlementCount() === 1, `${mode} settlement remains one`);
    hostileCases += 1;
  }

  const reconcile = await fixture('reconcile', { postMode: 'unknown-never-accepted' });
  const reconcileSpec = spec('reconcile-a');
  expectCode(await reconcile.lifecycle.signAndCheck(reconcileSpec), 'CHECK_ACCEPTED', 'reconcile check');
  expectCode(await reconcile.lifecycle.post(reconcileSpec), 'POST_UNKNOWN', 'reconcile unknown post');
  check(reconcile.settlementCount() === 0, 'never-accepted fake chain has no settlement');
  const incomplete = { transactionId: reconcileSpec.transactionId, onchain: false, mempoolPresent: false,
    predecessorInputsUnspent: true, predictedOutputsAbsent: true, validityExpired: true, searchComplete: false,
    chainAnchorBlock: 1000, chainAnchorId: tx('anchor'),
    predecessorInputIds: reconcileSpec.expectedConfirmation.inputCoinIds,
    predictedOutputIds: reconcileSpec.expectedConfirmation.outputs.map((entry) => entry.coinid) };
  expectCode(verifyDefinitivelyNotSettled(incomplete, reconcileSpec.expectedConfirmation), 'NOT_SETTLED_UNKNOWN', 'bounded search cannot clear unknown');
  const complete = { ...incomplete, searchComplete: true };
  expectCode(verifyDefinitivelyNotSettled({ ...complete, onchain: 'true' }, reconcileSpec.expectedConfirmation),
    'NOT_SETTLED_UNKNOWN', 'typed true cannot clear unknown post');
  const foreignReconcileSpec = spec('reconcile-foreign', ['committee-1'], { intentId: reconcileSpec.intentId });
  const foreignComplete = {
    ...complete,
    transactionId: foreignReconcileSpec.transactionId,
    predecessorInputIds: foreignReconcileSpec.expectedConfirmation.inputCoinIds,
    predictedOutputIds: foreignReconcileSpec.expectedConfirmation.outputs.map((entry) => entry.coinid),
  };
  const swappedReconciliation = await reconcile.lifecycle.reconcileNotSettled(foreignReconcileSpec, foreignComplete);
  expectCode(swappedReconciliation, 'RECONCILIATION_JOURNAL_REJECTED', 'cross-spec negative reconciliation rejected');
  expectCode(swappedReconciliation.details.guard, 'RECONCILIATION_BINDING_MISMATCH', 'guard identifies cross-spec reconciliation');
  hostileCases += 1;
  expectCode(await reconcile.lifecycle.reconcileNotSettled(reconcileSpec, complete), 'DEFINITELY_NOT_SETTLED', 'complete negative reconciliation');
  reconcile.setPostMode('accepted');
  const retryAfterReconcile = spec('reconcile-retry', ['committee-1'], {
    settlementId: reconcileSpec.settlementId,
    supersedesIntentId: reconcileSpec.intentId,
  });
  expectCode(await reconcile.lifecycle.signAndCheck(retryAfterReconcile), 'CHECK_ACCEPTED', 'reconciled settlement can use explicit fresh attempt');
  expectCode(await reconcile.lifecycle.post(retryAfterReconcile), 'POST_ACCEPTED', 'fresh reconciled attempt posts once');
  expectCode(await reconcile.lifecycle.confirm(retryAfterReconcile, exactProof(retryAfterReconcile)), 'CONFIRMED_EXACT', 'fresh attempt confirms');
  check(reconcile.settlementCount() === 1, 'reconciliation retry creates exactly one settlement');

  const confirmation = spec('confirmation-cases');
  const confirmationCases = [
    ['body-missing', { onchain: true, confirmations: 3 }, 'CONFIRM_UNKNOWN'],
    ['pending', { ...exactProof(confirmation), onchain: false }, 'CONFIRM_PENDING'],
    ['few-confirmations', { ...exactProof(confirmation), confirmations: 2 }, 'CONFIRM_PENDING'],
    ['conflict', { ...exactProof(confirmation), conflictingTransactionId: tx('other') }, 'CONFLICTING_SUCCESSOR'],
    ['successor', { ...exactProof(confirmation), successorDigest: digest('wrong') }, 'CONFIRM_SUCCESSOR_MISMATCH'],
  ];
  const wrongInputs = exactProof(confirmation); wrongInputs.transaction.inputs.reverse();
  confirmationCases.push(['input-order', wrongInputs, 'CONFIRM_INPUT_MISMATCH']);
  const wrongOutputs = exactProof(confirmation); wrongOutputs.transaction.outputs[0].amount = '2';
  confirmationCases.push(['output', wrongOutputs, 'CONFIRM_OUTPUT_MISMATCH']);
  for (const [label, proof, code] of confirmationCases) {
    expectCode(verifyConfirmationProof(proof, confirmation.expectedConfirmation), code, label);
    hostileCases += 1;
  }

  const report = {
    schema: 'generic-p9-transaction-boundary-validation/v1',
    createdAt: new Date().toISOString(),
    result: 'PASS',
    assertions,
    crashCases,
    hostileCases,
    liveNodeCommandsExecuted: false,
    signaturesCreated: 0,
    transactionsPosted: 0,
    livePolicySigningEnabled: policy.signingEnabled,
    sourceSha256: {
      policy: sha256Hex(await fs.readFile(livePolicyPath)),
      guard: sha256Hex(await fs.readFile(path.join(root, 'wots-write-ahead-guard.mjs'))),
      lifecycle: sha256Hex(await fs.readFile(path.join(root, 'generic-bridge-transaction-lifecycle.mjs'))),
      validator: sha256Hex(await fs.readFile(fileURLToPath(import.meta.url))),
    },
    witnessResolution: {
      requiredOrder: ['reserve-and-flush', 'durable-one-shot-sign-step-for-exact-unsigned-transaction', 'txnsign-each-key', 'observe-and-commit-counters',
        'txnmmr', 'explicit-txnscript', 'txncheck', 'typed-post', 'exact-onchain-confirmation'],
      txnbasicsUsed: false,
      reason: 'The P8 covenant exceeds the wallet script registry limit, so the proven explicit txnmmr plus txnscript witness path is retained.',
    },
    proved: [
      'no signing callback before a durable reservation',
      'per-key counter sequencing across five signers and every prefix crash',
      'rejected checks permanently account for leaves',
      'missing and ambiguous txncheck values fail closed',
      'post authorization binds the intent to the reserved custom transaction, transaction body and expected settlement before broadcast',
      'negative reconciliation cannot use a different transaction specification to clear an unknown post',
      'accepted-response-lost post outcomes reconcile the exact transaction without rebuilding',
      'confirmation pins onchain status, exact predecessor inputs, ordered outputs, successor digest and confirmations',
      'duplicate settlement and unresolved retries do not create a second successor',
    ],
    limitations: [
      'All transaction-boundary cases use dependency-injected fakes and disposable counters.',
      'No restored P8 key signed and no mainnet transaction was posted.',
    ],
  };
  if (emitEvidence) {
    const stamp = report.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const evidencePath = path.join(root, 'evidence', `generic-p9-transaction-boundaries-${stamp}.json`);
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    await fs.writeFile(evidencePath, bytes);
    await fs.writeFile(`${evidencePath}.sha256`, `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${path.basename(evidencePath)}\n`);
    report.evidencePath = evidencePath;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.rm(work, { recursive: true, force: true });
}
