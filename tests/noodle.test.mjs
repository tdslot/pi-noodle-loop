import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as mod from "../extensions/noodle.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const skillsDir = path.resolve(here, "../skills");

test("todos.md parse/add/markDone", () => {
  const a = mod.add("", "first");
  assert.equal(a.id, "1");
  const b = mod.add(a.md, "second  task plans/2-x/overview.md");
  assert.equal(b.id, "2");
  assert.match(b.md, /<!-- next-id: 3 -->/);
  const c = mod.markDone(b.md, "1");
  assert.deepEqual(mod.parse(c), [
    { id: "1", title: "first", done: true },
    { id: "2", title: "second task plans/2-x/overview.md", done: false, plan: "plans/2-x/overview.md" },
  ]);
  assert.equal(mod.markDone(c, "12"), c);
});

test('item IDs reject path traversal and avoid sanitized-name collisions', () => {
  for (const id of ['..', '.', '../x', 'a/b', 'a b', '-']) assert.throws(()=>mod.safeId(id),/Invalid item ID/);
  assert.equal(mod.safeId('ENG-123'), 'ENG-123');
});

test("adapter NDJSON contract", () => {
  assert.deepEqual(mod.parseNdjson('{"id":7,"title":"x","status":"done","tags":["a"]}\n\n{"id":"ENG-1","title":"y"}\n'), [
    { id: "7", title: "x", status: "done", tags: ["a"], done: true },
    { id: "ENG-1", title: "y", done: false },
  ]);
  assert.throws(() => mod.parseNdjson('{"id":1}'), /needs id and title/);
});

test("scheduleField, nextDirectives, verdict", () => {
  assert.equal(mod.scheduleField('---\nname: a\nschedule: "After execute"\n---\n'), "After execute");
  assert.equal(mod.scheduleField("---\nname: a\nschedule: >\n  When orders\n  are empty\ndescription: x\n---\n"), "When orders are empty");
  assert.equal(mod.scheduleField("---\nname: a\n---\n"), undefined);
  assert.deepEqual(mod.nextDirectives("t\nNEXT: noodle-execute #3\n`NEXT: noodle-plan ENG-12 @openai/gpt-5`"), [
    { skill: "noodle-execute", id: "3" },
    { skill: "noodle-plan", id: "ENG-12", model: "openai/gpt-5" },
  ]);
  assert.deepEqual(mod.nextDirectives("NEXT: idle"), []);
  assert.equal(mod.nextDirectives("nothing"), null);
  assert.equal(mod.verdict("## Verdict: PASS"), undefined);
  assert.equal(mod.verdict("NOODLE_VERDICT: CONTESTED\n...\nNOODLE_VERDICT: PASS"), "PASS");
  assert.equal(mod.verdict("no verdict"), undefined);
});

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noodle-"));
  const g = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"], ["nep.repo-kind", "personal"], ["core.hooksPath", "/dev/null"]]) g("config", k, v);
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  g("add", "-A");
  g("commit", "-qm", "init");
  return { root, g };
}

test("Repo worktree is idempotent; merge is safe", async () => {
  const { root, g } = gitRepo();
  const repo = new mod.Repo(root);
  fs.mkdirSync(path.join(repo.dir,'worktrees/invalid'),{recursive:true});
  await assert.rejects(repo.worktree('invalid','main'),/Refusing invalid worktree/);
  const wt = await repo.worktree("1", "main");
  assert.equal(wt.branch, "noodle/1");
  assert.deepEqual(await repo.worktree("1", "main"), wt);
  fs.writeFileSync(path.join(wt.path, "b.txt"), "b\n");
  execFileSync("git", ["-C", wt.path, "add", "-A"]);
  execFileSync("git", ["-C", wt.path, "commit", "-qm", "b"]);
  assert.equal(await repo.ahead("1", "main"), 1);
  fs.writeFileSync(path.join(root,'todos.md'),'local staged user text\n');
  g('add','todos.md');
  assert.match(await repo.merge('1','main'),/staged changes/);
  g('reset','--','todos.md');
  fs.unlinkSync(path.join(root,'todos.md'));

  // Conflict: main and branch both change a.txt.
  const wt2 = await repo.worktree("2", "main");
  fs.writeFileSync(path.join(wt2.path, "a.txt"), "branch\n");
  execFileSync("git", ["-C", wt2.path, "commit", "-qam", "x"]);
  fs.writeFileSync(path.join(root, "a.txt"), "main\n");
  assert.match(await repo.merge("1", "main"), /uncommitted changes/);
  g("commit", "-qam", "main change");

  assert.equal(await repo.merge("1", "main"), undefined);
  assert.equal(fs.existsSync(path.join(root, "b.txt")), true);
  assert.equal(await repo.hasBranch("1"), false);
  assert.match(await repo.merge("2", "main"), /merge conflict/);
  assert.equal(g("status", "--porcelain", "--untracked-files=no"), "");
  assert.match(await repo.merge("9", "main"), /no branch/);
});

