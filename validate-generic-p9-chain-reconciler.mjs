import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExactMinimaChainReconciler } from './generic-bridge-p9-chain-reconciler.mjs';
import { RecoverySafeTransactionLifecycle } from './generic-bridge-transaction-lifecycle.mjs';
import { canonicalJson, sha256Hex } from './wots-write-ahead-guard.mjs';

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

function id(seed) { return `0x${sha256Hex(seed)}`; }

function expected(seed = 'base') {
  const outputs = [
    { coinid: id(`${seed}:control`), address: '0xAA', tokenid: '0x01', amount: '1', state: { 0: '2' } },
    { coinid: id(`${seed}:reserve`), address: '0xAA', tokenid: '0x02', amount: '100' },
  ];
  return {
    transactionId: id(`${seed}:transaction`),
    inputCoinIds: [id(`${seed}:input-control`), id(`${seed}:input-reserve`)],
    outputs,
    successorDigest: sha256Hex(canonicalJson(outputs)),
    minimumConfirmations: 3,
  };
}

class FakeConsistentChain {
  constructor(spec) {
    this.spec = structuredClone(spec);
    this.anchor = { blockNumber: 104, blockId: id('anchor:104'), cumulativeWorkDigest: id('work:104') };
    this.transaction = null;
    this.mempoolPresent = false;
    this.inputs = new Map(spec.inputCoinIds.map((coinId) => [coinId, { unspent: true }]));
    this.outputs = new Map(spec.outputs.map((entry) => [entry.coinid, { present: false }]));
    this.conflicts = [];
    this.complete = true;
    this.capabilities = Object.freeze({
      canonicalChainBound: true,
      completeTransactionLookup: true,
      completeMempoolLookup: true,
      completeCoinLineageLookup: true,
      typedResponses: true,
    });
  }

  mineExact(blockNumber = 102) {
    this.transaction = {
      blockNumber,
      body: {
        transactionid: this.spec.transactionId,
        inputs: this.spec.inputCoinIds.map((coinid) => ({ coinid })),
        outputs: structuredClone(this.spec.outputs),
      },
    };
    for (const coinId of this.spec.inputCoinIds) this.inputs.set(coinId, { unspent: false });
    for (const output of this.spec.outputs) this.outputs.set(output.coinid, { present: true });
  }

  async getChainAnchor() { return { ok: true, ...this.anchor }; }
  async getTransaction({ transactionId }) {
    const exact = this.transaction && transactionId.toUpperCase() === this.spec.transactionId.toUpperCase();
    return exact
      ? { ok: true, searchComplete: this.complete, onchain: true, blockNumber: this.transaction.blockNumber,
        transaction: structuredClone(this.transaction.body) }
      : { ok: true, searchComplete: this.complete, onchain: false };
  }
  async getMempoolTransaction() { return { ok: true, searchComplete: this.complete, present: this.mempoolPresent }; }
  async getInputCoins({ coinIds }) {
    return { ok: true, searchComplete: this.complete, coins: coinIds.map((coinid) => ({ coinid, ...this.inputs.get(coinid) })) };
  }
  async getOutputCoins({ coinIds }) {
    return { ok: true, searchComplete: this.complete, coins: coinIds.map((coinid) => ({ coinid, ...this.outputs.get(coinid) })) };
  }
  async getConflictingSpends() { return { ok: true, searchComplete: this.complete, spends: structuredClone(this.conflicts) }; }
}

const confirmationSpec = expected('confirmation');
const confirmedChain = new FakeConsistentChain(confirmationSpec);
confirmedChain.mineExact(102);
const confirmedReconciler = new ExactMinimaChainReconciler({ source: confirmedChain });
const confirmed = expectCode(await confirmedReconciler.confirmation(confirmationSpec),
  'CONFIRMED_EXACT_FROM_CHAIN', 'exact mined transaction confirmed');
check(confirmed.details.proof.confirmations === 3, 'confirmation count derives from one chain anchor');
check(confirmed.details.proof.successorDigest === confirmationSpec.successorDigest,
  'successor digest derives from the exact output body');

const pendingSpec = expected('pending');
const pendingChain = new FakeConsistentChain(pendingSpec);
expectCode(await new ExactMinimaChainReconciler({ source: pendingChain }).confirmation(pendingSpec),
  'CONFIRM_PENDING', 'absent transaction remains pending');

