#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath=fileURLToPath(import.meta.url),root=dirname(sourcePath),emitEvidence=process.argv.includes('--evidence');
const H=(v)=>createHash('sha256').update(v).digest(),hex=(v)=>H(v).toString('hex'),u=(v,n)=>{let x=BigInt(v),b=Buffer.alloc(n);for(let i=n-1;i>=0;i-=1){b[i]=Number(x&255n);x>>=8n;}return b;};
const EMPTY=0,RELEASED=1,CANCELLED=2,PENDING=1,REFUNDED=2;
const TOKEN='88'.repeat(32),DEST='22'.repeat(32),BRIDGE='55'.repeat(32),EPOCH=3n;

function canonical(value){
  if(typeof value==='bigint')return `${value}n`;
  if(value instanceof Map)return [...value.entries()].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([k,v])=>[k,canonical(v)]);
  if(value instanceof Set)return [...value].sort();
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export const stateDigest=(s)=>hex(JSON.stringify(canonical(s)));
const clone=(s)=>structuredClone(s);

export function initialState(F=10_000n){return{
  eth:{version:0,records:new Map(),accepted:0n,refunded:0n,paid:0n,fixedCapacity:F-1n,vaultBalance:F,payouts:[],paidRedemptions:new Set(),locked:false},
  min:{clientVersion:0,F,R:F,I:0n,P:0n,L:F,payoutCursor:0,acknowledgedPaid:0n,nullifiers:new Map(),returnedCoins:new Map(),redemptions:new Map(),controlVersion:0,height:0},
};}
export const usedCapacity=(s)=>s.eth.accepted-s.eth.refunded-s.eth.paid;

function redemptionId(coin,recipient){const d=Buffer.alloc(32);Buffer.from('MINIMA_ETH_REDEMPTION_V1').copy(d);return hex(Buffer.concat([d,Buffer.from(DEST,'hex'),Buffer.from(BRIDGE,'hex'),Buffer.from(TOKEN,'hex'),Buffer.from(coin.id,'hex'),u(coin.amount,16),Buffer.from(recipient,'hex'),u(EPOCH,8)]));}
function proofCurrent(s,a){if(a.ethVersion!==s.eth.version||a.vaultBalance!==s.eth.vaultBalance||a.payoutCursor!==s.eth.payouts.length||a.cumulativePaid!==s.eth.paid)throw new Error('source proof mismatch');}
function bridgeSynced(s,a){if(a.payoutCursor!==s.min.payoutCursor||a.cumulativePaid!==s.min.acknowledgedPaid)throw new Error('unacknowledged payout');}
const record=(s,id)=>s.eth.records.get(id);
const status=(s,id)=>s.min.nullifiers.get(id)??EMPTY;

