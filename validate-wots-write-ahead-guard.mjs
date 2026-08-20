#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WotsWriteAheadGuard, canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const livePolicyPath = path.join(root, 'p9-wots-policy.json');
const policy = JSON.parse(await fs.readFile(livePolicyPath, 'utf8'));
const emitEvidence = process.argv.includes('--evidence');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-p9-wots-'));
const testPolicy = { ...structuredClone(policy), guardId: 'bridge-test-signers-p9-test', signingEnabled: true,
  retirementReason: 'Synthetic test policy only. No live signing authority.' };
const policyPath = path.join(work, 'test-policy.json');
await fs.writeFile(policyPath, `${JSON.stringify(testPolicy, null, 2)}\n`);
const nodeRollbackRoot = path.join(work, 'node-rollback-domain');
await fs.mkdir(nodeRollbackRoot);
let assertions = 0;
let mutationCount = 0;
let propertySteps = 0;

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function expectCode(verdict, code, label) {
  check(verdict?.code === code, `${label}: expected ${code}, received ${verdict?.code}`);
  return verdict;
}

function tx(seed) { return `0x${sha256Hex(`tx:${seed}`)}`; }
function digest(seed) { return sha256Hex(`unsigned:${seed}`); }
function successor(seed) { return sha256Hex(`successor:${seed}`); }

function baselineObservation(overrides = {}, options = {}) {
  const usesById = Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id, entry.minimumUses]));
  Object.assign(usesById, overrides);
  const keys = policy.protectedKeys.map((entry) => ({ publicKey: entry.publicKey, uses: usesById[entry.id],
    maximumUses: policy.maximumUsesPerTreeKey, size: policy.treeKeySize, depth: policy.treeKeyDepth }));
  if (options.missing) keys.splice(keys.findIndex((entry) => entry.publicKey === options.missing), 1);
  if (options.duplicate) keys.push({ ...keys.find((entry) => entry.publicKey === options.duplicate) });
  return {
    nodeName: options.nodeName ?? policy.nodeName,
    coreVersion: options.coreVersion ?? policy.coreVersion,
    committee: structuredClone(options.committee ?? policy.committee),
    keys,
  };
}

function observationForPolicy(selectedPolicy, overrides = {}) {
  const usesById = Object.fromEntries(selectedPolicy.protectedKeys.map((entry) => [entry.id, entry.minimumUses]));
  Object.assign(usesById, overrides);
  return {
    nodeName: selectedPolicy.nodeName,
    coreVersion: selectedPolicy.coreVersion,
    committee: structuredClone(selectedPolicy.committee),
    keys: selectedPolicy.protectedKeys.map((entry) => ({ publicKey: entry.publicKey, uses: usesById[entry.id],
      maximumUses: selectedPolicy.maximumUsesPerTreeKey, size: selectedPolicy.treeKeySize, depth: selectedPolicy.treeKeyDepth })),
  };
}

async function fixture(label, policyOverride = null) {
  const base = path.join(work, label);
  await fs.mkdir(base);
  let selectedPolicyPath = policyPath;
  if (policyOverride) {
    selectedPolicyPath = path.join(base, 'policy.json');
    await fs.writeFile(selectedPolicyPath, `${JSON.stringify(policyOverride, null, 2)}\n`);
  }
  const journalDir = path.join(base, 'journal');
  const guard = new WotsWriteAheadGuard({ policyPath: selectedPolicyPath, journalDir, forbiddenRoots: [nodeRollbackRoot] });
  return { base, journalDir, guard, policyPath: selectedPolicyPath };
}

async function initialized(label, policyOverride = null, observation = null) {
  const item = await fixture(label, policyOverride);
  expectCode(await item.guard.initialize(observation ?? baselineObservation()), 'JOURNAL_INITIALIZED', `${label} initialize`);
  return item;
}

function reserveRequest(seed, observation, keyIds = ['committee-0'], settlementId = `settlement-${seed}`, extras = {}) {
  return {
    intentId: `intent-${seed}`,
    settlementId,
    customTransactionId: `custom-${seed}`,
    transactionId: tx(seed),
    transactionDigest: digest(seed),
    settlementDigest: successor(seed),
    keyIds,
    observation,
    ...extras,
  };
}