const shallowSpec = expected('shallow');
const shallowChain = new FakeConsistentChain(shallowSpec);
shallowChain.mineExact(103);
expectCode(await new ExactMinimaChainReconciler({ source: shallowChain }).confirmation(shallowSpec),
  'CONFIRM_PENDING', 'insufficient confirmations remain pending');

const bodyMutationSpec = expected('body-mutation');
const bodyMutationChain = new FakeConsistentChain(bodyMutationSpec);
bodyMutationChain.mineExact(101);
bodyMutationChain.transaction.body.outputs[1].amount = '99';
expectCode(await new ExactMinimaChainReconciler({ source: bodyMutationChain }).confirmation(bodyMutationSpec),
  'CONFIRM_SOURCE_BODY_MISMATCH', 'mined output mutation rejected');
hostileCases += 1;

const digestMutationSpec = expected('digest-mutation');
const digestMutationChain = new FakeConsistentChain(digestMutationSpec);
digestMutationChain.mineExact(101);
digestMutationSpec.successorDigest = sha256Hex('foreign-successor');
expectCode(await new ExactMinimaChainReconciler({ source: digestMutationChain }).confirmation(digestMutationSpec),
  'CONFIRM_EXPECTED_SUCCESSOR_DIGEST_MISMATCH', 'caller-supplied successor digest cannot replace derived digest');
hostileCases += 1;

const negativeSpec = expected('negative');
const negativeChain = new FakeConsistentChain(negativeSpec);
const negativeReconciler = new ExactMinimaChainReconciler({ source: negativeChain });
const negative = expectCode(await negativeReconciler.definitiveNonSettlement(negativeSpec, { validityEndBlock: 100 }),
  'DEFINITELY_NOT_SETTLED_FROM_CHAIN', 'complete consistent negative chain state accepted');
check(negative.details.proof.transactionId === negativeSpec.transactionId,
  'negative proof binds the exact transaction');
check(negative.details.proof.predecessorInputIds.length === negativeSpec.inputCoinIds.length,
  'negative proof binds all predecessor inputs');

let chainConfirmRecords = 0;
let chainReconcileRecords = 0;
const chainLifecycle = new RecoverySafeTransactionLifecycle({
  guard: {
    confirm: async () => { chainConfirmRecords += 1; return { ok: true, code: 'CONFIRM_RECORDED' }; },
    reconcileNotSettled: async () => { chainReconcileRecords += 1; return { ok: true, code: 'RECONCILE_RECORDED' }; },
  },
  chainReconciler: confirmedReconciler,
});
const chainLifecycleSpec = {
  intentId: 'intent-chain-confirmation',
  customTransactionId: 'custom-chain-confirmation',
  transactionId: confirmationSpec.transactionId,
  transactionDigest: sha256Hex('chain-confirmation-body'),
  expectedConfirmation: confirmationSpec,
};
expectCode(await chainLifecycle.confirmFromChain(chainLifecycleSpec), 'CONFIRMED_EXACT',
  'lifecycle records only reconciler-derived exact confirmation');
check(chainConfirmRecords === 1, 'exact chain confirmation reaches guard once');

const negativeLifecycle = new RecoverySafeTransactionLifecycle({
  guard: {
    confirm: async () => ({ ok: true }),
    reconcileNotSettled: async () => { chainReconcileRecords += 1; return { ok: true, code: 'RECONCILE_RECORDED' }; },
  },
  chainReconciler: negativeReconciler,
});
const negativeLifecycleSpec = {
  intentId: 'intent-chain-negative',
  customTransactionId: 'custom-chain-negative',
  transactionId: negativeSpec.transactionId,
  transactionDigest: sha256Hex('chain-negative-body'),
  expectedConfirmation: negativeSpec,
};
expectCode(await negativeLifecycle.reconcileNotSettledFromChain(negativeLifecycleSpec, { validityEndBlock: 100 }),
  'DEFINITELY_NOT_SETTLED', 'lifecycle records only reconciler-derived definitive non-settlement');
check(chainReconcileRecords === 1, 'definitive non-settlement reaches guard once');

expectCode(await negativeReconciler.definitiveNonSettlement(negativeSpec, { validityEndBlock: 104 }),
  'VALIDITY_NOT_EXPIRED', 'negative reconciliation blocked before expiry');
hostileCases += 1;

const mempoolSpec = expected('mempool');
const mempoolChain = new FakeConsistentChain(mempoolSpec);
mempoolChain.mempoolPresent = true;
expectCode(await new ExactMinimaChainReconciler({ source: mempoolChain }).definitiveNonSettlement(mempoolSpec,
  { validityEndBlock: 100 }), 'NON_SETTLEMENT_SOURCE_UNKNOWN', 'mempool presence blocks definitive rejection');
