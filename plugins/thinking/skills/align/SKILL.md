---
name: align
description: Use when what to work on or whether to start with elaborate, first-bet, or brief is unclear. Align on the subject or question and hand off when one fits.
argument-hint: <what is currently known>
---

Identify the subject or question that should be addressed next. Use available materials and the codebase only as needed to establish what can be known before asking the user.

Ask the user what is currently unclear about the subject. Ask one question at a time and wait for the answer before continuing.

Once the subject or question is clear, select the Skill that addresses the main uncertainty blocking progress:

- `elaborate`: the subject is identifiable, but its purpose, desired result, scope, success criteria, or important constraints need clarification.
- `first-bet`: the situation or question is identifiable, but the right answer is unclear and the first hypothesis worth testing must be chosen.
- `brief`: the implementation task is identifiable, but its requirements, completion criteria, and implementation approach need alignment.

If the subject and matching Skill are already clear, skip alignment questions. If multiple Skills fit, choose the one that most directly addresses the main unresolved uncertainty.

Invoke the matching Skill with the aligned subject or question, confirmed premises, and unresolved points so it can continue without repeating completed clarification. Do not merely recommend that the user run it, and do not require an additional confirmation before handoff.

If no Skill fits, state the aligned subject or question and why none applies, then stop. If the subject or question cannot be identified, state what information is missing and stop.

Do not clarify the identified subject in depth, choose a hypothesis, produce an implementation specification, or carry out the work.
