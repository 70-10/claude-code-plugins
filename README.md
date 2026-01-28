# claude-code-plugins

A collection of Claude Code plugins.

## Plugins

| Plugin | Description |
|--------|-------------|
| [dr](./plugins/dr) | Auto-generate Decision Records (DR) from conversation and save as Markdown files |
| [elaborate](./plugins/elaborate) | Elaborate on specifications through detailed, structured interviews |

## Installation

Add marketplace:

```bash
/plugin marketplace add 70-10/claude-code-plugins
```

Install plugin:

```bash
/plugin install dr@70-10-plugins
/plugin install elaborate@70-10-plugins
```

## Usage

### dr - Decision Record Generator

Automatically generates a Decision Record from your conversation and saves it as a Markdown file.

#### Trigger Phrases

- "Record this decision"
- "Create a DR"
- "Generate Decision Record"
- "Document this decision"

#### Explicit Invocation

```
/dr
```

#### Output

Decision Records are saved to `decision-records/` directory in the current working directory.

### elaborate - Specification Interview Tool

Helps you elaborate on specifications through detailed, structured interviews.

#### Arguments

- `@path/to/spec.md` - Use an existing spec file as the base for the interview
- `description` - Create a new spec file from text requirements
- No arguments - Interactively decide where to save and what to write

#### Explicit Invocation

```
/elaborate
/elaborate @path/to/spec.md
/elaborate new feature description
```

## License

MIT
