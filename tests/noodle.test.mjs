import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as mod from "../extensions/noodle.ts";

test("parse/add keep Noodle todos.md format", () => {
  const a = mod.add("", "first");
  assert.equal(a.id, 1);
  const b = mod.add(a.md.replace("1. [ ]", "1. [x]"), "second  task plans/2-x/overview.md");
  assert.equal(b.id, 2);
  assert.match(b.md, /<!-- next-id: 3 -->/);
  assert.deepEqual(mod.parse(b.md), [
    { id: 1, done: true, text: "first" },
    { id: 2, done: false, text: "second task plans/2-x/overview.md", plan: "plans/2-x/overview.md" },
  ]);
});

test("scheduleField and nextDirective", () => {
  assert.equal(mod.scheduleField('---\nname: a\nschedule: "After execute"\n---\n'), "After execute");
  assert.equal(mod.scheduleField("---\nname: a\nschedule: >\n  When orders\n  are empty\ndescription: x\n---\n"), "When orders are empty");
  assert.equal(mod.scheduleField("---\nname: a\n---\n"), undefined);
  assert.deepEqual(mod.nextDirective("table\nNEXT: noodle-execute #3"), { skill: "noodle-execute", id: "3" });
  assert.deepEqual(mod.nextDirective("`NEXT: reflect -`"), { skill: "reflect", id: "-" });
  assert.equal(mod.nextDirective("x\nNEXT: idle"), "idle");
  assert.equal(mod.nextDirective("no directive"), null);
});

function harness() {
  let cmd;
  const hooks = {};
  const sent = [];
  const notes = [];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "noodle-"));
  let reply = "";
  const pi = {
    registerCommand: (n, c) => (cmd = c),
    on: (e, h) => (hooks[e] = h),
    sendUserMessage: (m, o) => sent.push([m, o]),
    exec: async () => ({ stdout: "", code: 0 }),
  };
  mod.default(pi);
  const skills = ["noodle-plan", "noodle-execute", "noodle-review"].map((name) => ({
    name,
    filePath: path.resolve(path.dirname(new URL(import.meta.url).pathname), `../skills/${name}/SKILL.md`),
  }));
  const ctx = {
    cwd,
    hasUI: false,
    isIdle: () => true,
    ui: { notify: (m) => notes.push(m), confirm: async () => true },
    getSystemPromptOptions: () => ({ skills }),
    sessionManager: {
      getSessionFile: () => undefined,
      getBranch: () => [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: reply }] } }],
    },
    newSession: async ({ withSession }) => withSession({ sendUserMessage: async (m, o) => sent.push([m, o]) }),
  };
  return { run: (a) => cmd.handler(a, ctx), settle: (r, aborted = false) => ((reply = r), hooks.agent_settled({ aborted }, ctx)), sent, notes, cwd };
}

test("/noodle commands", async () => {
  const h = harness();
  await h.run("add fix login");
  await h.run("status");
  assert.match(h.notes.at(-1), /#1 fix login/);
  await h.run("plan");
  const mise = JSON.parse(fs.readFileSync(path.join(h.cwd, ".noodle/mise.json"), "utf8"));
  assert.deepEqual(mise.task_types.map((t) => t.skill), ["noodle-plan", "noodle-execute", "noodle-review"]);
  assert.match(h.sent[0][0], /One plan at a time/);
  await h.run("plan 1");
  await h.run("run 1");
  await h.settle("done on branch noodle/1");
  const hist = fs.readFileSync(path.join(h.cwd, ".noodle/history.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(hist.map((e) => [e.skill, e.id]), [["noodle-execute", "1"]]);
  await h.run("do bogus 1");
  assert.match(h.notes.at(-1), /Unknown skill: bogus/);
  assert.deepEqual(h.sent.slice(1).map(([m, o]) => [m.split(" ")[0], o]), [
    ["/skill:noodle-plan", { expandPromptTemplates: true }],
    ["/skill:noodle-execute", { expandPromptTemplates: true }],
  ]);
});

test("/noodle loop drives schedule -> stage -> schedule and stops at limit", async () => {
  const h = harness();
  await h.run("add a");
  await h.run("loop 1 --auto");
  assert.match(h.sent.at(-1)[0], /Noodle scheduler/);
  await h.settle("| table |\nNEXT: noodle-execute 1");
  assert.deepEqual(h.sent.at(-1), ["/noodle do noodle-execute 1", { expandPromptTemplates: true }]);
  await h.run("do noodle-execute 1");
  await h.settle("implemented");
  assert.match(h.notes.at(-1), /stage limit reached/);
  assert.equal(fs.existsSync(path.join(h.cwd, ".noodle/loop.json")), false);

  await h.run("loop 3");
  await h.settle("NEXT: idle");
  assert.match(h.notes.at(-1), /nothing actionable/);
  await h.run("loop 3");
  await h.settle("NEXT: noodle-execute 1");
  assert.match(h.notes.at(-1), /needs confirmation/);
});
