---
name: noodle-testing
description: Reproduce bugs with failing regression tests; verify behavior changes using project-native tests and real feature paths. Use before fixing bugs or implementing behavior in Noodle tasks.
---

# Testing

Adapted from poteto/noodle testing and execute verification guidance (MIT); use the target project's tools, not upstream Go commands.

1. Discover test/build/lint commands from repository instructions, package scripts and CI. Read matching installed testing/domain skills.
2. For a bug, reproduce the reported behavior first. Write the smallest regression test and run it against unfixed code. Confirm it fails for the reported reason, not a fixture/setup failure.
3. For new behavior, express observable acceptance criteria in a test before implementing when practical. Test outcomes, trust boundaries, errors and important edge cases, not private implementation details.
4. Change only the scoped root cause or behavior. Run the focused test until green, then the project's required suite, type checks and lint.
5. Exercise the actual user/runtime path when integration behavior changes. UI work needs interaction/accessibility checks and visual evidence; a successful build alone is not verification.
6. Never remove, skip or weaken tests to get green. Do not regenerate fixtures blindly; inspect changes against intended behavior.
7. Record exact commands and results, including red/green evidence and missing checks. Commit only verified scoped work under repository conventions; do not commit broken tests separately if project policy forbids failing commits.

If reproduction or required verification is impossible, state the blocker. Do not claim verified completion or mark the phase complete.
