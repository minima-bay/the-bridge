#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRecordPrimary, hashRecordPrimary, recordLayouts } from './usdtm-p2-records-primary.mjs';
import { encodeRecordIndependent, hashRecordIndependent } from './usdtm-p2-records-independent.mjs';

const sourcePath=fileURLToPath(import.meta.url),root=dirname(sourcePath),fixturePath=resolve(root,'fixtures','usdtm-p2-records-v1.json');
const fixture=JSON.parse(readFileSync(fixturePath,'utf8')),emitEvidence=process.argv.includes('--evidence');
const sha256=(v)=>createHash('sha256').update(v).digest('hex'),assertions=[],mutations=[];
function ok(name,value){if(!value)throw new Error(name);assertions.push(name);}
function rejects(name,fn){let yes=false;try{fn();}catch{yes=true;}ok(name,yes);}
const nz=(hex)=>!/^0+$/.test(hex);

function uintBytes(value,width){let x=BigInt(value),b=Buffer.alloc(width);for(let i=width-1;i>=0;i-=1){b[i]=Number(x&255n);x>>=8n;}return b;}
function redemptionId(r){const d=Buffer.alloc(32);Buffer.from('MINIMA_ETH_REDEMPTION_V1','ascii').copy(d);return sha256(Buffer.concat([d,Buffer.from(r.destinationNetworkId,'hex'),Buffer.from(r.destinationBridgeDeploymentId,'hex'),Buffer.from(r.destinationTokenId,'hex'),Buffer.from(r.returnedCoinId,'hex'),uintBytes(r.returnedAmountAtoms,16),Buffer.from(r.ethereumRecipient,'hex'),uintBytes(r.configurationEpoch,8)]));}

function validateSemantic(type,r){
  if(r.schemaVersion!=='1'||r.proofProgramVersion!=='1'||r.verifierVersion!=='1'||!nz(r.verificationKeyHash))throw new Error('version domain');
  if(type==='deposit'){
    if(r.domainTag!=='MINIMA_USDTM_DEPOSIT_V1'||r.action!=='2'||r.ethereumRecordStatus!=='1'||r.expectedMinimaNullifierStatus!=='0')throw new Error('deposit state domain');
    const a=BigInt(r.destinationAmountAtoms),s=BigInt(r.sourceAmountAtoms),q=BigInt(r.decimalScale),before=BigInt(r.usedCapacityBeforeAtoms),after=BigInt(r.usedCapacityAfterAtoms),cap=BigInt(r.fixedCapacityAtoms);
    if(a<=0n||q<=0n||s*q!==a||after!==before+a||after>cap||!nz(r.minimaRecipient)||!nz(r.refundRecipient)||!nz(r.authorityPublicKey))throw new Error('deposit arithmetic or identity');
  }else if(type==='refund'){
    if(r.domainTag!=='MINIMA_USDTM_REFUND_V1'||r.action!=='6'||r.recordStatusBefore!=='1'||r.recordStatusAfter!=='2')throw new Error('refund state domain');
    const a=BigInt(r.amountAtoms),before=BigInt(r.capacityBeforeAtoms),after=BigInt(r.capacityAfterAtoms);
    if(a<=0n||before<a||after!==before-a||!nz(r.cancellationTxpowId)||!nz(r.cancellationStateCommitment)||!nz(r.minimaBranchCommitment))throw new Error('refund proof or capacity');
  }else if(type==='redemption'){
    if(r.domainTag!=='MINIMA_USDTM_REDEEM_V1'||r.action!=='3'||BigInt(r.returnedAmountAtoms)<=0n||!nz(r.ethereumRecipient)||r.redemptionId!==redemptionId(r))throw new Error('redemption domain');
  }else if(type==='payoutBatch'){
    if(r.domainTag!=='MINIMA_USDTM_PAYOUT_V1'||r.action!=='7')throw new Error('payout domain');
    const pc=BigInt(r.priorCursor),nc=BigInt(r.newCursor),pa=BigInt(r.priorCumulativePaidAtoms),na=BigInt(r.newCumulativePaidAtoms),a=BigInt(r.batchPaidAtoms);
    if(nc<=pc||a<=0n||na-pa!==a||!nz(r.firstRedemptionId)||!nz(r.lastRedemptionId)||!nz(r.payoutRangeRoot))throw new Error('payout range');
  }else if(type==='clientState'){
    if(r.domainTag!=='MINIMA_USDTM_CLIENT_V1'||r.action!=='1'||r.previousClientCommitment===r.newClientCommitment)throw new Error('client domain');
    const source=BigInt(r.sourceTimestampMs),dest=BigInt(r.destinationAcceptanceTimestampMs),age=BigInt(r.maximumSourceAgeMs),skew=BigInt(r.maximumFutureSkewMs);
    if(source>dest+skew||dest>source+age)throw new Error('guarded timestamp bounds');
  }else throw new Error('unknown semantic record');
  return true;
}

