---
name: elaborate
description: Elaborate on tasks through detailed, structured interviews
allowed-tools: AskUserQuestion
argument-hint: <task description>
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

After the summary, suggest the user switch to plan mode (Shift+Tab) to proceed with implementation planning. Do NOT call ExitPlanMode or attempt to transition into planning yourself.
