import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ceremony = JSON.parse(readFileSync(resolve(ROOT, 'mainnet-ceremony-state.json'), 'utf8'));
const signers = JSON.parse(readFileSync(resolve(ROOT, 'mainnet-test-signers.json'), 'utf8'));
const CANDIDATE = resolve(ROOT, 'p7', 'candidate-v2');
const SIGNERS = process.env.BRIDGE_TEST_SIGNERS_RPC || 'http://127.0.0.1:9705';
const zero = (bytes) => `0x${'00'.repeat(bytes)}`;
const repeated = (pair, bytes) => `0x${pair.repeat(bytes)}`;

function sha3Bytes(bytes) { return `0x${createHash('sha3-256').update(bytes).digest('hex').toUpperCase()}`; }
function sha3Text(value) { return sha3Bytes(Buffer.from(value, 'utf8')); }
function sub(start, width) { return `SUBSET(${start} ${start + width} record)`; }
function numberSub(start, width) { return `NUMBER(${sub(start, width)})`; }

async function rpc(url, command) {
  const response = await fetch(url + '/' + encodeURIComponent(command));
  const raw = await response.text();
  if (!raw) throw new Error(`empty RPC response ${response.status} for ${command.split(' ')[0]}`);
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`non-JSON RPC response ${response.status}: ${raw.slice(0, 500)}`); }
  return Array.isArray(body) ? body[0] : body;
}

async function cleanAt(url, script) {
  const result = await rpc(url, `runscript script:"${script}"`);
  if (!result?.status || result?.response?.parseok !== true) throw new Error(`script parse failed at ${url}: ${(result?.error || result?.message || JSON.stringify(result) || 'parseok false').slice(0, 1000)}`);
  return result.response.clean;
}