function depositOne(s,id,amount){if(!/^[0-9a-f]{64}$/.test(id)||s.eth.records.has(id)||amount<=0n||usedCapacity(s)+amount>s.eth.fixedCapacity)throw new Error('invalid deposit');s.eth.records.set(id,{status:PENDING,amount});s.eth.accepted+=amount;}
function applyMutable(s,a){
  if(a.type==='DEPOSIT'||a.type==='DEPOSIT_BATCH'){
    const entries=a.type==='DEPOSIT'?[{id:a.id,amount:a.amount}]:a.entries;
    if(!Array.isArray(entries)||entries.length===0)throw new Error('empty deposit batch');
    const ids=new Set();for(const e of entries){if(ids.has(e.id))throw new Error('duplicate batch id');ids.add(e.id);depositOne(s,e.id,e.amount);}s.eth.version+=1;return;
  }
  if(a.type==='CLIENT_UPDATE'){
    proofCurrent(s,a);bridgeSynced(s,a);if(a.ethVersion<=s.min.clientVersion||s.min.I+s.min.P>a.vaultBalance)throw new Error('invalid client update');s.min.clientVersion=a.ethVersion;s.min.L=a.vaultBalance;s.min.controlVersion+=1;s.min.height+=1;return;
  }
  if(a.type==='RELEASE'){
    proofCurrent(s,a);bridgeSynced(s,a);const r=record(s,a.id);if(!r||r.status!==PENDING||status(s,a.id)!==EMPTY||r.amount!==a.amount||a.amount<=0n||a.amount>=s.min.R||s.min.I+a.amount+s.min.P>a.vaultBalance)throw new Error('invalid release');s.min.R-=a.amount;s.min.I+=a.amount;s.min.nullifiers.set(a.id,RELEASED);s.min.clientVersion=a.ethVersion;s.min.L=a.vaultBalance;s.min.controlVersion+=1;s.min.height+=1;return;
  }
  if(a.type==='CANCEL'){
    proofCurrent(s,a);bridgeSynced(s,a);const r=record(s,a.id);if(!r||r.status!==PENDING||status(s,a.id)!==EMPTY||!a.authorizationValid||s.min.I+s.min.P>a.vaultBalance)throw new Error('invalid cancellation');s.min.nullifiers.set(a.id,CANCELLED);s.min.clientVersion=a.ethVersion;s.min.L=a.vaultBalance;s.min.controlVersion+=1;s.min.height+=1;return;
  }
  if(a.type==='REFUND'){
    if(s.eth.locked)throw new Error('source lock');const r=record(s,a.id);if(!r||r.status!==PENDING||status(s,a.id)!==CANCELLED||!a.settled||a.transfer!=='success')throw new Error('invalid refund');s.eth.locked=true;r.status=REFUNDED;s.eth.refunded+=r.amount;s.eth.version+=1;s.eth.locked=false;return;
  }
  if(a.type==='RETURN'){
    const coin=a.coin;if(!coin||!/^[0-9a-f]{64}$/.test(coin.id)||coin.tokenId!==TOKEN||coin.amount<=0n||coin.amount>s.min.I||s.min.returnedCoins.has(coin.id)||!/^[0-9a-f]{40}$/.test(a.recipient))throw new Error('invalid returned coin');const id=redemptionId(coin,a.recipient);if(a.redemptionId!==id||s.min.redemptions.has(id))throw new Error('invalid redemption id');s.min.returnedCoins.set(coin.id,{...coin,spent:true});s.min.R+=coin.amount;s.min.I-=coin.amount;s.min.P+=coin.amount;s.min.redemptions.set(id,{id,coinId:coin.id,amount:coin.amount,recipient:a.recipient,status:'RETURNED'});s.min.controlVersion+=1;s.min.height+=1;return;
  }
  if(a.type==='PAY_REDEMPTION'||a.type==='PAY_REDEMPTION_BATCH'){
    if(s.eth.locked)throw new Error('source lock');const ids=a.type==='PAY_REDEMPTION'?[a.id]:a.ids;if(!Array.isArray(ids)||ids.length===0||new Set(ids).size!==ids.length||a.transfer!=='success')throw new Error('invalid payout batch');let total=0n;for(const id of ids){const r=s.min.redemptions.get(id);if(!r||r.status!=='RETURNED'||s.eth.paidRedemptions.has(id))throw new Error('invalid payout record');total+=r.amount;}if(total>usedCapacity(s)||total>s.min.P||total>s.eth.vaultBalance)throw new Error('payout bound');s.eth.locked=true;const block=s.eth.version+1;for(const id of ids){const r=s.min.redemptions.get(id);r.status='PAID';s.eth.paidRedemptions.add(id);s.eth.payouts.push({cursor:s.eth.payouts.length+1,id,amount:r.amount,recipient:r.recipient,cumulative:s.eth.paid+r.amount,block});s.eth.paid+=r.amount;s.eth.vaultBalance-=r.amount;}s.eth.version=block;s.eth.locked=false;return;
  }
  if(a.type==='PAYOUT_ACK'){
    proofCurrent(s,a);if(a.priorCursor!==s.min.payoutCursor||a.priorCumulative!==s.min.acknowledgedPaid||a.newCursor!==s.eth.payouts.length||a.newCumulative!==s.eth.paid||a.newCursor<=a.priorCursor)throw new Error('invalid payout range');const records=s.eth.payouts.slice(a.priorCursor),sum=records.reduce((n,r)=>n+r.amount,0n);if(a.paidAmount!==sum||a.newCumulative-a.priorCumulative!==sum||sum<=0n||sum>s.min.P||s.min.I+(s.min.P-sum)>a.vaultBalance)throw new Error('invalid payout amount');s.min.P-=sum;s.min.L=a.vaultBalance;s.min.payoutCursor=a.newCursor;s.min.acknowledgedPaid=a.newCumulative;s.min.clientVersion=a.ethVersion;s.min.controlVersion+=1;s.min.height+=1;for(const p of records){const r=s.min.redemptions.get(p.id);if(r)r.status='ACKED';}return;
  }
  throw new Error('unknown action');
}

