import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const JOURNAL_SCHEMA = 'generic-bridge-wots-journal/v1';
const HEAD_SCHEMA = 'generic-bridge-wots-head/v1';
const ZERO_HASH = '0'.repeat(64);
const EVENT_TYPES = new Set(['GENESIS', 'RESERVE', 'SIGN_STEP', 'COMMIT', 'HALT', 'CHECK', 'POST_ATTEMPT', 'POST', 'CONFIRM', 'RECONCILE_NOT_SETTLED']);
const INTENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CUSTOM_TRANSACTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TX_RE = /^0x[0-9A-Fa-f]{64}$/;

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanHex(value) {
  return String(value || '').toUpperCase();
}

function result(ok, code, details = {}) {
  return { schema: 'generic-bridge-wots-verdict/v1', ok, code, details };
}

function fail(code, details = {}) {
  return result(false, code, details);
}

function pass(code, details = {}) {
  return result(true, code, details);
}

function eventHash(eventWithoutHash) {
  return sha256Hex(canonicalJson(eventWithoutHash));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function physicalCandidate(candidate) {
  let cursor = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      const real = await fs.realpath(cursor);
      return path.join(real, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function syncDirectory(directory) {
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
      return true;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EINVAL', 'EBADF'].includes(error?.code)) return false;
    throw error;
  }
}

function validatePolicyObject(policy) {
  if (!isPlainObject(policy) || policy.schema !== 'generic-bridge-wots-policy/v1') return fail('POLICY_SCHEMA_INVALID');
  if (!INTENT_RE.test(policy.guardId || '')) return fail('POLICY_GUARD_ID_INVALID');
  if (policy.strictCounters !== true) return fail('POLICY_STRICT_COUNTERS_REQUIRED');
  if (typeof policy.signingEnabled !== 'boolean' || (policy.signingEnabled === false && !String(policy.retirementReason || '').trim())) {
    return fail('POLICY_SIGNING_STATE_INVALID');
  }
  if (!Number.isSafeInteger(policy.maximumUsesPerTreeKey) || policy.maximumUsesPerTreeKey < 1) {
    return fail('POLICY_MAXIMUM_USES_INVALID');
  }
  if (!Number.isSafeInteger(policy.treeKeySize) || policy.treeKeySize < 1
    || !Number.isSafeInteger(policy.treeKeyDepth) || policy.treeKeyDepth < 1
    || !Number.isSafeInteger(policy.treeKeySize ** policy.treeKeyDepth)
    || policy.treeKeySize ** policy.treeKeyDepth !== policy.maximumUsesPerTreeKey) return fail('POLICY_TREEKEY_SHAPE_INVALID');
  if (!isPlainObject(policy.committee)
    || !Number.isSafeInteger(policy.committee.threshold)
    || !Number.isSafeInteger(policy.committee.memberCount)
    || policy.committee.threshold < 1
    || policy.committee.threshold > policy.committee.memberCount
    || !/^0X[0-9A-F]{64}$/.test(cleanHex(policy.committee.rootSha3))) {
    return fail('POLICY_COMMITTEE_INVALID');
  }
  if (!Array.isArray(policy.protectedKeys) || policy.protectedKeys.length === 0) return fail('POLICY_KEYS_MISSING');
  const ids = new Set();
  const publicKeys = new Set();
  let committeeCount = 0;
  for (const key of policy.protectedKeys) {
    if (!isPlainObject(key) || !INTENT_RE.test(key.id || '') || ids.has(key.id)) return fail('POLICY_KEY_ID_INVALID', { keyId: key?.id });
    const publicKey = cleanHex(key.publicKey);
    if (!/^0X[0-9A-F]{64}$/.test(publicKey) || publicKeys.has(publicKey)) return fail('POLICY_PUBLIC_KEY_INVALID', { keyId: key.id });
    if (!Number.isSafeInteger(key.minimumUses) || key.minimumUses < 0 || key.minimumUses >= policy.maximumUsesPerTreeKey) {
      return fail('POLICY_MINIMUM_USES_INVALID', { keyId: key.id });
    }
    ids.add(key.id);
    publicKeys.add(publicKey);
    if (key.role === 'committee') committeeCount += 1;
  }
  if (committeeCount !== policy.committee.memberCount) {
    return fail('POLICY_COMMITTEE_KEY_COUNT_MISMATCH', { expected: policy.committee.memberCount, actual: committeeCount });
  }
  return pass('POLICY_VALID', { keyCount: ids.size });
}

export async function loadWotsPolicy(policyPath) {
  let policy;
  try {
    policy = JSON.parse(await fs.readFile(policyPath, 'utf8'));
  } catch (error) {
    return { verdict: fail('POLICY_READ_FAILED', { error: error?.code || error?.name || 'ERROR' }) };
  }
  const verdict = validatePolicyObject(policy);
  if (!verdict.ok) return { verdict };
  const normalized = structuredClone(policy);
  normalized.committee.rootSha3 = cleanHex(normalized.committee.rootSha3);
  normalized.protectedKeys = normalized.protectedKeys.map((key) => ({ ...key, publicKey: cleanHex(key.publicKey) }));
  return { verdict, policy: normalized, policyHash: sha256Hex(canonicalJson(normalized)) };
}

function normalizeObservation(observation) {
  if (!isPlainObject(observation) || !Array.isArray(observation.keys)) return { verdict: fail('NODE_OBSERVATION_INVALID') };
  const keys = [];
  for (const entry of observation.keys) {
    const publicKey = cleanHex(entry?.publicKey ?? entry?.publickey);
    const usesValue = entry?.uses ?? entry?.use ?? entry?.usesCount;
    const uses = typeof usesValue === 'string' && /^\d+$/.test(usesValue) ? Number(usesValue) : usesValue;
    const maximumUsesValue = entry?.maximumUses ?? entry?.maxuses;
    const maximumUses = typeof maximumUsesValue === 'string' && /^\d+$/.test(maximumUsesValue) ? Number(maximumUsesValue) : maximumUsesValue;
    const size = typeof entry?.size === 'string' && /^\d+$/.test(entry.size) ? Number(entry.size) : entry?.size;
    const depth = typeof entry?.depth === 'string' && /^\d+$/.test(entry.depth) ? Number(entry.depth) : entry?.depth;
    if (!/^0X[0-9A-F]{64}$/.test(publicKey) || !Number.isSafeInteger(uses) || uses < 0
      || !Number.isSafeInteger(maximumUses) || !Number.isSafeInteger(size) || !Number.isSafeInteger(depth)) {
      return { verdict: fail('NODE_KEY_ENTRY_INVALID') };
    }
    keys.push({ publicKey, uses, maximumUses, size, depth });
  }
  return {
    verdict: pass('NODE_OBSERVATION_NORMALIZED'),
    observation: {
      nodeName: String(observation.nodeName || ''),
      coreVersion: String(observation.coreVersion || ''),
      committee: observation.committee ? structuredClone(observation.committee) : null,
      keys,
    },
  };
}

function compareConfiguration(policy, observation) {
  if (observation.nodeName !== policy.nodeName) return fail('NODE_NAME_MISMATCH');
  if (observation.coreVersion !== policy.coreVersion) return fail('CORE_VERSION_MISMATCH');
  if (!isPlainObject(observation.committee)) return fail('COMMITTEE_CONFIGURATION_MISSING');
  const expected = policy.committee;
  const actual = observation.committee;
  if (actual.threshold !== expected.threshold
    || actual.memberCount !== expected.memberCount
    || cleanHex(actual.rootSha3) !== expected.rootSha3
    || actual.singleControllerFixture !== expected.singleControllerFixture
    || actual.decentralizationEvidence !== expected.decentralizationEvidence) {
    return fail('COMMITTEE_CONFIGURATION_CHANGED');
  }
  const counts = new Map();
  for (const key of observation.keys) counts.set(key.publicKey, (counts.get(key.publicKey) || 0) + 1);
  for (const key of policy.protectedKeys) {
    if (!counts.has(key.publicKey)) return fail('PROTECTED_PUBLIC_KEY_MISSING', { keyId: key.id });
    if (counts.get(key.publicKey) !== 1) return fail('PROTECTED_PUBLIC_KEY_DUPLICATED', { keyId: key.id });
    const observed = observation.keys.find((entry) => entry.publicKey === key.publicKey);
    if (observed.maximumUses !== policy.maximumUsesPerTreeKey || observed.size !== policy.treeKeySize || observed.depth !== policy.treeKeyDepth) {
      return fail('PROTECTED_TREEKEY_SHAPE_MISMATCH', { keyId: key.id });
    }
  }
  return pass('CONFIGURATION_MATCH');
}

function observedUsesById(policy, observation) {
  const byPublic = new Map(observation.keys.map((entry) => [entry.publicKey, entry.uses]));
  return Object.fromEntries(policy.protectedKeys.map((key) => [key.id, byPublic.get(key.publicKey)]));
}

function auditCounters(policy, state, observation, preSign = null) {
  const observed = observedUsesById(policy, observation);
  for (const key of policy.protectedKeys) {
    let expected = state.minimumUses[key.id];
    if (preSign) {
      const reservation = preSign.keys.find((entry) => entry.keyId === key.id);
      if (reservation) expected = reservation.fromUses;
    }
    if (observed[key.id] < expected) return fail('COUNTER_ROLLBACK', { keyId: key.id, minimum: expected, observed: observed[key.id] });
    if (observed[key.id] > expected) return fail('UNJOURNALED_COUNTER_ADVANCE', { keyId: key.id, expected, observed: observed[key.id] });
  }
  return pass(preSign ? 'PRE_SIGN_AUTHORIZED' : 'NODE_ACCEPTED', { observedUses: observed });
}

function initialDerivedState(policy) {
  return {
    minimumUses: Object.fromEntries(policy.protectedKeys.map((key) => [key.id, key.minimumUses])),
    reservations: new Map(),
    settlements: new Map(),
  };
}

function applyEvent(policy, state, event) {
  if (event.type === 'GENESIS') {
    const expected = Object.fromEntries(policy.protectedKeys.map((key) => [key.id, key.minimumUses]));
    if (canonicalJson(event.minimumUses) !== canonicalJson(expected)) return fail('GENESIS_MINIMUM_MISMATCH');
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'RESERVE') {
    if (!INTENT_RE.test(event.intentId || '') || state.reservations.has(event.intentId)) return fail('DUPLICATE_INTENT_ID', { intentId: event.intentId });
    if (!INTENT_RE.test(event.settlementId || '') || !CUSTOM_TRANSACTION_RE.test(event.customTransactionId || '')
      || !TX_RE.test(event.transactionId || '') || !/^[0-9a-f]{64}$/.test(event.transactionDigest || '')
      || !/^[0-9a-f]{64}$/.test(event.settlementDigest || '')) return fail('RESERVATION_ID_INVALID');
    if (!Array.isArray(event.keys) || event.keys.length === 0) return fail('RESERVATION_KEYS_MISSING');
    const seen = new Set();
    for (const reservation of event.keys) {
      const policyKey = policy.protectedKeys.find((key) => key.id === reservation.keyId);
      if (!policyKey || seen.has(reservation.keyId)) return fail('RESERVATION_KEY_INVALID', { keyId: reservation.keyId });
      if (reservation.fromUses !== state.minimumUses[reservation.keyId]
        || reservation.toUses !== reservation.fromUses + 1
        || reservation.leafIndex !== reservation.fromUses
        || reservation.toUses > policy.maximumUsesPerTreeKey) {
        return fail('RESERVATION_COUNTER_CONFLICT', { keyId: reservation.keyId });
      }
      for (const existing of state.reservations.values()) {
        if (existing.status === 'reserved' && existing.keys.some((key) => key.keyId === reservation.keyId)) {
          return fail('CONFLICTING_RESERVATION', { keyId: reservation.keyId, existingIntentId: existing.intentId });
        }
      }
      seen.add(reservation.keyId);
    }
    for (const existing of state.reservations.values()) {
      if (cleanHex(existing.transactionId) === cleanHex(event.transactionId)) {
        return fail('TRANSACTION_ALREADY_RESERVED', { existingIntentId: existing.intentId });
      }
    }
    const settlement = state.settlements.get(event.settlementId);
    if (settlement && settlement.status !== 'definite-rejection') {
      return fail('SETTLEMENT_RETRY_BLOCKED', { settlementId: event.settlementId, status: settlement.status });
    }
    if (settlement && event.supersedesIntentId !== settlement.intentId) {
      return fail('SETTLEMENT_SUPERSESSION_REQUIRED', { settlementId: event.settlementId, priorIntentId: settlement.intentId });
    }
    const record = { ...structuredClone(event), status: 'reserved', signSteps: [] };
    state.reservations.set(event.intentId, record);
    state.settlements.set(event.settlementId, { status: 'reserved', intentId: event.intentId });
    for (const reservation of event.keys) state.minimumUses[reservation.keyId] = reservation.toUses;
    return pass('EVENT_APPLIED');
  }
  const reservation = state.reservations.get(event.intentId);
  if (!reservation) return fail('INTENT_NOT_FOUND', { intentId: event.intentId });
  if (event.type === 'SIGN_STEP') {
    if (reservation.status !== 'reserved' || reservation.halted || !Number.isSafeInteger(event.stepIndex)) {
      return fail('SIGN_STEP_SEQUENCE_INVALID');
    }
    const expected = reservation.keys[reservation.signSteps.length];
    if (!expected || event.stepIndex !== reservation.signSteps.length || event.keyId !== expected.keyId
      || canonicalJson(event.completedKeyIds) !== canonicalJson(reservation.keys.slice(0, event.stepIndex).map((entry) => entry.keyId))) {
      return fail('SIGN_STEP_SEQUENCE_INVALID');
    }
    reservation.signSteps.push({ keyId: event.keyId, eventHash: event.eventHash });
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'COMMIT') {
    if (reservation.status !== 'reserved' || reservation.halted) return fail('RESERVATION_NOT_COMMITTABLE');
    if (reservation.signSteps.length !== reservation.keys.length) return fail('SIGN_STEPS_INCOMPLETE');
    if (!['signed', 'reserved-leaf-retired'].includes(event.outcome)) return fail('COMMIT_OUTCOME_INVALID');
    reservation.status = 'committed';
    reservation.commitOutcome = event.outcome;
    state.settlements.set(reservation.settlementId, { status: 'committed', intentId: event.intentId });
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'HALT') {
    if (reservation.status !== 'reserved' || reservation.halted) return fail('HALT_SEQUENCE_INVALID');
    if (!['PARTIAL_COUNTER_ADVANCE', 'COUNTER_OBSERVATION_AMBIGUOUS', 'DURABILITY_RECOVERY_REQUIRED'].includes(event.reason)
      || !isPlainObject(event.observedUses)) return fail('HALT_REASON_INVALID');
    reservation.halted = true;
    reservation.haltReason = event.reason;
    state.settlements.set(reservation.settlementId, { status: 'unresolved', intentId: event.intentId });
    return pass('EVENT_APPLIED');
  }
  if (reservation.status !== 'committed') return fail('SIGNATURE_COMMIT_REQUIRED');
  if (event.type === 'CHECK') {
    if (!['PASS', 'REJECT'].includes(event.verdict)) return fail('CHECK_VERDICT_INVALID');
    if (reservation.check) return fail('CHECK_ALREADY_RECORDED');
    reservation.check = event.verdict;
    state.settlements.set(reservation.settlementId, {
      status: event.verdict === 'PASS' ? 'checked' : 'definite-rejection', intentId: event.intentId,
    });
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'POST_ATTEMPT') {
    if (reservation.check !== 'PASS' || reservation.postAttempt || reservation.post) return fail('POST_SEQUENCE_INVALID');
    if (event.customTransactionId !== reservation.customTransactionId
      || cleanHex(event.transactionId) !== cleanHex(reservation.transactionId)
      || event.transactionDigest !== reservation.transactionDigest
      || event.settlementDigest !== reservation.settlementDigest) return fail('POST_BINDING_MISMATCH');
    reservation.postAttempt = {
      customTransactionId: event.customTransactionId,
      transactionId: event.transactionId,
      transactionDigest: event.transactionDigest,
      settlementDigest: event.settlementDigest,
    };
    state.settlements.set(reservation.settlementId, { status: 'unresolved', intentId: event.intentId });
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'POST') {
    if (reservation.check !== 'PASS' || !reservation.postAttempt || reservation.post) return fail('POST_SEQUENCE_INVALID');
    if (!['ACCEPTED', 'UNKNOWN', 'DEFINITE_REFUSAL'].includes(event.outcome)) return fail('POST_OUTCOME_INVALID');
    reservation.post = event.outcome;
    const status = event.outcome === 'DEFINITE_REFUSAL' ? 'definite-rejection' : 'unresolved';
    state.settlements.set(reservation.settlementId, { status, intentId: event.intentId });
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'CONFIRM') {
    if (reservation.confirmed) return fail('CONFIRM_ALREADY_RECORDED');
    if (!['ACCEPTED', 'UNKNOWN'].includes(reservation.post) || !TX_RE.test(event.minedTransactionId || '')
      || cleanHex(event.minedTransactionId) !== cleanHex(reservation.transactionId)
      || event.settlementDigest !== reservation.settlementDigest
      || !/^[0-9a-f]{64}$/.test(event.successorDigest || '')) return fail('CONFIRMATION_INVALID');
    reservation.confirmed = true;
    state.settlements.set(reservation.settlementId, { status: 'confirmed', intentId: event.intentId });
    return pass('EVENT_APPLIED');
  }
  if (event.type === 'RECONCILE_NOT_SETTLED') {
    if (reservation.post !== 'UNKNOWN' || reservation.confirmed || reservation.reconciledNotSettled) {
      return fail('RECONCILIATION_SEQUENCE_INVALID');
    }
    if (event.customTransactionId !== reservation.customTransactionId
      || cleanHex(event.transactionId) !== cleanHex(reservation.transactionId)
      || event.transactionDigest !== reservation.transactionDigest
      || event.settlementDigest !== reservation.settlementDigest) return fail('RECONCILIATION_BINDING_MISMATCH');
    if (!/^[0-9a-f]{64}$/.test(event.evidenceDigest || '')) return fail('RECONCILIATION_EVIDENCE_INVALID');
    reservation.reconciledNotSettled = true;
    state.settlements.set(reservation.settlementId, { status: 'definite-rejection', intentId: event.intentId });
    return pass('EVENT_APPLIED');
  }
  return fail('EVENT_TYPE_INVALID');
}

async function readJournalFiles(policy, policyHash, journalDir, { lockHeldByCaller = false } = {}) {
  const journalPath = path.join(journalDir, 'journal.jsonl');
  const headPath = path.join(journalDir, 'head.json');
  const lockPath = path.join(journalDir, 'writer.lock');
  if (!lockHeldByCaller) {
    try {
      await fs.access(lockPath);
      return { verdict: fail('WRITER_LOCK_PRESENT') };
    } catch (error) {
      if (error?.code !== 'ENOENT') return { verdict: fail('WRITER_LOCK_CHECK_FAILED') };
    }
  }
  let raw;
  let head;
  try {
    raw = await fs.readFile(journalPath, 'utf8');
    head = JSON.parse(await fs.readFile(headPath, 'utf8'));
  } catch (error) {
    return { verdict: fail('JOURNAL_FILES_MISSING_OR_INVALID', { error: error?.code || error?.name || 'ERROR' }) };
  }
  if (!raw.endsWith('\n')) return { verdict: fail('JOURNAL_TORN_WRITE') };
  if (head.schema !== HEAD_SCHEMA || head.guardId !== policy.guardId || head.policyHash !== policyHash) {
    return { verdict: fail('HEAD_POLICY_MISMATCH') };
  }
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (head.journalBytes !== byteLength) return { verdict: fail('JOURNAL_LENGTH_MISMATCH', { expected: head.journalBytes, actual: byteLength }) };
  const lines = raw.slice(0, -1).split('\n');
  if (lines.length === 0 || lines.some((line) => line.length === 0)) return { verdict: fail('JOURNAL_ENTRY_MISSING') };
  const state = initialDerivedState(policy);
  const events = [];
  let previousHash = ZERO_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      return { verdict: fail('JOURNAL_JSON_CORRUPT', { index }) };
    }
    if (!isPlainObject(event) || event.schema !== JOURNAL_SCHEMA || event.seq !== index
      || event.guardId !== policy.guardId || event.policyHash !== policyHash
      || !EVENT_TYPES.has(event.type) || event.prevHash !== previousHash) {
      return { verdict: fail('JOURNAL_CHAIN_INVALID', { index }) };
    }
    const suppliedHash = event.eventHash;
    const withoutHash = { ...event };
    delete withoutHash.eventHash;
    const calculatedHash = eventHash(withoutHash);
    if (suppliedHash !== calculatedHash) return { verdict: fail('JOURNAL_HASH_INVALID', { index }) };
    const applied = applyEvent(policy, state, event);
    if (!applied.ok) return { verdict: fail('JOURNAL_SEMANTICS_INVALID', { index, cause: applied.code, causeDetails: applied.details }) };
    events.push(event);
    previousHash = suppliedHash;
  }
  if (head.lastSeq !== events.length - 1 || head.lastHash !== previousHash) return { verdict: fail('JOURNAL_HEAD_MISMATCH') };
  return { verdict: pass('JOURNAL_VALID', { entries: events.length, lastHash: previousHash }), events, state, head, raw };
}

