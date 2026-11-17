import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Repo,acquireOwnership,planComplete,stagePrompt,run,scheduleField,modelIdentity,resolveModelIdentity} from '../extensions/noodle.ts';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'noodle-safety-'));
test('repository ownership excludes another operation and releases idempotently',()=>{
 const repo=new Repo(tmp());const release=acquireOwnership(repo);
 assert.throws(()=>acquireOwnership(repo),/owned/);release();release();acquireOwnership(repo)();
});
test('whole plan requires completion markers in every phase',()=>{
 const root=tmp(),dir=path.join(root,'plans/1-example');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'overview.md'),'Plan');
 fs.writeFileSync(path.join(dir,'phase-1.md'),'- [x] NOODLE_PHASE_COMPLETE\n');
 fs.writeFileSync(path.join(dir,'phase-2.md'),'- [ ] NOODLE_PHASE_COMPLETE\n');
 assert.equal(planComplete(root,'plans/1-example/overview.md'),false);
 fs.writeFileSync(path.join(dir,'phase-2.md'),'- [x] NOODLE_PHASE_COMPLETE\n');
 assert.equal(planComplete(root,'plans/1-example/overview.md'),true);
 assert.equal(planComplete(root,'../outside.md'),false);
 fs.writeFileSync(path.join(root,'single.md'),'- [x] NOODLE_PHASE_COMPLETE\n- [ ] NOODLE_PHASE_COMPLETE\n');
 assert.equal(planComplete(root,'single.md'),false);
});
test('worker receives complete ticket acceptance context',()=>{
 const s=stagePrompt('noodle-execute',{id:'1',title:'Fix',body:'Preserve signed URLs',priority:1,acceptance:['No data loss']},undefined,'adapter');
 assert.match(s,/Preserve signed URLs/);assert.match(s,/No data loss/);assert.match(s,/"priority": 1/);
});
test('timeout escalates for TERM-resistant process',async()=>{
 const t=Date.now();
 const r=await run(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{cwd:tmp(),timeoutMs:150});
 assert.notEqual(r.code,0);assert.ok(Date.now()-t<4000);
});

test('CRLF schedule metadata and review model identities',()=>{
 assert.equal(scheduleField('---\r\nname: x\r\nschedule: "After execute"\r\n---\r\n'),'After execute');
 assert.equal(modelIdentity('provider/model:high'),modelIdentity('provider/model:low'));
 const models=[{provider:'p',id:'model'},{provider:'q',id:'other'}];
 assert.equal(resolveModelIdentity('model:high',models),'p/model');
 assert.equal(resolveModelIdentity('p/model:low',models),'p/model');
 assert.throws(()=>resolveModelIdentity('mod',models),/unambiguous/);
 assert.throws(()=>resolveModelIdentity('model',[...models,{provider:'q',id:'model'}]),/unambiguous/);
 const literalSuffix=[{provider:'p',id:'foo'},{provider:'p',id:'foo:high'}];
 assert.equal(resolveModelIdentity('p/foo:high',literalSuffix),'p/foo:high');
 assert.equal(resolveModelIdentity('p/foo:high:high',literalSuffix),'p/foo:high');
 assert.equal(resolveModelIdentity('foo:high',literalSuffix),'p/foo:high');
});