export function apply(state,action){const next=clone(state);applyMutable(next,action);assertInvariants(next);return next;}
export function assertInvariants(s,options={}){
  const used=usedCapacity(s);if(used<0n||used>s.eth.fixedCapacity)throw new Error('capacity invariant');
  if(s.min.R<=0n||s.min.I<0n||s.min.P<0n||s.min.R+s.min.I!==s.min.F||s.min.I+s.min.P>s.min.L)throw new Error('Minima accounting invariant');
  if(s.min.payoutCursor<0||s.min.payoutCursor>s.eth.payouts.length||s.min.acknowledgedPaid<0n||s.min.acknowledgedPaid>s.eth.paid)throw new Error('payout cursor invariant');
  for(const [id,r] of s.eth.records){const n=status(s,id);if(r.status===REFUNDED&&n!==CANCELLED&&!options.finalityAssumptionBreached)throw new Error('refund without cancellation');if(n!==EMPTY&&n!==RELEASED&&n!==CANCELLED)throw new Error('nullifier status');}
  for(const n of s.min.nullifiers.values())if(n!==RELEASED&&n!==CANCELLED)throw new Error('nullifier status');
  return true;
}

export function sparseNullifierRoot(nullifiers){
  const empty=[H(Buffer.concat([Buffer.from([0]),Buffer.alloc(32),Buffer.from([0])]))];for(let d=0;d<256;d+=1)empty.push(H(Buffer.concat([Buffer.from([1]),empty[d],empty[d]])));
  let level=new Map();for(const [key,value] of nullifiers){if(value===EMPTY)continue;if(!/^[0-9a-f]{64}$/.test(key)||![RELEASED,CANCELLED].includes(value))throw new Error('invalid leaf');level.set(BigInt(`0x${key}`),H(Buffer.concat([Buffer.from([0]),Buffer.from(key,'hex'),Buffer.from([value])])));}
  for(let d=0;d<256;d+=1){const parents=new Map(),seen=new Set();for(const index of level.keys()){const parent=index>>1n;if(seen.has(parent))continue;seen.add(parent);const left=level.get(parent<<1n)??empty[d],right=level.get((parent<<1n)|1n)??empty[d];parents.set(parent,H(Buffer.concat([Buffer.from([1]),left,right])));}level=parents;}
  return (level.get(0n)??empty[256]).toString('hex');
}

function currentProof(s){return{ethVersion:s.eth.version,vaultBalance:s.eth.vaultBalance,payoutCursor:s.eth.payouts.length,cumulativePaid:s.eth.paid};}
function ackAction(s){const records=s.eth.payouts.slice(s.min.payoutCursor),sum=records.reduce((n,r)=>n+r.amount,0n);return{type:'PAYOUT_ACK',...currentProof(s),priorCursor:s.min.payoutCursor,newCursor:s.eth.payouts.length,priorCumulative:s.min.acknowledgedPaid,newCumulative:s.eth.paid,paidAmount:sum};}
function xorshift(seed){let x=BigInt(seed)||1n;return()=>{x^=x<<13n;x^=x>>7n;x^=x<<17n;x&=(1n<<64n)-1n;return Number(x%0x1_0000_0000n);};}

const assertions=[];function ok(name,v){if(!v)throw new Error(name);assertions.push(name);}function rejectedUnchanged(name,s,a){const before=stateDigest(s);let rejected=false;try{apply(s,a);}catch{rejected=true;}ok(name,rejected&&stateDigest(s)===before);}
let transitionCount=0,rejectedCount=0,crashRetryCount=0,fuzzSeeds=64,fuzzSteps=128;