async function appendDurable(journalDir, head, event, faultAt) {
  const journalPath = path.join(journalDir, 'journal.jsonl');
  const headPath = path.join(journalDir, 'head.json');
  const line = `${canonicalJson(event)}\n`;
  const journal = await fs.open(journalPath, 'a');
  try {
    if (faultAt === 'before-journal-write') throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
    if (faultAt === 'during-journal-write') {
      await journal.write(line.slice(0, Math.max(1, Math.floor(line.length / 2))), null, 'utf8');
      await journal.sync();
      throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
    }
    await journal.write(line, null, 'utf8');
    if (faultAt === 'after-journal-write-before-sync') throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
    await journal.sync();
  } finally {
    await journal.close();
  }
  if (faultAt === 'after-journal-sync') throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
  const nextHead = {
    ...head,
    lastSeq: event.seq,
    lastHash: event.eventHash,
    journalBytes: head.journalBytes + Buffer.byteLength(line, 'utf8'),
  };
  const headHandle = await fs.open(headPath, 'r+');
  try {
    await headHandle.truncate(0);
    if (faultAt === 'during-head-write') {
      await headHandle.write(canonicalJson(nextHead).slice(0, 12), 0, 'utf8');
      await headHandle.sync();
      throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
    }
    await headHandle.write(canonicalJson(nextHead), 0, 'utf8');
    await headHandle.sync();
  } finally {
    await headHandle.close();
  }
  if (faultAt === 'after-head-sync') throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
  const directorySync = await syncDirectory(journalDir);
  return { head: nextHead, durability: { journalSync: true, headSync: true, directorySync } };
}

