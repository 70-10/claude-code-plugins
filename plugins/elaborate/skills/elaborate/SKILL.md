---
name: elaborate
description: Elaborate on tasks through detailed, structured interviews
allowed-tools: AskUserQuestion, EnterPlanMode, Write
argument-hint: <task description>
---

## Initialization

1. Call EnterPlanMode immediately
2. IMPORTANT: Ignore the default plan mode 5-phase workflow. This skill uses its own interview workflow described below.

---

When invoked with arguments:
- Treat the argument as a task description and use it as the subject of the interview

When invoked without arguments:
- Ask the user what task they want to elaborate on using AskUserQuestion, then proceed with the interview

---

## Interview Quality Rules

### Principles for Question Design

1. **Prioritize questions that surface implicit assumptions**
   - Challenge what the speaker unconsciously takes for granted
   - Bring unspoken expectations, constraints, and dependencies to light

2. **Show how each option affects downstream decisions**
   - Add context like "choosing this means you'll need to decide X later" or "this narrows down options for Y"
   - Go beyond simple pros/cons — reveal the chain of consequences

3. **Avoid superficial or obvious questions**
   - Do not ask about things that can be inferred from information already provided
   - Defer trivial details and prioritize structural decisions first

4. **Flag contradictions and unexplored combinations**
   - When answers contradict each other, raise it immediately
   - Present gaps like "achieving both A and B requires C, but C hasn't been decided yet"

### Question Format

- 1–4 questions per round (using AskUserQuestion)
- Include tradeoff explanations for each option
- Keep options representative — users can always provide custom input via "Other"

---

## Completion

Be very in-depth and continue interviewing continually until it's complete, then summarize the elaborated task details.

1. Write the elaborated task specification to the plan file (the file path is provided by the system in plan mode). Use a structured format with clear sections (e.g., Goal, Requirements, Constraints, Decisions Made, Open Questions).
2. The skill's job ends here. Plan mode continues — the user will review the plan and decide how to proceed.
