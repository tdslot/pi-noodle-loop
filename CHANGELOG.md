# Changelog

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
