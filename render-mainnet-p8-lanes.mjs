import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ceremony = JSON.parse(readFileSync(resolve(ROOT, 'mainnet-p8-ceremony-state.json'), 'utf8'));
const signers = JSON.parse(readFileSync(resolve(ROOT, 'mainnet-test-signers.json'), 'utf8'));
const HARNESS = resolve(ROOT, 'p8', 'GenericP8UnifiedSmoke.java');
const JAR = resolve(ROOT, 'upstream', 'minima-core', 'jar', 'minima.jar');
const CANDIDATE = resolve(ROOT, 'p8', 'final-mainnet-p8');
const SIGNER_RPC = process.env.BRIDGE_TEST_SIGNERS_RPC || 'http://127.0.0.1:9705';
const ISSUER_RPC = process.env.USDTM_P8_ISSUER_RPC || 'http://127.0.0.1:9905';
const zero = (bytes) => `0x${'00'.repeat(bytes)}`;
const repeated = (pair, bytes) => `0x${pair.repeat(bytes)}`;
const upper = (value) => String(value || '').toUpperCase();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha3Bytes = (bytes) => `0x${createHash('sha3-256').update(bytes).digest('hex').toUpperCase()}`;
const sha3Text = (value) => sha3Bytes(Buffer.from(value, 'utf8'));

async function rpc(url, command) {
  const response = await fetch(url + '/' + encodeURIComponent(command));
  const body = await response.json();
  return Array.isArray(body) ? body[0] : body;
}

async function cleanAt(url, script) {
  const result = await rpc(url, `runscript script:"${script}"`);
  if (!result?.status || result?.response?.parseok !== true) {
    throw new Error(`script parse failed at ${url}: ${result?.error || result?.message || 'parseok false'}`);
  }
  return result.response.clean;
}

