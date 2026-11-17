---
name: noodle-plan
description: Write a phased implementation plan for a medium/large backlog item (3+ files, new architecture, unclear scope) to plans/; does not implement. Use for "/noodle plan <id>", "plan this", "break this down", items tagged #needs_plan.
schedule: "When a backlog item is complex (3+ files, new architecture, ambiguous or cross-cutting scope) and has no linked plan yet"
---

# Noodle Plan

The plan is the deliverable. **Do not implement.** Adapted from poteto/noodle `plan` (MIT). Principles: [../noodle-execute/references/principles.md](../noodle-execute/references/principles.md); read before writing.

## 0. Triage

Trivial (1-2 files, obvious approach)? Say it needs no plan, suggest `/noodle run <id>`, stop.

Plan when: 3+ files or new architecture, multiple valid approaches, unclear or cross-cutting scope, or the user asked.

## 1. Scope

Resolve real ambiguity first (in scope / out of scope, constraints, what "done" looks like). Offer concrete options. If clear, state boundaries and move on.

## 2. Explore

Delegate broad exploration to read-only subagents when available (pi-subagents `scout`/`researcher`); run independent areas in parallel. Keep summaries, not raw output, in the main context. Map: affected code, patterns and conventions, dependencies, tests, verification commands.

## 3. Write the plan

Small plan: `plans/<id>-<slug>.md`. 3+ phases: directory `plans/<id>-<slug>/` with `overview.md` and `phase-N-<name>.md`. The `<id>-` prefix is how `/noodle` links the plan to the item.

If the prompt names a `Worktree:`, write the plan files there and commit them (`docs(plan): ...`); the plan merges with the item's branch. Otherwise write them in the current checkout.

**Overview** must have: Context (problem, why), Scope (in / explicitly out), Constraints, Alternatives (2-3 sketched for architectural choices, which chosen and why), Phases (ordered links), Verification (project-level commands).

**Each phase** must have: back-link to overview; Goal; Changes (files + what, high level); Data structures (name key types; one-line sketch max); Model tier (fast for mechanical, strong for judgment); Verification: static (types, lint, tests) and runtime (feature path to exercise, edge cases, tests to add).

### Phase sizing

- 1 function/type + tests, or 1 bug fix, per phase. Max 2-3 files.
- Prefer many small phases over a few large ones. >5 test cases or >3 functions: split.
- Order: deletions first, then shared infrastructure/types, then features. Each phase independently shippable.
- Mark which phases are independent (parallelizable) vs dependent (output feeds another).

### Design checks

- Redesign check for existing code: "built from scratch with this requirement, what would we build?" Don't bolt on.
- No code blocks in phases. Name types and functions; describe shape in prose, like a brief to a senior engineer.
- "It compiles" is not verification. A phase needing manual app testing must say so.

## 4. Link and self-check

- Do not edit the backlog; the `plans/<id>-` prefix links the plan.
- Verify: overview cites at least 2 principles by name; no phase touches >3 files; no code blocks in phases.

## 5. Present and stop

Summarize phases, scope boundaries, verification approach. Suggest `/skill:noodle-review` on the plan for risky work. Stop: the user decides when to run it.
