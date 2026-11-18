# Changelog

## [0.7.0]

- `/noodle bg` delegates one bounded loop to native pi-subagents via public event RPC, with native TUI activity and completion return to parent.
- `/noodle jobs` forwards native subagent status; no standalone background registry or polling manager.
- Missing native integration fails closed; no silent CLI fallback.

## [0.6.0]

- Atomic, fsynced attempt journal with before/after commits, model identity and verdict evidence.
- Lost running attempts become interrupted and require inspected `/noodle retry <id>` acknowledgment before loop dispatch.
- Persist merge intent before Git and reconcile pending backlog closure using saved commit ancestry, without rerunning implementation.
- Bind recovery to a stable backlog destination fingerprint; reject changed adapters/destinations.
- Jira completion succeeds idempotently when already in the requested terminal state.
- Independent review uses durable successful execution evidence at the exact reviewed HEAD.

## [0.5.0]

- Forward parent domain skill paths into isolated workers; plan/execute/review explicitly load applicable domain guidance.
- Add portable testing/debugging workflows with reproduction, regression evidence and scoped root-cause verification.
- Require distinct canonical implementation/review model identities; reject self-review, thinking-only variations, fuzzy model aliases and unknown prior model evidence.
- Restore experience-first principle, external API compatibility qualifiers and scoped-fix discipline.
- Recognize CRLF skill frontmatter.
- Verified real GPT implementation / Claude review / automatic merge in disposable repository.

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
