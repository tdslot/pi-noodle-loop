import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {NativeOwnership,observedTerminal,verifyNativeResult} from '../extensions/native.ts';
function fixture(){const r=fs.mkdtempSync(path.join(os.tmpdir(),'native-lease-'));const g=(...a)=>execFileSync('git',a,{cwd:r,encoding:'utf8'}).trim();g('init','-q','-b','main');for(const[k,v]of[['user.name','Test'],['user.email','test@example.invalid'],['commit.gpgsign','false'],['core.hooksPath','/dev/null']])g('config',k,v);g('commit','--allow-empty','-qm','base');return{r,g};}
test('native repository lease survives owner instance loss and excludes second session',async()=>{const{r}=fixture();const a=new NativeOwnership(r);const lease=await a.acquire('s1',['1'],'request');await assert.rejects(new NativeOwnership(r).acquire('s2',['1'],'other'),/already owned/);assert.equal(new NativeOwnership(r).read().token,lease.token);assert.throws(()=>a.release({...lease,token:'wrong'}),/mismatch/);a.release(lease);await new NativeOwnership(r).acquire('s2',['1'],'new');});
test('completion and unknown process proof never unlock native ownership',()=>{assert.equal(observedTerminal({runId:'x',status:'completed'},'x'),false);assert.equal(observedTerminal({version:1,runId:'x',state:'unknown'},'x'),false);assert.equal(observedTerminal({version:1,runId:'other',state:'observed',observedAt:1,instances:[{}]},'x'),false);assert.equal(observedTerminal({version:1,runId:'x',state:'observed',observedAt:1,instances:[{}]},'x'),true)});
test('native Git validation identifies changed base and unauthorized branches',async()=>{const{r,g}=fixture();const owner=new NativeOwnership(r);const lease=await owner.acquire('s',['1'],'req');g('branch','noodle/other');const result=await verifyNativeResult(r,lease);assert.equal(result.ok,false);assert.ok(result.lines.some(s=>s.includes('Unexpected')));g('commit','--allow-empty','-qm','changed');assert.ok((await verifyNativeResult(r,lease)).lines.some(s=>s.includes('Integration branch changed')));});

test('verifyNativeResult requires a branch for every authorized item',async()=>{
 const {verifyNativeResult}=await import('../extensions/native.ts');
 const {execFileSync:x}=await import('node:child_process');const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'nv-'));const g=(...a)=>x('git',['-c','core.hooksPath=/dev/null','-c','user.name=T','-c','user.email=t@e.invalid','-c','commit.gpgsign=false',...a],{cwd:d,encoding:'utf8'}).trim();
 g('init','-q','-b','main');g('commit','--allow-empty','-qm','b');const base=g('rev-parse','HEAD');
 g('checkout','-q','-b','noodle/1');g('commit','--allow-empty','-qm','one');g('checkout','-q','main');
 const lease=items=>({version:1,token:'t',sessionId:'s',requestId:'r',started:'',status:'running',base:'main',baseHead:base,items});
 assert.equal((await verifyNativeResult(d,lease(['1']))).ok,true);
 const r=await verifyNativeResult(d,lease(['1','2']));assert.equal(r.ok,false);assert.ok(r.lines.some(l=>l.includes('noodle/2: no branch')));
 g('checkout','-q','-b','noodle/2');g('commit','--allow-empty','-qm','two');g('checkout','-q','main');
 assert.equal((await verifyNativeResult(d,lease(['1','2']))).ok,true);
});
