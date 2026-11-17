import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import extension from '../extensions/noodle.ts';
test('nonzero scheduler exit never dispatches even valid NEXT output', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noodle-scheduler-'));
 execFileSync('git',['init','-q','-b','main'],{cwd:dir});
 const bin=path.join(dir,'fake-pi');
 fs.writeFileSync(bin,'#!/bin/sh\necho "NEXT: noodle-execute 1"\nexit 1\n');fs.chmodSync(bin,0o755);
 fs.writeFileSync(path.join(dir,'todos.md'),'1. [ ] test\n');
 let command;const notes=[];
 extension({registerCommand:(_,c)=>command=c,on:()=>{}});
 const old=process.env.NOODLE_PI;process.env.NOODLE_PI=bin;
 try {
 await command.handler('loop 1 --auto',{cwd:dir,hasUI:false,isIdle:()=>true,getSystemPromptOptions:()=>({skills:[]}),ui:{notify:m=>notes.push(m)}});
 assert.ok(notes.some(m=>m.includes('scheduler failed')));
 assert.equal(fs.existsSync(path.join(dir,'.noodle/worktrees/1')),false);
 } finally {if(old===undefined)delete process.env.NOODLE_PI;else process.env.NOODLE_PI=old;}
});
