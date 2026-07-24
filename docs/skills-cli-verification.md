# skills CLI compatibility verification

Verified on 2026-07-24 with `skills` CLI 1.5.20.

## Scope

This verifies discovery and project-level installation compatibility only. Runtime response quality and identical behavior across agents are outside the verification scope.

## Commands

Run discovery against the repository root:

```sh
npx skills add . --list
```

Run isolated project installations from separate temporary directories:

```sh
npx skills add /path/to/repository --skill '*' --agent claude-code --copy --yes
npx skills add /path/to/repository --skill '*' --agent codex --copy --yes
```

## Results

- Discovery returned exactly seven skills: `adr`, `align`, `brief`, `discover`, `elaborate`, `first-bet`, and `refine`.
- Discovery did not return `dev`, `flow`, `decompose`, `implement`, `verify`, or `review`.
- Claude Code project installation created all seven `SKILL.md` files under `.claude/skills/`.
- Codex project installation created all seven `SKILL.md` files under `.agents/skills/`.
- Every installed `SKILL.md` was byte-identical to its source file.
- Both installations ran under a newly created `/tmp` root. They did not write to this repository or any global agent skill directory.
