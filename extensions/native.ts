import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';

export type NativeLease={version:1;token:string;sessionId:string;requestId:string;runId?:string;started:string;status:'launching'|'running'|'uncertain'|'terminal';base:string;baseHead:string;items:string[]};
const git=(root:string,args:string[])=>new Promise<string>((resolve,reject)=>execFile('git',args,{cwd:root,maxBuffer:1024*1024},(err,out)=>err?reject(err):resolve(out.trim())));
export class NativeOwnership {
 readonly root:string;readonly lock:string;
 constructor(root:string){this.root=root;this.lock=path.join(root,'.noodle/owner.lock');}
 async acquire(sessionId:string,items:string[],requestId:string):Promise<NativeLease>{
  const base=await git(this.root,['symbolic-ref','--short','HEAD']);
  const baseHead=await git(this.root,['rev-parse','HEAD']);
  fs.mkdirSync(path.dirname(this.lock),{recursive:true});
  try{fs.mkdirSync(this.lock);}catch{throw new Error('Repository already owned by a Noodle operation; inspect native status before retrying.');}
  const lease:NativeLease={version:1,token:randomUUID(),sessionId,requestId,started:new Date().toISOString(),status:'launching',base,baseHead,items};
  try{fs.writeFileSync(path.join(this.lock,'owner.json'),JSON.stringify({pid:process.pid,...lease}),{mode:0o600});this.save(lease);}catch(e){fs.rmSync(this.lock,{recursive:true});throw e;}
  return lease;
 }
 read():NativeLease|undefined{
  const f=path.join(this.lock,'native.json');if(!fs.existsSync(f))return undefined;
  const l=JSON.parse(fs.readFileSync(f,'utf8'));if(l.version!==1||typeof l.token!=='string'||!Array.isArray(l.items))throw new Error('Invalid native ownership record; preserve for inspection.');return l;
 }
 save(l:NativeLease){
  const file=path.join(this.lock,'native.json');const tmp=file+'.'+randomUUID();
  fs.writeFileSync(tmp,JSON.stringify(l,null,2),{mode:0o600});fs.renameSync(tmp,file);
 }
 release(l:NativeLease){if(this.read()?.token!==l.token)throw new Error('Native ownership token mismatch');fs.rmSync(this.lock,{recursive:true});}
}
/** Release proof for a top-level native workflow: dispatch closed AND every roster child has observed process-terminal proof. */
export function workflowTerminalObserved(proof:any,runId:string,expectedChildren:number):boolean{
 return proof?.version===1&&proof.kind==='workflow'&&proof.runId===runId&&proof.state==='observed'&&proof.dispatchClosed===true&&typeof proof.observedAt==='number'
  &&Array.isArray(proof.children)&&proof.children.length===expectedChildren&&proof.children.length>0&&proof.children.every((c:any)=>typeof c?.runId==='string'&&c.runId!==runId&&observedTerminal(c,c.runId))&&new Set(proof.children.map((c:any)=>c.runId)).size===proof.children.length;
}
export function proofMatchesRun(proof:any,expectedRunId:string):boolean {
 return typeof expectedRunId==='string'&&proof?.runId===expectedRunId;
}
/** Only exact native observed proof; completion prose/status alone is insufficient. */
export function observedTerminal(value:any,runId:string):boolean{return value?.version===1&&value.runId===runId&&value.state==='observed'&&typeof value.observedAt==='number'&&Array.isArray(value.instances)&&value.instances.length>0;}
export async function verifyNativeResult(root:string,lease:NativeLease):Promise<{ok:boolean;lines:string[]}>{
 const lines:string[]=[];let ok=true;
 const baseHead=await git(root,['rev-parse',lease.base]);
 if(baseHead!==lease.baseHead){ok=false;lines.push('Integration branch changed during native work; merge/verification requires inspection.');}
 const allowed=new Set(lease.items.map(id=>`noodle/${id}`));
 const branches=(await git(root,['for-each-ref','--format=%(refname:short)','refs/heads/noodle/'])).split('\n').filter(Boolean);
 for(const b of branches){
  if(!allowed.has(b)){ok=false;lines.push(`Unexpected item branch: ${b}`);continue;}
  const head=await git(root,['rev-parse',b]);
  const count=await git(root,['rev-list','--count',`${lease.baseHead}..${b}`]);
  if(Number(count)===0){ok=false;lines.push(`${b}: no implementation commits ahead of launch base`);}
  lines.push(`${b}: ${head}, ${count} commit(s) ahead of launch base`);
 }
 const porcelain=await git(root,['worktree','list','--porcelain']);
 for(const block of porcelain.split('\n\n')){
  const worktree=/^worktree (.+)$/m.exec(block)?.[1];const branch=/^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
  if(worktree&&branch&&allowed.has(branch)){
   const dirty=await git(worktree,['status','--porcelain']);
   if(dirty){ok=false;lines.push(`${branch}: uncommitted changes remain`);}
  }
 }
 for(const id of lease.items)if(!branches.includes(`noodle/${id}`)){ok=false;lines.push(`noodle/${id}: no branch; item outcome not verified`);}
 lines.push('Git evidence only: test results and independent review verdict are not structurally attested by this check. No merge authorization is issued.');
 return{ok,lines};
}