function makeScript(lane) {
  const multisig = `MULTISIG(5 ${signers.publicKeys.join(' ')})`;
  let script = '';
  script += 'ASSERT @TOTIN EQ 2 ASSERT @TOTOUT EQ 3 ';
  script += 'ASSERT GETINADDR(0) EQ @ADDRESS ASSERT GETINADDR(1) EQ @ADDRESS ';
  script += `ASSERT GETINTOK(0) EQ ${lane.controlTokenId} ASSERT GETINAMT(0) EQ 1 `;
  script += `ASSERT GETINTOK(1) EQ ${lane.bridgeTokenId} `;
  script += 'LET record=STATE(90) ASSERT LEN(record) EQ 444 ';
  script += `LET amountsource=${numberSub(240, 8)} LET amountdest=${numberSub(248, 8)} `;
  script += `LET oldreserve=(GETINAMT(1)*${lane.factor}) LET newreserve=STATE(6) `;
  script += 'ASSERT amountdest GT 0 ASSERT amountdest LT oldreserve ASSERT oldreserve EQ (newreserve+amountdest) ';
  script += `ASSERT GETOUTADDR(0) EQ @ADDRESS ASSERT GETOUTTOK(0) EQ ${lane.controlTokenId} `;
  script += 'ASSERT GETOUTAMT(0) EQ 1 ASSERT GETOUTKEEPSTATE(0) EQ TRUE ';
  script += `ASSERT GETOUTADDR(1) EQ @ADDRESS ASSERT GETOUTTOK(1) EQ ${lane.bridgeTokenId} `;
  script += `ASSERT GETOUTKEEPSTATE(1) EQ FALSE ASSERT (GETOUTAMT(1)*${lane.factor}) EQ newreserve `;
  script += `ASSERT GETOUTADDR(2) EQ ${sub(256, 32)} ASSERT GETOUTTOK(2) EQ ${lane.bridgeTokenId} `;
  script += `ASSERT GETOUTKEEPSTATE(2) EQ FALSE ASSERT (GETOUTAMT(2)*${lane.factor}) EQ amountdest `;
  script += `IF @INPUT EQ 1 THEN RETURN TRUE ENDIF ASSERT @INPUT EQ 0 ASSERT ${multisig} `;
  script += `ASSERT ${numberSub(0, 2)} EQ 1 ASSERT ${numberSub(2, 1)} EQ 1 `;
  script += `ASSERT ${numberSub(3, 2)} EQ 1 ASSERT ${numberSub(5, 1)} EQ PREVSTATE(30) `;
  script += `ASSERT ${numberSub(6, 1)} EQ PREVSTATE(31) ASSERT ${numberSub(7, 1)} EQ PREVSTATE(32) `;
  script += `ASSERT ${numberSub(8, 8)} EQ PREVSTATE(38) ASSERT ${numberSub(16, 8)} EQ PREVSTATE(39) `;
  script += `ASSERT ${numberSub(24, 8)} EQ PREVSTATE(33) ASSERT ${numberSub(32, 8)} EQ PREVSTATE(35) `;
  script += `ASSERT ${sub(40, 32)} EQ PREVSTATE(36) ASSERT ${sub(72, 20)} EQ PREVSTATE(12) `;
  script += `ASSERT ${sub(92, 20)} EQ PREVSTATE(34) ASSERT ${sub(112, 32)} EQ PREVSTATE(11) `;
  script += `ASSERT ${sub(144, 32)} EQ PREVSTATE(13) ASSERT ${sub(176, 32)} EQ @ADDRESS `;
  script += 'ASSERT (amountsource*PREVSTATE(39)) EQ (amountdest*PREVSTATE(38)) ';
  script += 'LET newissued=(PREVSTATE(4)+amountdest) ASSERT STATE(4) EQ newissued ASSERT STATE(5) EQ PREVSTATE(5) ';
  script += 'ASSERT newreserve EQ (PREVSTATE(6)-amountdest) ASSERT PREVSTATE(6) EQ oldreserve ';
  script += 'ASSERT (newreserve+newissued) EQ PREVSTATE(7) ASSERT newissued LTE PREVSTATE(33) ';
  script += `LET newvault=${numberSub(368, 8)} `;
  script += 'ASSERT ((newissued+PREVSTATE(5))*PREVSTATE(38)) LTE (newvault*PREVSTATE(39)) ';
  script += `LET newversion=${numberSub(360, 8)} LET newblock=${numberSub(288, 8)} `;
  script += `LET newcursor=${numberSub(376, 8)} ASSERT newcursor EQ PREVSTATE(15) `;
  script += `LET newpaid=${numberSub(384, 8)} ASSERT newpaid EQ PREVSTATE(16) `;
  script += 'IF newversion EQ PREVSTATE(25) THEN ASSERT newvault EQ PREVSTATE(8) ASSERT newblock EQ PREVSTATE(26) ';
  script += `ASSERT ${sub(296, 32)} EQ PREVSTATE(27) ASSERT STATE(17) EQ PREVSTATE(17) `;
  script += 'ASSERT (@BLOCK-PREVSTATE(17)) LTE PREVSTATE(18) ';
  script += 'ELSE ASSERT newversion EQ (PREVSTATE(25)+1) ASSERT newblock GTE PREVSTATE(26) ';
  script += 'ASSERT STATE(17) GTE PREVSTATE(17) ASSERT STATE(17) LTE @BLOCK ';
  script += 'ASSERT (@BLOCK-STATE(17)) LTE PREVSTATE(18) ENDIF ';
  script += 'ASSERT STATE(8) EQ newvault ASSERT STATE(15) EQ newcursor ASSERT STATE(16) EQ newpaid ';
  script += `ASSERT STATE(25) EQ newversion ASSERT STATE(26) EQ newblock ASSERT STATE(27) EQ ${sub(296, 32)} `;
  script += `ASSERT ${numberSub(392, 4)} EQ PREVSTATE(28) ASSERT ${sub(396, 32)} EQ PREVSTATE(29) `;
  script += `ASSERT ${numberSub(428, 8)} EQ PREVSTATE(1) LET sourcetime=${numberSub(436, 8)} `;
  script += 'ASSERT sourcetime LTE (@BLOCKMILLI+PREVSTATE(24)) ASSERT @BLOCKMILLI LTE (sourcetime+PREVSTATE(23)) ';
  script += `ASSERT STATE(10) EQ SHA3(CONCAT(PREVSTATE(10) ${sub(112, 32)} ${sub(208, 32)})) `;
  script += 'ASSERT SAMESTATE(0 3) ASSERT SAMESTATE(7 7) ASSERT SAMESTATE(9 9) ASSERT SAMESTATE(18 24) ';
  script += 'ASSERT SAMESTATE(11 14) ASSERT SAMESTATE(28 39) RETURN TRUE';
  return script;
}

