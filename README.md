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
| `/noodle stop` | Abort current foreground loop workers |
| `/noodle bg [n]` (1-8) | Run first n open items sequentially in one native pi-subagents workflow (worker then reviewer per item); native TUI and completion wake return result to originating parent |
| `/noodle jobs [run-id]` | Read native pi-subagents status from the current session |
| `/noodle recover` | Mark lost attempts interrupted; retry pending backlog closure after Git ancestry/destination checks |
| `/noodle retry <id>` | Acknowledge interrupted work after inspecting it, allowing a fresh loop attempt |
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
- Worker processes are not adopted after restart. `.noodle/state.json` durably checkpoints attempts (before/after commits, model identity, verdict) and merge intents. Lost running attempts become interrupted, not successful. Session shutdown aborts and drains the loop. Unix workers use process-group TERM followed by KILL after one second; adapter commands have a 60-second timeout and loop cancellation. Windows currently terminates only the direct child, not its entire process tree.
- Logs can include source/task content; treat them as private. Do not put secrets in task descriptions.

## Native background delegation

`/noodle bg 4` first requires a Git repository root, an existing local or adapter backlog with open tasks, and `pi-subagents` agents `worker` and `reviewer`. Native models are explicitly passed from project routing and must resolve to distinct available model IDs. Missing requirements reject launch before native registration; no task/config files are created automatically. Subdirectories and `~` are not inferred or redirected to another repository. It uses pi-subagents' public runtime-agent registration and event-bus spawn API. It requires pi-subagents loaded in the parent Pi session. No separate Noodle job registry, polling loop, fleet implementation or process dashboard is installed. If native launch fails or its reply is lost, inspect native status; do not redispatch blindly and never fall back to an unmanaged process.

`/noodle bg N` (1-8) starts one native `pi-subagents` workflow: for each of the first N open items, sequentially, a `worker` implements in `.noodle/worktrees/<id>` on branch `noodle/<id>` and a `reviewer` reviews it. It never starts a standalone Pi CLI loop; run lifecycle and child evidence belong to pi-subagents. This path does not claim the standalone `/noodle loop` journal/recovery guarantees. Pi's existing subagent TUI shows its task/tool/activity; native completion delivers results to the original parent so it can continue. Use normal subagent status, transcript, stop and interrupt controls for that native run. `/noodle jobs` delegates to the same native status API. `/noodle status` still describes the current repository only.

Background delegation explicitly authorizes unattended stage selection (`--auto`). Native `--merge` is currently rejected: structural phase/review attestation is not implemented yet. Inspect branches and use an explicitly approved manual merge; no pushes. Session ownership, output, run retention and wake policy belong to pi-subagents. Noodle still owns its repository-specific execution/checkpoint policy, not an independent background-job manager.

Legacy native runs saved without explicit model fields cannot resolve under this version and remain fail-closed. Before upgrading an active run, let it finish. For interrupted legacy runs, inspect child termination proofs and Git state before any manual lock removal or relaunch; old arguments are not migrated automatically.

### Native ownership and verified results

Native launch acquires the same `.noodle/owner.lock` as standalone mutation paths before spawning. Another session cannot launch against that repository. Ownership is released only after the workflow's terminal proof: `dispatchClosed` plus observed process-terminal proof for every child (`2 x items`: implementation and review per item). Unknown, missing or mismatched proof, or failed Git verification, retains the lock; inspect before removing it manually.

On observed termination, Noodle checks the launch integration commit, authorized `noodle/<item-id>` branches and worktree cleanliness, writes `.noodle/native-result-<token>.json`, and appends Git evidence to parent context. Test and reviewer claims remain native output, not structurally verified attestations; this check never authorizes merge. Automatic descendant-proof reconciliation and unlock, including after reload, remain future work. This release deliberately fails closed: inspect every native descendant and confirm it has stopped before manually removing a retained lock.

## Recovery

Loop startup reconciles saved state before scheduling. After a crash, first inspect `.noodle/owner.lock/owner.json` and ensure no prior processes remain before removing a stale ownership lock. Run `/noodle recover`; interrupted work is blocked until `/noodle retry <id>` explicitly acknowledges inspection. Successful current-HEAD execute evidence can be reused rather than reimplemented. This is checkpoint-based safe restart, not process adoption or a full persistent orders/DAG engine.

Merge intent is saved before Git. If the recorded commit is already in the recorded base, recovery retries **only** backlog completion. If ancestry is missing, the item enters `attention` and requires manual Git inspection. Already completed intents are not repeated. Remote completion must be idempotent because a crash may occur after the API side effect but before checkpointing.

Recovery is bound to the original destination fingerprint. Set `NOODLE_GH_REPO=owner/repo` explicitly for GitHub. Custom adapters require a stable `backlogIdentity` in `.noodle.json` (include account/project identifiers, not secrets) and idempotent `done`. Script/config/destination changes block replay; restore the original settings or inspect/migrate state manually. Do not delete journal evidence to force a retry.

## Routing

`/noodle bg` requires `routing.noodle-review`. Its implementation model comes from `routing.noodle-execute`, then `routing.default`, then the current session model. Both must resolve to unambiguous available model IDs and must differ (thinking-level suffixes do not make a model independent). Validation happens before lock acquisition or launch; agent defaults cannot override the explicit models. Example: `github-copilot/gpt-6-luna` for execute and `github-copilot/gpt-6-sol` for review. This checks configured identities, not post-run model attestation; native `--merge` remains disabled.

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

Store credentials in your shell/secret manager, not Git. Existing label must exist on GitHub and Linear; Linear creation attaches that label so newly added items remain discoverable. `NOODLE_JIRA_DONE` names the target status, never a transition name. Jira must expose a transition into that status for open issues; already-target-status issues return success. Sources currently return a bounded first page (GitHub/Linear 200, Jira 100); narrow filters for larger queues. Live Jira/Linear mutations require testing against your project's workflows.

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