async function readLines(journalDir) {
  return (await fs.readFile(path.join(journalDir, 'journal.jsonl'), 'utf8')).trimEnd().split('\n');
}

async function writeLines(journalDir, lines) {
  await fs.writeFile(path.join(journalDir, 'journal.jsonl'), `${lines.join('\n')}\n`);
}

async function cloneJournal(source, label) {
  const target = await fixture(label);
  await fs.cp(source.journalDir, target.journalDir, { recursive: true });
  return target;
}

try {
  const basic = await initialized('basic');
  expectCode(await basic.guard.inspect(baselineObservation()), 'NODE_ACCEPTED', 'baseline accepted');
  expectCode(await basic.guard.inspect(baselineObservation({ 'committee-0': 11 })), 'COUNTER_ROLLBACK', 'rollback rejected');
  expectCode(await basic.guard.inspect(baselineObservation({ 'committee-0': 13 })), 'UNJOURNALED_COUNTER_ADVANCE', 'ahead rejected');
  expectCode(await basic.guard.inspect(baselineObservation({}, { missing: policy.protectedKeys[0].publicKey })), 'PROTECTED_PUBLIC_KEY_MISSING', 'missing key');
  expectCode(await basic.guard.inspect(baselineObservation({}, { duplicate: policy.protectedKeys[0].publicKey })), 'PROTECTED_PUBLIC_KEY_DUPLICATED', 'duplicate key');
  const wrongSize = baselineObservation(); wrongSize.keys[0].size = policy.treeKeySize + 1;
  expectCode(await basic.guard.inspect(wrongSize), 'PROTECTED_TREEKEY_SHAPE_MISMATCH', 'TreeKey size mismatch');
  const wrongDepth = baselineObservation(); wrongDepth.keys[0].depth = policy.treeKeyDepth + 1;
  expectCode(await basic.guard.inspect(wrongDepth), 'PROTECTED_TREEKEY_SHAPE_MISMATCH', 'TreeKey depth mismatch');
  expectCode(await basic.guard.inspect(baselineObservation({}, { nodeName: 'WrongNode' })), 'NODE_NAME_MISMATCH', 'node identity');
  expectCode(await basic.guard.inspect(baselineObservation({}, { coreVersion: '0.0.0' })), 'CORE_VERSION_MISMATCH', 'Core identity');
  const changedCommittee = structuredClone(policy.committee);
  changedCommittee.threshold = 4;
  expectCode(await basic.guard.inspect(baselineObservation({}, { committee: changedCommittee })), 'COMMITTEE_CONFIGURATION_CHANGED', 'committee threshold');

  const retired = await initialized('retired-live-policy', policy);
  expectCode(await retired.guard.reserve(reserveRequest('retired-a', baselineObservation())), 'SIGNING_DOMAIN_RETIRED', 'live P8 key domain retired');

  const forbiddenGuard = new WotsWriteAheadGuard({
    policyPath,
    journalDir: path.join(nodeRollbackRoot, 'guard'),
    forbiddenRoots: [nodeRollbackRoot],
  });
  expectCode(await forbiddenGuard.initialize(baselineObservation()), 'JOURNAL_INSIDE_ROLLBACK_DOMAIN', 'rollback-domain path');

  const orderedKeys = ['committee-0', 'committee-1', 'committee-2', 'committee-3', 'committee-4'];
  const reserved = expectCode(await basic.guard.reserve(reserveRequest('basic-a', baselineObservation(), orderedKeys)), 'RESERVE_RECORDED', 'reserve');
  check(reserved.details.durability.journalSync === true && reserved.details.durability.headSync === true, 'reservation files flushed');
  expectCode(await basic.guard.inspect(baselineObservation()), 'COUNTER_ROLLBACK', 'reservation raises durable minima');
  expectCode(await basic.guard.beginSigningStep({
    intentId: 'intent-basic-a', transactionId: tx('changed'), transactionDigest: digest('basic-a'),
    keyIds: orderedKeys, completedKeyIds: [], nextKeyId: 'committee-0', observation: baselineObservation(),
  }), 'PRE_SIGN_BINDING_MISMATCH', 'changed transaction rejected');
  expectCode(await basic.guard.reserve(reserveRequest('basic-a', baselineObservation(), orderedKeys)), 'COUNTER_ROLLBACK', 'duplicate cannot bypass raised minima');
  expectCode(await basic.guard.reserve(reserveRequest('basic-b', baselineObservation(), ['committee-0'])), 'COUNTER_ROLLBACK', 'conflict before counter gate');
  const basicProgress = {};
  for (let index = 0; index < orderedKeys.length; index += 1) {
    expectCode(await basic.guard.beginSigningStep({
      intentId: 'intent-basic-a', transactionId: tx('basic-a'), transactionDigest: digest('basic-a'), keyIds: orderedKeys,
      completedKeyIds: orderedKeys.slice(0, index), nextKeyId: orderedKeys[index], observation: baselineObservation(basicProgress),
    }), 'SIGN_STEP_RECORDED', `durable sign step ${index}`);
    basicProgress[orderedKeys[index]] = policy.protectedKeys.find((entry) => entry.id === orderedKeys[index]).minimumUses + 1;
  }
  const advancedFive = baselineObservation(Object.fromEntries(orderedKeys.map((key) => [key, policy.protectedKeys.find((entry) => entry.id === key).minimumUses + 1])));
  expectCode(await basic.guard.commit({ intentId: 'intent-basic-a', observation: advancedFive, outcome: 'signed' }), 'COMMIT_RECORDED', 'commit exact counters');
  expectCode(await basic.guard.recordCheck({ intentId: 'intent-basic-a', verdict: 'PASS' }), 'CHECK_RECORDED', 'check pass');
  expectCode(await basic.guard.beginPost({ intentId: 'intent-basic-a', customTransactionId: 'custom-other-a',
    transactionId: tx('other-a'), transactionDigest: digest('other-a'), settlementDigest: successor('other-a') }),
  'POST_BINDING_MISMATCH', 'cross-spec post rejected');
  expectCode(await basic.guard.beginPost({ intentId: 'intent-basic-a', customTransactionId: 'custom-basic-a',
    transactionId: tx('basic-a'), transactionDigest: digest('basic-a'), settlementDigest: successor('basic-a') }),
  'POST_ATTEMPT_RECORDED', 'post attempt durable');
  expectCode(await basic.guard.recordPost({ intentId: 'intent-basic-a', outcome: 'UNKNOWN' }), 'POST_RECORDED', 'post unknown');
  expectCode(await basic.guard.reserve(reserveRequest('basic-c', advancedFive, ['committee-5'], 'settlement-basic-a')),
    'SETTLEMENT_RETRY_BLOCKED', 'unknown post blocks settlement retry');
  expectCode(await basic.guard.reconcileNotSettled({ intentId: 'intent-basic-a', customTransactionId: 'custom-other-a',
    transactionId: tx('other-a'), transactionDigest: digest('other-a'), settlementDigest: successor('other-a'),
    evidenceDigest: digest('reconcile-other') }),
    'RECONCILIATION_BINDING_MISMATCH', 'cross-spec reconciliation rejected');
  expectCode(await basic.guard.reconcileNotSettled({ intentId: 'intent-basic-a', customTransactionId: 'custom-basic-a',
    transactionId: tx('basic-a'), transactionDigest: digest('basic-a'), settlementDigest: successor('basic-a'),
    evidenceDigest: digest('reconcile-basic') }),
    'RECONCILE_NOT_SETTLED_RECORDED', 'not-settled reconciliation');
  expectCode(await basic.guard.reserve(reserveRequest('basic-c', advancedFive, ['committee-5'], 'settlement-basic-a', {
    supersedesIntentId: 'intent-basic-a',
  })), 'RESERVE_RECORDED', 'explicit supersession');

  const confirmed = await initialized('confirmed');
  expectCode(await confirmed.guard.reserve(reserveRequest('confirm-a', baselineObservation())), 'RESERVE_RECORDED', 'confirm reserve');
  const advancedOne = baselineObservation({ 'committee-0': 13 });
  expectCode(await confirmed.guard.beginSigningStep({ intentId: 'intent-confirm-a', transactionId: tx('confirm-a'), transactionDigest: digest('confirm-a'),
    keyIds: ['committee-0'], completedKeyIds: [], nextKeyId: 'committee-0', observation: baselineObservation() }), 'SIGN_STEP_RECORDED', 'confirm sign step');
  expectCode(await confirmed.guard.commit({ intentId: 'intent-confirm-a', observation: advancedOne }), 'COMMIT_RECORDED', 'confirm commit');
  expectCode(await confirmed.guard.recordCheck({ intentId: 'intent-confirm-a', verdict: 'PASS' }), 'CHECK_RECORDED', 'confirm check');
  expectCode(await confirmed.guard.beginPost({ intentId: 'intent-confirm-a', customTransactionId: 'custom-confirm-a',
    transactionId: tx('confirm-a'), transactionDigest: digest('confirm-a'), settlementDigest: successor('confirm-a') }),
  'POST_ATTEMPT_RECORDED', 'confirm post attempt');
  expectCode(await confirmed.guard.recordPost({ intentId: 'intent-confirm-a', outcome: 'ACCEPTED' }), 'POST_RECORDED', 'confirm post');
  expectCode(await confirmed.guard.confirm({ intentId: 'intent-confirm-a', minedTransactionId: tx('confirm-a'),
    successorDigest: successor('confirm-a'), settlementDigest: successor('confirm-a') }),
    'CONFIRM_RECORDED', 'exact confirmation');
  expectCode(await confirmed.guard.confirm({ intentId: 'intent-confirm-a', minedTransactionId: tx('confirm-a'),
    successorDigest: successor('confirm-a'), settlementDigest: successor('confirm-a') }),
    'CONFIRM_ALREADY_RECORDED', 'duplicate confirmation rejected');
  expectCode(await confirmed.guard.reserve(reserveRequest('confirm-b', advancedOne, ['committee-1'], 'settlement-confirm-a')),
    'SETTLEMENT_RETRY_BLOCKED', 'confirmed settlement cannot repeat');

  const partial = await initialized('partial');
  expectCode(await partial.guard.reserve(reserveRequest('partial-a', baselineObservation(), orderedKeys)), 'RESERVE_RECORDED', 'partial reserve');
  expectCode(await partial.guard.beginSigningStep({ intentId: 'intent-partial-a', transactionId: tx('partial-a'), transactionDigest: digest('partial-a'),
    keyIds: orderedKeys, completedKeyIds: [], nextKeyId: 'committee-0', observation: baselineObservation() }), 'SIGN_STEP_RECORDED', 'partial first step');
  expectCode(await partial.guard.beginSigningStep({ intentId: 'intent-partial-a', transactionId: tx('partial-a'), transactionDigest: digest('partial-a'),
    keyIds: orderedKeys, completedKeyIds: ['committee-0'], nextKeyId: 'committee-1', observation: baselineObservation({ 'committee-0': 13 }) }),
    'SIGN_STEP_RECORDED', 'partial second step');
  const prefix = baselineObservation({ 'committee-0': 13, 'committee-1': 13 });
  expectCode(await partial.guard.commit({ intentId: 'intent-partial-a', observation: prefix }), 'COUNTER_INCREMENT_NOT_OBSERVED', 'partial commit rejected');
  const prefixUses = Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id,
    prefix.keys.find((key) => key.publicKey.toUpperCase() === entry.publicKey.toUpperCase()).uses]));
  expectCode(await partial.guard.halt({ intentId: 'intent-partial-a', reason: 'PARTIAL_COUNTER_ADVANCE', observedUses: prefixUses }),
    'HALT_RECORDED', 'partial advancement halted');
  expectCode(await partial.guard.beginSigningStep({ intentId: 'intent-partial-a', transactionId: tx('partial-a'),
    transactionDigest: digest('partial-a'), keyIds: orderedKeys, completedKeyIds: [], nextKeyId: 'committee-0',
    observation: prefix }), 'PRE_SIGN_RESERVATION_NOT_FOUND', 'halt cannot resume');
  const fullyAdvancedAfterHalt = baselineObservation(Object.fromEntries(orderedKeys.map((key) => [key,
    policy.protectedKeys.find((entry) => entry.id === key).minimumUses + 1])));
  expectCode(await partial.guard.commit({ intentId: 'intent-partial-a', observation: fullyAdvancedAfterHalt }),
    'RESERVATION_NOT_PENDING', 'halt cannot later commit');

  const rejected = await initialized('rejected');
  expectCode(await rejected.guard.reserve(reserveRequest('reject-a', baselineObservation())), 'RESERVE_RECORDED', 'reject reserve');
  expectCode(await rejected.guard.beginSigningStep({ intentId: 'intent-reject-a', transactionId: tx('reject-a'), transactionDigest: digest('reject-a'),
    keyIds: ['committee-0'], completedKeyIds: [], nextKeyId: 'committee-0', observation: baselineObservation() }), 'SIGN_STEP_RECORDED', 'reject sign step');
  expectCode(await rejected.guard.commit({ intentId: 'intent-reject-a', observation: advancedOne }), 'COMMIT_RECORDED', 'reject commit');
  expectCode(await rejected.guard.recordCheck({ intentId: 'intent-reject-a', verdict: 'REJECT' }), 'CHECK_RECORDED', 'check rejection recorded');
  expectCode(await rejected.guard.reserve(reserveRequest('reject-b', advancedOne, ['committee-1'], 'settlement-reject-a')),
    'SETTLEMENT_SUPERSESSION_REQUIRED', 'retry requires supersession');
  expectCode(await rejected.guard.reserve(reserveRequest('reject-b', advancedOne, ['committee-1'], 'settlement-reject-a', {
    supersedesIntentId: 'intent-reject-a',
  })), 'RESERVE_RECORDED', 'rejected retry uses new intent');

  const smuggling = await initialized('field-smuggling');
  expectCode(await smuggling.guard.reserve(reserveRequest('smuggle-a', baselineObservation())), 'RESERVE_RECORDED', 'smuggling reserve');
  expectCode(await smuggling.guard.beginSigningStep({ intentId: 'intent-smuggle-a', transactionId: tx('smuggle-a'), transactionDigest: digest('smuggle-a'),
    keyIds: ['committee-0'], completedKeyIds: [], nextKeyId: 'committee-0', observation: baselineObservation() }), 'SIGN_STEP_RECORDED', 'smuggling sign step');
  expectCode(await smuggling.guard.commit({ intentId: 'intent-smuggle-a', observation: advancedOne }), 'COMMIT_RECORDED', 'smuggling commit');
  expectCode(await smuggling.guard.recordCheck({ intentId: 'intent-smuggle-a', verdict: 'PASS', type: 'COMMIT', seq: 0,
    prevHash: 'f'.repeat(64), policyHash: '0'.repeat(64), outcome: 'signed' }), 'CHECK_RECORDED', 'event envelope cannot be overridden');
  expectCode(await smuggling.guard.inspect(advancedOne), 'NODE_ACCEPTED', 'smuggled fields did not corrupt journal');

  const exhaustedPolicy = structuredClone(testPolicy);
  exhaustedPolicy.maximumUsesPerTreeKey = 8;
  exhaustedPolicy.treeKeySize = 2;
  exhaustedPolicy.treeKeyDepth = 3;
  exhaustedPolicy.protectedKeys = exhaustedPolicy.protectedKeys.map((entry, index) => ({ ...entry, minimumUses: index === 0 ? 7 : 0 }));
  const exhaustedBefore = observationForPolicy(exhaustedPolicy);
  const exhaustedAfter = observationForPolicy(exhaustedPolicy, { 'committee-0': 8 });
  const exhausted = await initialized('exhausted', exhaustedPolicy, exhaustedBefore);
  expectCode(await exhausted.guard.reserve(reserveRequest('max-a', exhaustedBefore)), 'RESERVE_RECORDED', 'max minus one allowed');
  expectCode(await exhausted.guard.beginSigningStep({ intentId: 'intent-max-a', transactionId: tx('max-a'), transactionDigest: digest('max-a'),
    keyIds: ['committee-0'], completedKeyIds: [], nextKeyId: 'committee-0', observation: exhaustedBefore }), 'SIGN_STEP_RECORDED', 'max sign step');
  expectCode(await exhausted.guard.commit({ intentId: 'intent-max-a', observation: exhaustedAfter }), 'COMMIT_RECORDED', 'max reached commit');
  expectCode(await exhausted.guard.recordCheck({ intentId: 'intent-max-a', verdict: 'REJECT' }), 'CHECK_RECORDED', 'max check reject');
  expectCode(await exhausted.guard.reserve(reserveRequest('max-b', exhaustedAfter, ['committee-0'], 'settlement-max-b')),
    'COUNTER_EXHAUSTED', 'maximum rejected before TreeKey wrap');

  const policyChanged = structuredClone(testPolicy);
  [policyChanged.protectedKeys[0], policyChanged.protectedKeys[1]] = [policyChanged.protectedKeys[1], policyChanged.protectedKeys[0]];
  const changedPolicyPath = path.join(basic.base, 'changed-policy.json');
  await fs.writeFile(changedPolicyPath, `${JSON.stringify(policyChanged, null, 2)}\n`);
  const changedPolicyGuard = new WotsWriteAheadGuard({ policyPath: changedPolicyPath, journalDir: basic.journalDir, forbiddenRoots: [nodeRollbackRoot] });
  expectCode(await changedPolicyGuard.inspect(advancedFive), 'HEAD_POLICY_MISMATCH', 'ordered policy map pinned');

  const corruptionSource = await initialized('corruption-source');
  expectCode(await corruptionSource.guard.reserve(reserveRequest('corrupt-a', baselineObservation())), 'RESERVE_RECORDED', 'corruption reserve');
  expectCode(await corruptionSource.guard.beginSigningStep({ intentId: 'intent-corrupt-a', transactionId: tx('corrupt-a'), transactionDigest: digest('corrupt-a'),
    keyIds: ['committee-0'], completedKeyIds: [], nextKeyId: 'committee-0', observation: baselineObservation() }), 'SIGN_STEP_RECORDED', 'corruption sign step');
  expectCode(await corruptionSource.guard.commit({ intentId: 'intent-corrupt-a', observation: advancedOne }), 'COMMIT_RECORDED', 'corruption commit');
  const corruptions = [
    ['field-mutation', async (copy) => {
      const lines = await readLines(copy.journalDir); lines[0] = lines[0].replace('GENESIS', 'GENESIZ'); await writeLines(copy.journalDir, lines);
    }, ['JOURNAL_HASH_INVALID', 'JOURNAL_CHAIN_INVALID']],
    ['entry-reorder', async (copy) => {
      const lines = await readLines(copy.journalDir); [lines[1], lines[2]] = [lines[2], lines[1]]; await writeLines(copy.journalDir, lines);
    }, ['JOURNAL_CHAIN_INVALID']],
    ['entry-delete', async (copy) => { const lines = await readLines(copy.journalDir); lines.splice(1, 1); await writeLines(copy.journalDir, lines); },
      ['JOURNAL_LENGTH_MISMATCH']],
    ['entry-duplicate', async (copy) => { const lines = await readLines(copy.journalDir); lines.splice(2, 0, lines[1]); await writeLines(copy.journalDir, lines); },
      ['JOURNAL_LENGTH_MISMATCH']],
    ['suffix-truncate', async (copy) => { const lines = await readLines(copy.journalDir); lines.pop(); await writeLines(copy.journalDir, lines); },
      ['JOURNAL_LENGTH_MISMATCH']],
    ['torn-write', async (copy) => {
      const raw = await fs.readFile(path.join(copy.journalDir, 'journal.jsonl'), 'utf8');
      await fs.writeFile(path.join(copy.journalDir, 'journal.jsonl'), raw.slice(0, -7));
    }, ['JOURNAL_TORN_WRITE']],
    ['trailing-junk', async (copy) => { await fs.appendFile(path.join(copy.journalDir, 'journal.jsonl'), 'junk\n'); }, ['JOURNAL_LENGTH_MISMATCH']],
    ['head-fork', async (copy) => {
      const headPath = path.join(copy.journalDir, 'head.json'); const head = JSON.parse(await fs.readFile(headPath, 'utf8'));
      head.lastHash = 'f'.repeat(64); await fs.writeFile(headPath, canonicalJson(head));
    }, ['JOURNAL_HEAD_MISMATCH']],
  ];
  for (const [label, mutate, codes] of corruptions) {
    const copy = await cloneJournal(corruptionSource, `mutation-${label}`);
    await mutate(copy);
    const verdict = await copy.guard.inspect(advancedOne);
    check(codes.includes(verdict.code), `${label}: unexpected ${verdict.code}`);
    mutationCount += 1;
  }

  for (const stage of ['before-journal-write', 'during-journal-write', 'after-journal-write-before-sync',
    'after-journal-sync', 'during-head-write', 'after-head-sync']) {
    const crash = await initialized(`crash-${stage}`);
    expectCode(await crash.guard.reserve(reserveRequest(`crash-${stage}`, baselineObservation()), { faultAt: stage }),
      'FAIL_CLOSED_AFTER_DURABILITY_FAULT', `fault ${stage}`);
    expectCode(await crash.guard.inspect(baselineObservation()), 'WRITER_LOCK_PRESENT', `fault lock ${stage}`);
    const lockPath = path.join(crash.journalDir, 'writer.lock');
    await fs.unlink(lockPath);
    const forensic = await crash.guard.inspect(baselineObservation());
    if (stage === 'before-journal-write') expectCode(forensic, 'NODE_ACCEPTED', `${stage} forensic state`);
    else if (stage === 'during-journal-write') expectCode(forensic, 'JOURNAL_TORN_WRITE', `${stage} forensic state`);
    else if (stage === 'during-head-write') expectCode(forensic, 'JOURNAL_FILES_MISSING_OR_INVALID', `${stage} forensic state`);
    else if (stage === 'after-head-sync') expectCode(forensic, 'COUNTER_ROLLBACK', `${stage} durable reservation`);
    else expectCode(forensic, 'JOURNAL_LENGTH_MISMATCH', `${stage} forensic state`);
    mutationCount += 1;
  }

  const concurrent = await initialized('concurrent');
  const otherGuard = new WotsWriteAheadGuard({ policyPath, journalDir: concurrent.journalDir, forbiddenRoots: [nodeRollbackRoot] });
  const [left, right] = await Promise.all([
    concurrent.guard.reserve(reserveRequest('concurrent-a', baselineObservation(), ['committee-0'])),
    otherGuard.reserve(reserveRequest('concurrent-b', baselineObservation(), ['committee-0'])),
  ]);
  check([left, right].filter((entry) => entry.code === 'RESERVE_RECORDED').length === 1, 'one concurrent writer wins');
  check([left, right].filter((entry) => entry.code === 'CONCURRENT_WRITER_LOCKED').length === 1, 'one concurrent writer is fenced');

  const concurrentSign = await initialized('concurrent-sign');
  expectCode(await concurrentSign.guard.reserve(reserveRequest('concurrent-sign-a', baselineObservation())), 'RESERVE_RECORDED', 'concurrent sign reserve');
  const competingSignGuard = new WotsWriteAheadGuard({ policyPath, journalDir: concurrentSign.journalDir, forbiddenRoots: [nodeRollbackRoot] });
  const signStepRequest = { intentId: 'intent-concurrent-sign-a', transactionId: tx('concurrent-sign-a'),
    transactionDigest: digest('concurrent-sign-a'), keyIds: ['committee-0'], completedKeyIds: [], nextKeyId: 'committee-0',
    observation: baselineObservation() };
  const signStepResults = await Promise.all([
    concurrentSign.guard.beginSigningStep(signStepRequest), competingSignGuard.beginSigningStep(signStepRequest),
  ]);
  check(signStepResults.filter((entry) => entry.code === 'SIGN_STEP_RECORDED').length === 1, 'one durable sign authorization wins');
  check(signStepResults.filter((entry) => ['CONCURRENT_WRITER_LOCKED', 'PRE_SIGN_SEQUENCE_MISMATCH'].includes(entry.code)).length === 1,
    'competing sign authorization cannot reuse the leaf');

  const property = await initialized('property');
  const current = Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id, entry.minimumUses]));
  for (let index = 0; index < 40; index += 1) {
    const key = policy.protectedKeys[index % policy.protectedKeys.length];
    const seed = `property-${String(index).padStart(3, '0')}`;
    const observation = baselineObservation(current);
    expectCode(await property.guard.reserve(reserveRequest(seed, observation, [key.id])), 'RESERVE_RECORDED', `${seed} reserve`);
    expectCode(await property.guard.beginSigningStep({ intentId: `intent-${seed}`, transactionId: tx(seed), transactionDigest: digest(seed),
      keyIds: [key.id], completedKeyIds: [], nextKeyId: key.id, observation }), 'SIGN_STEP_RECORDED', `${seed} durable sign step`);
    current[key.id] += 1;
    expectCode(await property.guard.commit({ intentId: `intent-${seed}`, observation: baselineObservation(current) }), 'COMMIT_RECORDED', `${seed} commit`);
    expectCode(await property.guard.recordCheck({ intentId: `intent-${seed}`, verdict: 'REJECT' }), 'CHECK_RECORDED', `${seed} rejection`);
    propertySteps += 1;
  }
  expectCode(await property.guard.inspect(baselineObservation(current)), 'NODE_ACCEPTED', 'property final counters');

  const journalText = await fs.readFile(path.join(property.journalDir, 'journal.jsonl'), 'utf8');
  for (const forbiddenText of ['dbpassword', 'privatekey', 'seedphrase', 'mnemonic', 'signaturesecret']) {
    check(!journalText.toLowerCase().includes(forbiddenText), `journal secret hygiene ${forbiddenText}`);
  }

  const report = {
    schema: 'generic-p9-wots-guard-validation/v1',
    createdAt: new Date().toISOString(),
    result: 'PASS',
    assertions,
    mutationCount,
    propertySteps,
    protectedKeys: policy.protectedKeys.length,
    livePolicySigningEnabled: policy.signingEnabled,
    sourceSha256: {
      policy: sha256Hex(await fs.readFile(livePolicyPath)),
      guard: sha256Hex(await fs.readFile(path.join(root, 'wots-write-ahead-guard.mjs'))),
      validator: sha256Hex(await fs.readFile(fileURLToPath(import.meta.url))),
    },
    currentMinimums: Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id, entry.minimumUses])),
    durability: {
      journalFileSync: true,
      headFileSync: true,
      directorySyncAvailableOnThisRun: process.platform !== 'win32',
      localExclusiveWriterLock: true,
      staleLocksNeverAutoCleared: true,
    },
    proved: [
      'exact protected configuration and immutable floors',
      'reservation durability before signing authorization',
      'exact transaction and ordered-key binding',
      'rollback, ahead-counter, exhaustion and partial-prefix rejection',
      'hash-chain, head-anchor, truncation, tear and corruption rejection',
      'single local writer and fail-closed crash behavior',
      'typed settlement retry, supersession and confirmation states',
    ],
    limitations: [
      'A local filesystem lock does not fence a copied guard store or another host.',
      'An administrator able to roll back both journal and trusted head together is outside this local proof.',
      'Windows did not provide a portable directory fsync proof through Node.js.',
      'No Minima signature or transaction was created by this validator.',
      'The live P8 fixture signing domain is retired; enabled signing is exercised only by a synthetic test policy.',
    ],
  };
  if (emitEvidence) {
    const stamp = report.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const evidencePath = path.join(root, 'evidence', `generic-p9-wots-guard-${stamp}.json`);
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    await fs.writeFile(evidencePath, bytes);
    await fs.writeFile(`${evidencePath}.sha256`, `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${path.basename(evidencePath)}\n`);
    report.evidencePath = evidencePath;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.rm(work, { recursive: true, force: true });
}
