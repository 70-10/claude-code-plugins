---
name: refine
description: Use to refine a GitHub Issue into an approved, self-contained description that an agent can implement and verify without guessing its purpose, scope, or completion criteria.
---

# refine

Turn one identifiable GitHub Issue for repository-contained work into an approved, self-contained issue body that a subsequent agent can implement without access to the conversation history. Do not implement the issue.

Read the issue body, comments, linked material, and relevant repository content before asking questions. Resolve facts through investigation. Ask the user only about unresolved intent or consequential tradeoffs, one question at a time, and wait for each answer.

The revised issue body must convey:

- The purpose, background, and reason the work is needed
- The desired result and scope
- Requirements, exclusions, and behavior that must not regress
- Objective completion criteria and verification methods
- Conditions under which the implementing agent must stop and ask
- Implementation direction, only when needed to preserve an agreed decision

Make every completion criterion objectively judgeable. Include concrete test, lint, type-check, or other commands when they can be established from the repository. When verification cannot be automated, give specific manual steps and expected results.

Leave local, reversible implementation choices to the implementing agent. Resolve the implementation direction with the user when a choice affects public behavior, compatibility, persistent data, security, reversibility, or the expected amount of work.

Preserve useful source information while restructuring the full issue body. Surface contradictions and obsolete requirements instead of silently choosing between them.

When all required content is settled, present the complete proposed body and obtain explicit approval. After approval, replace the GitHub Issue body using the available GitHub tooling and report the updated issue. Do not change the title, labels, or other issue metadata.

If the target issue cannot be identified, ask for it once. If required information remains unavailable, state what is missing and the next question needed, then stop without changing the issue. Do not fill gaps with assumptions, search for other candidate issues, add readiness markers, or handle work whose outcome depends on external operations or stakeholder coordination.
