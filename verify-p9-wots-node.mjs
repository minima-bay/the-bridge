#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WotsWriteAheadGuard } from './wots-write-ahead-guard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const split = entry.indexOf('=');
  return split < 0 ? [entry.replace(/^--/, ''), true] : [entry.slice(2, split), entry.slice(split + 1)];
}));
const mode = args.mode || 'inspect';
const journalDir = path.resolve(args.journal || '');
const policyPath = path.join(root, 'p9-wots-policy.json');
const signerPath = path.join(root, 'mainnet-test-signers.json');
const lanesPath = path.join(root, 'mainnet-lanes-p8.json');
const evidencePath = path.join(root, 'evidence', 'generic-mainnet-p8-live-20260819T192848Z.json');
const expectedEvidenceSha256 = '2760cc3ae4bc1a042b46c24c0c603d9f28580c79233518c0dc288e2283ed4175';
const forbiddenRoots = [
  'C:\\Users\\Charles\\Documents\\Crypto\\Minima\\Nodes\\BridgeTestSigners',
  'C:\\Users\\Charles\\Documents\\Crypto\\Minima\\Nodes\\BridgeTestSigners-backups',
];

function fatal(message) { throw new Error(message); }
function upper(value) { return String(value || '').toUpperCase(); }

const [policy, signers, lanes] = await Promise.all([
  fs.readFile(policyPath, 'utf8').then(JSON.parse),
  fs.readFile(signerPath, 'utf8').then(JSON.parse),
  fs.readFile(lanesPath, 'utf8').then(JSON.parse),
]);

function verifyProjectConfiguration() {
  if (signers.node !== policy.nodeName || signers.coreVersion !== policy.coreVersion
    || signers.threshold !== policy.committee.threshold || signers.memberCount !== policy.committee.memberCount
    || upper(signers.committeeRootSha3) !== upper(policy.committee.rootSha3)
    || signers.singleControllerFixture !== policy.committee.singleControllerFixture
    || signers.decentralizationEvidence !== policy.committee.decentralizationEvidence
    || signers.maximumUsesPerTreeKey !== policy.maximumUsesPerTreeKey || signers.treeKeySize !== policy.treeKeySize
    || signers.treeKeyDepth !== policy.treeKeyDepth) fatal('project signer configuration differs from P9 policy');
  const committee = policy.protectedKeys.filter((entry) => entry.role === 'committee').map((entry) => upper(entry.publicKey));
  if (JSON.stringify(signers.publicKeys.map(upper)) !== JSON.stringify(committee)) fatal('ordered committee public keys differ');
  const committeeFloors = policy.protectedKeys.filter((entry) => entry.role === 'committee').map((entry) => entry.minimumUses);
  if (JSON.stringify(signers.keyUsesAfterLiveP8Ceremony) !== JSON.stringify(committeeFloors)
    || signers.p8FinalProtectedUses?.cancellationAuthorities?.USDTm !== policy.protectedKeys.find((entry) => entry.id === 'cancel-usdtm').minimumUses
    || signers.p8FinalProtectedUses?.cancellationAuthorities?.ETHm !== policy.protectedKeys.find((entry) => entry.id === 'cancel-ethm').minimumUses
    || signers.p8FinalProtectedUses?.returnOwner !== policy.protectedKeys.find((entry) => entry.id === 'return-owner').minimumUses
    || signers.p8FinalProtectedUses?.authoritativeEvidenceSha256 !== expectedEvidenceSha256) fatal('authoritative P8 counter floors differ');
  for (const laneName of ['USDTm', 'ETHm']) {
    const lane = lanes.lanes.find((entry) => entry.name === laneName);
    const expectedId = laneName === 'USDTm' ? 'cancel-usdtm' : 'cancel-ethm';
    const expected = policy.protectedKeys.find((entry) => entry.id === expectedId);
    if (!lane || upper(lane.cancellationAuthorityPublicKey) !== upper(expected.publicKey)
      || upper(signers.p8CancellationAuthorities[laneName].publicKey) !== upper(expected.publicKey)) fatal(`${laneName} cancellation key differs`);
    const returnKey = policy.protectedKeys.find((entry) => entry.id === 'return-owner');
    if (upper(lane.returnOwner.publicKey) !== upper(returnKey.publicKey)
      || upper(signers.p8ReturnOwner.publicKey) !== upper(returnKey.publicKey)) fatal(`${laneName} return key differs`);
  }
  if (upper(lanes.committeeRoot) !== upper(policy.committee.rootSha3)) fatal('lane committee root differs');
}

verifyProjectConfiguration();

function makeObservation(keys) {
  return {
    nodeName: policy.nodeName,
    coreVersion: policy.coreVersion,
    committee: structuredClone(policy.committee),
    keys,
  };
}