hostileCases += 1;

const spentSpec = expected('spent');
const spentChain = new FakeConsistentChain(spentSpec);
spentChain.inputs.set(spentSpec.inputCoinIds[0], { unspent: false });
expectCode(await new ExactMinimaChainReconciler({ source: spentChain }).definitiveNonSettlement(spentSpec,
  { validityEndBlock: 100 }), 'PREDECESSOR_NOT_PROVED_UNSPENT', 'spent predecessor blocks definitive rejection');
hostileCases += 1;

const outputSpec = expected('output-present');
const outputChain = new FakeConsistentChain(outputSpec);
outputChain.outputs.set(outputSpec.outputs[0].coinid, { present: true });
expectCode(await new ExactMinimaChainReconciler({ source: outputChain }).definitiveNonSettlement(outputSpec,
  { validityEndBlock: 100 }), 'PREDICTED_OUTPUT_ABSENCE_NOT_PROVED', 'observed predicted output blocks definitive rejection');
hostileCases += 1;

const conflictSpec = expected('conflict');
const conflictChain = new FakeConsistentChain(conflictSpec);
conflictChain.conflicts = [{ transactionId: id('conflicting-successor'), inputCoinId: conflictSpec.inputCoinIds[0] }];
expectCode(await new ExactMinimaChainReconciler({ source: conflictChain }).definitiveNonSettlement(conflictSpec,
  { validityEndBlock: 100 }), 'CONFLICTING_SUCCESSOR_OBSERVED', 'conflicting successor blocks retry');
hostileCases += 1;

const incompleteSpec = expected('incomplete');
const incompleteChain = new FakeConsistentChain(incompleteSpec);
incompleteChain.complete = false;
expectCode(await new ExactMinimaChainReconciler({ source: incompleteChain }).definitiveNonSettlement(incompleteSpec,
  { validityEndBlock: 100 }), 'NON_SETTLEMENT_SOURCE_UNKNOWN', 'incomplete search fails closed');
hostileCases += 1;

const weakSource = new ExactMinimaChainReconciler({ source: { capabilities: { canonicalChainBound: false } } });
expectCode(await weakSource.confirmation(expected('weak')), 'CHAIN_SOURCE_CAPABILITY_MISSING',
  'untrusted discovery source rejected');
hostileCases += 1;

const sourceFiles = [
  'wots-write-ahead-guard.mjs',
  'generic-bridge-transaction-lifecycle.mjs',
  'generic-bridge-p9-chain-reconciler.mjs',
  'validate-generic-p9-chain-reconciler.mjs',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name, sha256Hex(await fs.readFile(path.join(root, name))),
])));

const result = {
  schema: 'generic-p9-chain-reconciler-validation/v1',
  createdAt: new Date().toISOString(),
  result: 'PASS',
  evidenceLevel: 'offline dependency-injected consistent-chain reconciliation model',
  assertions,
  hostileCases,
  proved: [
    'Confirmation derives transaction body, input lineage, outputs, successor digest and depth from one canonical chain source.',
    'Definitive non-settlement requires expiry, complete transaction and mempool searches, exact unspent predecessors, absent predicted outputs and no conflicting spend.',
    'Mempool presence, input spending, output presence, conflicting successors, incomplete searches and weak source capabilities fail closed.',
    'The negative proof is generated from consistent source state rather than caller-supplied independent booleans.',
  ],
  notProved: [
    'No live Minima archive or MegaMMR-backed source implements the required complete lookup interface.',
    'No RPC, explorer, node, transaction, signature or post was used.',
    'Minima settlement depth and late-heavier-fork policy remain founder decisions.',
  ],
  boundaries: { newMainnetTransactions: 0, newWotsSignatures: 0, realAssets: false },
  sourceSha256,
};

if (emitEvidence) {
  const stamp = result.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const evidencePath = path.join(root, 'evidence', `generic-p9-chain-reconciler-${stamp}.json`);
  const body = `${JSON.stringify(result, null, 2)}\n`;
  await fs.writeFile(evidencePath, body);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  await fs.writeFile(`${evidencePath}.sha256`, `${digest}  ${path.basename(evidencePath)}\n`);
  result.evidencePath = evidencePath;
  result.sha256 = digest;
}

console.log(JSON.stringify(result, null, 2));
