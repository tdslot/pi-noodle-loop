# pi-noodle-loop

[Noodle](https://poteto.github.io/noodle/introduction.html)'s skill loop adapted to Pi. A scheduler reads skill `schedule:` fields, backlog and recent results. Workers execute stages in isolated git worktrees; independent items can run in parallel.

## Install

```sh
pi install git:github.com/tdslot/pi-noodle-loop
```

Do not load a local copy and an installed package together: duplicate `/noodle` commands receive numeric suffixes. For isolated local testing:

```sh
pi --no-extensions -e ./pi-noodle --skill ./pi-noodle/skills
```

## Commands

| Command | Effect |
|---|---|
| `/noodle status` | Open items and current workers |
| `/noodle add <text>` | Add local or adapter-backed item |
| `/noodle plan` | Scheduler pass only |
| `/noodle plan <id>` | Write phased plan on item's branch |
| `/noodle run <id>` | Execute on item's branch |
| `/noodle review <id>` | Review item's branch |
| `/noodle do <skill> <id\|->` | Run a loaded skill for an item, or `-` without one |
| `/noodle loop [n] [--parallel k] [--auto] [--merge]` | Run at most `n` stages (default 5), at most `k` concurrent workers (default 1) |
| `/noodle stop` | Abort current loop workers |
| `/noodle merge <id>` | Explicitly merge branch and mark item done |
| `/noodle init <github\|jira\|linear>` | Copy adapter scripts into project and configure `.noodle.json` |

`--auto` skips per-stage confirmation. `--merge` explicitly authorizes automatic local merges after a successful review with the exact machine-readable `NOODLE_VERDICT: PASS` result. No pushes. Without `--merge`, review branches yourself and call `/noodle merge <id>`.

```text
/noodle add Rename legacy helper and add regression test
/noodle loop 8 --parallel 2 --auto --merge
```

## Execution and safety

- Branch `noodle/<id>`, worktree `.noodle/worktrees/<id>` created by the extension, reused by plan/execute/review stages.
- `.noodle/owner.lock` grants exclusive repository ownership for mutation-capable operations. Other Pi sessions must wait. A crash may leave a stale lock: inspect its `owner.json` and verify the owner is no longer running before removing it; locks are never stolen automatically.
- Planned tasks merge only when every phase file contains a checked `- [x] NOODLE_PHASE_COMPLETE` marker and no unchecked markers. Existing plans without markers fail closed; add completion evidence after verification. An overview uses sibling `phase-*.md` files; single-file plans keep all markers in that file.
- Execute must create a new commit; earlier planning commits cannot satisfy its success check. Full ticket metadata is included in worker prompts.
- Loop stages run as `pi -p` subprocesses. Child extension discovery is disabled to prevent recursive orchestrators and duplicate command conflicts. Built-in tools and skills remain available; extension-provided tools such as pi-subagents are not loaded in these subprocesses. Bundled skills are pinned first; additional loaded parent skill paths are forwarded explicitly to workers, without forwarding extension code. Domain skill guidance is available even when its extension tools are not; workers must report missing required tools.
- Scheduler and workers use separate model invocations. Each worker commits only in its worktree. Scheduler only proposes stages.
- Merge queue is serialized. Staged main-checkout changes, a dirty tracked main checkout (except unstaged `todos.md`) or dirty worker checkout blocks merging. Conflicts are aborted and recorded; branches/worktrees retained for inspection. Empty branches are not considered completed work.
- Backlog item becomes done only after merge, not after implementation.
- `.noodle/mise.json`: backlog, plan paths, item branches, active workers, available slots, routing and schedulable skills. `.noodle/history.jsonl`: stage/merge results. `.noodle/logs/`: worker logs. Runtime directory self-gitignored.
- Scheduler decisions are model judgments, not dependency proofs. Use conservative concurrency for related items.
- Loop state is in memory, not restart-resumable. Committed branches, worktrees, history and logs survive. Session shutdown aborts and drains the loop. Unix workers use process-group TERM followed by KILL after one second; adapter commands have a 60-second timeout and loop cancellation. Windows currently terminates only the direct child, not its entire process tree.
- Logs can include source/task content; treat them as private. Do not put secrets in task descriptions.

## Routing

Project `.noodle.json` (optional):

```json
{
  "routing": {
    "default": "provider/model",
    "scheduler": "provider/reasoning-model",
    "noodle-execute": "provider/coding-model",
    "noodle-review": "provider/review-model"
  },
  "timeoutMinutes": 60
}
```

Use model identifiers from `pi --list-models`; no credentials in this file. Scheduler may propose `NEXT: noodle-execute 42 @provider/model`. Explicit stage model overrides routing, then skill routing, then default. Omitted worker model uses the parent's current model when available. Exact model IDs are validated against Pi's available registry; fuzzy aliases are rejected for workers. Review requires a successful execute with a recorded canonical model identity and a different canonical review identity. Set `routing.noodle-review` explicitly. Different thinking levels of the same model do not count as independent review. Older history without canonical model evidence cannot authorize review/automatic merge; rerun execution with current version.

## Backlog adapters

Default source: project-root `todos.md`, Noodle numbered checkbox format:

```markdown
# Todos
<!-- next-id: 2 -->
## Inbox
1. [ ] First task
```

`/noodle init` copies scripts and writes adapter configuration. Requires Bash, jq, plus gh (GitHub) or curl (Jira/Linear). Inspect scripts before enabling; `done` closes/transitions remote issues after merge.

| Adapter | Environment |
|---|---|
| GitHub | Existing `gh auth login`; optional `NOODLE_GH_REPO=owner/repo`, `NOODLE_GH_LABEL` (default `noodle`, empty selects all) |
| Jira Cloud | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`; optional `NOODLE_JIRA_JQL`, `NOODLE_JIRA_DONE` (default `Done`); creation requires `NOODLE_JIRA_PROJECT`, optional `NOODLE_JIRA_TYPE` |
| Linear | `LINEAR_API_KEY`, `NOODLE_LINEAR_TEAM`; optional `NOODLE_LINEAR_LABEL` (default `noodle`, empty selects all) |

Store credentials in your shell/secret manager, not Git. Existing label must exist on GitHub and Linear; Linear creation attaches that label so newly added items remain discoverable. Jira transition must be available for each issue. Sources currently return a bounded first page (GitHub/Linear 200, Jira 100); narrow filters for larger queues. Live Jira/Linear mutations require testing against your project's workflows.

Custom adapter contract:

```json
{
  "adapters": {
    "backlog": {
      "sync": "adapters/backlog-sync",
      "add": "adapters/backlog-add",
      "done": "adapters/backlog-done"
    }
  }
}
```

Commands run relative to project root. `sync` emits NDJSON objects requiring `id`, `title`; optional `status: done`, `plan`, other metadata passed through. `add` gets JSON `{ "title": "..." }` on stdin, prints ID. `done` gets ID as first argument.

## Skills

Bundled `noodle-plan`, `noodle-execute`, `noodle-review`, `noodle-testing` and `noodle-debugging` adapt Noodle's process and principles. Planning records Applicable skills by name/path; execution and review read matching domain guidance. Testing requires bug reproduction and red/green evidence; debugging separates hypotheses from facts and fixes scoped root causes. Manual self-review is not independent evidence. Any loaded skill with `schedule:` becomes schedulable. Example:

```yaml
---
name: reflect
description: Capture reusable lessons from completed stages.
schedule: "After a reviewed item merged successfully"
---
```

No brain memory vault or external cloud runtime is installed. General skills remain independently callable.

## Verification

Node.js with native TypeScript stripping:

```sh
npm test
shellcheck -S warning adapters/*/*
npm pack --dry-run
```

Tests cover parsing, adapter failures, real Git worktrees/conflicts, parallel workers, routing, serialized merges and confirmation gating. Real Pi smoke tests exercised two concurrent execute workers, both reviews and serialized automatic merges in a disposable repository.

## Credits / license

MIT. Skills, scheduling rules and principles adapted from [poteto/noodle](https://github.com/poteto/noodle) by Lauren Tan. Plain Git replaces Noodle CLI; Pi processes replace its runtime. See LICENSE for original and adaptation notices.