const minimaNetwork = sha3Text('GENERIC_BRIDGE_MINIMA_MAINNET_V1');
const emptyNullifierRoot = sha3Text('GENERIC_BRIDGE_EMPTY_NULLIFIER_ROOT_V1');
const laneInputs = [
  {
    name: 'USDTm', sourceKind: 1, decimals: 6, factor: '1000000',
    fixedSupplyAtoms: ceremony.tokens.USDTm.fixedSupplyAtoms, capAtoms: ceremony.tokens.USDTm.capAtoms,
    bridgeTokenId: ceremony.tokens.USDTm.tokenId, controlTokenId: ceremony.tokens.USDTmControl.tokenId,
    ethereumVault: repeated('22', 20), sourceAsset: repeated('33', 20),
  },
  {
    name: 'ETHm', sourceKind: 0, decimals: 18, factor: '1000000000000000000',
    fixedSupplyAtoms: ceremony.tokens.ETHm.fixedSupplyAtoms, capAtoms: ceremony.tokens.ETHm.capAtoms,
    bridgeTokenId: ceremony.tokens.ETHm.tokenId, controlTokenId: ceremony.tokens.ETHmControl.tokenId,
    ethereumVault: repeated('cc', 20), sourceAsset: zero(20),
  },
];

mkdirSync(CANDIDATE, { recursive: true });
const output = { schema: 'generic-bridge-mainnet-test-lanes-candidate/v2', supersedesDeployedCandidate: 'mainnet-lanes.json',
  requiresFreshPurposeCreatedTokenIds: true, addressesAreProvisionalUntilFreshTokenIdsAreBound: true,
  minimaNetwork, committeeRoot: signers.committeeRootSha3,
  singleControllerSignerFixture: true, sourceFactsAreSynthetic: true, lanes: [] };

for (const input of laneInputs) {
  if (![input.bridgeTokenId, input.controlTokenId].every((value) => /^0x[0-9a-f]{64}$/i.test(value || ''))) throw new Error(`${input.name} token IDs are not confirmed`);
  const laneId = sha3Text(['GENERIC_BRIDGE_MAINNET_TEST_LANE_V2', input.name, input.sourceKind, input.decimals,
    input.bridgeTokenId, input.controlTokenId, input.ethereumVault, input.sourceAsset, input.capAtoms, minimaNetwork].join('\0'));
  const rawScript = makeScript({ ...input, laneId });
  const signer = await cleanAt(SIGNERS, rawScript);
  const state = {
    0: '1', 1: '1', 2: sha3Text(`GENERIC_BRIDGE_TEST_CLIENT_V1\0${laneId}`),
    3: sha3Text(`GENERIC_BRIDGE_TEST_CONFIG_V1\0${laneId}`), 4: '0', 5: '0',
    6: input.fixedSupplyAtoms, 7: input.fixedSupplyAtoms, 8: '0', 9: String(input.decimals),
    10: emptyNullifierRoot, 11: laneId, 12: input.ethereumVault, 13: input.bridgeTokenId,
    14: input.controlTokenId, 15: '0', 16: '0', 17: '0', 18: '100', 19: zero(32),
    20: zero(20), 21: zero(32), 22: '0', 23: '3600000', 24: '300000', 25: '0',
    26: '0', 27: zero(32), 28: '1', 29: signers.committeeRootSha3, 30: String(input.sourceKind),
    31: String(input.decimals), 32: String(input.decimals), 33: input.capAtoms,
    34: input.sourceAsset, 35: '1', 36: minimaNetwork, 37: signer.address, 38: '1', 39: '1',
  };
  const file = resolve(CANDIDATE, `${input.name.toLowerCase()}-lane-v2.kiss`);
  writeFileSync(file, signer.script);
  output.lanes.push({ ...input, laneId, covenantAddress: signer.address, cleanScriptBytes: Buffer.byteLength(signer.script),
    cleanScriptSha256: createHash('sha256').update(signer.script).digest('hex'), scriptFile: file.slice(ROOT.length + 1).replaceAll('\\', '/'), genesisState: state });
}

writeFileSync(resolve(ROOT, 'mainnet-lanes-v2-candidate.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
