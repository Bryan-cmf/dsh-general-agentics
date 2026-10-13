# Third-Party Skills — Attribution

## obra/superpowers (MIT)

The following thirteen skills are vendored verbatim from
[obra/superpowers](https://github.com/obra/superpowers)
(MIT License, Copyright (c) 2025 Jesse Vincent) at upstream commit
`bb92a77741419a4ab5f06e711a283343f1ada0c3` (main, fetched 2026-10-13).

| Skill directory | Upstream path |
|---|---|
| `brainstorming/` | `skills/brainstorming/` |
| `writing-plans/` | `skills/writing-plans/` |
| `executing-plans/` | `skills/executing-plans/` |
| `test-driven-development/` | `skills/test-driven-development/` |
| `systematic-debugging/` | `skills/systematic-debugging/` |
| `verification-before-completion/` | `skills/verification-before-completion/` |
| `writing-skills/` | `skills/writing-skills/` |
| `diagnosing-superpowers/` | `skills/diagnosing-superpowers/` |
| `subagent-driven-development/` | `skills/subagent-driven-development/` |
| `dispatching-parallel-agents/` | `skills/dispatching-parallel-agents/` |
| `requesting-code-review/` | `skills/requesting-code-review/` |
| `receiving-code-review/` | `skills/receiving-code-review/` |
| `finishing-a-development-branch/` | `skills/finishing-a-development-branch/` |

- License text: `superpowers/LICENSE` (upstream `LICENSE`, unchanged).
- File contents are unmodified; descriptions keep upstream wording.
- Two upstream skills remain intentionally not vendored:
  - `using-superpowers` — its "check skills before ANY response" rule competes
    with `ga-identity` for control of how the assistant presents itself in a
    white-label deployment (see `docs/packaging-and-installation-plan.md` §3.5).
  - `using-git-worktrees` — team git workflow, out of scope for the baseline.
  Users who want them can install the community port `@wenaixi/dsh-superpower`
  or copy the directories; user/plugin-level skills override these bundled
  copies (bundled rank 600).

## Updating

Re-vendor by copying the skill directories from the upstream repo at a new
commit, updating `superpowers/UPSTREAM-SHA.txt` and the table above.
