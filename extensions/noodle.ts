/**
 * Noodle-style backlog loop for Pi. Adapted from poteto/noodle (MIT).
 * Backlog: <cwd>/todos.md ("1. [ ] task", "<!-- next-id: N -->"). Runtime state: <cwd>/.noodle/.
 *
 * /noodle status              open items, loop state
 * /noodle add <text>          append item
 * /noodle plan                scheduler pass over the mise (also written to .noodle/mise.json)
 * /noodle plan|run|review <id>  load noodle-plan / noodle-execute / noodle-review for an item
 * /noodle do <skill> <id|->   run any skill (e.g. your own schedulable skill) for an item
 * /noodle loop [n] [--auto]   schedule -> stage -> schedule ..., max n stages, fresh session each;
 *                             asks before each stage unless --auto. Never merges.
 * /noodle stop                end the loop
 *
 * Skills with a `schedule:` frontmatter field are offered to the scheduler as task types.
 * ponytail: one stage at a time, no merge queue, no backlog adapters; parallelism lives
 * inside noodle-execute via pi-subagents.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ITEM = /^(\d+)\. \[( |x)\] (.+)$/i;
const NEXT_ID = /<!-- next-id: (\d+) -->/;
const TEMPLATE = "# Todos\n\n<!-- next-id: 1 -->\n\n## Inbox\n";

export type Item = { id: number; done: boolean; text: string; plan?: string };
type Current = { kind: "schedule" } | { kind: "stage"; skill: string; id: string };
type Loop = { remaining: number; auto: boolean };

export function parse(md: string): Item[] {
	return md.split("\n").flatMap((line) => {
		const m = ITEM.exec(line.trim());
		if (!m) return [];
		const plan = /\bplans\/\S+\.md\b/.exec(m[3])?.[0];
		return [{ id: Number(m[1]), done: m[2] !== " ", text: m[3], ...(plan && { plan }) }];
	});
}

export function add(md: string, text: string): { md: string; id: number } {
	if (!md.trim()) md = TEMPLATE;
	const ids = parse(md).map((i) => i.id);
	const id = Math.max(Number(NEXT_ID.exec(md)?.[1] ?? 1), ...ids.map((n) => n + 1));
	const line = `${id}. [ ] ${text.replace(/\s+/g, " ").trim()}`;
	md = NEXT_ID.test(md) ? md.replace(NEXT_ID, `<!-- next-id: ${id + 1} -->`) : md;
	if (!/^## Inbox$/m.test(md)) md = `${md.trimEnd()}\n\n## Inbox\n`;
	// Insert after the last line of the Inbox section.
	const lines = md.split("\n");
	const start = lines.findIndex((l) => l === "## Inbox");
	let end = start + 1;
	while (end < lines.length && !lines[end].startsWith("## ")) end++;
	while (end > start + 1 && !lines[end - 1].trim()) end--;
	lines.splice(end, 0, line);
	return { md: lines.join("\n").replace(/\n*$/, "\n"), id };
}

/** `schedule:` from SKILL.md frontmatter; supports one-line and folded (`>`/`|`) values. */
export function scheduleField(skillMd: string): string | undefined {
	const fm = /^---\n([\s\S]*?)\n---/.exec(skillMd)?.[1];
	const m = fm && /^schedule:[ \t]*(.*)$/m.exec(fm);
	if (!m) return undefined;
	let v = m[1].trim();
	if (v === ">" || v === "|" || v === ">-" || v === "|-" || v === "") {
		const rest = fm.slice(m.index + m[0].length + 1).split("\n");
		const body: string[] = [];
		for (const l of rest) {
			if (!/^\s+\S/.test(l)) break;
			body.push(l.trim());
		}
		v = body.join(" ");
	}
	return v.replace(/^["']|["']$/g, "").trim() || undefined;
}

/** Last `NEXT: <skill> <id>` / `NEXT: idle` line of the scheduler reply. */
export function nextDirective(text: string): { skill: string; id: string } | "idle" | null {
	const all = [...text.matchAll(/^\s*`?NEXT:\s*(idle|([a-z0-9][a-z0-9-]*)\s+(#?[\w-]+))`?\s*$/gim)];
	const m = all.at(-1);
	if (!m) return null;
	return m[1].toLowerCase() === "idle" ? "idle" : { skill: m[2], id: m[3].replace(/^#/, "") };
}

// Scheduler rules adapted from poteto/noodle `schedule` skill (MIT).
export const schedulePrompt = (file: string, misePath: string, mise: unknown) =>
	[
		`Act as the Noodle scheduler for the backlog in ${file}. Read the repository and plan files as needed.`,
		"Scheduling only: do not edit files, do not load task skills, do not start planning or implementing.",
		`Mise (also in ${misePath}):`,
		"```json",
		JSON.stringify(mise, null, 2),
		"```",
		"",
		"Rules:",
		"- task_types are the schedulable skills; read each `schedule` as prose and use judgment to match it to backlog state and history.",
		"- One plan at a time: finish the highest-priority planned item end to end before starting another. Shared infrastructure may run alongside.",
		"- Complex items (multi-file, cross-cutting, ambiguous, or needing an architecture sketch) get noodle-plan first; simple, clear items go to noodle-execute.",
		"- Items with a plan: schedule remaining unchecked phases.",
		"- Unmerged noodle/* branches are not on the base branch yet: items that depend on them are blocked until the human merges.",
		"- Use history: don't repeat a stage that already succeeded; an item that failed twice gets split or descheduled.",
		"- If nothing is actionable, say so and go idle.",
		"",
		"Output a table: order, item, skill, why now (cite the rule or schedule field), dependencies, risk.",
		"Flag items too vague to act on and propose a rewrite.",
		"Last line, exactly one of: `NEXT: <skill> <item-id>` (item-id `-` for no item) or `NEXT: idle`.",
	].join("\n");

const ALIASES: Record<string, string> = { plan: "noodle-plan", run: "noodle-execute", review: "noodle-review" };
const USAGE = "Usage: /noodle status | add <text> | plan [id] | run <id> | review <id> | do <skill> <id|-> | loop [n] [--auto] | stop";

export default function (pi: ExtensionAPI) {
	const dir = (cwd: string) => {
		const d = path.join(cwd, ".noodle");
		if (!fs.existsSync(d)) {
			fs.mkdirSync(d);
			fs.writeFileSync(path.join(d, ".gitignore"), "*\n");
		}
		return d;
	};
	const read = <T>(cwd: string, name: string): T | undefined => {
		try {
			return JSON.parse(fs.readFileSync(path.join(dir(cwd), name), "utf8"));
		} catch {
			return undefined;
		}
	};
	const write = (cwd: string, name: string, v: unknown) =>
		v === undefined ? fs.rmSync(path.join(dir(cwd), name), { force: true }) : fs.writeFileSync(path.join(dir(cwd), name), JSON.stringify(v, null, 2));
	const history = (cwd: string) => {
		const f = path.join(dir(cwd), "history.jsonl");
		return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).slice(-10).map((l) => JSON.parse(l)) : [];
	};

	async function buildMise(ctx: ExtensionCommandContext, md: string) {
		const git = async (...args: string[]) => (await pi.exec("git", args, { cwd: ctx.cwd, timeout: 10000 })).stdout.split("\n").filter(Boolean);
		const merged = new Set(await git("branch", "--merged", "HEAD", "--format=%(refname:short)", "--list", "noodle/*"));
		const branches = (await git("branch", "--format=%(refname:short)", "--list", "noodle/*")).map((name) => ({ name, merged: merged.has(name) }));
		const skills = ctx.getSystemPromptOptions?.().skills ?? [];
		const task_types = skills.flatMap((s) => {
			const schedule = scheduleField(fs.readFileSync(s.filePath, "utf8"));
			return schedule ? [{ skill: s.name, schedule }] : [];
		});
		return { backlog: parse(md).filter((i) => !i.done), branches, recent_history: history(ctx.cwd), task_types };
	}

	// Loop stages run in a fresh session, like Noodle's per-order agent sessions.
	async function send(ctx: ExtensionCommandContext, prompt: string, expand: boolean) {
		const opts = expand ? { expandPromptTemplates: true } : undefined;
		if (!read<Loop>(ctx.cwd, "loop.json")) return pi.sendUserMessage(prompt, opts);
		await ctx.newSession({
			parentSession: ctx.sessionManager.getSessionFile(),
			withSession: async (c) => c.sendUserMessage(prompt, opts),
		});
	}

	pi.registerCommand("noodle", {
		description: "Backlog loop: status | add | plan [id] | run <id> | review <id> | do <skill> <id> | loop [n] [--auto] | stop",
		getArgumentCompletions: (prefix) => {
			const items = ["status", "add", "plan", "run", "review", "do", "loop", "stop"].filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const file = path.join(ctx.cwd, "todos.md");
			const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
			const all = parse(md);
			const open = all.filter((i) => !i.done);
			const [cmd = "status", ...rest] = args.trim().split(/\s+/);
			const arg = args.trim().slice(cmd.length).trim();
			const loop = read<Loop>(ctx.cwd, "loop.json");

			if (cmd === "status") {
				const lines = open.length ? open.map((i) => `#${i.id} ${i.text}`) : [`No open items in ${file}`];
				if (loop) lines.push(`Loop: ${loop.remaining} stage(s) left${loop.auto ? ", auto" : ""}`);
				return ctx.ui.notify(lines.join("\n"), "info");
			}
			if (cmd === "add") {
				if (!arg) return ctx.ui.notify("Usage: /noodle add <text>", "warning");
				const out = add(md, arg);
				fs.writeFileSync(file, out.md);
				return ctx.ui.notify(`Added #${out.id}`, "info");
			}
			if (cmd === "stop") {
				write(ctx.cwd, "loop.json", undefined);
				return ctx.ui.notify("Loop stopped.", "info");
			}
			if (cmd === "loop") {
				const n = Number(rest.find((r) => /^\d+$/.test(r)) ?? 5);
				write(ctx.cwd, "loop.json", { remaining: n, auto: rest.includes("--auto") } satisfies Loop);
				ctx.ui.notify(`Loop started: max ${n} stage(s). /noodle stop to end.`, "info");
			} else if (!ALIASES[cmd] && cmd !== "do") return ctx.ui.notify(USAGE, "warning");
			if (!ctx.isIdle()) return ctx.ui.notify("Agent busy; wait until idle.", "warning");

			// Scheduler pass.
			if (cmd === "loop" || (cmd === "plan" && !rest[0])) {
				const mise = await buildMise(ctx, md);
				write(ctx.cwd, "mise.json", mise);
				if (!mise.backlog.length) {
					write(ctx.cwd, "loop.json", undefined);
					return ctx.ui.notify(`No open items in ${file}`, "warning");
				}
				write(ctx.cwd, "current.json", { kind: "schedule" } satisfies Current);
				return send(ctx, schedulePrompt(file, path.join(ctx.cwd, ".noodle/mise.json"), mise), false);
			}

			// Stage: one skill applied to one item.
			const skill = cmd === "do" ? rest[0] : ALIASES[cmd];
			const id = cmd === "do" ? rest[1] : rest[0];
			if (!skill || !id) return ctx.ui.notify(USAGE, "warning");
			const known = ctx.getSystemPromptOptions?.().skills?.map((s) => s.name);
			if (known && !known.includes(skill)) return ctx.ui.notify(`Unknown skill: ${skill}`, "warning");
			// review also accepts done items: the branch exists after run marks [x].
			const item = id === "-" ? undefined : (cmd === "run" ? open : all).find((i) => i.id === Number(id));
			if (id !== "-" && !item) return ctx.ui.notify(`No ${cmd === "run" ? "open " : ""}item #${id}`, "warning");
			write(ctx.cwd, "current.json", { kind: "stage", skill, id } satisfies Current);
			const body = item ? ` Backlog item #${item.id}: ${item.text}\nBacklog file: ${file}` : "";
			await send(ctx, `/skill:${skill}${body}`, true);
		},
	});

	// Record finished stages; drive the loop. Every handoff goes through /noodle so it gets a command context.
	pi.on("agent_settled", async (event, ctx: ExtensionContext) => {
		const cur = read<Current>(ctx.cwd, "current.json");
		if (!cur) return;
		write(ctx.cwd, "current.json", undefined);
		const reply = lastAssistantText(ctx);
		if (cur.kind === "stage") {
			const entry = { ts: new Date().toISOString(), skill: cur.skill, id: cur.id, aborted: event.aborted, summary: reply.slice(-400) };
			fs.appendFileSync(path.join(dir(ctx.cwd), "history.jsonl"), `${JSON.stringify(entry)}\n`);
		}
		const loop = read<Loop>(ctx.cwd, "loop.json");
		if (!loop) return;
		const stop = (why: string) => {
			write(ctx.cwd, "loop.json", undefined);
			ctx.ui.notify(`Noodle loop stopped: ${why}`, "info");
		};
		if (event.aborted) return stop("aborted");

		if (cur.kind === "stage") {
			if (loop.remaining - 1 <= 0) return stop("stage limit reached");
			write(ctx.cwd, "loop.json", { ...loop, remaining: loop.remaining - 1 });
			return pi.sendUserMessage("/noodle plan", { expandPromptTemplates: true });
		}
		const next = nextDirective(reply);
		if (next === null) return stop("scheduler gave no NEXT line");
		if (next === "idle") return stop("nothing actionable");
		const command = `/noodle do ${next.skill} ${next.id}`;
		if (!loop.auto) {
			if (!ctx.hasUI) return stop(`needs confirmation; run ${command} or use --auto`);
			if (!(await ctx.ui.confirm("Noodle loop", `Run ${command}?`))) return stop("declined");
		}
		pi.sendUserMessage(command, { expandPromptTemplates: true });
	});
}

function lastAssistantText(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e.type === "message" && e.message.role === "assistant") {
			const c = e.message.content;
			return typeof c === "string" ? c : c.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
		}
	}
	return "";
}
