# Standard ADR Format

Use this template when the repository has no existing ADR convention.

```markdown
---
date: YYYY-MM-DD
---

# Decision stated as a sentence

## Status

Proposed | Accepted | Deprecated | Superseded

## Context

The self-contained context, reasoning, considered alternatives, and relevant references.

## Decision

The decision.

## Consequences

The known consequences and trade-offs.
```

Use `date: unknown` when the decision date can't be verified.

Name the file using the next available zero-padded three-digit number and a concise, filesystem-safe title, e.g. `adr/003-adopt-nextjs-as-frontend-framework.md`.
