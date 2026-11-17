import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
test('Linear add attaches configured sync label so new issue stays discoverable',()=>{
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'noodle-linear-'));
 const payload=path.join(bin,'payload');
 fs.writeFileSync(path.join(bin,'curl'),`#!/usr/bin/env bash
body=$(cat)
case "$body" in
 *'teams(filter'*) echo '{"data":{"teams":{"nodes":[{"id":"team-id"}]}}}' ;;
 *'issueLabels(filter'*) echo '{"data":{"issueLabels":{"nodes":[{"id":"label-id"}]}}}' ;;
 *) printf '%s' "$body" > '${payload}'; echo '{"data":{"issueCreate":{"issue":{"identifier":"TEST-1"}}}}' ;;
esac
`);fs.chmodSync(path.join(bin,'curl'),0o755);
 const r=spawnSync('bash',[path.join(root,'adapters/linear/backlog-add')],{input:'{"title":"test"}',encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,LINEAR_API_KEY:'test',NOODLE_LINEAR_TEAM:'TEST'}});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'TEST-1');
 assert.deepEqual(JSON.parse(fs.readFileSync(payload,'utf8')).variables.i.labelIds,['label-id']);
});
