# pi-noodle-loop

Supervised backlog loop for [Pi](https://pi.dev), inspired by [poteto/noodle](https://github.com/poteto/noodle). Independent implementation; no Noodle CLI needed.

## Install

```bash
pi install npm:pi-noodle-loop
```

## Commands

Backlog is `todos.md` in the project root, Noodle format (`1. [ ] task`, `<!-- next-id: N -->`).

| Command | Effect |
|---|---|
| `/noodle status` | List open items |
| `/noodle add <text>` | Append item (creates `todos.md` if missing) |
| `/noodle plan` | Agent proposes order, dependencies, risk, verification. No edits. |
| `/noodle run <id>` | Agent implements item in git worktree branch `noodle/<id>`, verifies, commits, marks item done. May delegate via pi-subagents. **Never merges or pushes.** |

You review and merge the branch yourself.

## Not included

Background scheduler, auto-merge, provider/model routing, external backlog adapters.

## License

MIT
