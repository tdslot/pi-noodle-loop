import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import extension,{Repo,Backlog,loadConfig} from '../extensions/noodle.ts';
import {Journal} from '../extensions/state.ts';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'noodle-recovery-'));
test('journal persists attempt evidence and marks lost running attempts interrupted',()=>{
 const dir=tmp(),j=new Journal(dir);
 const id=j.start({item:'1',skill:'noodle-execute',before:'abc',log:'x',modelIdentity:'p/m'});
 const done=j.start({item:'2',skill:'noodle-execute',before:'a',log:'y'});
 j.finish(done,{status:'succeeded',after:'b'});
 new Journal(dir).interrupt();
 const s=new Journal(dir).read();
 assert.equal(s.attempts.find(a=>a.id===id).status,'interrupted');
 assert.equal(s.attempts.find(a=>a.id===done).status,'succeeded');
 assert.equal(s.attempts.find(a=>a.id===done).after,'b');
 new Journal(dir).acknowledge(id);
 assert.equal(new Journal(dir).read().attempts.find(a=>a.id===id).status,'failed');
});
test('corrupt journal fails closed rather than resetting work',()=>{
 const dir=tmp();fs.writeFileSync(path.join(dir,'state.json'),'{bad');
 assert.throws(()=>new Journal(dir).read());
});
test('recovery retries backlog closure only after confirmed merge ancestry',async()=>{
 const root=tmp();const g=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
 g('init','-q','-b','main');
 for(const [k,v] of [['user.name','Test'],['user.email','test@example.invalid'],['commit.gpgsign','false'],['core.hooksPath','/dev/null']])g('config',k,v);
 fs.writeFileSync(path.join(root,'a'),'base');g('add','a');g('commit','-qm','base');
 const repo=new Repo(root),j=new Journal(repo.dir),head=g('rev-parse','HEAD');
 
 const done=path.join(root,'done.sh');fs.writeFileSync(done,'#!/bin/sh\n[ ! -e fail ] || exit 1\necho "$1" >> closures\n');
 fs.writeFileSync(path.join(root,'.noodle.json'),JSON.stringify({backlogIdentity:'fixture-backend',adapters:{backlog:{sync:'echo \'{"id":"42","title":"test"}\'',done:'sh done.sh'}}}));
 const destination=new Backlog(root,loadConfig(root)).identity;
 j.merge({item:'42',base:'main',head,destination,status:'prepared'});
 let cmd;const notes=[];extension({on(){},registerCommand(n,c){cmd=c;}});
 const ctx={cwd:root,ui:{notify:m=>notes.push(m)}};
 await cmd.handler('recover',ctx);
 assert.equal(j.read().merges['42'].status,'done');
 assert.equal(fs.readFileSync(path.join(root,'closures'),'utf8'),'42\n');
 await cmd.handler('recover',ctx);
 assert.equal(fs.readFileSync(path.join(root,'closures'),'utf8'),'42\n','already reconciled closure was repeated');
 // Failed remote completion stays pending and is retried, without any branch or worker.
 j.merge({item:'43',base:'main',head,destination,status:'backlog-pending'});
 fs.writeFileSync(path.join(root,'fail'),'1');
 await cmd.handler('recover',ctx);
 assert.equal(j.read().merges['43'].status,'backlog-pending');
 fs.unlinkSync(path.join(root,'fail'));
 await cmd.handler('recover',ctx);
 assert.equal(j.read().merges['43'].status,'done');
 assert.equal(g('branch','--list','noodle/*'),'');
 j.merge({item:'44',base:'main',head,destination:'different-backend',status:'backlog-pending'});
 await cmd.handler('recover',ctx);
 assert.equal(j.read().merges['44'].status,'backlog-pending');
 assert.ok(notes.at(-1).includes('destination changed'));
 assert.equal(fs.readFileSync(path.join(root,'closures'),'utf8'),'42\n43\n');
});
