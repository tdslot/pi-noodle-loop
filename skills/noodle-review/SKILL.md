---
name: noodle-review
description: Adversarial quality gate for a finished noodle branch, diff, or plan - Skeptic/Architect/Minimalist lenses, preferably on a different model, producing a PASS/CONTESTED/REJECT verdict; makes no changes. Use for "/noodle review <id>", "review this branch", "quality check", "adversarial review".
schedule: "Follow-up after noodle-execute on the same item, before the human merges; prefer a different model than the one that wrote the code"
---

# Noodle Review

Challenge completed work. The deliverable is a verdict; **make no changes**. Adapted from poteto/noodle `quality` + `adversarial-review` (MIT). Principles: [../noodle-execute/references/principles.md](../noodle-execute/references/principles.md).

## 1. Scope and intent

Find the target: the `Worktree:` and branch `noodle/<id>` named in the prompt, a plan file, or a given diff. Read the item/plan. State the **intent** explicitly: reviewers judge whether the work achieves it well, not whether the intent is right.

Base = the repo's default branch (`main`, `master`, ...; check `git symbolic-ref refs/remotes/origin/HEAD` or `git branch`). Gather: `git diff --stat <base>...<branch>`, `git log --oneline <base>..<branch>`, full diff.

## 2. Mechanical gate

Run the project's checks (build, types, tests, lint) in the worktree via absolute paths or `git -C`. Any failure is high severity. Files changed outside the item/plan scope are scope violations.

## 3. Lenses

| Size | Reviewers |
|---|---|
| < 50 lines, 1-2 files | Skeptic |
| 50-200 lines, 3-5 files | Skeptic + Architect |
| 200+ lines or 5+ files | Skeptic + Architect + Minimalist |

- **Skeptic** (correctness): inputs, states, sequences that break it; swallowed errors; races and ordering; claims not proven; "works on my machine" posing as verification. Principles: prove it works, fix root causes, serialize shared-state mutations.
- **Architect** (structure): does the design serve the stated goal; coupling that hurts when requirements shift; boundary leaks; assumptions about scale, concurrency, ordering. Principles: boundary discipline, foundational thinking, redesign from first principles.
- **Minimalist** (necessity): what can be deleted without losing the goal; problems solved before they exist; abstractions with one call site; config without a second use. Principles: subtract before you add, outcome-oriented execution, cost-aware delegation.

Also check: new behavior has new tests asserting outcomes; runtime checks from the plan were actually performed.

The loop requires a separate review invocation on an explicitly known model different from the implementation model. Configure `routing.noodle-review`; missing or matching model blocks review rather than silently falling back. This review invocation is the independent reviewer. Apply the lenses here; if additional reviewer tooling is available, it may provide separate fresh-context lenses, but do not claim tools were used when unavailable.

Read the plan's Applicable skills and relevant installed domain guidance before judging the diff. Self-review in a manual session may produce findings, but is not independent evidence and must not be represented as an independent PASS.

## 4. Verdict

```
## Intent
<what the author is trying to achieve>

## Verdict: PASS | CONTESTED | REJECT
<one-line summary>

## Findings
<numbered, high -> medium -> low>
- **[severity]** description with file:line
- Lens / Principle
- Recommendation: concrete action

## What went well
<1-3 items>

## Lead judgment
<accept or reject each finding, one line why>
```

- **PASS**: no high-severity findings.
- **CONTESTED**: high-severity findings, reviewers disagree.
- **REJECT**: high-severity findings with consensus. Write findings so a retry run can act on them directly.

End with exactly one machine-readable line, untranslated: `NOODLE_VERDICT: PASS`, `NOODLE_VERDICT: CONTESTED`, or `NOODLE_VERDICT: REJECT`. Only a successful review process with `NOODLE_VERDICT: PASS` allows `/noodle loop --merge` to merge. Low-severity, non-blocking issues: list them as suggested backlog items.
