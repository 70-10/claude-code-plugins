# claude-code-plugins

A collection of Claude Code plugins.

## Plugins

| Plugin | Description |
|--------|-------------|
| [dr](./plugins/dr) | Auto-generate Decision Records (DR) from conversation and save as Markdown files |

## Installation

Add marketplace:

```bash
/plugin marketplace add 70-10/claude-code-plugins
```

Install plugin:

```bash
/plugin install dr@70-10-plugins
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

## License

MIT
