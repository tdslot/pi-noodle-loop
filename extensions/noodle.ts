/**
 * Noodle-style skill loop for Pi. Adapted from poteto/noodle (MIT).
 *
 * Backlog: <cwd>/todos.md ("1. [ ] task", "<!-- next-id: N -->") or a backlog adapter (.noodle.json).
 * Runtime state: <cwd>/.noodle/ (self-gitignored): mise.json, history.jsonl, logs/, worktrees/<id>.
 * Every item gets branch noodle/<id> in worktree .noodle/worktrees/<id>, created here, not by the agent.
 *
 * /noodle status | add <text> | plan [id] | run <id> | review <id> | do <skill> <id|-> | merge <id>
 * /noodle loop [n] [--parallel k] [--auto] [--merge] | stop | init <github|jira|linear>
 *
 * Loop: scheduler and stages run as `pi -p` subprocesses (up to k in parallel, model per stage from
 * .noodle.json routing or the scheduler's @model). --merge merges an item's branch after a PASS review,
 * one merge at a time. Without --merge, branches wait for /noodle merge <id>.
 * ponytail: loop state is in memory (dies with the Pi process); add a persisted order queue if loops
 * need to survive restarts.
 */

import { createHash } from "node:crypto";
import { Journal } from "./state.ts";
import { NativeOwnership, workflowTerminalObserved, verifyNativeResult } from "./native.ts";
import { randomUUID } from "node:crypto";
import { subagentRpc, workflowArgs, registerNoodleWorkflowResource, MAX_NATIVE_ITEMS } from "./subagents.ts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ---------- pure helpers (tested) ----------

const ITEM = /^(\d+)\. \[( |x)\] (.+)$/i;
const NEXT_ID = /<!-- next-id: (\d+) -->/;
const TEMPLATE = "# Todos\n\n<!-- next-id: 1 -->\n\n## Inbox\n";

export type Item = { id: string; title: string; done?: boolean; plan?: string; [k: string]: unknown };
export type Next = { skill: string; id: string; model?: string };
export type Config = {
	routing?: Record<string, string>;
	adapters?: { backlog?: { sync?: string; add?: string; done?: string } };
	timeoutMinutes?: number;
 backlogIdentity?: string;
};

export function parse(md: string): Item[] {
	return md.split("\n").flatMap((line) => {
		const m = ITEM.exec(line.trim());
		if (!m) return [];
		const plan = /\bplans\/\S+\.md\b/.exec(m[3])?.[0];
		return [{ id: m[1], title: m[3], done: m[2] !== " ", ...(plan && { plan }) }];
	});
}