function mutate(kind,width,value){if(kind==='ascii')return `${value}X`;if(kind==='hex')return `${value[0]==='f'?'e':'f'}${value.slice(1)}`;const x=BigInt(value),max=(1n<<BigInt(width*8))-1n;return String(x===max?x-1n:x+1n);}

ok('bundle schema exact',fixture.schema==='usdtm-p2-records/v1');
for(const [type,record] of Object.entries(fixture.records)){
  const a=encodeRecordPrimary(type,record),b=encodeRecordIndependent(type,record),expected=fixture.expected[type];
  ok(`${type} semantic fixture valid`,validateSemantic(type,record));
  ok(`${type} encoder bytes agree`,a.equals(b));
  ok(`${type} encoded length fixed`,a.length===expected.bytes);
  ok(`${type} primary hash fixed`,hashRecordPrimary(type,record)===expected.sha256);
  ok(`${type} independent hash fixed`,hashRecordIndependent(type,record)===expected.sha256);
  for(const [name,kind,width] of recordLayouts[type]){
    const changed={...record,[name]:mutate(kind,width,record[name])};
    const x=encodeRecordPrimary(type,changed),y=encodeRecordIndependent(type,changed);
    const detected=x.equals(y)&&sha256(x)!==expected.sha256;
    ok(`${type}.${name} mutation changes commitment`,detected);mutations.push({type,field:name,detected});
  }
  const missing={...record};delete missing[recordLayouts[type][0][0]];
  rejects(`${type} missing field rejects`,()=>encodeRecordPrimary(type,missing));
  rejects(`${type} extra field rejects`,()=>encodeRecordPrimary(type,{...record,unexpected:'0'}));
}

const invalidCases=[
  ['deposit wrong action','deposit',{action:'5'}],['deposit nonpending','deposit',{ethereumRecordStatus:'2'}],['deposit nonempty nullifier','deposit',{expectedMinimaNullifierStatus:'1'}],['deposit capacity mismatch','deposit',{usedCapacityAfterAtoms:'2250001'}],['deposit reserve floor crossed','deposit',{usedCapacityAfterAtoms:'10000000'}],['deposit zero amount','deposit',{sourceAmountAtoms:'0',destinationAmountAtoms:'0'}],
  ['refund wrong transition','refund',{recordStatusAfter:'1'}],['refund capacity mismatch','refund',{capacityAfterAtoms:'999999'}],['refund underflow','refund',{capacityBeforeAtoms:'1'}],
  ['redemption wrong action','redemption',{action:'7'}],['redemption zero amount','redemption',{returnedAmountAtoms:'0'}],['redemption changed recipient','redemption',{ethereumRecipient:'38'.repeat(20)}],['redemption arbitrary ID','redemption',{redemptionId:'35'.repeat(32)}],
  ['payout empty range','payoutBatch',{newCursor:'8'}],['payout cumulative mismatch','payoutBatch',{newCumulativePaidAtoms:'3000001'}],['payout zero amount','payoutBatch',{batchPaidAtoms:'0'}],
  ['client equal head','clientState',{newClientCommitment:fixture.records.clientState.previousClientCommitment}],['client too old','clientState',{destinationAcceptanceTimestampMs:'1770000700001'}],['client too far future','clientState',{sourceTimestampMs:'1770000135001'}],
];
for(const [name,type,patch] of invalidCases)rejects(name,()=>validateSemantic(type,{...fixture.records[type],...patch}));

const result={schema:'usdtm-p2-record-validation/v1',createdAtUtc:new Date().toISOString(),status:'passed',validator:basename(sourcePath),validatorSha256:sha256(readFileSync(sourcePath)),fixture:'fixtures/usdtm-p2-records-v1.json',fixtureSha256:sha256(readFileSync(fixturePath)),recordCount:Object.keys(fixture.records).length,assertionCount:assertions.length,fieldMutationCount:mutations.length,mutationsDetected:mutations.filter(x=>x.detected).length,invalidSemanticCaseCount:invalidCases.length,recordCommitments:Object.fromEntries(Object.entries(fixture.expected).map(([k,v])=>[k,v.sha256])),limitations:['Canonical local record bytes only; no source inclusion, chain finality, ZK verification, KISS execution, signature runtime or transaction mineability is proved.','P2 authority scheme selection remains a schema identifier until P6/P8 runtime evidence.','No network, transaction, token, vault, funds or mainnet action occurred.']};
if(emitEvidence){const stamp=result.createdAtUtc.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),p=resolve(root,'evidence',`usdtm-p2-record-validation-${stamp}.json`),s=`${JSON.stringify(result,null,2)}\n`;writeFileSync(p,s);const d=sha256(s);writeFileSync(`${p}.sha256`,`${d}  ${basename(p)}\n`);result.evidencePath=p;result.evidenceSha256=d;}
console.log(JSON.stringify(result,null,2));
