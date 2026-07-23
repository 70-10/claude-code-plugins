---
name: adr
description: Record decisions — not limited to architecture — as self-contained Architecture Decision Records (ADRs) and save them in the repository. Use when a user asks to record, create, generate, or document a decision, or runs /adr to capture every decision and concrete proposal made in the current session.
---

Record decisions as self-contained ADRs and save them in the repository. In this Skill, ADRs are not limited to architectural decisions.

When a target is specified, record that decision. When invoked without a target, inspect the full current session and record every identifiable decision or concrete proposal. Create a separate ADR for each decision that could be changed, deprecated, or superseded independently, and keep inseparable parts of one decision together. Don't create ADRs for unresolved questions, open comparisons, or ideas that haven't become a concrete proposal. If nothing is recordable, report that no ADR was created and stop.

Use the conversation, code, existing ADRs, and relevant documentation before asking the user for anything you can determine from them. Record only facts, decisions, reasons, and consequences that are explicitly stated or directly verified — don't invent or infer missing rationale, alternatives, impacts, or dates. Reorganizing and summarizing source information without changing its meaning is fine. When information is incomplete, ambiguous, or contradictory, identify exactly what can't be determined and ask only for what's needed to resolve it; if it still can't be resolved, write the ADR anyway and mark the relevant section unknown, unconfirmed, undecided, or contradictory. Don't ask for confirmation when the available information already supports an accurate ADR.

Follow this repository's existing ADR conventions — save location, file naming, template and metadata, language, cross-reference format — whenever they're clear. When no convention exists, save to `adr/`, name files `001-short-title.md` (the next available zero-padded three-digit number plus a concise, filesystem-safe title), write in the language of the source information or the user, and use the [standard format](references/template.md).

Every ADR must communicate the decision date (not the ADR's creation date — record it as unknown if it can't be verified), the current status, the context and reasoning, the decision, and the known consequences, regardless of the repository's own template. Title the ADR as the decision itself, not just its topic.

Status is Proposed (a decision has been proposed but not accepted), Accepted (adopted), Deprecated (no longer recommended, not necessarily replaced), or Superseded (replaced by another ADR). Infer the status when it's clear, and ask the user only when it's ambiguous. A Superseded ADR must reference its replacement; a Deprecated one should reference a successor when one exists.

Write context a reader with no prior knowledge of the discussion, project, or session could use to understand why the decision was made: the background and problem, the requirements, assumptions, and constraints, the facts and decision criteria, the alternatives actually considered and why they were rejected, and the reasoning that led here. Don't invent alternatives or reasons that weren't in the source information. Reference code, documents, or other ADRs instead of duplicating their detail when that's enough to understand or verify the decision.

State the decision itself clearly and concisely.

Record the known effects, costs, constraints, risks, and trade-offs as consequences. Don't force them into positive and negative categories, and don't invent consequences to fill the section.

Preserve the historical content of existing ADRs: when a decision changes, write a new ADR rather than rewriting the original's decision and rationale. When a new ADR clearly replaces an existing one, reference the old ADR from the new one, change the old ADR's status to Superseded, and add a reference from the old ADR to its replacement.

After saving, report each created or updated ADR's status, a concise statement of its decision, and its file path. Stop once the ADRs and any required cross-reference updates are saved and reported.
