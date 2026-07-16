# claude-code-plugins

A collection of Claude Code plugins.

## Plugins

| Plugin | Description |
|--------|-------------|
| [dr](./plugins/dr) | Auto-generate Decision Records (DR) from conversation and save as Markdown files |
| [dev](./plugins/dev) | Run an implementation task in reviewable steps with explicit approval before each step advances |
| [thinking](./plugins/thinking) | Thinking tools for subject alignment, hypothesis selection, requirement elaboration, and implementation briefing |

## Installation

Run the following commands in Claude Code to add this marketplace and install the plugins you want:

```text
/plugin marketplace add 70-10/claude-code-plugins
/plugin install dr@70-10-plugins
/plugin install dev@70-10-plugins
/plugin install thinking@70-10-plugins
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

### dev - Gated Development Flow

Guides an implementation task through planning, small implementation units, testing, and an
independent review. Claude Code shows the result of each step and waits for your explicit approval
before continuing.

Install the plugin, open Claude Code in a Git repository with at least one commit, and run:

```
/dev:flow <what you want to implement>
```

See the [dev plugin guide](./plugins/dev/README.md) for a first-run tutorial, example conversation,
and instructions for resuming or requesting changes.

### thinking - Thinking Tools

Groups skills for clarifying uncertain work before implementation or execution.

#### Skills

- `align` - Identify what to work on when it's unclear whether to start with elaborate, first-bet, or brief.
- `first-bet` - Identify the first hypothesis worth testing when the right answer is unclear.
- `elaborate` - Clarify concepts, requirements, and conceptual designs through dialogue.
- `brief` - Align requirements, completion criteria, and implementation approach before starting implementation.

#### Arguments

- `/align <what is currently known>` - Identify the subject and hand off to the fitting Skill.
- `/first-bet <situation or question>` - Explore the first hypothesis worth testing.
- `/elaborate <concept, requirements, or conceptual design>` - Clarify purpose, scope, success criteria, and constraints.
- `/brief <implementation task>` - Produce an approved, self-contained implementation specification.

#### Explicit Invocation

```
/align
/align not sure if this needs elaborate or brief
/first-bet
/first-bet should we adopt this approach?
/elaborate
/elaborate new feature description
/brief
/brief implement the new plugin structure
```

## License

MIT
