import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecoverySafeTransactionLifecycle } from './generic-bridge-transaction-lifecycle.mjs';
import { FencedAnchoredWotsAuthority, StrictMinimaOperationGateway } from './generic-bridge-p9-signing-authority.mjs';
import { WotsWriteAheadGuard, canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const livePolicyPath = path.join(root, 'p9-wots-policy.json');
const livePolicy = JSON.parse(await fs.readFile(livePolicyPath, 'utf8'));
const emitEvidence = process.argv.includes('--evidence');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-p9-authority-'));
const testPolicy = {
  ...structuredClone(livePolicy),
  guardId: 'bridge-p9-authority-test',
  signingEnabled: true,
  retirementReason: 'Synthetic signing-authority test policy only.',
};
const policyPath = path.join(work, 'policy.json');
await fs.writeFile(policyPath, `${JSON.stringify(testPolicy, null, 2)}\n`);
const forbiddenRoot = path.join(work, 'node-domain');
await fs.mkdir(forbiddenRoot);
const publicKeysById = Object.fromEntries(testPolicy.protectedKeys.map((entry) => [entry.id, entry.publicKey]));

let assertions = 0;
let hostileCases = 0;
let concurrencyCases = 0;

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
function hash(seed) { return sha256Hex(`hash:${seed}`); }
function initialUses() { return Object.fromEntries(testPolicy.protectedKeys.map((entry) => [entry.id, entry.minimumUses])); }

function observation(uses) {
  return {
    nodeName: testPolicy.nodeName,
    coreVersion: testPolicy.coreVersion,
    committee: structuredClone(testPolicy.committee),
    keys: testPolicy.protectedKeys.map((entry) => ({
      publicKey: entry.publicKey,
      uses: uses[entry.id],
      maximumUses: testPolicy.maximumUsesPerTreeKey,
      size: testPolicy.treeKeySize,
      depth: testPolicy.treeKeyDepth,
    })),
  };
}

function makeSpec(seed, keyIds = ['committee-0']) {
  const transactionId = tx(seed);
  const outputs = [
    { coinid: coin(`${seed}:control`), tokenid: '0x01', amount: '1', address: '0xAA', stateDigest: hash(`${seed}:state`) },
    { coinid: coin(`${seed}:reserve`), tokenid: '0x02', amount: '100', address: '0xAA' },
  ];
  const unsignedBody = {
    inputs: [coin(`${seed}:input-control`), coin(`${seed}:input-reserve`)],
    outputs,
    state: { 0: '2', 90: `0x${hash(`${seed}:record`)}` },
  };
  return {
    intentId: `intent-${seed}`,
    settlementId: `settlement-${seed}`,
    customTransactionId: `custom-${seed}`,
    transactionId,
    transactionDigest: sha256Hex(canonicalJson(unsignedBody)),
    unsignedBody,
    keyIds,
    unsignedVerified: true,
    witnessStrategy: 'txnsign-then-txnmmr-then-explicit-txnscript',
    expectedCheck: {
      inputs: 2,
      outputs: 2,
      signatures: keyIds.length,
      mmrproofs: 2,
      scripts: 2,
      coinDifferences: [{ tokenId: '0x01', difference: '0' }, { tokenId: '0x02', difference: '0' }],
    },
    expectedConfirmation: {
      transactionId,
      inputCoinIds: [coin(`${seed}:input-control`), coin(`${seed}:input-reserve`)],
      outputs,
      successorDigest: hash(`${seed}:successor`),
      minimumConfirmations: 3,
    },
  };
}

function acceptedCheck(signatures) {
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

class FakeGlobalFence {
  constructor(log = []) {
    this.log = log;
    this.nextToken = 0;
    this.active = null;
    this.capabilities = Object.freeze({
      globalAcrossRestores: true,
      monotonicTokens: true,
      exclusiveLease: true,
      noAutomaticExpiryDuringOperation: true,
      revocationAcknowledgedBeforeReassignment: true,
    });
  }

  async acquire({ signerDomain, operation }) {
    if (this.active) return { ok: false, code: 'LEASE_BUSY' };
    this.nextToken += 1;
    this.active = { signerDomain, operation, fencingToken: this.nextToken, leaseId: `lease-${this.nextToken}` };
    this.log.push(`fence:acquire:${operation}:${this.nextToken}`);
    return { ok: true, ...this.active };
  }

  async assertHeld(request) {
    const ok = this.active && this.active.signerDomain === request.signerDomain
      && this.active.leaseId === request.leaseId && this.active.fencingToken === request.fencingToken;
    return { ok: Boolean(ok), code: ok ? 'LEASE_HELD' : 'LEASE_LOST' };
  }

  async release(request) {
    const held = await this.assertHeld(request);
    if (!held.ok) return held;
    this.log.push(`fence:release:${request.fencingToken}`);
    this.active = null;
    return { ok: true, code: 'LEASE_RELEASED' };
  }
}

class FakeMonotonicAnchor {
  constructor(log = []) {
    this.log = log;
    this.records = new Map();
    this.lastToken = new Map();
    this.failNextCompareAndSwap = false;
    this.onAdvance = null;
    this.capabilities = Object.freeze({ independentRollbackDomain: true, durableCompareAndSwap: true });
  }

  async read({ signerDomain }) {
    const checkpoint = this.records.get(signerDomain);
    return checkpoint ? { ok: true, checkpoint: structuredClone(checkpoint) } : { ok: false, code: 'ANCHOR_MISSING' };
  }

  async initialize({ signerDomain, checkpoint, fencingToken }) {
    if (this.records.has(signerDomain)) return { ok: false, code: 'ANCHOR_ALREADY_EXISTS' };
    this.records.set(signerDomain, structuredClone(checkpoint));
    this.lastToken.set(signerDomain, fencingToken);
    this.log.push(`anchor:init:${checkpoint.lastSeq}`);
    return { ok: true, code: 'ANCHOR_INITIALIZED' };
  }

  async compareAndSwap({ signerDomain, expected, next, fencingToken }) {
    if (this.failNextCompareAndSwap) {
      this.failNextCompareAndSwap = false;
      return { ok: false, code: 'INJECTED_ANCHOR_FAILURE' };
    }
    const current = this.records.get(signerDomain);
    if (!current || canonicalJson(current) !== canonicalJson(expected)) return { ok: false, code: 'ANCHOR_COMPARE_FAILED' };
    if (fencingToken < (this.lastToken.get(signerDomain) || 0)) return { ok: false, code: 'STALE_FENCING_TOKEN' };
    this.records.set(signerDomain, structuredClone(next));
    this.lastToken.set(signerDomain, fencingToken);
    this.log.push(`anchor:advance:${next.lastSeq}`);
    if (this.onAdvance) await this.onAdvance({ signerDomain, expected, next, fencingToken });
    return { ok: true, code: 'ANCHOR_ADVANCED' };
  }
}

async function fixture(label, {
  sharedFence = null,
  sharedAnchor = null,
  sourceJournalDir = null,
  beforeConditionalSign = null,
} = {}) {
  const base = path.join(work, label);
  await fs.mkdir(base);
  const journalDir = path.join(base, 'journal');
  const uses = initialUses();
  if (sourceJournalDir) await fs.cp(sourceJournalDir, journalDir, { recursive: true });
  const guard = new WotsWriteAheadGuard({ policyPath, journalDir, forbiddenRoots: [forbiddenRoot] });
  if (!sourceJournalDir) expectCode(await guard.initialize(observation(uses)), 'JOURNAL_INITIALIZED', `${label} journal initialize`);
  const log = [];
  const fence = sharedFence || new FakeGlobalFence(log);
  const anchor = sharedAnchor || new FakeMonotonicAnchor(log);
  const registry = new Map();
  let signCalls = 0;
  const gateway = new StrictMinimaOperationGateway({
    publicKeysById,
    transport: async (request) => {
      log.push(`rpc:${request.operation}`);
      if (request.operation === 'conditional-txnsign') {
        check(Boolean(fence.active), `${label} sign transport runs only while global fence is held`);
        if (beforeConditionalSign) await beforeConditionalSign({ registry, request });
        const snapshot = registry.get(request.customTransactionId);
        if (!snapshot || snapshot.transactionId.toUpperCase() !== request.transactionId.toUpperCase()
          || sha256Hex(canonicalJson(snapshot.unsignedBody)) !== request.transactionDigest) {
          return { ok: false, code: 'CONDITIONAL_TRANSACTION_BINDING_MISMATCH' };
        }
        const keyId = Object.entries(publicKeysById).find(([, publicKey]) => publicKey === request.publicKey)?.[0];
        if (!keyId) return { ok: false, code: 'UNKNOWN_KEY' };
        signCalls += 1;
        uses[keyId] += 1;
        return { ok: true, code: 'SIGNED' };
      }
      if (request.operation === 'keys-list-protected') return observation(uses);
      if (request.operation === 'txnlist-one') return registry.get(request.customTransactionId) || null;
      return { ok: false, code: 'TRANSPORT_OPERATION_REJECTED' };
    },
  });
  const verifyTransactionBinding = async (request) => {
    const snapshot = registry.get(request.customTransactionId);
    const ok = snapshot && snapshot.customTransactionId === request.customTransactionId
      && snapshot.transactionId.toUpperCase() === request.transactionId.toUpperCase()
      && sha256Hex(canonicalJson(snapshot.unsignedBody)) === request.transactionDigest;
    return { ok: Boolean(ok), code: ok ? 'TRANSACTION_BOUND' : 'TRANSACTION_BINDING_MISMATCH' };
  };
  const authority = new FencedAnchoredWotsAuthority({
    guard,
    fence,
    anchor,
    signerGateway: gateway,
    observeCounters: async () => observation(uses),
    verifyTransactionBinding,
    signerDomain: 'synthetic-attestor-seed-domain',
    publicKeysById,
  });
  return {
    base, journalDir, uses, guard, log, fence, anchor, registry, gateway, authority,
    signCalls: () => signCalls,
    register: (spec) => registry.set(spec.customTransactionId, {
      customTransactionId: spec.customTransactionId,
      transactionId: spec.transactionId,
      unsignedBody: structuredClone(spec.unsignedBody),
    }),
  };
}

function reservation(spec, uses) {
  return {
    intentId: spec.intentId,
    settlementId: spec.settlementId,
    customTransactionId: spec.customTransactionId,
    transactionId: spec.transactionId,
    transactionDigest: spec.transactionDigest,
    settlementDigest: sha256Hex(canonicalJson(spec.expectedConfirmation)),
    keyIds: spec.keyIds,
    observation: observation(uses),
  };
}

async function bootstrap(value, label) {
  expectCode(await value.authority.bootstrapAnchor(), 'MONOTONIC_ANCHOR_INITIALIZED', `${label} bootstrap anchor`);
  expectCode(await value.authority.startupCheck(), 'LOCAL_JOURNAL_ANCHORED', `${label} startup anchored`);
}

const primary = await fixture('primary');
await bootstrap(primary, 'primary');
const primarySpec = makeSpec('primary');
primary.register(primarySpec);
expectCode(await primary.gateway.invoke('send', { amount: '1' }), 'RPC_OPERATION_NOT_ALLOWED', 'arbitrary RPC operation rejected');
hostileCases += 1;
expectCode(await primary.gateway.invoke('sign-one', { keyId: 'committee-0', customTransactionId: '../bad', transactionId: primarySpec.transactionId }),
  'SIGN_REQUEST_INVALID', 'malformed sign request rejected');
hostileCases += 1;

const lifecycle = new RecoverySafeTransactionLifecycle({
  guard: primary.authority,
  observeCounters: async () => observation(primary.uses),
  loadTransactionSnapshot: async ({ customTransactionId }) => structuredClone(primary.registry.get(customTransactionId) || null),
  finalizeExplicitWitness: async () => ({ strategy: primarySpec.witnessStrategy, transactionId: primarySpec.transactionId }),
  runTxncheck: async () => acceptedCheck(primarySpec.keyIds.length),
  postSignedTransaction: async () => ({ status: true, txpowid: tx('primary:txpow'),
    transactionid: primarySpec.transactionId, size: 4096 }),
});
expectCode(await lifecycle.signAndCheck(primarySpec), 'CHECK_ACCEPTED', 'production-shaped lifecycle sign and check');
check(primary.signCalls() === 1, 'production-shaped lifecycle signs exactly once');
const anchorBeforeRpc = primary.log.findIndex((entry) => entry === 'anchor:advance:2');
const rpcIndex = primary.log.findIndex((entry) => entry === 'rpc:conditional-txnsign');
check(anchorBeforeRpc >= 0 && rpcIndex > anchorBeforeRpc, 'independent checkpoint advances before txnsign');
expectCode(await lifecycle.post(primarySpec), 'POST_ACCEPTED', 'production-shaped lifecycle post accepted');
const proof = {
  onchain: true,
  confirmations: 3,
  transaction: {
    transactionid: primarySpec.transactionId,
    inputs: primarySpec.expectedConfirmation.inputCoinIds.map((coinid) => ({ coinid })),
    outputs: structuredClone(primarySpec.expectedConfirmation.outputs),
  },
  successorDigest: primarySpec.expectedConfirmation.successorDigest,
};
expectCode(await lifecycle.confirm(primarySpec, proof), 'CONFIRMED_EXACT', 'production-shaped lifecycle exact confirmation');
expectCode(await primary.authority.startupCheck(), 'LOCAL_JOURNAL_ANCHORED', 'primary remains anchored after full lifecycle');

const concurrentFence = new FakeGlobalFence([]);
const concurrentAnchor = new FakeMonotonicAnchor([]);
const copyA = await fixture('copy-a', { sharedFence: concurrentFence, sharedAnchor: concurrentAnchor });
await bootstrap(copyA, 'copy-a');
const copyB = await fixture('copy-b', { sharedFence: concurrentFence, sharedAnchor: concurrentAnchor,
  sourceJournalDir: copyA.journalDir });
const copySpecA = makeSpec('copy-a');
const copySpecB = makeSpec('copy-b');
copyA.register(copySpecA);
copyB.register(copySpecB);
const concurrentResults = await Promise.all([
  copyA.authority.reserve(reservation(copySpecA, copyA.uses)),
  copyB.authority.reserve(reservation(copySpecB, copyB.uses)),
]);
check(concurrentResults.filter((entry) => entry.ok).length === 1, 'two restored copies sharing global authority have exactly one reserve winner');
check(concurrentResults.filter((entry) => !entry.ok).length === 1, 'second restored copy fails closed');
concurrencyCases += 1;
const loser = concurrentResults[0].ok ? copyB : copyA;
expectCode(await loser.authority.startupCheck(), 'LOCAL_JOURNAL_ANCHOR_MISMATCH', 'copied store cannot follow advanced global anchor');

const anchorFailure = await fixture('anchor-failure');
await bootstrap(anchorFailure, 'anchor-failure');
const anchorFailureSpec = makeSpec('anchor-failure');
anchorFailure.register(anchorFailureSpec);
check((await anchorFailure.authority.reserve(reservation(anchorFailureSpec, anchorFailure.uses))).ok,
  'anchor-failure reservation recorded');
anchorFailure.anchor.failNextCompareAndSwap = true;
expectCode(await anchorFailure.authority.executeSigningStep({
  intentId: anchorFailureSpec.intentId,
  customTransactionId: anchorFailureSpec.customTransactionId,
  transactionId: anchorFailureSpec.transactionId,
  transactionDigest: anchorFailureSpec.transactionDigest,
  keyIds: anchorFailureSpec.keyIds,
  completedKeyIds: [],
  nextKeyId: anchorFailureSpec.keyIds[0],
}), 'LOCAL_JOURNAL_AHEAD_ANCHOR', 'anchor failure blocks signing');
check(anchorFailure.signCalls() === 0, 'no txnsign occurs when independent anchor does not advance');
expectCode(await anchorFailure.authority.startupCheck(), 'LOCAL_JOURNAL_ANCHOR_MISMATCH', 'local-ahead state remains fail closed');
hostileCases += 1;

const mutation = await fixture('binding-mutation');
await bootstrap(mutation, 'binding-mutation');
const mutationSpec = makeSpec('binding-mutation');
mutation.register(mutationSpec);
check((await mutation.authority.reserve(reservation(mutationSpec, mutation.uses))).ok, 'binding-mutation reservation recorded');
mutation.anchor.onAdvance = async ({ next }) => {
  if (next.lastSeq === 2) mutation.registry.get(mutationSpec.customTransactionId).unsignedBody.state[0] = '999';
};
expectCode(await mutation.authority.executeSigningStep({
  intentId: mutationSpec.intentId,
  customTransactionId: mutationSpec.customTransactionId,
  transactionId: mutationSpec.transactionId,
  transactionDigest: mutationSpec.transactionDigest,
  keyIds: mutationSpec.keyIds,
  completedKeyIds: [],
  nextKeyId: mutationSpec.keyIds[0],
}), 'TRANSACTION_BINDING_CHANGED_AFTER_SIGN_STEP', 'mutation after sign-step checkpoint blocks txnsign');
check(mutation.signCalls() === 0, 'post-authorization transaction mutation consumes no signature');
const mutationJournal = await fs.readFile(path.join(mutation.journalDir, 'journal.jsonl'), 'utf8');
check(mutationJournal.includes('"type":"HALT"'), 'post-authorization mutation records terminal halt');
expectCode(await mutation.authority.startupCheck(), 'LOCAL_JOURNAL_ANCHORED', 'halt remains globally anchored');
hostileCases += 1;

const finalBinding = await fixture('final-conditional-binding', {
  beforeConditionalSign: async ({ registry, request }) => {
    registry.get(request.customTransactionId).unsignedBody.state[0] = '777';
  },
});
await bootstrap(finalBinding, 'final-conditional-binding');
const finalBindingSpec = makeSpec('final-conditional-binding');
finalBinding.register(finalBindingSpec);
check((await finalBinding.authority.reserve(reservation(finalBindingSpec, finalBinding.uses))).ok,
  'final conditional-binding reservation recorded');
expectCode(await finalBinding.authority.executeSigningStep({
  intentId: finalBindingSpec.intentId,
  customTransactionId: finalBindingSpec.customTransactionId,
  transactionId: finalBindingSpec.transactionId,
  transactionDigest: finalBindingSpec.transactionDigest,
  keyIds: finalBindingSpec.keyIds,
  completedKeyIds: [],
  nextKeyId: finalBindingSpec.keyIds[0],
}), 'SIGNING_RPC_FAILED', 'conditional signer catches last-moment transaction substitution');
check(finalBinding.signCalls() === 0, 'conditional transaction mismatch advances no node counter');
const finalBindingJournal = await fs.readFile(path.join(finalBinding.journalDir, 'journal.jsonl'), 'utf8');
check(finalBindingJournal.includes('"reason":"DURABILITY_RECOVERY_REQUIRED"'),
  'last-moment transaction substitution retires the authorized leaf and halts');
hostileCases += 1;

const weakFence = new FencedAnchoredWotsAuthority({
  guard: primary.guard,
  fence: { capabilities: { globalAcrossRestores: false } },
  anchor: primary.anchor,
  signerGateway: primary.gateway,
  observeCounters: async () => observation(primary.uses),
  verifyTransactionBinding: async () => ({ ok: true }),
  signerDomain: 'synthetic-attestor-seed-domain',
  publicKeysById,
});
expectCode(await weakFence.startupCheck(), 'GLOBAL_FENCE_CAPABILITY_MISSING', 'local-only fence rejected');
hostileCases += 1;
const weakAnchor = new FencedAnchoredWotsAuthority({
  guard: primary.guard,
  fence: primary.fence,
  anchor: { capabilities: { independentRollbackDomain: false } },
  signerGateway: primary.gateway,
  observeCounters: async () => observation(primary.uses),
  verifyTransactionBinding: async () => ({ ok: true }),
  signerDomain: 'synthetic-attestor-seed-domain',
  publicKeysById,
});
expectCode(await weakAnchor.startupCheck(), 'MONOTONIC_ANCHOR_CAPABILITY_MISSING', 'colocated rollback anchor rejected');
hostileCases += 1;

const sourceFiles = [
  'p9-wots-policy.json',
  'wots-write-ahead-guard.mjs',
  'generic-bridge-p9-signing-authority.mjs',
  'generic-bridge-transaction-lifecycle.mjs',
  'validate-generic-p9-signing-authority.mjs',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name, sha256Hex(await fs.readFile(path.join(root, name))),
])));

