# Plan Guide — Creating Better Plans in Cursor

Practical guidance for creating plans, expressing requirements, and managing todos effectively in Cursor.

---

## Creating Plans

1. **Give plans a clear name and overview** — The plan name and overview should tell you (or the agent) exactly what you're building or changing at a glance.

2. **Include enough context** — The agent (or future you) won't have full context. Reference relevant files, prior decisions, or constraints so the scope is clear.

3. **Break work into logical sections** — Each section should describe one cohesive feature or change. Use subsections if there are multiple steps or variants.

4. **Separate "what" from "how"** — Specs/plans describe *what* to build; implementation details can come later. If implementation details matter for scope or design decisions, include them; otherwise keep the plan requirements-focused.

---

## Expressing Requirements

- **Be specific** — e.g. "Brush size slider with 4 discrete positions: 1, 2, 4, 8" instead of "Brush size control."

- **State edge cases** — e.g. "If user releases Alt before second click, solo mode persists until next Alt+click on any eye."

- **Reference existing docs** — Instead of restating everything, say "See CHARACTER-CREATION-SCREEN-SPEC Section 5" or link to the file.

- **Use acceptance criteria** — Describe what "done" looks like for each requirement so it's clear when something is complete.

- **Use tables for options/behaviors** — Tables (e.g., tool → behavior, layer → region) are scannable and easy to implement from.

---

## Using Todos

- **One concrete action per todo** — "Add color swatch auto-extraction on skin load" is better than "Work on color system."

- **Order by dependency** — Put foundational work first (e.g., swatch extraction before UI).

- **Keep scope bite-sized** — 5–10 todos per plan is usually manageable. If more, consider splitting into multiple plans or phases.

- **Use status** — Mark `in_progress` when starting, `completed` when done. Pending items stay until you begin.

---

## General Tips

- **Include file paths / links** — Reference specific files (e.g., `src/creator.ts`) and doc sections so the agent knows where to look.

- **Add diagrams where useful** — Mermaid flowcharts or tables can clarify complex behavior.

- **Note "out of scope"** — Explicitly list what the plan does *not* cover to prevent scope creep.

- **Add "dependencies"** — Note any prerequisite work, modules, or APIs so the agent doesn't assume missing pieces exist.
