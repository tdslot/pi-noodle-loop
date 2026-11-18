import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import extension from '../extensions/noodle.ts';
function fixture(git=true,early=false){const root=fs.mkdtempSync(path.join(os.tmpdir(),'noodle-preflight-'));if(git)execFileSync('git',['init','-q','-b','main'],{cwd:root});let cmd;const notes=[],events=[];
 const handlers=new Map();const bus={on:(n,h)=>{handlers.set(n,h);return()=>handlers.delete(n)},emit:(n,v)=>{events.push(n);if(n==='pi-subagents:runtime-agent-register:v1')v.result={ok:true,registration:{dispose(){}}};if(n==='subagents:rpc:v1:request'){if(early)handlers.get('subagent:process-terminal')?.({version:1,runId:'test-run',state:'observed',observedAt:Date.now(),instances:[{}]});handlers.get(`subagents:rpc:v1:reply:${v.requestId}`)?.({success:true,data:{text:'started',details:{runId:'test-run'}}})}}};
 extension({on(){},sendMessage(){},registerCommand:(n,c)=>cmd=c,events:bus});
 const ctx={cwd:root,ui:{notify:m=>notes.push(m)},modelRegistry:{getAvailable:()=>[{provider:'p',id:'execute'},{provider:'p',id:'review'}]}};
 return{root,ctx,notes,events,run:()=>cmd.handler('bg 2',ctx)};}
test('home-like non-Git launch rejects without creating files or native agent',async()=>{const f=fixture(false);await f.run();assert.match(f.notes.at(-1),/Not a Git repository/);assert.deepEqual(f.events,[]);assert.deepEqual(fs.readdirSync(f.root),[])});
test('missing backlog, empty backlog and missing routing reject before registration',async()=>{const f=fixture();await f.run();assert.match(f.notes.at(-1),/Backlog missing/);fs.writeFileSync(path.join(f.root,'todos.md'),'1. [x] done\n');await f.run();assert.match(f.notes.at(-1),/No open/);fs.writeFileSync(path.join(f.root,'todos.md'),'1. [ ] task\n');await f.run();assert.match(f.notes.at(-1),/Configure routing/);assert.deepEqual(f.events,[]);assert.equal(fs.existsSync(path.join(f.root,'.noodle')),false)});
test('subdirectory launch is rejected without redirecting or spawning',async()=>{const f=fixture();const sub=path.join(f.root,'src');fs.mkdirSync(sub);f.ctx.cwd=sub;await f.run();assert.match(f.notes.at(-1),/repository root/);assert.deepEqual(f.events,[]);assert.deepEqual(fs.readdirSync(sub),[])});
test('same model or unavailable model reject; valid distinct models launch native agent',async()=>{const f=fixture();fs.writeFileSync(path.join(f.root,'todos.md'),'1. [ ] task\n');const config=path.join(f.root,'.noodle.json');
 fs.writeFileSync(config,JSON.stringify({routing:{default:'p/execute','noodle-review':'execute:high'}}));await f.run();assert.match(f.notes.at(-1),/different model/);
 fs.writeFileSync(config,JSON.stringify({routing:{default:'p/execute','noodle-review':'missing'}}));await f.run();assert.match(f.notes.at(-1),/unambiguous/);assert.deepEqual(f.events,[]);
 fs.writeFileSync(config,JSON.stringify({routing:{default:'p/execute','noodle-review':'p/review'}}));execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','fixture'],{cwd:f.root});await f.run();assert.equal(f.notes.at(-1),'started');assert.ok(f.events.includes('subagents:rpc:v1:request'));});

test('early coordinator terminal proof is consumed after spawn reply but never unlocks descendants',async()=>{
 const f=fixture(true,true);
 fs.writeFileSync(path.join(f.root,'todos.md'),'1. [ ] task\n');
 fs.writeFileSync(path.join(f.root,'.noodle.json'),JSON.stringify({routing:{default:'p/execute','noodle-review':'p/review'}}));
 execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','fixture'],{cwd:f.root});
 await f.run();
 for(let i=0;i<100;i++){const lease=JSON.parse(fs.readFileSync(path.join(f.root,'.noodle/owner.lock/native.json'),'utf8'));if(lease.status==='terminal')break;await new Promise(r=>setTimeout(r,10));}
 const lease=JSON.parse(fs.readFileSync(path.join(f.root,'.noodle/owner.lock/native.json'),'utf8'));
 assert.equal(lease.status,'terminal');assert.equal(lease.runId,'test-run');
 assert.ok(fs.existsSync(path.join(f.root,'.noodle/owner.lock')),'coordinator proof must not release descendant ownership');
 assert.ok(fs.readdirSync(path.join(f.root,'.noodle')).some(f=>f.startsWith('native-result-')));
});