const result = {
  schema: 'generic-p9-signing-authority-validation/v1',
  createdAt: new Date().toISOString(),
  result: 'PASS',
  evidenceLevel: 'offline dependency-injected production-shaped authority model',
  assertions,
  hostileCases,
  concurrencyCases,
  proved: [
    'A global exclusive lease with monotonic fencing token is required before every protected mutation.',
    'An independent compare-and-swap checkpoint advances before the signing RPC becomes callable.',
    'Two copied local stores sharing the same global authority cannot both advance.',
    'An anchor failure leaves the local store ahead and blocks the signing callback and all later startup.',
    'The exact loaded transaction is rebound inside the lease before and after the durable sign step.',
    'A post-authorization transaction mutation records HALT without calling txnsign.',
    'The serialized conditional signer performs a final transaction-digest check and retires the leaf on mismatch.',
    'The structured Minima gateway rejects operations outside its fixed allowlist.',
    'The complete dependency-injected lifecycle reaches exact check, post and confirmation through the anchored guard.',
  ],
  notProved: [
    'No real globally consistent fence or independently durable WORM service is deployed.',
    'No Minima node, RPC listener, restored clone, WOTS key, signature, transaction or post was used.',
    'Operating-system network isolation and elimination of every raw RPC bypass remain deployment controls.',
    'The live P8 key domain remains retired and signing disabled.',
  ],
  boundaries: {
    newMainnetTransactions: 0,
    newWotsSignatures: 0,
    realAssets: false,
    livePolicyModified: false,
  },
  sourceSha256,
};

if (emitEvidence) {
  const stamp = result.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidenceDir = path.join(root, 'evidence');
  const evidencePath = path.join(evidenceDir, `generic-p9-signing-authority-${stamp}.json`);
  const body = `${JSON.stringify(result, null, 2)}\n`;
  await fs.writeFile(evidencePath, body);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  await fs.writeFile(`${evidencePath}.sha256`, `${digest}  ${path.basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.sha256 = digest;
}

console.log(JSON.stringify(result, null, 2));
