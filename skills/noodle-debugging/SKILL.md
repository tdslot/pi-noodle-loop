---
name: noodle-debugging
description: Diagnose reported runtime failures, flaky tests and broken behavior with reproduction, competing hypotheses and root-cause evidence before patching. Use for bugs, crashes, errors and failed Noodle tasks.
---

# Debugging

Adapted from poteto/noodle debugging/oops and fix-root-causes guidance (MIT).

1. Capture expected vs actual behavior, exact error and smallest reproduction. Check relevant repository instructions, domain skills and recent changes. Keep investigation read-only until the failure is understood.
2. Trace the failing path and real state. Distinguish facts, hypotheses and unknowns. For restart-only failures inspect persistent state, stale locks and caches before assuming code changed.
3. Form explicit competing hypotheses. Test the cheapest discriminating observation first; instrument when evidence is insufficient. Change one variable at a time; do not accumulate speculative patches.
4. Locate the violated contract at its source. Do not swallow errors, add retries, clear state or add guards merely to hide a symptom. Validate input at trust boundaries and preserve errors that prevent data loss.
5. Load noodle-testing: reproduce the root cause as a failing regression, apply the smallest scoped fix, then verify focused and full required checks and the actual runtime path.
6. If the plan or scope is wrong, report it rather than silently widening the task. Record unrelated discoveries as follow-up findings. Stop on production mutation, destructive ambiguity or unresolved verification requirements.
7. Report root cause, evidence, changed files, verification and remaining uncertainty. Encode recurring failures as tests or checks; do not substitute promises for enforcement.
