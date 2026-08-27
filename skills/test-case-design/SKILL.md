---
name: test-case-design
description: Use when the user asks to write, generate, or design test cases for a ticket (e.g. "write test cases", "generate test cases", "create test cases for PROJ-123"). Reads the test plan and produces a labeled test case table in .qa/<ticket-id>/<ticket-id>-test-cases.md.
---

# Test Case Design

Generate executable test cases from the test plan.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Read <ticket-id>-plan.md (+ ticket.json if present)
- [ ] If <ticket-id>-test-cases.md exists: classify every case, get the classification approved, record it in the plan's Change Log
- [ ] Optional: read Figma design for grounding
- [ ] Design cases: positive / negative / boundary / CMS variations
- [ ] Label every case: automatable / assisted / manual
- [ ] Write .qa/<ticket-id>/<ticket-id>-test-cases.md (from template on round 1, amended in place after)
- [ ] Report total + triage split to the user
```

## Input

A ticket id with an existing `.qa/<ticket-id>/<ticket-id>-plan.md`. If the plan is missing, say so and offer to run the `test-plan` skill first. Do not proceed without it unless the user explicitly asks to design cases directly from the ticket JSON (`.qa/<ticket-id>/ticket.json`).

## Procedure

> **Two roots.** `<project-root>` is the project under test — the current directory for every command, and where `.qa/` lives. `<plugin-root>` is the installed ritus-qa directory holding this skill, `scripts/`, and `templates/`. Those assets are NOT in the project: always read templates and invoke scripts by their plugin-root path while the current directory stays `<project-root>`. Run scripts with `bun`, never `node`.

1. Read `.qa/<ticket-id>/<ticket-id>-plan.md` (and `ticket.json` if present).

2. If `<ticket-id>-plan.md` lists a Figma link, optionally read the design via Figma MCP to ground cases: exact copy strings, item counts, breakpoints, and rendering edge cases (long text, missing images, overflow). Skip silently if Figma is unavailable.

3. Design cases covering:
   - **Positive:** each acceptance criterion, one or more cases.
   - **Negative:** invalid input, missing required CMS fields, unpublished content.
   - **Boundary:** character limits, empty/maximum item counts, oldest/newest scheduled publish.
   - **CMS content variations:** visitor groups / personalization variants, block property combinations, "hide on mobile"-style flags — each becomes its own case when the plan's scope includes CMS verification.

   Then apply three QA-readability rules (from real review feedback):

   - **Setup/precondition cases first.** Any case that prepares data or config other cases rely on (e.g. importing the Autosuggest CSV) goes at the top of its group. A case that consumes that setup neither repeats the setup steps nor points at the case by ID alone: it states the resulting **state** in one line and tags the owning case at the end — `Test page published with an Icon List Block of 3 cards (TC-001)`. Full contract in **Writing preconditions** below.
   - **Group cases by area.** Emit one `## <Group>` section per area — typically `Setup / CMS` (CMS-driven configuration and imports), `Frontend functionality` (behavioral cases), `UI / Visual` (layout/responsive/visual cases). Keep the table-per-group structure.
   - **Merge cases that share a flow and differ only in expectation.** Two cases with identical steps but opposite/complementary expected results (e.g. "dropdown appears" vs "no dropdown") become ONE case whose Expected Result lists `E1`, `E2`, ... — the triage label is the strictest of the merged cases.

4. Label every case with exactly one triage value (this drives `auto-execute`):
   - `automatable` — verifiable deterministically via DOM/browser: navigation, element presence, text content, form validation messages, CMS-driven content rendering.
   - `assisted` — automatable except for a human-required point: login, captcha, real payment, OS-level file dialogs.
   - `manual` — requires human judgment: visual fidelity ("matches design"), animation feel, delivered email content, brand tone.

   Use exactly one Priority value: High, Medium, or Low. Do not use Critical, P0/P1, lowercase variants, or a blank priority because artifact export rejects them.

5. On the first round, write `.qa/<ticket-id>/<ticket-id>-test-cases.md` from `<plugin-root>/templates/test-cases.md`; on a later round, amend the existing file as described in **When test cases already exist** below. Either way the table headers MUST be exactly:

   `| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |`

   IDs are `TC-001`, `TC-002`, ... sequential per ticket across all groups (never restart numbering per group — downstream skills parse IDs globally). Steps are numbered, one action per step, using concrete selectors only when known from the plan — otherwise describe the target ("the 'Explore now' button") and let `auto-execute` resolve it via Playwright MCP snapshot. Preconditions follow **Writing preconditions** below: state-first lines separated by `<br>`, each setup-derived line ending with ` (TC-XXX)`. Merged cases list expectations as `E1`, `E2`, ...

6. Report to the user: total cases, the group breakdown, triage split (recomputed AFTER merging), and the file path. Suggest `auto-execute` for the automatable/assisted cases.

7. If the user explicitly asks for a spreadsheet export of the finished cases, mention the optional follow-up `artifact-export` skill for `.qa/<ticket-id>/<ticket-id>-test-cases.md` → `.qa/<ticket-id>/exports/<ticket-id>-test-cases.xlsx`. Do not offer export automatically.

## When test cases already exist

`<ticket-id>-test-cases.md` being present means the ticket has been tested before. Do not regenerate the file: read it together with the plan's `## Change Log` and give every existing case one of five outcomes.