function renderJava(outputRoot, mode, bridgeTokenId, controlTokenId) {
  const stdout = execFileSync('java', ['-cp', `${outputRoot};${JAR}`, 'GenericP8UnifiedSmoke', 'render', mode,
    bridgeTokenId, controlTokenId, ...signers.publicKeys], { cwd: ROOT, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}

if (ceremony.status !== 'all-p8-tokens-confirmed-awaiting-lane-render') throw new Error('all four mined P8 token IDs must be confirmed first');
if (!Array.isArray(signers.publicKeys) || signers.publicKeys.length !== 7) throw new Error('exactly seven committee public keys required');
const committeeRoot = sha3Bytes(Buffer.concat(signers.publicKeys.map((key) => Buffer.from(key.slice(2), 'hex'))));
if (upper(committeeRoot) !== upper(signers.committeeRootSha3)) throw new Error('committee root differs from signer manifest');

const minimaNetwork = sha3Text('GENERIC_BRIDGE_MINIMA_MAINNET_V1');
const emptyNullifierRoot = sha3Text('GENERIC_BRIDGE_EMPTY_NULLIFIER_ROOT_V1');
const laneInputs = [
  {
    name: 'USDTm', mode: 'erc20', sourceKind: 1, decimals: 6, factor: '1000000',
    fixedSupply: ceremony.tokens.USDTm.fixedSupply, fixedSupplyAtoms: ceremony.tokens.USDTm.fixedSupplyAtoms,
    capAtoms: ceremony.tokens.USDTm.capAtoms, bridgeTokenId: ceremony.tokens.USDTm.tokenId,
    controlTokenId: ceremony.tokens.USDTmControl.tokenId, ethereumVault: repeated('22', 20), sourceAsset: repeated('33', 20),
  },
  {
    name: 'ETHm', mode: 'eth', sourceKind: 0, decimals: 18, factor: '1000000000000000000',
    fixedSupply: ceremony.tokens.ETHm.fixedSupply, fixedSupplyAtoms: ceremony.tokens.ETHm.fixedSupplyAtoms,
    capAtoms: ceremony.tokens.ETHm.capAtoms, bridgeTokenId: ceremony.tokens.ETHm.tokenId,
    controlTokenId: ceremony.tokens.ETHmControl.tokenId, ethereumVault: repeated('cc', 20), sourceAsset: zero(20),
  },
];

const outputRoot = mkdtempSync(join(tmpdir(), 'generic-p8-render-'));
const resolvedTempBase = `${realpathSync(tmpdir())}${sep}`.toLowerCase();
const resolvedOutputRoot = realpathSync(outputRoot).toLowerCase();
if (!resolvedOutputRoot.startsWith(resolvedTempBase) || !basename(resolvedOutputRoot).startsWith('generic-p8-render-')) {
  throw new Error(`refusing cleanup outside expected temporary root: ${resolvedOutputRoot}`);
}

const output = {
  schema: 'generic-bridge-mainnet-test-lanes-final/v3', authorizedBy: 'D-USDTM-023',
  minimaNetwork, committeeRoot, singleControllerSignerFixture: true, sourceFactsAreSynthetic: true,
  allFiveActionsRequired: true, lanes: [],
};

try {
  execFileSync('javac', ['--release', '8', '-cp', JAR, '-d', outputRoot, HARNESS], { cwd: ROOT, windowsHide: true });
  mkdirSync(CANDIDATE, { recursive: true });
  for (const input of laneInputs) {
    if (![input.bridgeTokenId, input.controlTokenId].every((value) => /^0x[0-9a-f]{64}$/i.test(value || ''))) {
      throw new Error(`${input.name} token IDs are not confirmed`);
    }
    const laneId = sha3Text(['GENERIC_BRIDGE_MAINNET_TEST_LANE_P8_V1', input.name, input.sourceKind, input.decimals,
      input.bridgeTokenId, input.controlTokenId, input.ethereumVault, input.sourceAsset, input.capAtoms, minimaNetwork].join('\0'));
    const rendered = renderJava(outputRoot, input.mode, input.bridgeTokenId, input.controlTokenId);
    const signer = await cleanAt(SIGNER_RPC, rendered.script);
    const issuer = await cleanAt(ISSUER_RPC, rendered.script);
    if (upper(signer.address) !== upper(rendered.address) || upper(issuer.address) !== upper(rendered.address)
        || signer.script !== rendered.script || issuer.script !== rendered.script) {
      throw new Error(`${input.name} script cleaning differs across Java, issuer and signer nodes`);
    }
    const state = {
      0: '2', 1: '1', 2: sha3Text(`GENERIC_BRIDGE_P8_TEST_CLIENT_V1\0${laneId}`),
      3: sha3Text(`GENERIC_BRIDGE_P8_TEST_CONFIG_V1\0${laneId}`), 4: '0', 5: '0',
      6: input.fixedSupplyAtoms, 7: input.fixedSupplyAtoms, 8: '0', 9: String(input.decimals),
      10: emptyNullifierRoot, 11: laneId, 12: input.ethereumVault, 13: input.bridgeTokenId,
      14: input.controlTokenId, 15: '0', 16: '0', 17: '0', 18: '100', 19: zero(32),
      20: zero(20), 21: zero(32), 22: '0', 23: '3600000', 24: '300000', 25: '0',
      26: '0', 27: zero(32), 28: '1', 29: committeeRoot, 30: String(input.sourceKind),
      31: String(input.decimals), 32: String(input.decimals), 33: input.capAtoms,
      34: input.sourceAsset, 35: '1', 36: minimaNetwork, 37: rendered.address, 38: '1', 39: '1',
    };
    const file = resolve(CANDIDATE, `${input.name.toLowerCase()}-lane-p8.kiss`);
    writeFileSync(file, rendered.script);
    output.lanes.push({ ...input, laneId, covenantAddress: rendered.address, cleanScriptBytes: rendered.scriptBytes,
      cleanScriptSha256: sha256(rendered.script), scriptFile: file.slice(ROOT.length + 1).replaceAll('\\', '/'),
      cancellationAuthorityPublicKey: signers.p8CancellationAuthorities[input.name].publicKey,
      returnOwner: signers.p8ReturnOwner, genesisState: state });
  }
  writeFileSync(resolve(ROOT, 'mainnet-lanes-p8.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