async function evidenceObservation() {
  const bytes = await fs.readFile(evidencePath);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expectedEvidenceSha256) fatal('P8 live evidence SHA-256 differs');
  const evidence = JSON.parse(bytes.toString('utf8'));
  const counters = evidence?.committee?.finalTreeKeyUses;
  const cancellation = evidence?.committee?.cancellationAuthorityUses;
  const returnOwnerUses = evidence?.committee?.returnOwnerUses;
  if (evidence?.recovery?.walletKeyCount !== 74 || !Array.isArray(counters) || counters.length !== 7
    || cancellation?.USDTm === undefined || cancellation?.ETHm === undefined || returnOwnerUses === undefined
    || JSON.stringify(evidence?.committee?.publicKeys?.map(upper)) !== JSON.stringify(signers.publicKeys.map(upper))) {
    fatal('P8 evidence counter or key shape differs');
  }
  const byId = Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id, entry.minimumUses]));
  policy.protectedKeys.filter((entry) => entry.role === 'committee').forEach((entry, index) => { byId[entry.id] = Number(counters[index]); });
  byId['cancel-usdtm'] = Number(cancellation.USDTm);
  byId['cancel-ethm'] = Number(cancellation.ETHm);
  byId['return-owner'] = Number(returnOwnerUses);
  for (const entry of policy.protectedKeys) {
    if (byId[entry.id] !== entry.minimumUses) fatal(`P8 evidence floor differs for ${entry.id}`);
  }
  return makeObservation(policy.protectedKeys.map((entry) => ({ publicKey: entry.publicKey, uses: byId[entry.id],
    maximumUses: policy.maximumUsesPerTreeKey, size: policy.treeKeySize, depth: policy.treeKeyDepth })));
}

async function rpcKeys(rpc) {
  const rpcPassword = process.env.P9_VERIFY_RPCPASSWORD;
  if (!rpcPassword) fatal('authenticated RPC password environment is required');
  const authorization = `Basic ${Buffer.from(`minima:${rpcPassword}`, 'utf8').toString('base64')}`;
  const response = await fetch(`${rpc.replace(/\/$/, '')}/${encodeURIComponent('keys action:list')}`, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fatal(`keys RPC HTTP ${response.status}`);
  const parsed = await response.json();
  const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
  if (envelope?.status !== true) fatal('keys RPC returned a failure');
  const rows = envelope?.response?.keys;
  if (!Array.isArray(rows)) fatal('keys RPC shape differs');
  return rows.map((entry) => ({ publicKey: String(entry.publickey || ''), uses: entry.uses,
    maximumUses: entry.maxuses, size: entry.size, depth: entry.depth }));
}

if (!journalDir || journalDir === path.parse(journalDir).root) fatal('exact --journal path is required');
const guard = new WotsWriteAheadGuard({ policyPath, journalDir, forbiddenRoots });
let keys;
let verdict;
if (mode === 'initialize-evidence') {
  keys = (await evidenceObservation()).keys;
  verdict = await guard.initialize(makeObservation(keys));
} else if (mode === 'inspect') {
  if (!args.rpc || !/^http:\/\/127\.0\.0\.1:\d+$/.test(args.rpc)) fatal('loopback --rpc is required');
  keys = await rpcKeys(args.rpc);
  if (args['expected-wallet-keys'] && keys.length !== Number(args['expected-wallet-keys'])) fatal('wallet key count differs');
  verdict = await guard.inspect(makeObservation(keys));
} else fatal('mode must be initialize-evidence or inspect');

const usesByPublic = new Map(keys.map((entry) => [upper(entry.publicKey), Number(entry.uses)]));
const protectedCounters = Object.fromEntries(policy.protectedKeys.map((entry) => [entry.id, usesByPublic.get(upper(entry.publicKey))]));
const protectedTreeKeyShape = Object.fromEntries(policy.protectedKeys.map((entry) => {
  const found = keys.find((key) => upper(key.publicKey) === upper(entry.publicKey));
  return [entry.id, { maximumUses: Number(found?.maximumUses), size: Number(found?.size), depth: Number(found?.depth) }];
}));
const output = {
  schema: 'generic-p9-wots-node-verification/v1',
  createdAt: new Date().toISOString(),
  mode,
  rpcCommand: mode === 'inspect' ? 'keys action:list' : null,
  walletKeyCount: mode === 'inspect' ? keys.length : null,
  protectedCounters,
  protectedTreeKeyShape,
  verdict,
  policySigningState: {
    signingEnabled: policy.signingEnabled,
    ...(policy.signingEnabled ? {} : { retirementReason: policy.retirementReason }),
  },
  wrapperSourceConstrainedToProjectedKeyMetadata: true,
};
if (args.output) {
  const outputPath = path.resolve(args.output);
  const bytes = `${JSON.stringify(output, null, 2)}\n`;
  await fs.writeFile(outputPath, bytes);
  await fs.writeFile(`${outputPath}.sha256`, `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${path.basename(outputPath)}\n`);
}
console.log(JSON.stringify(output, null, 2));
if (mode === 'initialize-evidence' && verdict.code !== 'JOURNAL_INITIALIZED') process.exitCode = 2;
if (mode === 'inspect' && args['expect-code'] && verdict.code !== args['expect-code']) process.exitCode = 3;
