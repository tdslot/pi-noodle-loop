import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as mod from "../extensions/noodle.ts";

test("parse/add keep Noodle todos.md format", () => {
  const a = mod.add("", "first");
  assert.equal(a.id, 1);
  const b = mod.add(a.md.replace("1. [ ]", "1. [x]"), "second  task");
  assert.equal(b.id, 2);
  assert.match(b.md, /<!-- next-id: 3 -->/);
  assert.deepEqual(mod.parse(b.md), [
    { id: 1, done: true, text: "first" },
    { id: 2, done: false, text: "second task" },
  ]);
});

test("/noodle commands", async () => {
  let cmd;
  const sent = [];
  const notes = [];
  (mod.default ?? mod)({ registerCommand: (n, c) => (cmd = c), sendUserMessage: (m) => sent.push(m) });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "noodle-"));
  const ctx = { cwd, isIdle: () => true, ui: { notify: (m) => notes.push(m) } };
  await cmd.handler("add fix login", ctx);
  await cmd.handler("status", ctx);
  assert.match(notes.at(-1), /#1 fix login/);
  await cmd.handler("plan", ctx);
  await cmd.handler("run 1", ctx);
  await cmd.handler("run 9", ctx);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /noodle\/1/);
  assert.match(notes.at(-1), /No open item #9/);
});
