# pi-noodle-loop

[Noodle](https://poteto.github.io/noodle/introduction.html)'s idea, as a Pi package: **skills that run themselves**. Skills declare *when* they should run in a `schedule:` frontmatter field; a scheduler agent reads the backlog plus those fields, picks the next stage, and a fresh agent runs it in an isolated git worktree. No Noodle CLI; Pi runs everything. Agents commit on branches. **You merge.**

## Install

```bash
pi install npm:pi-noodle-loop
# or
pi install git:github.com/tdslot/pi-noodle-loop
```

## Commands

Backlog is `todos.md` in the project root, Noodle format (`1. [ ] task`, `<!-- next-id: N -->`). Runtime state lives in `.noodle/` (self-gitignored).

| Command | Effect |
|---|---|
| `/noodle status` | Open items and loop state |
| `/noodle add <text>` | Append item (creates `todos.md` if missing) |
| `/noodle plan` | One scheduler pass: builds the mise, proposes order and the next stage. No edits. |
| `/noodle plan <id>` | `noodle-plan`: phased plan in `plans/`, linked from the item. No implementation. |
| `/noodle run <id>` | `noodle-execute`: implement in a worktree, verify, commit, mark done. Never merges or pushes. |
| `/noodle review <id>` | `noodle-review`: Skeptic/Architect/Minimalist review, PASS/CONTESTED/REJECT verdict. No edits. |
| `/noodle do <skill> <id\|->` | Run any skill as a stage, e.g. your own schedulable skill |
| `/noodle loop [n] [--auto]` | Loop: schedule, run stage, schedule again, up to `n` stages (default 5). Each stage in a fresh session. Asks before each stage unless `--auto`. |
| `/noodle stop` | End the loop |

## How the loop works

1. **Mise.** `/noodle` writes `.noodle/mise.json`: open backlog items (with linked `plan`), `noodle/*` branches and whether they're merged, the last 10 stage results from `.noodle/history.jsonl`, and `task_types` (every loaded skill with a `schedule:` field).
2. **Schedule.** The agent applies Noodle's scheduler rules (one plan at a time, plan complex items first, don't repeat succeeded stages, split items that failed twice, blocked by unmerged branches) and ends with `NEXT: <skill> <id>` or `NEXT: idle`.
3. **Stage.** A fresh session runs `/skill:<skill>` for that item.
4. **Record.** When the stage settles, its result is appended to history and the loop schedules again, until the limit, `NEXT: idle`, a decline, an abort, or `/noodle stop`.

## Schedulable skills

Any Pi skill becomes a task type by adding `schedule:`. The scheduler reads it as prose:

```yaml
---
name: changelog
description: Update CHANGELOG.md from merged noodle branches.
schedule: "After a noodle-execute stage merged a user-visible change"
---
```

Bundled: `noodle-plan`, `noodle-execute`, `noodle-review`. With [pi-subagents](https://pi.dev/packages) installed, they delegate exploration, independent changes, and review lenses to child agents.

## Differences from Noodle

- One stage at a time; parallelism happens inside `noodle-execute` via subagents, not a dispatcher.
- No merge queue or auto-merge: branches wait for you. The scheduler sees unmerged branches and treats dependent items as blocked.
- Backlog is `todos.md` only; no adapters (GitHub/Linear/Jira).
- Model routing is advisory (skills name tiers); no per-stage provider config.
- No brain/reflect/meditate memory loop. Add your own scheduled `reflect` skill if you want it.

## Credits

Skills, scheduler rules, and principles adapted from [poteto/noodle](https://github.com/poteto/noodle) by Lauren Tan (MIT): `schedule`, `plan`, `execute`, `quality`, `adversarial-review`, `brain/principles`. Changed for Pi: plain `git worktree` instead of `noodle worktree`, no merge step, no `noodle event` calls, pi-subagents instead of Claude Task/Team tools.

## License

MIT. See [LICENSE](LICENSE).
