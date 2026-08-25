---
name: bug-report
description: Use when the user asks to write, file, or document a bug (e.g. "write a bug", "report this bug", "tạo bug report"). Produces a standardized English bug report under .qa/<ticket-id>/bugs/.
---

# Bug Report

Write a client-ready bug report.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Determine next bug id (BUG-NNN) under .qa/<ticket-id>/bugs/
- [ ] Gather facts: reuse screenshots/results/checklists, ask QA only for gaps
- [ ] Write bug file from <plugin-root>/templates/bug-report.md in English
- [ ] Assign severity with one-line justification
- [ ] Link evidence (case id, screenshot path) when from auto-execute; fill Case + Found in round
- [ ] Report bug id + path; remind bugs stay local
```

## Input

A ticket id and the defect to report — from an `auto-execute` failure, a checklist mismatch, or described directly by the user.

## Procedure

> **Two roots.** `<project-root>` is the project under test — the current directory for every command, and where `.qa/` lives. `<plugin-root>` is the installed ritus-qa directory holding this skill, `scripts/`, and `templates/`. Those assets are NOT in the project: always read templates and invoke scripts by their plugin-root path while the current directory stays `<project-root>`. Run scripts with `bun`, never `node`.

1. Determine the next bug id: list `.qa/<ticket-id>/bugs/` and use `BUG-001`, `BUG-002`, ... (create the directory if absent).
2. Gather the facts. Reuse existing evidence first: screenshots in `.qa/screenshots/<ticket-id>/`, failing rows in `execution-results.md`, mismatch rows in `checklist-*.md`. Ask the user only for what is missing (severity justification, affected browser/viewport).
3. Write `.qa/<ticket-id>/bugs/<BUG-ID>.md` from `<plugin-root>/templates/bug-report.md`, filling every `{{PLACEHOLDER}}` in English. Steps to Reproduce must be numbered, minimal, and start from a stable entry point (URL or CMS action).
4. Severity guide (state the chosen one with a one-line justification):
   - **Critical** — data loss, page unreachable, broken primary user journey.
   - **Major** — feature broken with a workaround; wrong CMS content rendered.
   - **Minor** — cosmetic issues, minor copy/spacing deviations.
5. If the failure came from `auto-execute`, link the case id and screenshot path in Evidence.

   Fill `{{CASE_ID_OR_NONE}}` and `{{ROUND}}` in the header from the row you took the failure from — the case's ID and its `Round` value in `execution-results.md`. Write `none` for the case when the finding came from a checklist or from the user rather than a case. These two fields are what lets `test-summary` tell a bug that a later round re-tested and fixed from one that is still open; a bug with no case link can never be marked fixed automatically and will keep counting as open.
6. Report the bug id and path. Remind the user bugs stay local — copying into Jira/ADO is a manual step (out of scope).

## Rules

- One bug per file. No bundling of unrelated findings.
- Expected/Actual must be observable facts, not opinions.

## Handoff

- **Produces:** `.qa/<ticket-id>/bugs/BUG-NNN.md`.
- **Next:** another `invoke bug-report` for additional findings, or `invoke test-summary` when the QA is done reporting.