export class WotsWriteAheadGuard {
  constructor({ policyPath, journalDir, forbiddenRoots = [] }) {
    this.policyPath = path.resolve(policyPath);
    this.journalDir = path.resolve(journalDir);
    this.forbiddenRoots = forbiddenRoots.map((root) => path.resolve(root));
  }

  async load() {
    const loaded = await loadWotsPolicy(this.policyPath);
    if (!loaded.verdict.ok) return loaded;
    const journalPhysical = await physicalCandidate(this.journalDir);
    for (const forbidden of this.forbiddenRoots) {
      const forbiddenPhysical = await physicalCandidate(forbidden);
      if (isWithin(journalPhysical, forbiddenPhysical) || isWithin(forbiddenPhysical, journalPhysical)) {
        return { verdict: fail('JOURNAL_INSIDE_ROLLBACK_DOMAIN') };
      }
    }
    return { ...loaded, journalPhysical };
  }

  async initialize(observationInput, { timestamp = new Date().toISOString() } = {}) {
    const loaded = await this.load();
    if (!loaded.verdict.ok) return loaded.verdict;
    const normalized = normalizeObservation(observationInput);
    if (!normalized.verdict.ok) return normalized.verdict;
    const configuration = compareConfiguration(loaded.policy, normalized.observation);
    if (!configuration.ok) return configuration;
    const observed = observedUsesById(loaded.policy, normalized.observation);
    for (const key of loaded.policy.protectedKeys) {
      if (observed[key.id] < key.minimumUses) return fail('COUNTER_ROLLBACK', { keyId: key.id, minimum: key.minimumUses, observed: observed[key.id] });
      if (observed[key.id] > key.minimumUses) return fail('UNJOURNALED_COUNTER_ADVANCE', { keyId: key.id, minimum: key.minimumUses, observed: observed[key.id] });
    }
    try {
      await fs.mkdir(this.journalDir, { recursive: false, mode: 0o700 });
    } catch (error) {
      return fail(error?.code === 'EEXIST' ? 'JOURNAL_ALREADY_EXISTS' : 'JOURNAL_DIRECTORY_CREATE_FAILED');
    }
    const lock = await this.#acquireLock(loaded.policy.guardId);
    if (!lock.ok) return lock;
    try {
      const base = {
        schema: JOURNAL_SCHEMA,
        seq: 0,
        type: 'GENESIS',
        guardId: loaded.policy.guardId,
        policyHash: loaded.policyHash,
        prevHash: ZERO_HASH,
        timestamp,
        minimumUses: Object.fromEntries(loaded.policy.protectedKeys.map((key) => [key.id, key.minimumUses])),
      };
      const event = { ...base, eventHash: eventHash(base) };
      const line = `${canonicalJson(event)}\n`;
      const journal = await fs.open(path.join(this.journalDir, 'journal.jsonl'), 'wx', 0o600);
      try { await journal.write(line, null, 'utf8'); await journal.sync(); } finally { await journal.close(); }
      const head = {
        schema: HEAD_SCHEMA,
        guardId: loaded.policy.guardId,
        policyHash: loaded.policyHash,
        lastSeq: 0,
        lastHash: event.eventHash,
        journalBytes: Buffer.byteLength(line, 'utf8'),
      };
      const headHandle = await fs.open(path.join(this.journalDir, 'head.json'), 'wx', 0o600);
      try { await headHandle.write(canonicalJson(head), null, 'utf8'); await headHandle.sync(); } finally { await headHandle.close(); }
      const directorySync = await syncDirectory(this.journalDir);
      await this.#releaseLock();
      return pass('JOURNAL_INITIALIZED', { policyHash: loaded.policyHash, genesisHash: event.eventHash, directorySync });
    } catch (error) {
      return fail('JOURNAL_INITIALIZATION_FAILED', { error: error?.code || error?.name || 'ERROR' });
    }
  }

