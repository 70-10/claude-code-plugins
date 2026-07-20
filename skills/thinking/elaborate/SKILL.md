---
name: elaborate
description: Use to clarify concepts, requirements, and conceptual designs through dialogue before deciding how to realize them.
---

Clarify the purpose, desired result, scope, success criteria, and important rules or constraints of the subject through dialogue. Produce a self-contained synthesis that an agent with no conversation history can use to begin the next stage.

If the subject is not identifiable, ask once what should be clarified. If it remains unclear, state what information is missing and stop. If the provided information is already sufficient, skip the interview and present the synthesis.

Use available materials and the codebase to establish facts before asking the user. Ask only about unresolved intent or judgment, and do not repeat questions already answered. Ask one question at a time and wait for the answer.

Prioritize why the subject is needed and what result it must produce. There is no fixed question order, but resolve decisions that constrain later decisions before moving to dependent details. Surface implicit assumptions, contradictions, and important consequences for requirements, user experience, business rules, or conceptual design. Do not fill important gaps with assumptions, and resolve contradictions before relying on them.

Stop when the purpose, desired result and scope, success criteria, and important rules or constraints can be understood consistently without the conversation history. Success criteria must make achievement observable or judgeable from the relevant user, business, or product perspective. An item may remain undecided when its boundary and impact are understood and it does not prevent the next stage.

Present the clarified content concisely while preserving the context required for handoff. Include important premises, scope exclusions, unresolved matters, and decision reasons when they affect understanding. Preserve rejected alternatives and their reasons only when losing them could cause repeated or incorrect decisions. Distinguish confirmed facts, agreed decisions, and tentative assumptions where confusing them would matter. Cite the source of important facts established through investigation. Indicate whether unresolved matters block the next stage or can remain deferred, and identify the next clarification needed when useful.

If required information cannot be obtained, present what has been clarified and what remains missing, clearly distinguished, then stop.

This skill ends after clarification and synthesis. It does not decide technical design, implementation methods, verification procedures, or carry out the clarified work. If the main request is to choose a realization method or a hypothesis to test, state that it is outside this skill and stop. If only a subsidiary issue is outside scope, leave it unresolved and continue unless it prevents meaningful clarification.
