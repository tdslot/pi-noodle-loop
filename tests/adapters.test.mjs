import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
test('sync adapters fail closed on HTTP/CLI failure, including piped commands', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'noodle-api-'));
  for (const name of ['curl','gh']) {
    fs.writeFileSync(path.join(bin,name), '#!/bin/sh\nexit 22\n');
    fs.chmodSync(path.join(bin,name),0o755);
  }
  for (const kind of ['github','jira','linear']) {
    const r = spawnSync('bash',[path.join(root,'adapters',kind,'backlog-sync')], {env:{...process.env,PATH:`${bin}:${process.env.PATH}`,JIRA_EMAIL:'test',JIRA_TOKEN:'test',JIRA_URL:'https://invalid.example',LINEAR_API_KEY:'test',NOODLE_LINEAR_TEAM:'TEST'}});
    assert.notEqual(r.status,0,`${kind} swallowed upstream failure`);
  }
});
test('Linear GraphQL HTTP 200 errors fail sync instead of returning empty backlog', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'noodle-gql-'));
  fs.writeFileSync(path.join(bin,'curl'),'#!/bin/sh\ncat >/dev/null\nprintf \'{"errors":[{"message":"denied"}]}\'\n');
  fs.chmodSync(path.join(bin,'curl'),0o755);
  const r = spawnSync('bash',[path.join(root,'adapters/linear/backlog-sync')], {env:{...process.env,PATH:`${bin}:${process.env.PATH}`,LINEAR_API_KEY:'test',NOODLE_LINEAR_TEAM:'TEST'}});
  assert.notEqual(r.status,0);
});
