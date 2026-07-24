---
name: align
description: Use when what to work on or whether to start with elaborate, first-bet, brief, discover, or refine is unclear. Align on the subject or question and hand off when one fits.
---

Identify the subject or question that should be addressed next. Use available materials and the codebase only as needed to establish what can be known before asking the user.

Ask the user what is currently unclear about the subject. Ask one question at a time and wait for the answer before continuing.

Once the subject or question is clear, select the skill that addresses the main uncertainty blocking progress:

- `elaborate`: the subject is identifiable, but its purpose, desired result, scope, success criteria, or important constraints need clarification.
- `first-bet`: the situation or question is identifiable, but the right answer is unclear and the first hypothesis worth testing must be chosen.
- `brief`: the implementation task is identifiable, but its requirements, completion criteria, and implementation approach need alignment.
- `discover`: the question or problem is identifiable, but the knowledge, context, and important unknowns needed to understand the subject are unclear.
- `refine`: a GitHub Issue is identifiable, but it must be investigated, clarified, and rewritten into an approved, self-contained issue body ready for implementation.

If the subject and matching skill are already clear, skip alignment questions. If multiple skills fit, choose the one that most directly addresses the main unresolved uncertainty. When both `brief` and `refine` fit, choose `refine` if updating the GitHub Issue body is the desired result; choose `brief` if the desired result is an implementation specification without editing the issue.

Continue with the matching skill's workflow, passing the aligned subject or question, confirmed premises, and unresolved points so it can proceed without repeating completed clarification. Do not merely recommend that the user run it, and do not require an additional confirmation before handoff.

If no skill fits, state the aligned subject or question and why none applies, then stop. If the subject or question cannot be identified, state what information is missing and stop.

Do not clarify the identified subject in depth, choose a hypothesis, produce an implementation specification, or carry out the work.