  async inspect(observationInput, { preSignIntentId = null } = {}) {
    const loaded = await this.load();
    if (!loaded.verdict.ok) return loaded.verdict;
    const journal = await readJournalFiles(loaded.policy, loaded.policyHash, this.journalDir);
    if (!journal.verdict.ok) return journal.verdict;
    const normalized = normalizeObservation(observationInput);
    if (!normalized.verdict.ok) return normalized.verdict;
    const configuration = compareConfiguration(loaded.policy, normalized.observation);
    if (!configuration.ok) return configuration;
    const preSign = preSignIntentId ? journal.state.reservations.get(preSignIntentId) : null;
    if (preSignIntentId && (!preSign || preSign.status !== 'reserved' || preSign.halted)) return fail('PRE_SIGN_RESERVATION_NOT_FOUND');
    const counters = auditCounters(loaded.policy, journal.state, normalized.observation, preSign);
    if (!counters.ok) return counters;
    return pass(preSign ? 'PRE_SIGN_AUTHORIZED' : (loaded.policy.signingEnabled ? 'NODE_ACCEPTED' : 'NODE_ACCEPTED_RETIRED'), {
      policyHash: loaded.policyHash,
      journalEntries: journal.events.length,
      lastHash: journal.head.lastHash,
      minimumUses: journal.state.minimumUses,
      pendingIntents: [...journal.state.reservations.values()].filter((entry) => entry.status === 'reserved').map((entry) => entry.intentId),
      signingEnabled: loaded.policy.signingEnabled,
      ...(loaded.policy.signingEnabled ? {} : { retirementReason: loaded.policy.retirementReason }),
    });
  }

