# Principles

Adapted from [poteto/noodle](https://github.com/poteto/noodle) `brain/principles/` (MIT, (c) 2026 Lauren Tan). Condensed for Pi.

## Core

- **Foundational thinking.** Structural decisions (data models, phase order) optimize for option value; code-level decisions optimize for simplicity. Get data structures right before logic; trace every read/write/lookup through them. Bad complexity: one-use helpers, flags for hypothetical needs, "in case we swap X" layers.
- **Redesign from first principles.** Don't bolt a change onto the old design. Ask "if we built this from scratch with this requirement, what would we build?" Propagate through types, docs, examples so nothing reads as a patch. Think holistically, deliver incrementally.
- **Subtract before you add.** Remove dead code, unused features, needless abstraction first; then build. Design for observed usage, not speculative edge cases. Simplify prompts too.
- **Outcome-oriented execution.** Optimize for the verifiable end state, not smooth intermediate states. Planned, scoped, reversible intermediate breakage is fine; final verification is not optional. Don't keep obsolete paths alive just to keep each step green.
- **Exhaust the design space.** For novel or architectural decisions with no precedent, sketch 2-3 alternatives, compare, then commit. Skip for obvious choices.

## Architecture

- **Boundary discipline.** Validate and handle errors at system boundaries (CLI args, config, external APIs, files). Trust internal typed data; no re-validation. Business logic in pure functions; the shell stays thin.
- **Make operations idempotent.** Every mutation answers: "what if this runs twice? what if the last run crashed halfway?" Converge to correct state from any start.
- **Migrate callers, then delete legacy APIs.** Move every caller to the new API, then delete the old one in the same effort. No permanent shims.
- **Serialize shared-state mutations.** Concurrent actors on shared files/branches need structural serialization (lockfile, sequential phases, exclusive ownership) or no sharing (separate worktrees). Instructions alone don't prevent races.

## Verification

- **Prove it works.** Check the real thing, not a proxy (self-reports, mtimes, "it compiles"). Build, run, exercise the actual feature path end to end, test error paths. When verification fails, suspect the observation method first.
- **Fix root causes.** Reproduce first. Ask "why" until bedrock; fix there, not with guards. Grep for the same pattern elsewhere. After restarts, suspect stale state before code. Own every file you touch: no "pre-existing" excuse for issues in it.

## Delegation

- **Cost-aware delegation.** Every delegation has overhead. Front-load context so children don't rediscover it. Hard-cap scope (about 1 function/type + tests, 2-3 files per unit). Pick the cheapest mechanism that works.
- **Guard the context window.** Route large outputs to subagents or files; keep summaries in the main context. Don't read what you won't use.
- **Don't block on the human for low-stakes choices.** Proceed, then present; the human reviews after the fact. Ask only on genuine ambiguity or irreversible/destructive actions.

## Meta

- **Encode lessons in structure.** When writing the same instruction twice, turn it into a lint rule, test, script, or metadata. Text instructions get ignored; mechanisms don't.
