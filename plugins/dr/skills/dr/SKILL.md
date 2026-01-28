---
name: dr
description: |
  Automatically generate a Decision Record (DR) from conversation content and save it as a Markdown file.
  Trigger phrases: "Record this decision", "Create a DR", "Generate Decision Record", "Document this decision"
allowed-tools: AskUserQuestion, Glob, Read, Write
---

A skill that automatically generates a Decision Record (DR) from conversation content and saves it as a Markdown file.

## Purpose

Record decisions (not limited to Architecture) as documentation.

## Save Location

`decision-records/` directory in the current working directory

## Invocation

### Explicit Invocation

```
/dr
```

### Trigger Phrases

The following phrases also activate this skill:

- "Record this decision"
- "Create a DR"
- "Generate Decision Record"
- "Document this decision"

## Processing Flow

> **Note**: Claude adapts all questions and interactions to the user's language at runtime.

### 1. Conversation Analysis

Analyze all conversation in the session and extract:

- Topics discussed
- Options considered
- Decisions made and their rationale
- Impacts and consequences

### 2. Automatic Status Determination

Determine Status based on the conversation flow:

| Situation | Status |
|-----------|--------|
| Clear decision made (e.g., "Let's go with...", "We've decided to...") | Accepted |
| Still in proposal stage (e.g., "What about...", "We're considering...") | Proposed |
| Comparing multiple options without conclusion | Proposed |

### 3. Draft Generation

Generate a DR draft from the extracted information.

### 4. Confirmation via AskUserQuestion

Confirm the following items:

1. **Title**: An active voice sentence that concisely describes the decision
2. **Status**: Proposed / Accepted / Deprecated / Superseded
3. **Context**: Background and circumstances that led to the need for this decision
4. **Decision**: The decision content and rationale
5. **Consequences**: Results brought about by the decision

If corrections are needed, reflect them and re-confirm.

### 5. For Deprecated/Superseded Status

If the Status is Deprecated or Superseded, confirm the replacement DR.

### 6. File Saving

After confirmation, save as a Markdown file.

## When No Decision Can Be Extracted

Ask the following via AskUserQuestion:

1. "What decision do you want to record?"
2. "What options were considered?"
3. "What was the final decision?"
4. "What was the rationale for this decision?"

## Template

Based on Michael Nygard's original format:

```markdown
---
tags:
  - DecisionRecord
date: YYYY-MM-DD
---

# Title

## Status

Proposed | Accepted | Deprecated | Superseded

<!-- Only when Status is Deprecated or Superseded -->
Superseded by [[Replacement DR Title]]

## Context

Background and circumstances that led to this decision.
Including technical, political, and social forces.
Describe facts in a value-neutral manner.

## Decision

The decision content.
Write in active voice (e.g., "We will adopt...", "We use...").

## Consequences

Results brought about by this decision.
Include both positive and negative aspects.
```

### Status Descriptions

| Status | Description | Link |
|--------|-------------|------|
| Proposed | Under proposal, not yet approved | None |
| Accepted | Approved, ready for implementation | None |
| Deprecated | No longer recommended, replaced by another DR | Add `Superseded by [[New DR]]` |
| Superseded | Completely replaced | Add `Superseded by [[New DR]]` |

## File Name Format

The file name follows the user's language. The format is:

```
YYYY-MM-DD Title.md
```

### File Name Sanitization

Remove or replace the following characters:

- `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`

### Examples

- `decision-records/2026-01-28 Adopt Next.js as Frontend Framework.md`
- `decision-records/2026-01-28 Use JWT for Authentication.md`

## Output Example

> **Note**: Output language follows the user's language. The example below is in English for documentation purposes.

```markdown
---
tags:
  - DecisionRecord
date: 2026-01-28
---

# Adopt Next.js as Frontend Framework

## Status

Accepted

## Context

We needed to select a frontend framework for a new web application development.

The following requirements were considered:
- SEO support required
- Fast page rendering
- Leverage team's React experience
- Future scalability

## Decision

We adopt Next.js as our frontend framework.

Reasons for selection:
- SEO support via SSR/SSG
- React-based, low learning curve for the team
- Strong support from Vercel
- Active community

Alternatives considered:
- Create React App: No SSR/SSG support
- Gatsby: Overkill for our requirements
- Vue/Nuxt: Cannot leverage team's React experience

## Consequences

### Positive

- SEO support becomes easier
- Fast page rendering can be achieved
- Existing React knowledge can be utilized

### Negative

- Learning Next.js-specific concepts required
- Potential increased dependency on Vercel
```

## Completion Notification

Output the saved file path.

Example: `decision-records/2026-01-28 Adopt Next.js as Frontend Framework.md`