{
  let s=initialState();const entries=[1,2,3].map(i=>({id:i.toString(16).padStart(64,'0'),amount:100n*BigInt(i)}));s=apply(s,{type:'DEPOSIT_BATCH',entries});ok('same-block deposit batch commits once',s.eth.version===1&&s.eth.records.size===3&&usedCapacity(s)===600n);s=apply(s,{type:'RELEASE',id:entries[2].id,amount:300n,...currentProof(s)});s=apply(s,{type:'RELEASE',id:entries[0].id,amount:100n,...currentProof(s)});ok('out-of-order independent deposits do not deadlock',status(s,entries[2].id)===RELEASED&&status(s,entries[0].id)===RELEASED);
  const coins=[4,5].map(i=>({id:i.toString(16).padStart(64,'0'),tokenId:TOKEN,amount:100n}));const ids=[];for(const coin of coins){const recipient='aa'.repeat(20);const id=redemptionId(coin,recipient);ids.push(id);s=apply(s,{type:'RETURN',coin,recipient,redemptionId:id});}s=apply(s,{type:'PAY_REDEMPTION_BATCH',ids,transfer:'success'});ok('same-block payout batch has one source block',new Set(s.eth.payouts.map(p=>p.block)).size===1&&s.eth.payouts.length===2);s=apply(s,ackAction(s));ok('cumulative batch acknowledgement consumes exact P',s.min.P===0n&&s.min.payoutCursor===2);
}

{
  let s=initialState(),id='0a'.padStart(64,'0');s=apply(s,{type:'DEPOSIT',id,amount:100n});const a={type:'CANCEL',id,authorizationValid:true,...currentProof(s)},candidate=apply(s,a);ok('crash before commit leaves predecessor unchanged',status(s,id)===EMPTY&&status(candidate,id)===CANCELLED);const retry=apply(s,a);ok('retry after discarded candidate is deterministic',stateDigest(candidate)===stateDigest(retry));rejectedUnchanged('retry after committed cancellation rejects unchanged',candidate,a);crashRetryCount+=3;
}

for(let seed=1;seed<=fuzzSeeds;seed+=1){let s=initialState(),rnd=xorshift(seed),nextId=1,nextCoin=1;for(let step=0;step<fuzzSteps;step+=1){const pending=[...s.eth.records].filter(([id,r])=>r.status===PENDING&&status(s,id)===EMPTY),cancelled=[...s.eth.records].filter(([id,r])=>r.status===PENDING&&status(s,id)===CANCELLED),returned=[...s.min.redemptions.values()].filter(r=>r.status==='RETURNED');const choices=['DEPOSIT','CLIENT'];if(pending.length)choices.push('RELEASE','CANCEL');if(cancelled.length)choices.push('REFUND');if(s.min.I>0n)choices.push('RETURN');if(returned.length)choices.push('PAY');if(s.eth.payouts.length>s.min.payoutCursor)choices.push('ACK');const choice=choices[rnd()%choices.length];let a;
    if(choice==='DEPOSIT'){const room=s.eth.fixedCapacity-usedCapacity(s),amount=room>0n?1n+BigInt(rnd()%Number(room>500n?500n:room)):0n;if(amount===0n)continue;a={type:'DEPOSIT',id:(nextId++).toString(16).padStart(64,'0'),amount};}
    else if(choice==='CLIENT'){if(s.eth.version<=s.min.clientVersion||s.eth.payouts.length!==s.min.payoutCursor)continue;a={type:'CLIENT_UPDATE',...currentProof(s)};}
    else if(choice==='RELEASE'){const [id,r]=pending[rnd()%pending.length];if(r.amount>=s.min.R)continue;a={type:'RELEASE',id,amount:r.amount,...currentProof(s)};}
    else if(choice==='CANCEL'){const [id]=pending[rnd()%pending.length];a={type:'CANCEL',id,authorizationValid:true,...currentProof(s)};}
    else if(choice==='REFUND'){const [id]=cancelled[rnd()%cancelled.length];a={type:'REFUND',id,settled:true,transfer:'success'};}
    else if(choice==='RETURN'){const amount=1n+BigInt(rnd()%Number(s.min.I>200n?200n:s.min.I)),coin={id:(10_000+nextCoin++).toString(16).padStart(64,'0'),tokenId:TOKEN,amount},recipient=(rnd().toString(16).padStart(8,'0')).repeat(5);a={type:'RETURN',coin,recipient,redemptionId:redemptionId(coin,recipient)};}
    else if(choice==='PAY'){a={type:'PAY_REDEMPTION',id:returned[rnd()%returned.length].id,transfer:'success'};}
    else a=ackAction(s);
    try{s=apply(s,a);transitionCount+=1;}catch{rejectedCount+=1;}
    if(step%7===0){const bad={type:'RELEASE',id:'ff'.repeat(32),amount:1n,...currentProof(s)};rejectedUnchanged(`fuzz rejected action seed ${seed} step ${step}`,s,bad);rejectedCount+=1;}
    assertInvariants(s);
  }
  ok(`fuzz seed ${seed} final invariant`,assertInvariants(s));
  ok(`fuzz seed ${seed} nullifier root deterministic`,sparseNullifierRoot(s.min.nullifiers)===sparseNullifierRoot(new Map([...s.min.nullifiers].reverse())));
}

