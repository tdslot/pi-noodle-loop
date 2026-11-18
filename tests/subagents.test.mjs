import test from 'node:test';import assert from 'node:assert/strict';
import {subagentRpc,coordinatorTask} from '../extensions/subagents.ts';
function bus(){const handlers=new Map();return {on(n,f){handlers.set(n,f);return ()=>handlers.delete(n)},emit(n,v){handlers.get(n)?.(v)}};}
test('native subagents RPC forwards spawn and returns correlated reply',async()=>{
 const events=bus();events.on('subagents:rpc:v1:request',r=>{assert.equal(r.method,'spawn');assert.equal(r.params.agent,'noodle-loop');events.emit(`subagents:rpc:v1:reply:${r.requestId}`,{success:true,data:{text:'native run started'}})});
 assert.deepEqual(await subagentRpc({events},'spawn',{agent:'noodle-loop'}),{text:'native run started'});
});
test('native subagents errors fail closed, never fallback to standalone process',async()=>{
 const events=bus();events.on('subagents:rpc:v1:request',r=>events.emit(`subagents:rpc:v1:reply:${r.requestId}`,{success:false,error:{message:'launch denied'}}));
 await assert.rejects(subagentRpc({events},'spawn',{}),/launch denied/);
});
test('native coordinator forbids nested CLI and keeps merge explicit',()=>{
 const task=coordinatorTask('/pkg','/repo',3,2,false);
 assert.match(task,/native subagent calls/);assert.match(task,/no CLI fallback/);assert.match(task,/No merge or push is authorized/);
 assert.match(coordinatorTask('/pkg','/repo',3,1,true),/only after independent PASS/);
});
