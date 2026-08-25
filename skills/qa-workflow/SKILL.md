---
name: qa-workflow
description: Use when the user wants to start or run the full QA process for a ticket end to end (e.g. "start QA for PROJ-123", "test ticket này", "QA ticket 12345"). Orchestrates the other ritus-qa skills stage by stage, asking before each transition.
---

# QA Workflow (orchestrator)

Drive the complete QA pipeline for one ticket. Each stage is a separate skill — this orchestrator sequences them and keeps artifacts consistent under `.qa/<ticket-id>/`.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Setup check: .qa/.env.local exists, credentials match the ticket's tracker
- [ ] Round check: does execution-results.md already exist?
- [ ] test-plan: invoke, confirm <ticket-id>-plan.md produced
- [ ] Ask user: proceed to test-case-design?
- [ ] test-case-design: invoke, report triage split (later rounds: get the classification approved)
- [ ] Ask user: does this ticket need CMS test content generated?
- [ ] cms-test-data: invoke if needed, get the data approved from test-data.md, then hold for the manual import
- [ ] Ask user: proceed to auto-execute?
- [ ] auto-execute: invoke, report pass/fail/blocked + manual hand-off list
- [ ] Ask user: run checklist skills (cms-content-check / ui-ux-check)?
- [ ] Checklist skills: invoke if scoped, report mismatches
- [ ] bug-report: invoke once per confirmed finding
- [ ] test-summary: invoke, report summary.md and note supported optional exports on request
```

Skip for a trivial one-step request (a single lookup needs no todo).

## Pipeline

```
test-plan → test-case-design → cms-test-data (only if the ticket needs CMS content)
                                   ↓
                              auto-execute
                                   ↓
              cms-content-check / ui-ux-check (as scoped in the plan)
                                   ↓
                bug-report (per finding) → test-summary
```

## Procedure

> **Two roots.** `<project-root>` is the project under test — the current directory for every command, and where `.qa/` lives. `<plugin-root>` is the installed ritus-qa directory holding this skill, `scripts/`, and `templates/`. Those assets are NOT in the project: always read templates and invoke scripts by their plugin-root path while the current directory stays `<project-root>`. Run scripts with `bun`, never `node`.

1. Ask for the ticket id if not provided.
2. **Setup check (first run only):** confirm `.qa/.env.local` exists — if not, tell the user to copy `<plugin-root>/templates/env.local.example` to `.qa/.env.local` and fill in values, then stop. Confirm the tracker credentials match the ticket type (Jira vs ADO) by attempting the fetch in stage 1 and relaying any Vietnamese error verbatim.
3. **Round check.** If `.qa/<id>/execution-results.md` exists, this ticket has been tested before: the current round is the highest `Round` value in that file plus one. Say so before starting — "This is round 2; round 1 ran on <date> with N passed, M failed" — so the user knows the pipeline will amend artifacts rather than create them.

   If `execution-results.md` is absent but `.qa/<id>/ticket.json` exists, the ticket was planned before and never executed. Say that instead of announcing round 1: `test-plan` will treat this as a later round and diff the saved ticket, so promising a clean first run would be wrong.

   Round 1 runs exactly as it does today. The stages below only change behaviour when a previous round exists; each skill handles that itself.
4. Run each stage in order by invoking its skill:
   - `test-plan` → then ask: "Plan is ready at .qa/<id>/<id>-plan.md. Proceed to test case design?"
   - `test-case-design` → on round 1, report the triage split. On a later round it classifies every existing case as rerun / skip / amend / new / deprecated and presents that table with a reason per case: **relay it and hold for the user's approval before anything runs.** A wrong `skip` is how a regression reaches production, so that call is the user's. Then ask whether the test cases need CMS content the environment does not have yet (read their Preconditions to answer this yourself before asking).
   - `cms-test-data` — only when they do. It plans the content and writes `.qa/<id>/test-data/test-data.md` for review BEFORE building anything. That is the stage's first hold: relay the proposed data and the fields the generator will leave empty, and let the user approve or amend it — no package is built until they do. Once they approve it builds the `.episerverdata` package, and the pipeline holds a second time while the QA imports it under Admin → Import Data and verifies it themselves. Continue only once the user confirms, then ask: "Proceed to auto-execute (N automatable, M assisted)?"
   - `auto-execute` → report pass/fail/blocked and the manual hand-off list, then ask whether to run the checklist skills.
   - `cms-content-check` and/or `ui-ux-check` — only if the plan's Test Approach includes them.
   - `bug-report` — once per confirmed finding.
   - `test-summary` → final artifact. If the user explicitly wants a local client-shareable plan or test-case export, point them to `artifact-export` for the supported files only: `.qa/<id>/<id>-plan.md` → `.qa/<id>/exports/<id>-plan.docx`/`.qa/<id>/exports/<id>-plan.pdf`, `.qa/<id>/<id>-test-cases.md` → `.qa/<id>/exports/<id>-test-cases.xlsx`.
5. Before EVERY stage transition, show a one-line status (artifact produced, where) and wait for the user's go-ahead. Never chain stages silently.
6. Any stage can be skipped at the user's word ("skip UI check") — note the skip in the final summary's Remaining Risks.

## Rules

- The orchestrator does no testing work itself; it only sequences skills and surfaces their outputs.
- If a prerequisite artifact is missing mid-pipeline (e.g. no `<ticket-id>-test-cases.md`), offer to run the corresponding skill — never fabricate artifacts.
- Stages also work standalone; never force the user through the full pipeline if they invoke a single skill directly.
- If a later round's ticket diff shows nothing changed and every case passed, say so and stop. That call belongs after `test-plan`, which is what produces the diff — the round check cannot make it, because nothing has been compared yet. Do not walk the rest of the pipeline to produce artifacts identical to last round's — there is nothing to test, and saying that is more useful than a summary that repeats itself.

## Handoff

- **Produces:** the full `.qa/<id>/` artifact set (`<id>-plan.md`, `<id>-test-cases.md`, `execution-results.md`, `bugs/`, `summary.md`), plus `.qa/<id>/test-data/` and an importable package when `cms-test-data` ran.
- **Next:** terminal — the pipeline ends at `test-summary`. Optional user-requested follow-up: `invoke artifact-export` for the supported plan/test-case files. If stages were skipped, the summary's Remaining Risks must say so — including test data generated on assumptions the QA confirmed rather than the ticket stating.