const mutationChecks=[];function catches(name,mutate){let s=initialState();mutate(s);let caught=false;try{assertInvariants(s);}catch{caught=true;}ok(`deliberate mutation caught: ${name}`,caught);mutationChecks.push({name,caught});}
catches('capacity above fixed cap',s=>{s.eth.accepted=s.eth.fixedCapacity+1n;});
catches('negative used capacity',s=>{s.eth.refunded=1n;});
catches('zero reserve',s=>{s.min.R=0n;s.min.I=s.min.F;});
catches('R plus I drift',s=>{s.min.I=1n;});
catches('pending redemption exceeds collateral',s=>{s.min.P=s.min.L+1n;});
catches('payout cursor beyond source',s=>{s.min.payoutCursor=1;});
catches('acknowledged total beyond source',s=>{s.min.acknowledgedPaid=1n;});
catches('refund without cancellation',s=>{const id='01'.padStart(64,'0');s.eth.records.set(id,{status:REFUNDED,amount:1n});s.eth.accepted=1n;s.eth.refunded=1n;});
catches('unknown nullifier status',s=>{const id='01'.padStart(64,'0');s.min.nullifiers.set(id,9);});
{
  const a=new Map([['01'.padStart(64,'0'),RELEASED]]),b=new Map([['01'.padStart(64,'0'),CANCELLED]]);ok('tagged nullifier status changes sparse root',sparseNullifierRoot(a)!==sparseNullifierRoot(b));mutationChecks.push({name:'nullifier status tag',caught:true});
}

const result={schema:'usdtm-p3-reference-validation/v1',createdAtUtc:new Date().toISOString(),status:'passed',validator:basename(sourcePath),validatorSha256:hex(readFileSync(sourcePath)),assertionCount:assertions.length,fuzzSeeds,fuzzSteps,attemptedFuzzActions:fuzzSeeds*fuzzSteps,committedTransitions:transitionCount,rejectedActionsChecked:rejectedCount,crashRetryChecks:crashRetryCount,deliberateMutationCount:mutationChecks.length,mutationsDetected:mutationChecks.filter(x=>x.caught).length,nullifierAccumulator:'tagged sparse SHA2-256 tree, depth 256',limitations:['Chain-independent pure state model only; source proofs, signatures, EVM callbacks, KISS scripts, MMRs and consensus are modeled values, not runtime executions.','Fuzzing is deterministic and bounded, not a proof over all sequences.','The late-heavier-Minima-fork double-settlement risk remains the explicit P1 settlement-finality assumption and is outside one-history reference semantics.','No network, transaction, token, vault, funds or mainnet action occurred.']};
if(emitEvidence){const stamp=result.createdAtUtc.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),p=resolve(root,'evidence',`usdtm-p3-reference-validation-${stamp}.json`),s=`${JSON.stringify(result,null,2)}\n`;writeFileSync(p,s);const d=hex(s);writeFileSync(`${p}.sha256`,`${d}  ${basename(p)}\n`);result.evidencePath=p;result.evidenceSha256=d;}
console.log(JSON.stringify(result,null,2));
