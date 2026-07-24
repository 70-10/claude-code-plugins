# Agent Skills

Reusable [Agent Skills](https://agentskills.io/) for decision documentation and structured thinking. Install only the skills you need with the [`skills` CLI](https://github.com/vercel-labs/skills).

## Published skills

| Skill | Description |
| --- | --- |
| `adr` | Record every identifiable decision from the current session, code, and documentation as self-contained ADRs |
| `align` | Identify the subject to address and continue with the appropriate thinking workflow |
| `brief` | Produce an approved, self-contained implementation specification |
| `discover` | Build an evidence-based understanding of an identified question or problem |
| `elaborate` | Clarify purpose, scope, success criteria, and constraints through dialogue |
| `first-bet` | Choose the first hypothesis worth testing when the answer is unclear |
| `refine` | Refine a GitHub Issue into an approved, self-contained description ready for implementation |

## Installation

List the available skills without installing them:

```sh
npx skills add 70-10/skills --list
```

Install selected skills interactively, or name them explicitly:

```sh
npx skills add 70-10/skills
npx skills add 70-10/skills --skill adr --skill brief
```

Install every published skill to every detected agent:

```sh
npx skills add 70-10/skills --all
```

Target a specific agent for a project-level installation:

```sh
# Claude Code
npx skills add 70-10/skills --skill '*' --agent claude-code

# Codex
npx skills add 70-10/skills --skill '*' --agent codex
```

Project-level installation is the default. Add `--global` only when you intentionally want to install into your user-level skill directories.

## Breaking change from the former marketplace

The former Claude Code Plugin Marketplace is no longer distributed from this repository. The `dr` plugin is now the agent-independent `adr` skill; update references from `dr` to `adr` when migrating.

The archived Claude Code-only `dev` plugin is not an Agent Skill, is no longer maintained, and is not distributed by `npx skills`. Its source remains available for reference under [`legacy/claude-code/dev`](./legacy/claude-code/dev).

## License

[MIT](./LICENSE)