  async checkpoint() {
    const loaded = await this.load();
    if (!loaded.verdict.ok) return loaded.verdict;
    const journal = await readJournalFiles(loaded.policy, loaded.policyHash, this.journalDir);
    if (!journal.verdict.ok) return journal.verdict;
    return pass('JOURNAL_CHECKPOINT', {
      guardId: loaded.policy.guardId,
      policyHash: loaded.policyHash,
      lastSeq: journal.head.lastSeq,
      lastHash: journal.head.lastHash,
      journalBytes: journal.head.journalBytes,
      signingEnabled: loaded.policy.signingEnabled,
      minimumUses: structuredClone(journal.state.minimumUses),
    });
  }

  async authorizeSigning() { return fail('DURABLE_SIGN_STEP_REQUIRED'); }

  async beginSigningStep(request, options = {}) { return this.#mutate('SIGN_STEP', request, options); }

  async reserve(request, { faultAt = null, timestamp = new Date().toISOString() } = {}) {
    return this.#mutate('RESERVE', request, { faultAt, timestamp });
  }

  async commit(request, { faultAt = null, timestamp = new Date().toISOString() } = {}) {
    return this.#mutate('COMMIT', request, { faultAt, timestamp });
  }

  async halt(request, options = {}) { return this.#mutate('HALT', request, options); }

  async recordCheck(request, options = {}) { return this.#mutate('CHECK', request, options); }
  async beginPost(request, options = {}) { return this.#mutate('POST_ATTEMPT', request, options); }
  async recordPost(request, options = {}) { return this.#mutate('POST', request, options); }
  async confirm(request, options = {}) { return this.#mutate('CONFIRM', request, options); }
  async reconcileNotSettled(request, options = {}) { return this.#mutate('RECONCILE_NOT_SETTLED', request, options); }

  async #mutate(type, request, { faultAt = null, timestamp = new Date().toISOString() } = {}) {
    const loaded = await this.load();
    if (!loaded.verdict.ok) return loaded.verdict;
    const lock = await this.#acquireLock(loaded.policy.guardId);
    if (!lock.ok) return lock;
    let release = true;
    try {
      const journal = await readJournalFiles(loaded.policy, loaded.policyHash, this.journalDir, { lockHeldByCaller: true });
      if (!journal.verdict.ok) return journal.verdict;
      let payload;
      if (type === 'RESERVE') {
        if (loaded.policy.signingEnabled !== true) return fail('SIGNING_DOMAIN_RETIRED');
        const normalized = normalizeObservation(request.observation);
        if (!normalized.verdict.ok) return normalized.verdict;
        const configuration = compareConfiguration(loaded.policy, normalized.observation);
        if (!configuration.ok) return configuration;
        const audit = auditCounters(loaded.policy, journal.state, normalized.observation);
        if (!audit.ok) return audit;
        if (!INTENT_RE.test(request.intentId || '') || !INTENT_RE.test(request.settlementId || '') || !TX_RE.test(request.transactionId || '')) {
          return fail('RESERVATION_ID_INVALID');
        }
        const keyIds = [...new Set(request.keyIds || [])];
        if (!keyIds.length || keyIds.length !== (request.keyIds || []).length) return fail('RESERVATION_KEYS_INVALID');
        for (const keyId of keyIds) {
          if (!Object.hasOwn(journal.state.minimumUses, keyId)) return fail('RESERVATION_KEY_UNKNOWN', { keyId });
          if (journal.state.minimumUses[keyId] >= loaded.policy.maximumUsesPerTreeKey) {
            return fail('COUNTER_EXHAUSTED', { keyId, uses: journal.state.minimumUses[keyId], maximum: loaded.policy.maximumUsesPerTreeKey });
          }
        }
        payload = {
          intentId: request.intentId,
          settlementId: request.settlementId,
          customTransactionId: request.customTransactionId,
          transactionId: cleanHex(request.transactionId).replace(/^0X/, '0x'),
          transactionDigest: request.transactionDigest,
          settlementDigest: request.settlementDigest,
          ...(request.supersedesIntentId ? { supersedesIntentId: request.supersedesIntentId } : {}),
          keys: keyIds.map((keyId) => ({
            keyId,
            fromUses: journal.state.minimumUses[keyId],
            toUses: journal.state.minimumUses[keyId] + 1,
            leafIndex: journal.state.minimumUses[keyId],
          })),
        };
      } else if (type === 'SIGN_STEP') {
        const normalized = normalizeObservation(request.observation);
        if (!normalized.verdict.ok) return normalized.verdict;
        const configuration = compareConfiguration(loaded.policy, normalized.observation);
        if (!configuration.ok) return configuration;
        const reservation = journal.state.reservations.get(request.intentId);
        if (!reservation || reservation.status !== 'reserved' || reservation.halted) return fail('PRE_SIGN_RESERVATION_NOT_FOUND');
        const keyIds = request.keyIds || [];
        if (cleanHex(reservation.transactionId) !== cleanHex(request.transactionId)
          || reservation.transactionDigest !== request.transactionDigest
          || canonicalJson(reservation.keys.map((entry) => entry.keyId)) !== canonicalJson(keyIds)) return fail('PRE_SIGN_BINDING_MISMATCH');
        const completed = request.completedKeyIds || [];
        const nextKeyId = request.nextKeyId;
        const nextIndex = keyIds.indexOf(nextKeyId);
        if (nextIndex < 0 || nextIndex !== reservation.signSteps.length
          || canonicalJson(completed) !== canonicalJson(keyIds.slice(0, nextIndex))) return fail('PRE_SIGN_SEQUENCE_MISMATCH');
        const observed = observedUsesById(loaded.policy, normalized.observation);
        for (const key of loaded.policy.protectedKeys) {
          const reservedKey = reservation.keys.find((entry) => entry.keyId === key.id);
          const expected = reservedKey ? (completed.includes(key.id) ? reservedKey.toUses : reservedKey.fromUses) : journal.state.minimumUses[key.id];
          if (observed[key.id] !== expected) return fail(observed[key.id] < expected ? 'COUNTER_ROLLBACK' : 'UNJOURNALED_COUNTER_ADVANCE', {
            keyId: key.id, expected, observed: observed[key.id],
          });
        }
        payload = { intentId: request.intentId, stepIndex: nextIndex, keyId: nextKeyId, completedKeyIds: completed };
      } else if (type === 'COMMIT') {
        const normalized = normalizeObservation(request.observation);
        if (!normalized.verdict.ok) return normalized.verdict;
        const configuration = compareConfiguration(loaded.policy, normalized.observation);
        if (!configuration.ok) return configuration;
        const reservation = journal.state.reservations.get(request.intentId);
        if (!reservation || reservation.status !== 'reserved' || reservation.halted) return fail('RESERVATION_NOT_PENDING');
        const observed = observedUsesById(loaded.policy, normalized.observation);
        for (const key of loaded.policy.protectedKeys) {
          const expected = journal.state.minimumUses[key.id];
          if (observed[key.id] !== expected) {
            return fail(observed[key.id] < expected ? 'COUNTER_INCREMENT_NOT_OBSERVED' : 'UNJOURNALED_COUNTER_ADVANCE', {
              keyId: key.id, expected, observed: observed[key.id],
            });
          }
        }
        payload = { intentId: request.intentId, outcome: request.outcome || 'signed', observedUses: observed };
      } else if (type === 'HALT') {
        const reservation = journal.state.reservations.get(request.intentId);
        if (!reservation || reservation.status !== 'reserved') return fail('RESERVATION_NOT_PENDING');
        payload = { intentId: request.intentId, reason: request.reason, observedUses: structuredClone(request.observedUses || {}) };
      } else if (type === 'CHECK') {
        payload = { intentId: request.intentId, verdict: request.verdict };
      } else if (type === 'POST_ATTEMPT') {
        payload = {
          intentId: request.intentId,
          customTransactionId: request.customTransactionId,
          transactionId: request.transactionId,
          transactionDigest: request.transactionDigest,
          settlementDigest: request.settlementDigest,
        };
      } else if (type === 'POST') {
        payload = { intentId: request.intentId, outcome: request.outcome };
      } else if (type === 'CONFIRM') {
        payload = { intentId: request.intentId, minedTransactionId: request.minedTransactionId,
          successorDigest: request.successorDigest, settlementDigest: request.settlementDigest };
      } else if (type === 'RECONCILE_NOT_SETTLED') {
        payload = {
          intentId: request.intentId,
          customTransactionId: request.customTransactionId,
          transactionId: request.transactionId,
          transactionDigest: request.transactionDigest,
          settlementDigest: request.settlementDigest,
          evidenceDigest: request.evidenceDigest,
        };
      } else {
        return fail('EVENT_TYPE_INVALID');
      }
      const base = {
        ...payload,
        schema: JOURNAL_SCHEMA,
        seq: journal.events.length,
        type,
        guardId: loaded.policy.guardId,
        policyHash: loaded.policyHash,
        prevHash: journal.head.lastHash,
        timestamp,
      };
      const event = { ...base, eventHash: eventHash(base) };
      const semanticProbe = {
        minimumUses: structuredClone(journal.state.minimumUses),
        reservations: new Map([...journal.state.reservations].map(([key, value]) => [key, structuredClone(value)])),
        settlements: new Map([...journal.state.settlements].map(([key, value]) => [key, structuredClone(value)])),
      };
      const applied = applyEvent(loaded.policy, semanticProbe, event);
      if (!applied.ok) return applied;
      try {
        const persisted = await appendDurable(this.journalDir, journal.head, event, faultAt);
        await this.#releaseLock();
        return pass(`${type}_RECORDED`, {
          seq: event.seq,
          eventHash: event.eventHash,
          durability: persisted.durability,
          minimumUses: semanticProbe.minimumUses,
        });
      } catch (error) {
        release = false;
        return fail('FAIL_CLOSED_AFTER_DURABILITY_FAULT', { stage: faultAt || 'write', error: error?.code || error?.name || 'ERROR' });
      }
    } finally {
      if (release) await this.#releaseLock().catch(() => {});
    }
  }

  async #acquireLock(guardId) {
    try {
      await fs.mkdir(this.journalDir, { recursive: true, mode: 0o700 });
      const handle = await fs.open(path.join(this.journalDir, 'writer.lock'), 'wx', 0o600);
      try {
        await handle.write(canonicalJson({ schema: 'generic-bridge-wots-lock/v1', guardId, createdAt: new Date().toISOString() }), null, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(this.journalDir);
      return pass('WRITER_LOCK_ACQUIRED');
    } catch (error) {
      return fail(error?.code === 'EEXIST' ? 'CONCURRENT_WRITER_LOCKED' : 'WRITER_LOCK_FAILED');
    }
  }

  async #releaseLock() {
    try {
      await fs.unlink(path.join(this.journalDir, 'writer.lock'));
      await syncDirectory(this.journalDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export const WOTS_GUARD_CONSTANTS = Object.freeze({ JOURNAL_SCHEMA, HEAD_SCHEMA, ZERO_HASH });
