/**
 * Noodle-style backlog loop for Pi (manual, supervised).
 * Backlog: <cwd>/todos.md in Noodle format ("1. [ ] task", "<!-- next-id: N -->").
 *
 * /noodle status      open items
 * /noodle add <text>  append item
 * /noodle plan        agent reviews backlog, proposes order (no edits)
 * /noodle run <id>    agent executes item in a git worktree, no merge
 *
 * ponytail: no background scheduler, auto-merge, or provider routing; add a
 * scheduler on agent_settled only if manual /noodle run becomes the bottleneck.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ITEM = /^(\d+)\. \[( |x)\] (.+)$/i;
const NEXT_ID = /<!-- next-id: (\d+) -->/;
const TEMPLATE = "# Todos\n\n<!-- next-id: 1 -->\n\n## Inbox\n";

export type Item = { id: number; done: boolean; text: string };

export function parse(md: string): Item[] {
	return md.split("\n").flatMap((line) => {
		const m = ITEM.exec(line.trim());
		return m ? [{ id: Number(m[1]), done: m[2] !== " ", text: m[3] }] : [];
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

export function runPrompt(item: Item, file: string): string {
	return [
		`Execute Noodle backlog item #${item.id}: ${item.text}`,
		"",
		`Backlog file: ${file}`,
		"Rules:",
		`- Work in a git worktree on branch noodle/${item.id}; create it with \`git worktree add\` outside the main checkout. Never edit the main checkout.`,
		"- Stay in scope of this item. Use absolute paths; do not cd into the worktree.",
		"- Verify with this project's own tests/linters/build before committing.",
		"- Commit in the worktree. Do NOT merge or push; the user reviews and merges.",
		`- When verified, mark item #${item.id} done (\`[x]\`) in the backlog file of the main checkout.`,
		"- Delegation via pi-subagents is authorized for independent parts of this item.",
		"- Finish with: branch, worktree path, commits, verification result, open risks.",
	].join("\n");
}

const PLAN_PROMPT = (file: string, items: Item[]) =>
	[
		`Review the Noodle backlog in ${file} and this repository. Do not edit files.`,
		"Open items:",
		...items.map((i) => `- #${i.id} ${i.text}`),
		"",
		"Propose execution order with: id, why now, dependencies, risk, verification command, and which can run in parallel.",
		"Flag items too vague to execute and suggest a rewrite. End with the exact `/noodle run <id>` to start with.",
	].join("\n");

export default function (pi: ExtensionAPI) {
	pi.registerCommand("noodle", {
		description: "Backlog loop: status | add <text> | plan | run <id>",
		getArgumentCompletions: (prefix) => {
			const items = ["status", "add", "plan", "run"].filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const file = path.join(ctx.cwd, "todos.md");
			const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
			const open = parse(md).filter((i) => !i.done);
			const [cmd = "status", ...rest] = args.trim().split(/\s+/);
			const arg = args.trim().slice(cmd.length).trim();

			if (cmd === "status") {
				ctx.ui.notify(open.length ? open.map((i) => `#${i.id} ${i.text}`).join("\n") : `No open items in ${file}`, "info");
				return;
			}
			if (cmd === "add") {
				if (!arg) return ctx.ui.notify("Usage: /noodle add <text>", "warning");
				const out = add(md, arg);
				fs.writeFileSync(file, out.md);
				ctx.ui.notify(`Added #${out.id}`, "info");
				return;
			}
			if (cmd !== "plan" && cmd !== "run") return ctx.ui.notify("Usage: /noodle status | add <text> | plan | run <id>", "warning");
			if (!ctx.isIdle()) return ctx.ui.notify("Agent busy; wait until idle.", "warning");

			if (cmd === "plan") {
				if (!open.length) return ctx.ui.notify(`No open items in ${file}`, "warning");
				pi.sendUserMessage(PLAN_PROMPT(file, open));
				return;
			}
			const item = open.find((i) => i.id === Number(rest[0]));
			if (!item) return ctx.ui.notify(`No open item #${rest[0] ?? "?"}`, "warning");
			pi.sendUserMessage(runPrompt(item, file));
		},
	});
}
