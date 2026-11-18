import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('Jira already terminal returns success without repeating transition',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jira-idempotent-'));
 fs.writeFileSync(path.join(dir,'curl'),'#!/bin/sh\ncase "$*" in *fields=status*) echo \'{"fields":{"status":{"name":"Done"}}}\';; *) exit 99;; esac\n');fs.chmodSync(path.join(dir,'curl'),0o755);
 const script=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../adapters/jira/backlog-done');
 const r=spawnSync('bash',[script,'TEST-1'],{env:{...process.env,PATH:`${dir}:${process.env.PATH}`,JIRA_URL:'https://invalid.example',JIRA_EMAIL:'test',JIRA_TOKEN:'test'}});
 assert.equal(r.status,0,r.stderr.toString());
});

test('Jira transition label cannot masquerade as configured target status',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jira-status-'));
 fs.writeFileSync(path.join(dir,'curl'),`#!/bin/sh
case "$*" in
 *fields=status*) echo '{"fields":{"status":{"name":"Open"}}}' ;;
 *transitions*) echo '{"transitions":[{"id":"1","name":"Resolve Issue","to":{"name":"Done"}}]}' ;;
 *) exit 99;;
esac
`);fs.chmodSync(path.join(dir,'curl'),0o755);
 const script=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../adapters/jira/backlog-done');
 const r=spawnSync('bash',[script,'TEST-1'],{env:{...process.env,PATH:`${dir}:${process.env.PATH}`,JIRA_URL:'https://invalid.example',JIRA_EMAIL:'test',JIRA_TOKEN:'test',NOODLE_JIRA_DONE:'Resolve Issue'}});
 assert.notEqual(r.status,0,'transition-name configuration must fail before side effect');
});
