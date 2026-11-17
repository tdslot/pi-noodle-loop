---
name: noodle-execute
description: Implement one backlog item or plan phase end to end in an isolated git worktree - scope, decompose, implement, verify, commit, report; never merges. Use for "/noodle run", "execute item", "implement this todo", "build this phase".
schedule: "When a backlog item is small and clear, or has a linked plan with unchecked phases"
---

# Noodle Execute

Process for doing the work; the item/order says *what*. Adapted from poteto/noodle `execute` (MIT). Read [references/principles.md](references/principles.md) once before starting.

Work autonomously. Don't stop until done or genuinely blocked. Ask only on real ambiguity or destructive/irreversible actions. Track changes with the task/todo tool if available: one task per change.

## 1. Scope

- **Backlog item**: read it in `todos.md`. If it links a plan (`plans/...`), read the overview and the assigned phase.
- **Ad-hoc request**: the prompt is the scope.

Identify affected files and packages. Write down a bounded scope: what changes, what explicitly doesn't.

## 2. Decompose

Split into discrete changes. Each change: one function/type + its tests, or one bug fix; independently compilable; one commit. Single-change scopes skip this.

## 3. Implement

### Worktree first (non-negotiable)

Never edit the main checkout: concurrent sessions cause conflicts and lost work.

- Already inside a worktree for this item? Use it.
- Otherwise: `git worktree add -b noodle/<id>-<slug> <repo>/../<repo>-worktrees/<id>-<slug>` (or `.worktrees/` if the repo ignores it).
- Use absolute paths or `git -C <worktree>`. Never `cd` into a worktree: if it is removed while the shell is inside, the session breaks.
- Commit inside the worktree. **Do not merge or push.** The human reviews and merges.

Skip the worktree only if the user explicitly chooses to work on main in an interactive session.

### Delegation

- **Self-execute**: one change, or tightly coupled changes (shared types, sequential dependencies).
- **Subagents** (pi-subagents, if installed): 2+ independent changes in different files. Front-load scope, relevant code, constraints. One writer per worktree: give each writer its own worktree branched from yours, review each before merging into your item branch.
- Before parallelizing ask: "does any change's output become another's input?" Shared type/API contracts mean sequential.
- Mechanical work (renames, boilerplate) can go to a cheaper/faster model; architectural decisions stay with a strong one.

## 4. Verify

Before every commit run this project's full checks: discover them from `package.json` scripts, `Makefile`, `justfile`, CI config, README. Typically build + type check + tests + lint.

- "It compiles" is not verification. Exercise the changed behavior on its real path.
- New behavior gets new tests; tests assert outcomes, not implementation details.
- Never commit failing code: fix and re-verify.
- `git -C <worktree> diff --stat` must match the stated scope.

## 5. Commit

`<type>(<scope>): <description>`; types `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. One commit per logical change. Follow the repo's own convention if it differs.

## 6. Report

When verified: mark the item `[x]` in the main checkout's `todos.md` (only that line). Finish with:

- branch and worktree path
- commits (`git log --oneline <base>..HEAD`, base = repo default branch)
- verification commands run and results
- out-of-scope findings, open risks, plan/requirement problems

## Scope discipline

- Change only what's in scope. No defensive code, backward-compat shims, or speculative features.
- Out-of-scope discoveries go in the report (or `/noodle add`), not into this diff.
- Wrong or incomplete requirements: flag it; don't silently deviate.