| Outcome | When | What you do |
|---|---|---|
| `rerun` | its criterion changed, or it failed / was blocked / stayed pending last round | leave it as is; it goes into this round's run |
| `skip` | untouched by the change and already passing | leave it as is; record why it is safe to skip |
| `amend` | the change makes its steps or expectation wrong | edit the row in place, keeping its ID |
| `new` | a new criterion has no case | add a row with the next free TC number |
| `deprecated` | its criterion was removed | move the row to `## Deprecated`, unchanged |

**IDs are permanent.** `execution-results.md` refers to cases by ID across rounds, so a renumbered case silently rewrites history. New cases continue the sequence; never reuse a number, even one freed by a deprecation.

**Deprecated cases keep their row.** Move them to a `## Deprecated` group at the end of the file, above `## Coverage Notes`, with the same table header and `|---|` separator row as every other group — export rejects a table missing either. Never delete them — a case that existed and stopped applying is part of the ticket's history, and the QA exporting to xlsx sees them grouped under `Deprecated`.

**A gloss is a copy, not a reference.** When a case is classified `amend`, re-check every case whose Preconditions tag its ID — the state it provides may have changed, and the copies do not update themselves. When a case is classified `deprecated`, its consumers cannot stand unchanged; classify them in the same round rather than leaving them tagged to a retired case.

Present the classification as a table with **one reason per case**, then wait for the user to approve it before you edit the file:

| Case | Outcome | Why |
|---|---|---|
| TC-003 | rerun | AC-3 changed from 5 to 10 results |
| TC-007 | skip | passed in round 1, untouched by AC-3 or AC-6 |
| TC-012 | deprecated | AC-5 removed from the ticket |

This is a gate, not a status report. A wrong `skip` is how a regression reaches production, and that call belongs to the QA, not to you.

Once approved, write the outcome into the plan's `## Change Log`, under the entry `test-plan` opened for this round — one line per outcome that has members, carrying the reasons the user just approved:

```markdown
### Round 2 — 2026-08-25
- AC-3 changed: "shows 5 results" → "shows 10 results"
- Cases re-run: TC-003 (AC-3 changed), TC-008 (failed in round 1)
- Cases skipped: TC-007 (passed in round 1, untouched by AC-3 or AC-6)
- Cases added: TC-014 (covers AC-6)
- Cases deprecated: TC-012 (AC-5 removed)
```

The Change Log is the only place these reasons survive: the classification table above is a conversation, and a skipped case leaves no row in `execution-results.md` at all. `test-summary` has to name every skipped case in the client-facing Remaining Risks, and this is where it reads them from.

## Writing preconditions

A Preconditions cell holds one precondition per line, separated by `<br>`. A line that comes from another case's setup ends with ` (TC-XXX)` naming that case; a line describing the environment carries no tag. Tagged lines come first. A cell may carry more than one tagged line when the case consumes two independent setups.

| Never write | Write |
|---|---|
| `Depends on: TC-001` | `Test page published with an Icon List Block of 3 cards (TC-001)` |
| `Depends on: TC-007` | `A card with no icon image has been published (TC-007)` |

The state text before the tag is the **gloss**, and four rules govern it:

1. **Canonical — written once.** Each depended-upon case has exactly one gloss, reused verbatim by every consuming case. Amending the setup case then means editing one known string.
2. **Compress the dependency's Expected Result, not its Title.** The title says what the case *does*; the Expected Result says what *exists afterwards*, and a precondition is a state. Cap the gloss at 15 words, counted without the tag.
3. **Phrase it as achieved state.** "Test page published with…", never "Create a test page…".
4. **One tag per line — never chain ancestors.** If TC-019 consumes TC-007, which consumed TC-001, TC-019 tags only `(TC-007)`: "A card with no icon image has been published" already implies the block exists. When a reader would need the transitive ancestor to understand the line, the gloss is wrong and gets rewritten — a second tag is not the fix.

A gloss that cannot fit 15 words means the setup case is doing too much and should be split.

The point of all four rules is that repetition is not the defect — repeating a token that carries no information is. A state repeated across sixteen rows earns its space; `Depends on: TC-001` repeated across sixteen rows sends the QA scrolling sixteen times.

## Rules

- English content; no invented behavior.
- **Merging expectations never merges distinct flows.** Merge only when steps are identical and only the expected outcome differs (E1/E2/...). Never merge two cases with different steps into one.
- **Every case keeps a unique, sequential ID** across all groups — `auto-execute` and `record-playwright` parse rows by ID. Grouping and reordering never changes an ID's uniqueness or the table's parseability.
- A merged case's triage = the strictest of its merged cases (`manual` > `assisted` > `automatable`).
- Never label a case `automatable` if its expected result requires comparing screenshots or judging appearance — that is `manual`.
- If the plan has zero acceptance criteria, say so and derive cases from the requirement summary + risks; flag the low-confidence coverage in Coverage Notes.

## Handoff

- **Produces:** `.qa/<ticket-id>/<ticket-id>-test-cases.md` — created on the first round, amended in place on later ones, with retired cases kept under `## Deprecated`. On a later round, also the approved classification appended to this round's `## Change Log` entry in `<ticket-id>-plan.md`.
- **Next:** read the Preconditions column, decide the branch yourself, then ask the user to confirm that specific next step: if any Preconditions need CMS content the test environment does not have yet, ask to `invoke cms-test-data` first — otherwise ask to `invoke auto-execute` for the automatable/assisted cases. Optional user-requested follow-up: `invoke artifact-export` for `<ticket-id>-test-cases.xlsx`.