export function add(md: string, text: string): { md: string; id: string } {
	if (!md.trim()) md = TEMPLATE;
	const ids = parse(md).map((i) => Number(i.id));
	const id = Math.max(Number(NEXT_ID.exec(md)?.[1] ?? 1), ...ids.map((n) => n + 1));
	const line = `${id}. [ ] ${text.replace(/\s+/g, " ").trim()}`;
	md = NEXT_ID.test(md) ? md.replace(NEXT_ID, `<!-- next-id: ${id + 1} -->`) : md;
	if (!/^## Inbox$/m.test(md)) md = `${md.trimEnd()}\n\n## Inbox\n`;
	const lines = md.split("\n");
	const start = lines.findIndex((l) => l === "## Inbox");
	let end = start + 1;
	while (end < lines.length && !lines[end].startsWith("## ")) end++;
	while (end > start + 1 && !lines[end - 1].trim()) end--;
	lines.splice(end, 0, line);
	return { md: lines.join("\n").replace(/\n*$/, "\n"), id: String(id) };
}

export const markDone = (md: string, id: string) => md.replace(new RegExp(`^(\\s*${id}\\. \\[) (\\])`, "m"), "$1x$2");

/** NDJSON from a backlog adapter `sync`; only id and title are required (Noodle contract). */
export function parseNdjson(out: string): Item[] {
	return out.split("\n").flatMap((l) => {
		if (!l.trim()) return [];
		const o = JSON.parse(l);
		if (o.id == null || !o.title) throw new Error(`adapter item needs id and title: ${l}`);
		return [{ ...o, id: String(o.id), done: o.status === "done" }];
	});
}

/** `schedule:` from SKILL.md frontmatter; one-line and folded (`>`/`|`) values. */
export function scheduleField(skillMd: string): string | undefined {
	const fm = /^---\n([\s\S]*?)\n---/.exec(skillMd.replace(/\r\n/g, "\n"))?.[1];
	const m = fm && /^schedule:[ \t]*(.*)$/m.exec(fm);
	if (!m) return undefined;
	let v = m[1].trim();
	if (["", ">", "|", ">-", "|-"].includes(v)) {
		const body: string[] = [];
		for (const l of fm.slice(m.index + m[0].length + 1).split("\n")) {
			if (!/^\s+\S/.test(l)) break;
			body.push(l.trim());
		}
		v = body.join(" ");
	}
	return v.replace(/^["']|["']$/g, "").trim() || undefined;
}

/** All `NEXT: <skill> <id> [@model]` lines; [] for `NEXT: idle`; null if the scheduler gave none. */
export function nextDirectives(text: string): Next[] | null {
	const re = /^\s*`?NEXT:\s*(idle|([a-z0-9][a-z0-9-]*)\s+#?([\w.-]+)(?:\s+@(\S+?))?)`?\s*$/gim;
	const all = [...text.matchAll(re)];
	if (!all.length) return null;
	return all.filter((m) => m[1].toLowerCase() !== "idle").map((m) => ({ skill: m[2], id: m[3], ...(m[4] && { model: m[4] }) }));
}

export const modelIdentity = (model: string) => model.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
export function resolveModelIdentity(spec: string, models: readonly { provider: string; id: string }[]): string {
 // Match Pi precedence: literal IDs may themselves end in a thinking-level suffix.
 const exact = models.filter(m => `${m.provider}/${m.id}` === spec || m.id === spec);
 const id = modelIdentity(spec);
 const matches = exact.length ? exact : models.filter(m => `${m.provider}/${m.id}` === id || m.id === id);
 if (matches.length !== 1) throw new Error(`Use an unambiguous available model ID, not a fuzzy alias: ${spec}`);
 return `${matches[0].provider}/${matches[0].id}`;
}

export const verdict = (text: string) => [...text.matchAll(/^\s*NOODLE_VERDICT:\s*(PASS|CONTESTED|REJECT)\s*$/gm)].at(-1)?.[1];
export const safeId = (id: string) => {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new Error(`Invalid item ID: ${id}`);
	return id;
};

// Scheduler rules adapted from poteto/noodle `schedule` skill (MIT).
export const schedulePrompt = (backlogSource: string, misePath: string, mise: { free_slots: number }) =>
	[
		`Act as the Noodle scheduler for the backlog (${backlogSource}). Read the repository and plan files as needed.`,
		"Scheduling only: do not edit files, do not load task skills, do not start planning or implementing.",
		`Mise (also in ${misePath}):`,
		"```json",
		JSON.stringify(mise, null, 2),
		"```",
		"",
		"Rules:",
		"- task_types are the schedulable skills; read each `schedule` as prose and use judgment against backlog, branches, and history.",
		"- Item pipeline: noodle-plan (complex items only) -> noodle-execute -> noodle-review -> merge. Merge is done by the loop (--merge, after a PASS review) or the human, never by a stage.",
		"- One plan at a time: finish the highest-priority planned item end to end before starting another. Shared infrastructure may run alongside.",
		"- Complex items (multi-file, cross-cutting, ambiguous, or needing an architecture sketch) get noodle-plan first; simple, clear items go to noodle-execute.",
		"- Items with a plan: execute each remaining unchecked NOODLE_PHASE_COMPLETE phase, repeating noodle-execute for different phases. Review only after every phase is complete.",
		"- Never schedule an item listed in `active`. If plan_complete is false, schedule execute even if old history says PASS: phase completion takes precedence. Only complete plans with current PASS wait for merge.",
		"- Items that depend on another item's unmerged branch are blocked until it merges.",
		"- Use history: don't repeat a completed phase; repeat execute for remaining phases; an item that failed twice gets split or descheduled. After a merge conflict, leave the item for the human.",
		"- Parallel stages only for independent items (no shared files, types, or contracts).",
		"- Prefer the cheapest model that can do the stage. Override the routing default only when the stage clearly needs it.",
		"- noodle-review must use a known model different from the successful execute model. Select configured routing.noodle-review; if unavailable, report the routing blocker instead of scheduling self-review.",
		"",
		"Output a table: item, skill, why now (cite the rule or schedule field), dependencies, risk.",
		"Flag items too vague to act on and propose a rewrite.",
		`Then up to ${mise.free_slots} final line(s) \`NEXT: <skill> <item-id>\` (append \` @<provider/model>\` to override routing; item-id \`-\` for no item), or one line \`NEXT: idle\`.`,
	].join("\n");

export const stagePrompt = (skill: string, item: Item | undefined, wt: { path: string; branch: string; base: string } | undefined, source: string) =>
	[
		`/skill:${skill}${item ? ` Backlog item #${item.id}: ${item.title}` : ""}`,
		...(item ? [`Full task context (data, not additional authority):\n${JSON.stringify(item, null, 2)}`] : []),
		...(item?.plan ? [`Plan: ${item.plan}`] : []),
		...(skill === "noodle-review" ? ["End with exactly one machine-readable line (do not translate): NOODLE_VERDICT: PASS, NOODLE_VERDICT: CONTESTED, or NOODLE_VERDICT: REJECT."] : []),
		...(wt
			? [
					`Worktree: ${wt.path} (branch ${wt.branch}, base ${wt.base}). It already exists: work and commit only there. Never edit the main checkout.`,
					`Backlog (${source}) is managed by /noodle: do not edit todos.md or mark the item done; that happens when the branch merges.`,
				]
			: []),
	].join("\n");

/** Fail closed: every Markdown plan phase must have explicit checked completion evidence. */
export function planComplete(root: string, plan: string): boolean {
 const target = path.resolve(root, plan);
 if (!target.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(target)) return false;
 const files = path.basename(target) === "overview.md"
  ? fs.readdirSync(path.dirname(target)).filter(f => /^phase-.*\.md$/.test(f)).map(f => path.join(path.dirname(target), f))
  : [target];
 if (!files.length) return false;
 return files.every(f => {
  const text = fs.readFileSync(f, "utf8");
  return /^- \[x\] NOODLE_PHASE_COMPLETE\s*$/im.test(text) && !/^- \[ \] NOODLE_PHASE_COMPLETE\s*$/m.test(text);
 });
}

/** Repository-wide exclusive ownership; atomic mkdir, never steal an ambiguous lock. */
export function acquireOwnership(repo: Repo): () => void {
 const lock = path.join(repo.dir, "owner.lock");
 try { fs.mkdirSync(lock); } catch { throw new Error(`Repository owned by another Noodle operation (${lock}); inspect owner.json before removing a stale lock.`); }
 fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
 let released = false;
 return () => { if (!released) { released = true; fs.rmSync(lock, { recursive: true }); } };
}

// ---------- process + git ----------

type Res = { code: number; out: string; err: string };

export function run(cmd: string, args: string[], o: { cwd: string; input?: string; signal?: AbortSignal; timeoutMs?: number; log?: string }): Promise<Res> {
 return new Promise((resolve) => {
  let out = "", err = "", stopped = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const grouped = process.platform !== "win32";
  const p = spawn(cmd, args, { cwd: o.cwd, detached: grouped });
  const kill = (signal: NodeJS.Signals) => {
   try { if (grouped && p.pid) process.kill(-p.pid, signal); else p.kill(signal); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") err += String(e); }
  };
  const stop = () => {
   if (stopped) return;
   stopped = true;
   kill("SIGTERM");
   escalation = setTimeout(() => kill("SIGKILL"), 1000);
  };
  const timer = o.timeoutMs ? setTimeout(stop, o.timeoutMs) : undefined;
  o.signal?.addEventListener("abort", stop, { once: true });
  if (o.signal?.aborted) stop();
  p.stdout.on("data", d => { out += d; });
  p.stderr.on("data", d => { err += d; });
  p.on("error", e => { err += String(e); });
  p.stdin.on("error", e => { err += String(e); });
  p.on("close", code => {
   if (timer) clearTimeout(timer);
   if (escalation) { clearTimeout(escalation); kill("SIGKILL"); }
   o.signal?.removeEventListener("abort", stop);
   if (o.log) fs.writeFileSync(o.log, `$ ${cmd} ${args.join(" ")}\n${out}\n--- stderr ---\n${err}`);
   resolve({ code: stopped ? 1 : code ?? 1, out, err });
  });
  p.stdin.end(o.input ?? "");
 });
}

const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });
const sh = (cwd: string, cmd: string, args: string[] = [], input?: string, signal?: AbortSignal) => run("sh", ["-c", `${cmd} "$@"`, "sh", ...args], { cwd, input, signal, timeoutMs: 60_000 });

export class Repo {
	readonly root: string;
	constructor(root: string) {
		this.root = root;
	}
	get dir() {
		const d = path.join(this.root, ".noodle");
		fs.mkdirSync(path.join(d, "logs"), { recursive: true });
		if (!fs.existsSync(path.join(d, ".gitignore"))) fs.writeFileSync(path.join(d, ".gitignore"), "*\n");
		return d;
	}
	branch = (id: string) => `noodle/${safeId(id)}`;
	wtPath = (id: string) => path.join(this.dir, "worktrees", safeId(id));
	async base() {
		return (await git(this.root, "rev-parse", "--abbrev-ref", "HEAD")).out.trim();
	}
	async hasBranch(id: string) {
		return (await git(this.root, "rev-parse", "--verify", "--quiet", `refs/heads/${this.branch(id)}`)).code === 0;
	}
	async ahead(id: string, base: string) {
		return Number((await git(this.root, "rev-list", "--count", `${base}..${this.branch(id)}`)).out.trim() || 0);
	}
	/** Idempotent: reuse worktree, reattach existing branch, or branch from base. */
	async worktree(id: string, base: string) {
		const p = this.wtPath(id);
		const b = this.branch(id);
		if (!fs.existsSync(p)) {
			await git(this.root, "worktree", "prune");
			const r = (await this.hasBranch(id)) ? await git(this.root, "worktree", "add", p, b) : await git(this.root, "worktree", "add", "-b", b, p, base);
			if (r.code) throw new Error(`git worktree add failed: ${r.err.trim()}`);
		}
		const top = await git(p, "rev-parse", "--show-toplevel");
		const branch = await git(p, "branch", "--show-current");
		if (top.code || !top.out.trim() || fs.realpathSync(top.out.trim()) !== fs.realpathSync(p) || branch.out.trim() !== b) throw new Error(`Refusing invalid worktree: ${p}`);
		return { path: p, branch: b, base };
	}
	/** Merge noodle/<id> into base in the main checkout, then remove worktree and branch. */
	async merge(id: string, base: string): Promise<string | undefined> {
		const b = this.branch(id);
		if (!(await this.hasBranch(id))) return `no branch ${b}`;
		if ((await this.base()) !== base) return `main checkout is not on ${base}`;
		if (!(await this.ahead(id, base))) return `${b} has no commits ahead of ${base}`;
		if (fs.existsSync(this.wtPath(id)) && (await git(this.wtPath(id), "status", "--porcelain")).out.trim()) return `${b} worktree has uncommitted changes`;
		if ((await git(this.root, "diff", "--cached", "--name-only")).out.trim()) return "main checkout has staged changes";
		const dirty = (await git(this.root, "status", "--porcelain", "--untracked-files=no")).out
			.split("\n")
			.filter((l) => l.trim() && !l.endsWith("todos.md"));
		if (dirty.length) return `main checkout has uncommitted changes: ${dirty.join(", ")}`;
		const m = await git(this.root, "merge", "--no-ff", "--no-edit", b);
		if (m.code) {
			await git(this.root, "merge", "--abort");
			return `merge conflict: ${(m.out + m.err).trim().split("\n").slice(-3).join(" ")}`;
		}
		// No --force: never discard uncommitted work left in the worktree.
		await git(this.root, "worktree", "remove", this.wtPath(id));
		await git(this.root, "branch", "-d", b);
	}
	findPlan(id: string) {
		for (const root of [this.wtPath(id), this.root]) {
			const dir = path.join(root, "plans");
			const hit = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith(`${safeId(id)}-`));
			if (!hit) continue;
			const p = path.join("plans", hit);
			return fs.statSync(path.join(root, p)).isDirectory() ? path.join(p, "overview.md") : p;
		}
	}
	history(n = 10) {
		const f = path.join(this.dir, "history.jsonl");
		return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l)) : [];
	}
	record(e: Record<string, unknown>) {
		fs.appendFileSync(path.join(this.dir, "history.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), ...e })}\n`);
	}
}

// ---------- backlog (todos.md or adapter) ----------

export class Backlog {
	readonly root: string;
	readonly cfg: Config;
	constructor(root: string, cfg: Config) {
		this.root = root;
		this.cfg = cfg;
	}
	get adapter() {
		return this.cfg.adapters?.backlog;
	}
	get file() {
		return path.join(this.root, "todos.md");
	}
	get identity() {
  if (!this.adapter?.sync) return `file:${this.file}`;
  if (this.adapter.done?.includes('github/') && !process.env.NOODLE_GH_REPO) throw new Error('Set NOODLE_GH_REPO explicitly for durable GitHub completion.');
  if (!/github\/|jira\/|linear\//.test(this.adapter.done ?? '') && !this.cfg.backlogIdentity) throw new Error('Custom durable backlog requires stable backlogIdentity in .noodle.json.');
  const env = Object.fromEntries(['NOODLE_GH_REPO','NOODLE_GH_LABEL','JIRA_URL','JIRA_EMAIL','NOODLE_JIRA_PROJECT','NOODLE_JIRA_JQL','NOODLE_JIRA_DONE','NOODLE_LINEAR_TEAM','NOODLE_LINEAR_LABEL'].map(k=>[k,process.env[k] ?? '']));
  const scripts=Object.entries(this.adapter).map(([k,v])=>[k,v,fs.existsSync(path.resolve(this.root,v)) ? fs.readFileSync(path.resolve(this.root,v),'utf8') : '']);
  return createHash('sha256').update(JSON.stringify({root:fs.realpathSync(this.root),adapter:scripts,env,identity:this.cfg.backlogIdentity ?? ''})).digest('hex');
 }
 get source() {
		return this.adapter?.sync ? `adapter: ${this.adapter.sync}` : this.file;
	}
	async items(signal?: AbortSignal): Promise<Item[]> {
		if (this.adapter?.sync) {
			const r = await sh(this.root, this.adapter.sync, [], undefined, signal);
			if (r.code) throw new Error(`backlog sync failed: ${r.err.trim()}`);
			return parseNdjson(r.out);
		}
		return parse(fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : "");
	}
	async add(title: string): Promise<string> {
		if (this.adapter?.sync) {
			if (!this.adapter.add) throw new Error("adapter has no add command");
			const r = await sh(this.root, this.adapter.add, [], JSON.stringify({ title }));
			if (r.code) throw new Error(`backlog add failed: ${r.err.trim()}`);
			return r.out.trim();
		}
		const out = add(fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : "", title);
		fs.writeFileSync(this.file, out.md);
		return out.id;
	}
	async done(id: string, signal?: AbortSignal) {
		if (this.adapter?.sync) {
			if (!this.adapter.done) return;
			const r = await sh(this.root, this.adapter.done, [id], undefined, signal);
			if (r.code) throw new Error(`backlog done failed: ${r.err.trim()}`);
			return;
		}
		if (fs.existsSync(this.file)) fs.writeFileSync(this.file, markDone(fs.readFileSync(this.file, "utf8"), id));
	}
}

export function loadConfig(root: string): Config {
	const f = path.join(root, ".noodle.json");
	return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}

// ---------- extension ----------

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALIASES: Record<string, string> = { plan: "noodle-plan", run: "noodle-execute", review: "noodle-review" };
const USAGE =
	"Usage: /noodle status | add <text> | plan [id] | run <id> | review <id> | do <skill> <id|-> | merge <id> | loop [n] [--parallel k] [--auto] [--merge] | stop | recover | retry <id> | init <github|jira|linear>";
const PI = () => process.env.NOODLE_PI ?? "pi";

type Loop = { ctl: AbortController; running: Map<string, Next>; left: number; done: Promise<void> };

export default function (pi: ExtensionAPI) {
	let loop: Loop | undefined;
	let manual: { skill: string; id: string; root: string; release: () => void } | undefined;
	let mergeChain = Promise.resolve();
 let disposeWorkflow: (()=>void) | undefined;
 const registerWorkflowForSession=(ctx:ExtensionContext)=>{const sid=ctx.sessionManager?.getSessionId?.();if(!sid)return;const next=registerNoodleWorkflowResource(sid);const previous=disposeWorkflow;disposeWorkflow=next;previous?.();};
 pi.on('session_start',async(_e:any,ctx:ExtensionContext)=>{try{registerWorkflowForSession(ctx);}catch(e){ctx.ui?.notify?.(`Noodle native workflow unavailable: ${e instanceof Error?e.message:e}`,'warning');return;}
  // Reconcile an earlier native launch (e.g. Pi restarted): finalize only through the same terminal-proof gate.
  try{
   const owner=new NativeOwnership(ctx.cwd);const lease=owner.read();
   if(lease){
    if(!lease.runId){ctx.ui?.notify?.('Native ownership lock without run ID (launch interrupted). Inspect `.noodle/owner.lock`; no automatic unlock.','warning');}
    else if(!nativeRuns.has(lease.runId)){nativeRuns.set(lease.runId,{owner,lease,ctx:ctx as any});
     finalizeNative(lease.runId).catch(e=>ctx.ui?.notify?.(`Native recovery failed; ownership retained: ${e}`,'error'));}
   }
  }catch(e){ctx.ui?.notify?.(`Native ownership record unreadable; preserved: ${e}`,'warning');}
 });
 const nativeRuns=new Map<string,{owner:NativeOwnership;lease:import('./native.ts').NativeLease;ctx:ExtensionCommandContext;asyncDir?:string;finalizing?:boolean}>();
 const requestRuns=new Map<string,string>();
 const earlyCompletions=new Map<string,{runId:string;asyncDir?:string}>();
 const recoveryTimers=new Map<string,ReturnType<typeof setTimeout>>();
 let sessionActive=true;
 const scheduleRecovery=(runId:string)=>{
  if(!sessionActive||recoveryTimers.has(runId))return;
  const timer=setTimeout(()=>{recoveryTimers.delete(runId);void finalizeNative(runId).catch(()=>{});},30000);timer.unref?.();recoveryTimers.set(runId,timer);
 };
 const finalizeNative=async (runId:string,asyncDir?:string)=>{
  const tracked=nativeRuns.get(runId);if(!tracked||tracked.finalizing)return;
  tracked.finalizing=true;
  let status:any;
  const dir=asyncDir ?? tracked.asyncDir;
  try{
   for(let i=0;i<6;i++){
    status=(await subagentRpc(pi,'status',{id:runId}))?.details;
    if(workflowTerminalObserved(status?.workflowTerminalProof ?? status?.details?.workflowTerminalProof,runId,tracked.lease.items.length*2)||i===5)break;
    await new Promise(r=>setTimeout(r,5000));
   }
   if(status?.runId!==runId) throw new Error('Native status run ID mismatch');
   if(dir && status?.asyncDir && path.resolve(dir)!==path.resolve(status.asyncDir)) throw new Error('Native status asyncDir mismatch');
   tracked.asyncDir=status?.asyncDir ?? dir;
  }catch(e){tracked.ctx.ui.notify(`Native status unavailable; ownership retained: ${e}`,'warning');tracked.finalizing=false;
   scheduleRecovery(runId);return;}
  const finalProof=status?.workflowTerminalProof ?? status?.details?.workflowTerminalProof;
  if(!finalProof || !workflowTerminalObserved(finalProof,runId,tracked.lease.items.length*2)){
   try{tracked.owner.save({...tracked.lease,status:finalProof?.state==='unknown'?'uncertain':'running'});}catch{/* lock stays as is; fail closed */}
   tracked.ctx.ui.notify(`Native workflow terminal evidence is ${finalProof?.state ?? 'missing'} (dispatchClosed=${finalProof?.dispatchClosed ?? false}); ownership remains retained.${['complete','completed','failed','stopped'].includes(status?.state)?` Workflow state is ${status.state} but a child process-terminal.json may be stuck pending (e.g. host reload); inspect child proofs and release the lock manually only after Git verification.`:''}`,`warning`);tracked.finalizing=false;
   scheduleRecovery(runId);return;
  }
  try{
   const result=await verifyNativeResult(tracked.owner.root,tracked.lease);
   if(!result.ok){tracked.owner.save({...tracked.lease,status:'terminal'});nativeRuns.delete(runId);pi.sendMessage({customType:'noodle-native-evidence',content:`Native workflow ${runId} finished but Git verification failed; ownership retained.\n${result.lines.join('\n')}`,display:true},{triggerTurn:false});tracked.ctx.ui.notify('Native Git verification failed; ownership retained for inspection.','error');return;}
   fs.writeFileSync(path.join(tracked.owner.root,'.noodle',`native-result-${tracked.lease.token}.json`),JSON.stringify({runId,observedAt:finalProof.observedAt,...result},null,2));
   pi.sendMessage({customType:'noodle-native-evidence',content:`Native workflow ${runId} terminated with observed proof for ${finalProof.children.length} children.\n${result.lines.join('\n')}`,display:true},{triggerTurn:false});
   tracked.owner.release(tracked.lease);
   nativeRuns.delete(runId);
   const timer=recoveryTimers.get(runId);if(timer)clearTimeout(timer);recoveryTimers.delete(runId);
   tracked.ctx.ui.notify('Native workflow stopped; repository ownership released.','info');
  }catch(e){if(tracked.owner.read?.()?.token===tracked.lease.token)tracked.owner.save({...tracked.lease,status:'terminal'});nativeRuns.delete(runId);tracked.ctx.ui.notify(`Native verification failed; ownership retained for manual inspection: ${e}`,'error');}
 };
 const noticeNative=(runId:string,asyncDir?:string)=>{
  const tracked=nativeRuns.get(runId) ?? [...nativeRuns.values()].find(x=>x.lease.requestId===runId);
  if(!tracked){earlyCompletions.set(runId,{runId,asyncDir});if(earlyCompletions.size>32)earlyCompletions.delete(earlyCompletions.keys().next().value!);return;}
  finalizeNative(tracked.lease.runId ?? runId,asyncDir).catch(e=>tracked.ctx.ui.notify(`Native finalize failed; ownership retained: ${e}`,'error'));
 };
 pi.events?.on('subagent:async-complete',(payload:any)=>{if(typeof payload?.runId==='string')noticeNative(payload.runId,payload.asyncDir);});
 pi.on('message_end',(event:any)=>{
  const m=event?.message;if(m?.role!=='custom'||m.customType!=='subagent-notify')return;
  for(const r of m.details?.runs ?? []) if(typeof r?.runId==='string') noticeNative(r.runId,r.asyncDir);
 });

	const skillsOf = (ctx: ExtensionCommandContext) => ctx.getSystemPromptOptions?.().skills ?? [];
 const childSkillArgs = (ctx: ExtensionCommandContext) => {
  const bundled = new Set(fs.readdirSync(path.join(PKG, "skills")));
  return skillsOf(ctx).filter(s => !bundled.has(s.name)).flatMap(s => ["--skill", s.filePath]);
 };
	const status = (ctx: ExtensionCommandContext, text?: string) => ctx.hasUI && ctx.ui.setStatus("noodle", text);

	async function buildMise(ctx: ExtensionCommandContext, repo: Repo, backlog: Backlog, free: number) {
		const base = await repo.base();
		const items = (await backlog.items(loop?.ctl.signal)).filter((i) => !i.done);
		const durable = new Journal(repo.dir).read();
		const enriched = await Promise.all(
			items.map(async (i) => {
				const plan = i.plan ?? repo.findPlan(i.id);
				const branch = (await repo.hasBranch(i.id)) ? { name: repo.branch(i.id), commits_ahead: await repo.ahead(i.id, base) } : undefined;
				return { ...i, recovery: durable.merges[i.id] ?? null, ...(plan && { plan, plan_complete: planComplete(fs.existsSync(repo.wtPath(i.id)) ? repo.wtPath(i.id) : repo.root, plan) }), ...(branch && { branch }) };
			}),
		);
		const task_types = skillsOf(ctx).flatMap((s) => {
			const schedule = scheduleField(fs.readFileSync(s.filePath, "utf8"));
			return schedule ? [{ skill: s.name, schedule }] : [];
		});
		const mise = {
			base,
			backlog: enriched,
			active: [...(loop?.running.values() ?? [])],
			free_slots: free,
			recent_history: repo.history(),
   durable_attempts: durable.attempts,
			task_types,
			routing: backlog.cfg.routing ?? {},
   available_skills: skillsOf(ctx).map(s => ({ name: s.name, description: s.description, path: s.filePath })),
		};
		fs.writeFileSync(path.join(repo.dir, "mise.json"), JSON.stringify(mise, null, 2));
		return mise;
	}

	/** Persist intent before Git, then reconcile remote completion independently. */
 async function recover(repo: Repo, backlog: Backlog, signal?: AbortSignal, interrupted = false) {
  const journal = new Journal(repo.dir);
  if (interrupted) journal.interrupt();
  for (const intent of Object.values(journal.read().merges)) {
   if (intent.status === 'done' || intent.status === 'attention') continue;
   if(intent.destination !== backlog.identity) throw new Error('Backlog destination changed; preserve state and restore original adapter identity before recovery.');
   const contained = await git(repo.root, 'merge-base', '--is-ancestor', intent.head, intent.base);
   if (contained.code !== 0) {
    journal.merge({...intent,status:'attention',error:'Prepared merge is not in recorded base; inspect Git before retrying.'});
    continue;
   }
   journal.merge({...intent,status:'backlog-pending'});
   try {
    await backlog.done(intent.item,signal);
    journal.merge({...intent,status:'done'});
    repo.record({skill:'merge',id:intent.item,ok:true,recovered:true});
   } catch(e) {
    journal.merge({...intent,status:'backlog-pending',error:String(e)});
    throw e;
   }
  }
 }
 function merge(repo: Repo, backlog: Backlog, id: string, base: string) {
  const p = mergeChain.then(async () => {
   const journal=new Journal(repo.dir);
   const previous=journal.read().merges[id];
   if(previous?.status === 'done') return undefined;
   if(previous?.status === 'backlog-pending') { await recover(repo,backlog,loop?.ctl.signal); return undefined; }
   if(previous?.status === 'attention') return previous.error ?? 'Merge needs manual inspection';
   const item=(await backlog.items(loop?.ctl.signal)).find(i=>i.id===id);
   const plan=item?.plan ?? repo.findPlan(id);
   if(plan && !planComplete(repo.wtPath(id),plan)) return 'plan has incomplete phases; finish every phase before merging';
   const head=(await git(repo.root,'rev-parse',repo.branch(id))).out.trim();
   if(!head) return 'No branch to merge';
   if(!(await repo.ahead(id,base))) return `${repo.branch(id)} has no commits ahead of ${base}`;
   journal.merge({item:id,base,head,destination:backlog.identity,status:'prepared'});
   const err=await repo.merge(id,base);
   if(err) { journal.clearMerge(id); return err; }
   journal.merge({item:id,base,head,destination:backlog.identity,status:'backlog-pending'});
   repo.record({skill:'git-merge',id,ok:true});
   try {
    await backlog.done(id,loop?.ctl.signal);
    journal.merge({item:id,base,head,destination:backlog.identity,status:'done'});
    repo.record({skill:'merge',id,ok:true});
   } catch(e) { journal.merge({item:id,base,head,destination:backlog.identity,status:'backlog-pending',error:String(e)});throw e; }
   return undefined;
  });
  mergeChain=p.then(()=>undefined,()=>undefined);
  return p;
 }

	async function runStage(ctx: ExtensionCommandContext, repo: Repo, backlog: Backlog, next: Next, opts: { merge: boolean }, signal: AbortSignal) {
		const cfg = backlog.cfg;
		const items = await backlog.items(signal);
		const item = next.id === "-" ? undefined : items.find((i) => i.id === next.id);
		if (next.id !== "-" && (!item || item.done)) return repo.record({ ...next, ok: false, error: "unknown or completed item" });
		const base = await repo.base();
		if (item && next.skill === "noodle-review" && !(await repo.hasBranch(item.id))) return repo.record({ ...next, ok: false, error: "no branch to review" });
		const wt = item ? await repo.worktree(item.id, base) : undefined;
		const plan = item && (item.plan ?? repo.findPlan(item.id));
		const model = next.model ?? cfg.routing?.[next.skill] ?? cfg.routing?.default ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
  const available = ctx.modelRegistry?.getAvailable();
  const identity = model ? (available ? resolveModelIdentity(model, available) : modelIdentity(model)) : undefined;
  const currentHead = wt ? (await git(wt.path,"rev-parse","HEAD")).out.trim() : "";
  const implementation = [...new Journal(repo.dir).read().attempts].reverse().find(a => a.item === next.id && a.skill === "noodle-execute" && a.status === "succeeded" && a.after === currentHead);
  const independent = !!identity && !!implementation?.modelIdentity && identity !== implementation.modelIdentity;
  if (next.skill === "noodle-review" && !independent) return repo.record({ ...next, ok: false, error: "Independent review requires a known model different from the successful implementation model; configure routing.noodle-review." });
		const args = ["-p", "--no-session", "--no-extensions", "--no-skills", "--skill", path.join(PKG, "skills"), ...childSkillArgs(ctx), ...(model ? ["--model", model] : []), stagePrompt(next.skill, item && { ...item, ...(plan && { plan }) }, wt, backlog.source)];
		const log = path.join(repo.dir, "logs", `${Date.now()}-${next.skill}-${next.id === "-" ? "standalone" : safeId(next.id)}.log`);
		const journal=new Journal(repo.dir);
		const before = wt ? (await git(wt.path, "rev-parse", "HEAD")).out.trim() : "";
  const prior=[...journal.read().attempts].reverse().find(a=>a.item===next.id && a.skill===next.skill && a.status==='succeeded' && a.after===before);
  if(prior && next.skill==='noodle-execute' && (!plan || planComplete(wt!.path,plan))) return repo.record({...next,ok:true,reused:true,modelIdentity:prior.modelIdentity});
		const attempt = journal.start({item:next.id,skill:next.skill,before,modelIdentity:identity,log});
		const r = await run(PI(), args, { cwd: wt?.path ?? repo.root, signal, timeoutMs: (cfg.timeoutMinutes ?? 60) * 60_000, log });
		const v = next.skill === "noodle-review" ? verdict(r.out) : undefined;
		if (next.skill === "noodle-review" && plan && wt && !planComplete(wt.path, plan)) { journal.finish(attempt,{status:"failed",error:"plan has incomplete phases"}); return repo.record({ ...next, ok: false, error: "plan has incomplete phases" }); }
		const after = wt ? (await git(wt.path,"rev-parse","HEAD")).out.trim() : "";
		const ok = r.code === 0 && !signal.aborted && (next.skill !== "noodle-review" || after === before) && (next.skill !== "noodle-review" || v === "PASS") && (next.skill !== "noodle-execute" || !item || (await git(wt!.path, "rev-parse", "HEAD")).out.trim() !== before);
		journal.finish(attempt,{status:ok ? "succeeded" : "failed",after,verdict:v});
		repo.record({ ...next, ...(model && { model }), ...(identity && { modelIdentity: identity }), ok, ...(v && { verdict: v }), log, summary: r.out.trim().slice(-400) });
		if (ok && item && v === "PASS" && opts.merge) {
			const err = await merge(repo, backlog, item.id, base);
			ctx.ui.notify(err ? `noodle: merge #${item.id} failed: ${err}` : `noodle: merged ${repo.branch(item.id)}`, err ? "warning" : "info");
		}
	}

	async function loopBody(ctx: ExtensionCommandContext, repo: Repo, backlog: Backlog, l: Loop, opts: { parallel: number; auto: boolean; merge: boolean }) {
		const known = new Set(skillsOf(ctx).map((s) => s.name));
		const inflight = new Map<string, Promise<void>>();
		let why = "stopped";
		let schedule = true;
		try {
			while (!l.ctl.signal.aborted) {
				const free = Math.min(opts.parallel - inflight.size, l.left);
				if (schedule && free > 0) {
					schedule = false;
					const historyBefore = fs.existsSync(path.join(repo.dir, "history.jsonl")) ? fs.statSync(path.join(repo.dir, "history.jsonl")).size : 0;
					const mise = await buildMise(ctx, repo, backlog, free);
					if (!mise.backlog.length && !inflight.size) {
						why = "backlog empty";
						break;
					}
					status(ctx, `noodle: scheduling (${inflight.size} running, ${l.left} left)`);
					const model = backlog.cfg.routing?.scheduler ?? backlog.cfg.routing?.default;
					const log = path.join(repo.dir, "logs", `${Date.now()}-schedule.log`);
					const prompt = schedulePrompt(backlog.source, path.join(repo.dir, "mise.json"), mise);
					const r = await run(PI(), ["-p", "--no-session", "--no-extensions", ...(model ? ["--model", model] : []), prompt], { cwd: repo.root, signal: l.ctl.signal, timeoutMs: (backlog.cfg.timeoutMinutes ?? 60) * 60_000, log });
					if (l.ctl.signal.aborted) break;
					if (r.code !== 0) throw new Error(`scheduler failed (see ${log})`);
					const nexts = nextDirectives(r.out) ?? [];
					const seen = new Set(l.running.keys());
     const recoveryState = new Journal(repo.dir).read();
					const pick = nexts.filter((n) => {
						if (!known.has(n.skill) || seen.has(n.id) || recoveryState.merges[n.id] || recoveryState.attempts.some(a => a.item === n.id && a.status === 'interrupted')) return false;
						seen.add(n.id);
						return true;
					}).slice(0, free);
					if (pick.length) {
						const desc = pick.map((n) => `${n.skill} #${n.id}${n.model ? ` @${n.model}` : ""}`).join(", ");
						if (!opts.auto && !(ctx.hasUI && (await ctx.ui.confirm("Noodle loop", `Run ${desc}?`)))) {
							why = ctx.hasUI ? "declined" : `needs confirmation for ${desc}; use --auto`;
							break;
						}
						for (const n of pick) {
							l.left--;
							l.running.set(n.id, n);
							const p = runStage(ctx, repo, backlog, n, opts, l.ctl.signal)
								.catch((e) => repo.record({ ...n, ok: false, error: String(e) }))
								.finally(() => {
									l.running.delete(n.id);
									inflight.delete(n.id);
								});
							inflight.set(n.id, p);
						}
					} else if (!inflight.size) {
						if ((fs.existsSync(path.join(repo.dir, "history.jsonl")) ? fs.statSync(path.join(repo.dir, "history.jsonl")).size : 0) !== historyBefore) { schedule = true; continue; }
						why = r.code ? `scheduler failed (see ${log})` : /NEXT:/i.test(r.out) ? "nothing actionable" : `scheduler gave no NEXT line (see ${log})`;
						break;
					}
				}
				if (!inflight.size) {
					why = "stage limit reached";
					break;
				}
				status(ctx, `noodle: ${[...l.running.values()].map((n) => `${n.skill} #${n.id}`).join(", ")} (${l.left} left)`);
				await Promise.race(inflight.values());
				schedule = true;
			}
		} finally {
			// Scheduler/adapter failure must not abandon mutation-capable workers.
			if (inflight.size) l.ctl.abort();
			await Promise.allSettled(inflight.values());
		}
		ctx.ui.notify(`Noodle loop stopped: ${why}`, "info");
	}

	pi.on("session_shutdown", async () => { sessionActive=false;for(const timer of recoveryTimers.values())clearTimeout(timer);recoveryTimers.clear(); disposeWorkflow?.(); disposeWorkflow=undefined; if (loop) { loop.ctl.abort(); await loop.done; } manual?.release(); manual = undefined; });

	pi.on("agent_settled", async (event) => {
		if (!manual) return;
		try { new Repo(manual.root).record({ skill: manual.skill, id: manual.id, ok: !event.aborted, manual: true }); } finally { manual.release(); manual = undefined; }
	});

	pi.registerCommand("noodle", {
		description: "Noodle skill loop: status | add | plan [id] | run | review | do | merge | loop | stop | init",
		getArgumentCompletions: (prefix) => {
			const items = ["status", "add", "plan", "run", "review", "do", "merge", "loop", "stop", "init", "recover", "retry", "bg", "jobs"].filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const repo = new Repo(ctx.cwd);
			const cfg = loadConfig(ctx.cwd);
			const backlog = new Backlog(ctx.cwd, cfg);
			const [cmd = "status", ...rest] = args.trim().split(/\s+/);
			const arg = args.trim().slice(cmd.length).trim();

			try {
				if (cmd === "bg") {
     const count=Number(rest[0] ?? 5);
     const at=rest.indexOf('--parallel');
     if(at>=0) return ctx.ui.notify('--parallel is not supported by native /noodle bg; items run sequentially.','warning');
     if(!Number.isSafeInteger(count) || count<1 || count>MAX_NATIVE_ITEMS) return ctx.ui.notify(`Use /noodle bg 1-${MAX_NATIVE_ITEMS}`,'warning');
     const top=await git(ctx.cwd,'rev-parse','--show-toplevel');
     if(top.code || !top.out.trim()) throw new Error(`Not a Git repository: ${ctx.cwd}. Start Pi in an authorized project root.`);
     if(fs.realpathSync(top.out.trim()) !== fs.realpathSync(ctx.cwd)) throw new Error(`Start Pi at repository root: ${top.out.trim()}`);
     if(!cfg.adapters?.backlog?.sync && !fs.existsSync(backlog.file)) throw new Error(`Backlog missing: ${backlog.file}. Add tasks before /noodle bg.`);
     const items=(await backlog.items()).filter(i=>!i.done);
     if(!items.length) throw new Error('No open backlog items; no subagent launched.');
     if(!disposeWorkflow) throw new Error('Native workflow resource is not registered for this session; reload Pi and check pi-subagents.');
     if(rest.includes('--merge')) throw new Error('Native automatic merge remains disabled until structural review/phase attestation is implemented; inspect branches and merge explicitly.');
     const batch=items.slice(0,count);
     if(items.length>batch.length) ctx.ui.notify(`${items.length} open items; launching first ${batch.length}. Run again for the rest.`,'info');
     for(const i of batch) safeId(i.id);
     if(!(await git(ctx.cwd,'rev-parse','HEAD')).out.trim()) throw new Error('Repository needs a base commit.');
     const requestId=randomUUID();
     const owner=new NativeOwnership(ctx.cwd);
     const lease=await owner.acquire(ctx.sessionManager?.getSessionId?.() ?? 'unknown',batch.map(i=>i.id),requestId);
     try {
      nativeRuns.set(requestId,{owner,lease,ctx});
      const result=await subagentRpc(pi,'spawn',{workflow:'noodle.item',args:workflowArgs(PKG,ctx.cwd,batch),cwd:ctx.cwd,async:true},requestId);
      const runId=result?.details?.runId ?? result?.details?.workflowRunId ?? requestId;
      if(typeof runId!=='string'){nativeRuns.delete(requestId);owner.save({...lease,status:'uncertain'});throw new Error('Native launch reply lacks run ID; ownership retained. Inspect native status, do not relaunch.');}
      lease.runId=runId;lease.status='running';owner.save(lease);
      const entry=nativeRuns.get(requestId);if(entry){nativeRuns.delete(requestId);nativeRuns.set(runId,entry);}
      const completed=earlyCompletions.get(runId);if(completed){earlyCompletions.delete(runId);finalizeNative(runId,completed.asyncDir).catch(e=>ctx.ui.notify(`Native finalize failed; ownership retained: ${e}`,'error'));}
      ctx.ui.notify(typeof result?.text==='string' ? result.text : 'Native Noodle workflow launched; repository ownership remains until observed workflow termination proof.','info');
     }catch(e){owner.save({...lease,status:'uncertain'});throw e;}
     return;

    }
    if (cmd === "jobs") {
     const result=await subagentRpc(pi,'status',rest[0]?{id:rest[0]}:{});
     return ctx.ui.notify(result?.text ?? JSON.stringify(result),'info');
    }
    if (cmd === "status") {
					const state=new Journal(repo.dir).read();
					const open = (await backlog.items()).filter((i) => !i.done);
					const lines = open.length ? open.map((i) => `#${i.id} ${i.title}`) : [`No open items (${backlog.source})`];
					lines.push(`Recovery: ${state.attempts.filter(a=>a.status==='interrupted' || a.status==='running').length} interrupted/running; ${Object.values(state.merges).filter(m=>m.status==='backlog-pending').length} backlog pending`);
					if (loop) lines.push(`Loop: ${[...loop.running.values()].map((n) => `${n.skill} #${n.id}`).join(", ") || "scheduling"}; ${loop.left} stage(s) left`);
					return ctx.ui.notify(lines.join("\n"), "info");
				}
				if (cmd === "add") {
					if (!arg) return ctx.ui.notify("Usage: /noodle add <text>", "warning");
					return ctx.ui.notify(`Added #${await backlog.add(arg)}`, "info");
				}
				if (cmd === "stop") {
					if (!loop) return ctx.ui.notify("No loop running.", "info");
					loop.ctl.abort();
					return ctx.ui.notify("Stopping loop; running stages are killed.", "info");
				}
				if (cmd === "init") {
					const kind = rest[0];
					const src = path.join(PKG, "adapters", kind ?? "");
					if (!kind || !fs.existsSync(src)) return ctx.ui.notify("Usage: /noodle init <github|jira|linear>", "warning");
					const dst = path.join(ctx.cwd, "adapters", kind);
					fs.mkdirSync(dst, { recursive: true });
					for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f)), fs.chmodSync(path.join(dst, f), 0o755);
					const cmds = Object.fromEntries(["sync", "add", "done"].map((k) => [k, `adapters/${kind}/backlog-${k}`]));
					fs.writeFileSync(path.join(ctx.cwd, ".noodle.json"), `${JSON.stringify({ ...cfg, adapters: { ...cfg.adapters, backlog: cmds } }, null, 2)}\n`);
					return ctx.ui.notify(`Wrote adapters/${kind}/ and .noodle.json. Configure env vars listed in adapters/${kind}/backlog-sync.`, "info");
				}
				if (cmd === "merge") {
					if (!rest[0]) return ctx.ui.notify("Usage: /noodle merge <id>", "warning");
					const id = rest[0].replace(/^#/, "");
					if (loop?.running.has(id) || (manual?.root === ctx.cwd && manual.id === id)) return ctx.ui.notify(`#${id} is running; stop or wait before merging.`, "warning");
					const release = acquireOwnership(repo);
					let err: string | undefined;
					try { err = await merge(repo, backlog, id, await repo.base()); } finally { release(); }
					return ctx.ui.notify(err ? `Merge failed: ${err}` : `Merged ${repo.branch(id)} and marked #${id} done`, err ? "warning" : "info");
				}
				if (cmd === "retry") {
     const id=rest[0]?.replace(/^#/, '');
     if(!id) return ctx.ui.notify('Usage: /noodle retry <id> (after inspecting interrupted worktree)', 'warning');
     safeId(id);
     const release=acquireOwnership(repo);
     try {
      const journal=new Journal(repo.dir);
      journal.interrupt();
      for(const a of journal.read().attempts.filter(a=>a.item===id && a.status==='interrupted')) journal.acknowledge(a.id);
     } finally { release(); }
     return ctx.ui.notify(`Interrupted #${id} acknowledged; next loop may retry after your inspection.`, 'info');
    }
    if (cmd === "recover") {
     const release=acquireOwnership(repo);
     try { await recover(repo,backlog,undefined,true); } finally { release(); }
     return ctx.ui.notify('Recovery inspected interrupted attempts and reconciled pending backlog updates.','info');
    }
    if (cmd === "loop") {
					if (!ctx.isIdle()) return ctx.ui.notify("Agent busy; wait until idle.", "warning");
					if (loop) return ctx.ui.notify("Loop already running; /noodle stop first.", "warning");
					const num = (flag: string) => Number(rest[rest.indexOf(flag) + 1]);
					const opts = {
						parallel: rest.includes("--parallel") ? Math.max(1, num("--parallel") || 1) : 1,
						auto: rest.includes("--auto"),
						merge: rest.includes("--merge"),
					};
					const n = Number(rest.find((r, i) => /^\d+$/.test(r) && rest[i - 1] !== "--parallel") ?? 5);
					if (!Number.isSafeInteger(n) || n < 1 || n > 100 || !Number.isSafeInteger(opts.parallel) || opts.parallel > 20) return ctx.ui.notify("Use 1-100 stages and 1-20 parallel workers.", "warning");
					const release = acquireOwnership(repo);
					const l: Loop = { ctl: new AbortController(), running: new Map(), left: n, done: Promise.resolve() };
					loop = l;
					l.done = recover(repo,backlog,l.ctl.signal,true).then(() => loopBody(ctx, repo, backlog, l, opts))
						.catch((e) => ctx.ui.notify(`Noodle loop failed: ${e}`, "error"))
						.finally(() => {
							release();
							loop = undefined;
							status(ctx, undefined);
						});
					ctx.ui.notify(`Loop started: max ${n} stage(s), parallel ${opts.parallel}${opts.auto ? ", auto" : ""}${opts.merge ? ", merge on PASS" : ""}. Logs: .noodle/logs/`, "info");
					// Print mode exits when the handler returns: keep the process alive until the loop ends.
					if (!ctx.hasUI) await l.done;
					return;
				}

				if (!ALIASES[cmd] && cmd !== "do") return ctx.ui.notify(USAGE, "warning");
				if (!ctx.isIdle()) return ctx.ui.notify("Agent busy; wait until idle.", "warning");

				if (cmd === "plan" && !rest[0]) {
					const mise = await buildMise(ctx, repo, backlog, 1);
					if (!mise.backlog.length) return ctx.ui.notify(`No open items (${backlog.source})`, "warning");
					pi.sendUserMessage(schedulePrompt(backlog.source, path.join(repo.dir, "mise.json"), mise));
					return;
				}

				const skill = cmd === "do" ? rest[0] : ALIASES[cmd];
				const id = cmd === "do" ? rest[1] : rest[0];
				if (!skill || !id) return ctx.ui.notify(USAGE, "warning");
				if (!skillsOf(ctx).some((s) => s.name === skill)) return ctx.ui.notify(`Unknown skill: ${skill}`, "warning");
				const item = id === "-" ? undefined : (await backlog.items()).find((i) => i.id === id.replace(/^#/, ""));
				if (id !== "-" && !item) return ctx.ui.notify(`No item #${id}`, "warning");
				if (item && skill === "noodle-review" && !(await repo.hasBranch(item.id))) return ctx.ui.notify(`No branch ${repo.branch(item.id)} to review`, "warning");
				if (item && loop?.running.has(item.id)) return ctx.ui.notify(`#${item.id} is running in the loop`, "warning");
				const release = acquireOwnership(repo);
				try {
				const wt = item ? await repo.worktree(item.id, await repo.base()) : undefined;
				const plan = item && (item.plan ?? repo.findPlan(item.id));
				manual = { skill, id: item?.id ?? id, root: ctx.cwd, release };
				pi.sendUserMessage(stagePrompt(skill, item && { ...item, ...(plan && { plan }) }, wt, backlog.source), { expandPromptTemplates: true });
				} catch (e) { release(); manual = undefined; throw e; }
			} catch (e) {
				ctx.ui.notify(`noodle: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});
}
