# Changelog

## [0.4.1]

- Gate whole-item merge on completion evidence for every plan phase, including explicit ticket plan paths and single-file plans.
- Require new execution commits rather than counting earlier plan commits as implementation success.
- Pass complete ticket metadata to workers; pin bundled skill discovery to avoid older installed skill shadowing.
- Add exclusive repository ownership across manual runs, loops and merges; reject overlapping Pi sessions.
- Terminate Unix worker process groups with TERM/KILL escalation; bound adapter execution and propagate loop cancellation.
- Record Git merge success separately before remote backlog completion; retain evidence if remote completion fails.

## [0.4.0]

- Parallel Pi subprocess workers with isolated per-item worktrees and per-stage model routing.
- Serialized local merge queue; automatic merging only after successful review with `NOODLE_VERDICT: PASS` and explicit `--merge`.
- GitHub Issues, Jira Cloud and Linear backlog adapter scripts; `/noodle init` and custom adapter support.
- Backlog completion follows successful merge; dirty worktrees and empty branches block merging.
- Child extension discovery disabled to prevent duplicate/recursive orchestrators; bounded stage timeouts.
- Regression coverage for Git merge conflicts, concurrent workers, routing, adapters and fail-closed review protocol.
- Reject unsafe item IDs, failed scheduler processes and staged main-checkout changes; preserve Linear labels on issue creation.
- Real two-worker Pi smoke test verified concurrent execution, both PASS reviews and serialized automatic merges.

## [0.3.0]

- Loop: `/noodle loop [n] [--auto]` runs schedule and stages in fresh sessions until the limit or idle; `/noodle stop`.
- Mise: `.noodle/mise.json` with backlog, plan links, `noodle/*` branch merge state, stage history, and task types.
- Skills with a `schedule:` frontmatter field become task types; `/noodle do <skill> <id>` runs any of them.
- Bundled skills declare `schedule:`; review uses the repo default branch instead of assuming `main`.

## [0.2.0]

- Add skills adapted from poteto/noodle: `noodle-plan`, `noodle-execute`, `noodle-review`, plus condensed principles.
- `/noodle plan` now applies Noodle scheduler rules; `/noodle plan <id>`, `/noodle run <id>`, `/noodle review <id>` load the matching skill.

## [0.1.0]

- Initial release: `/noodle status | add | plan | run`.
