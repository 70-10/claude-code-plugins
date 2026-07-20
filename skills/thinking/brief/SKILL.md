---
name: brief
description: Use before starting an implementation task when the requirements, completion criteria, and implementation approach need to be aligned.
---

# brief

Turn an implementation task into an approved, self-contained implementation specification by inspecting the codebase and aligning understanding with the user. The result must contain enough context for another AI agent, with no access to the conversation history, to implement and verify the task without additional clarification.

Ask one question at a time and wait for the answer before continuing. Do not ask the user for information that can be determined from the codebase. If the user's description conflicts with the code or existing behavior, surface the conflict and resolve it with the user.

The implementation specification must include:

- The current state and why the change is needed
- What must be implemented
- Completion criteria and detailed methods for verifying them
- The implementation approach and the reasoning behind major decisions
- The references, constraints, behavior that must not regress, and conditions under which implementation must stop for clarification

When they can be confirmed from the codebase, include the relevant files, symbols, and concrete commands for testing, linting, type checking, or other verification. Do not invent information that cannot be verified.

Once sufficient shared understanding has been reached, present the self-contained implementation specification and obtain the user's approval. If the specification cannot be finalized because required information is unavailable, state what information is missing and stop.

Do not implement the task, write the specification to a file, perform investigation or design as an independent objective, or finalize a specification by filling unresolved matters with assumptions.
