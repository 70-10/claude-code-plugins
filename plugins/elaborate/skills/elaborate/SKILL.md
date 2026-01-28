---
description: Elaborate on specifications through detailed, structured interviews
allowed-tools: AskUserQuestion, Write, Read
argument-hint: [@path/to/spec.md] | [description] | [leave empty]
---

When invoked with arguments:
- If the argument is a file path (contains `.md` or path separators), read that file and use its content as the base for the interview, then write the refined spec back to the same file
- If the argument is plain text (description), use that as the initial requirement and create a new spec file with an appropriate name (e.g., `projects/spec-<summary>.md`)

When invoked without arguments:
- First ask what the spec should be about and where to save it, then proceed with the detailed interview

---

Interview me in detail using the AskUserQuestionTool (typically 1-4 questions per round with clear tradeoffs for each option) about literally anything: technical implementation, UI & UX, concerns, edge cases, etc. Make sure the questions are not obvious and each option clearly explains its tradeoffs.

Be very in-depth and continue interviewing me continually until it's complete, then write the spec to the file.