/** Fake `pi` executable: scheduler answers from $FAKE_NEXT, stages commit in cwd and log args. */
function fakePi(dir) {
  const bin = path.join(dir, "fake-pi");
  fs.writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/calls.log"
last=""; for a in "$@"; do last="$a"; done
case "$last" in
  *"Noodle scheduler"*) n=$(cat "${dir}/count" 2>/dev/null || echo 0); echo $((n+1)) > "${dir}/count"
     sed -n "$((n+1))p" "${dir}/next" | tr '|' '\\n' ;;
  /skill:noodle-review*) sleep 0.2; echo "NOODLE_VERDICT: PASS" ;;
  /skill:noodle-execute*) touch "${dir}/running-$$"; sleep 0.3; [ "$(ls "${dir}" | grep -c running-)" -gt 1 ] && touch "${dir}/overlap"; sleep 0.2; rm "${dir}/running-$$"; echo "$last" > "work-$$.txt"; git add -A >/dev/null; git commit -qm "feat: work" >/dev/null; echo done ;;
  *) echo ok ;;
esac
`,
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function harness(root, extra = {}) {
  let cmd;
  const hooks = {};
  const sent = [];
  const notes = [];
  mod.default({ registerCommand: (n, c) => (cmd = c), on: (e, h) => (hooks[e] = h), sendUserMessage: (m, o) => sent.push([m, o]) });
  const skills = ["noodle-plan", "noodle-execute", "noodle-review"].map((name) => ({ name, filePath: path.join(skillsDir, name, "SKILL.md") }));
  const ctx = {
    cwd: root,
    hasUI: false,
    isIdle: () => true,
    ui: { notify: (m) => notes.push(m), confirm: async () => true, setStatus() {} },
    getSystemPromptOptions: () => ({ skills }),
    ...extra,
  };
  return { run: (a) => cmd.handler(a, ctx), settle: (aborted = false) => hooks.agent_settled({ aborted }, ctx), sent, notes };
}

test("manual commands create worktree and record history", async () => {
  const { root } = gitRepo();
  const h = harness(root);
  await h.run("add fix login");
  await h.run("status");
  assert.match(h.notes.at(-1), /#1 fix login/);
  await h.run("plan");
  assert.match(h.sent[0][0], /One plan at a time/);
  const mise = JSON.parse(fs.readFileSync(path.join(root, ".noodle/mise.json"), "utf8"));
  assert.deepEqual(mise.task_types.map((t) => t.skill), ["noodle-plan", "noodle-execute", "noodle-review"]);
  await h.run("review 1");
  assert.match(h.notes.at(-1), /No branch noodle\/1 to review/);
  await h.run("run 1");
  assert.match(h.sent[1][0], /^\/skill:noodle-execute Backlog item #1: fix login\nWorktree: .*\.noodle\/worktrees\/1 \(branch noodle\/1, base main\)/);
  assert.deepEqual(h.sent[1][1], { expandPromptTemplates: true });
  await h.run('merge #1');
  assert.match(h.notes.at(-1),/#1 is running/);
  await h.settle();
  assert.deepEqual(new mod.Repo(root).history().map((e) => [e.skill, e.id, e.ok]), [["noodle-execute", "1", true]]);
  await h.run("do bogus 1");
  assert.match(h.notes.at(-1), /Unknown skill: bogus/);
  await h.run("merge 1");
  assert.match(h.notes.at(-1), /no commits ahead/);
  const wt = path.join(root, ".noodle/worktrees/1");
  fs.writeFileSync(path.join(wt, "fix.txt"), "x\n");
  execFileSync("git", ["-C", wt, "add", "-A"]);
  execFileSync("git", ["-C", wt, "commit", "-qm", "fix"]);
  await h.run("merge #1");
  assert.match(h.notes.at(-1), /Merged noodle\/1/);
  assert.match(fs.readFileSync(path.join(root, "todos.md"), "utf8"), /1\. \[x\] fix login/);
});

test("loop: parallel stages, per-stage model routing, merge on PASS", async () => {
  const { root, g } = gitRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakepi-"));
  process.env.NOODLE_PI = fakePi(dir);
  fs.writeFileSync(
    path.join(dir, "next"),
    ["NEXT: noodle-execute 1|NEXT: noodle-execute 2 @fast/model", "NEXT: noodle-review 1|NEXT: noodle-review 2", "NEXT: noodle-review 2", "NEXT: idle", "NEXT: idle"].join("\n"),
  );
  fs.writeFileSync(path.join(root, ".noodle.json"), JSON.stringify({ routing: { default: "strong/model", "noodle-review": "review/model" } }));
  const h = harness(root);
  await h.run("add one");
  await h.run("add two");
  g("add", "todos.md", ".noodle.json");
  g("commit", "-qm", "backlog");
  await h.run("loop 6 --parallel 2 --auto --merge");

  const calls = fs.readFileSync(path.join(dir, "calls.log"), "utf8");
  assert.match(calls, /--model strong\/model .*\/skill:noodle-execute Backlog item #1/);
  assert.match(calls, /--model fast\/model .*\/skill:noodle-execute Backlog item #2/);
  assert.match(calls, /--model review\/model .*\/skill:noodle-review Backlog item #1/);
  const hist = new mod.Repo(root).history(20);
  const merges = hist.filter((e) => e.skill === "merge");
  assert.deepEqual(merges.map((e) => [e.id, e.ok]).sort(), [["1", true], ["2", true]]);
  // Both execute stages ran concurrently.
  assert.ok(fs.existsSync(path.join(dir, "overlap")), "execute stages did not overlap");
  assert.ok(["1", "2"].every((id) => hist.find((e) => e.skill === "noodle-execute" && e.id === id)?.ok));
  assert.match(fs.readFileSync(path.join(root, "todos.md"), "utf8"), /1\. \[x\] one[\s\S]*2\. \[x\] two/);
  assert.equal(g("branch", "--list", "noodle/*"), "");
  assert.match(h.notes.at(-1), /Noodle loop stopped: (backlog empty|nothing actionable)/);
  delete process.env.NOODLE_PI;
});

test("loop without --auto in print mode stops for confirmation", async () => {
  const { root } = gitRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakepi-"));
  process.env.NOODLE_PI = fakePi(dir);
  fs.writeFileSync(path.join(dir, "next"), "NEXT: noodle-execute 1\n");
  const h = harness(root);
  await h.run("add one");
  await h.run("loop 3");
  assert.match(h.notes.at(-1), /needs confirmation for noodle-execute #1/);
  delete process.env.NOODLE_PI;
});

test("init writes adapter scripts and config", async () => {
  const { root } = gitRepo();
  const h = harness(root);
  await h.run("init github");
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".noodle.json"), "utf8"));
  assert.equal(cfg.adapters.backlog.sync, "adapters/github/backlog-sync");
  assert.ok(fs.statSync(path.join(root, "adapters/github/backlog-sync")).mode & 0o100);
  // Adapter backlog: sync via a stub script.
  fs.writeFileSync(path.join(root, "adapters/github/backlog-sync"), '#!/bin/sh\necho \'{"id":"42","title":"from adapter"}\'\n');
  await h.run("status");
  assert.match(h.notes.at(-1), /#42 from adapter/);
});


test('aborting process waits for child close, not AbortError', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'noodle-abort-'));
  const marker = path.join(dir,'exited');
  const ctl = new AbortController();
  const child = mod.run(process.execPath,['-e',
    'process.on("SIGTERM",()=>setTimeout(()=>{require("fs").writeFileSync(process.argv[1],"done");process.exit(0)},150));console.log("ready");setInterval(()=>{},1000)',marker], {cwd:dir,signal:ctl.signal});
  await new Promise(r=>setTimeout(r,250));
  ctl.abort();
  await child;
  assert.ok(fs.existsSync(marker),'released worker before child exited');
});


test('loop refuses completed items and permits standalone skill stages', async () => {
 const {root}=gitRepo();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fakepi-'));
 process.env.NOODLE_PI=fakePi(dir);
 fs.writeFileSync(path.join(dir,'next'),'NEXT: noodle-execute 1\nNEXT: noodle-plan -\nNEXT: idle\n');
 const h=harness(root);
 await h.run('add completed');await h.run('add open');
 const file=path.join(root,'todos.md');fs.writeFileSync(file,mod.markDone(fs.readFileSync(file,'utf8'),'1'));
 try {
 await h.run('loop 3 --auto');
 const hist=new mod.Repo(root).history();
 assert.ok(hist.some(e=>e.id==='1' && e.ok===false && e.error==='unknown or completed item'));
 assert.ok(hist.some(e=>e.id==='-' && e.skill==='noodle-plan' && e.ok===true));
 assert.equal(await new mod.Repo(root).hasBranch('1'),false);
 } finally {delete process.env.NOODLE_PI;}
});
