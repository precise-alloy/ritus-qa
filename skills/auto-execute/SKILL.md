---
name: auto-execute
description: Use when the user asks to run, execute, or perform test cases in a browser (e.g. "run the tests", "execute test cases", "run tests for PROJ-123"). Drives a real browser via Playwright MCP, records pass/fail with evidence, hands off manual cases, and generates a Playwright regression script.
---

# Auto Execute

Execute labeled test cases against a live environment via Playwright MCP.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Setup: TEST_BASE_URL resolved, .qa/screenshots/<ticket-id>/ subdir created
- [ ] Tier-2 triage: confirm/adjust labels, report final split
- [ ] Execute automatable cases via Playwright MCP
- [ ] Run assisted cases up to the human-required point, pause for QA
- [ ] Build manual hand-off list with evidence packs
- [ ] Write execution-results.md (## Automated Results / ## Manual Hand-off), appending under this round's number when the file already exists
- [ ] Write execution-log.json and generate the regression spec (ask e2e style once per project: structured vs one-file-per-ticket; structured = detect existing e2e, else --scaffold)
- [ ] Clean up Playwright-generated noise (page-*.yml, console-*.log) and move screenshots into the ticket subdir
- [ ] Report results and suggest bug-report for failures
```

## Input

A ticket id with `.qa/<ticket-id>/<ticket-id>-test-cases.md`. If missing, offer `test-case-design` first.

## Setup

1. Read `.qa/.env.local` for `TEST_BASE_URL` (the target environment). If absent, ask the user for the environment URL.
2. The Playwright MCP server's `--output-dir` is fixed at `.qa/screenshots/` (it cannot be namespaced per ticket from the skill). Create a ticket subdir `.qa/screenshots/<ticket-id>/` and, during the run, move the screenshots you reference into it so each ticket's evidence is isolated.

## Tier-2 triage

Before executing, review every case's triage label from `<ticket-id>-test-cases.md` and confirm or adjust it:

- **Automatable test (mechanical, not a judgment call):** a case stays `automatable` only if its expected result can be verified by a DOM/text/URL/state assertion or a numeric measurement. If confirming it requires looking at how something *renders*, demote it to `manual` — even if the case is labeled `automatable`.
- **Force demotion when the expected result turns on** appearance rather than state: "looks correct", "displays properly", "matches the design/Figma", alignment, spacing, colour, font, imagery, layout, responsiveness, or any wording that asks whether something is visually right. Presence, text content, count, enabled/disabled, URL, and error-message wording are DOM-checkable and stay `automatable`.
- If you cannot express the assertion as a DOM/measurement check, that is a demotion, never a best guess.
- Promote nothing without telling the user why.
- Report the final split: "N automatable, M assisted, K manual — proceeding."

A `pass` from this skill means the asserted DOM/state condition held. It never means the UI looks right — visual correctness is the `manual` hand-off's verdict, or `ui-ux-check`'s measurements.

**Input format (read before executing):** `<ticket-id>-test-cases.md` is grouped into `## <Group>` sections, each with its own table. Parse ALL tables across groups; IDs are unique across the whole file. Two adaptations:

- **A trailing `(TC-XXX)` on a Preconditions line**: that line states a state another case establishes, so that case is a dependency. Execute the dependency first (or treat the setup as already done if it passed earlier in this run). A cell may declare several — one tag per line — and the line's own text names the state to expect, so you never have to open the other case to learn what it provides. A merged case (`E1`, `E2`, ... in Expected Result) is ONE case — run its steps once, then evaluate each expectation; record `pass` only when all expectations hold, otherwise `fail` naming the failing `E#`.
- Never treat a group heading or a precondition line as a separate case.

## Execution policy

For each case, by label:

- **automatable** — execute fully via Playwright MCP:
  1. Resolve each step's target with `browser_snapshot` first (prefer role-based selectors like `role=button[name='Explore now']` over CSS).
  2. Perform the step (`browser_navigate`, `browser_click`, `browser_type`).
  3. Verify the expected result via DOM: `browser_evaluate` for text/visibility/URL assertions. If the expectation cannot be reduced to such an assertion, stop and demote the case to `manual` — do not substitute an impression from a screenshot.
  4. Record `pass` / `fail`. On failure, capture `browser_take_screenshot` and save it under `.qa/screenshots/<ticket-id>/<case-id>.png` (move it there right after capture if the MCP wrote it to the shared `.qa/screenshots/` root).
  5. If a step cannot be executed (element not found, page error), mark the case `blocked`, screenshot, and **continue with the next case** — never abort the suite.
- **assisted** — execute until the human-required point (login, captcha, payment, file dialog), then pause, hand control to the user, and record the user's stated result.
- **manual** — never attempt. Add the case to the hand-off list with the reason. For visual-judgment cases, build an evidence pack: `browser_take_screenshot` at the assertion point (saved under `.qa/screenshots/<ticket-id>/`) plus the matching Figma export when a Figma link exists in `<ticket-id>-plan.md`, referenced side by side in the results.

If the suite has more than 30 cases, warn the user about token cost and propose running in batches (e.g. by priority) before starting.

## Outputs

1. `.qa/<ticket-id>/execution-results.md` from `<plugin-root>/templates/execution-results.md` with the exact sections `## Automated Results` and `## Manual Hand-off` (the hand-off table includes Reason, Prepared Evidence, and a `pending` Manual Verdict column).
   On the first round, write it from `<plugin-root>/templates/execution-results.md`; on a later round, append to the existing file as described in **When results already exist** while keeping the exact `## Automated Results` and `## Manual Hand-off` sections and the hand-off column description.
2. `.qa/<ticket-id>/execution-log.json` in this exact shape (only `automatable` and `assisted` cases, only executed steps):

   ```json
   {
     "ticketId": "PROJ-123",
     "baseUrl": "https://staging.client-site.com",
     "cases": [
       {
         "id": "TC-001",
         "title": "CTA navigates to campaign page",
         "triage": "automatable",
         "steps": [
           { "action": "goto", "url": "/" },
           { "action": "click", "selector": "role=button[name='Explore now']" },
           { "action": "expectUrl", "url": "/campaign" }
         ],
         "result": "pass"
       }
     ]
   }
   ```

   Allowed `action` values: `goto(url)`, `click(selector)`, `fill(selector, value)`, `expectVisible(selector)`, `expectText(selector, value)`, `expectUrl(url)`.

3. Generate the regression script. First decide the output style — **ask the user once** (per project) which they want, then remember the choice in `.qa/e2e-style`:

   | Style | When it fits | Where the spec goes |
   |---|---|---|
   | **structured** | Project wants a maintainable e2e suite (page objects, projects by scope) | Follows the existing `testDir`/page-object layout, or scaffolds `<plugin-root>/templates/e2e/` and writes to `e2e_tests/regression/<ticket-id>.spec.ts` |
   | **one-file-per-ticket** | QA just wants a runnable record of this ticket's cases, minimal ceremony | `.qa/<ticket-id>/automation/<ticket-id>.spec.ts` (self-contained, no page objects) |

   Read `.qa/e2e-style` first; if absent, ask:

   > "Generate the regression script in which style? (a) structured — follows/scaffolds a page-object e2e suite in the project; (b) one file per ticket — a single self-contained spec under `.qa/<ticket-id>/automation/`."

   Save the answer (`structured` or `one-file-per-ticket`) to `.qa/e2e-style` and reuse it for later tickets in the same project.

   Then generate:

   ```powershell
   # current directory: <project-root>
   bun "<plugin-root>\scripts\record-playwright.ts" .qa/<ticket-id>/execution-log.json --out <spec-path>
   ```

   - **structured + project already has an e2e suite** (`playwright.config.ts` / `e2e_tests/`): write the spec into the user's existing structure — never overwrite their config.
   - **structured + no e2e suite:** offer to scaffold the bundled template once:

     ```powershell
     bun "<plugin-root>\scripts\record-playwright.ts" .qa/<ticket-id>/execution-log.json --scaffold
     ```

     `--scaffold` copies the plugin's `<plugin-root>/templates/e2e/` (Playwright config + 2-layer page objects + CMS auth setup + lint/format) into `<project-root>`, skipping any file that already exists, then prints the written files as JSON. After scaffolding, remind the user to `npm install && npx playwright install` and fill `.env` in the scaffolded project before running `npx playwright test`. Then write the spec into `e2e_tests/regression/<ticket-id>.spec.ts`.
   - **one-file-per-ticket:** write the spec to `.qa/<ticket-id>/automation/<ticket-id>.spec.ts` (no scaffold, no page objects — the spec is self-contained and runnable with `bunx playwright test`).

4. Report: executed count, pass/fail/blocked counts, hand-off count with reasons, screenshot and spec paths (and scaffolded files when `--scaffold` ran). Suggest `bug-report` for any failures and remind the user the manual hand-off list awaits their verdicts.

## Cleanup

After the run, tidy `.qa/screenshots/` (the MCP `--output-dir` accumulates noise across runs):

1. Move every screenshot this run referenced into `.qa/screenshots/<ticket-id>/` (if not already there).
2. Delete Playwright's working files that are not evidence: `page-*.yml` (ARIA snapshots) and `console-*.log` (console logs) in `.qa/screenshots/`.
3. Delete any `*.png` left in `.qa/screenshots/` root that no result row references (orphaned captures).
4. Keep referenced `*.png` — they are evidence linked from `execution-results.md` and evidence packs.

Never let the cleanup delete a file referenced from `execution-results.md` or a manual hand-off evidence pack.

## Rules

- The model NEVER judges visuals. Visual assertions are demoted to `manual` with an evidence pack.
- Never loop-retry a failing step more than once; record and move on.
- Never enter credentials unless the user explicitly provides them for this run.

## When results already exist

`.qa/<ticket-id>/execution-results.md` being present means the ticket has been executed before. Take the round number from the artifacts, never from memory or a guess, in this order:

1. The plan's `## Change Log` — its highest `### Round N` heading is the round `test-plan` already resolved for this pass. Use that N.
2. No Change Log entry: the highest `Round` value in `execution-results.md`, plus one.
3. Neither yields a number: this is round 1.

The Change Log wins because `test-plan` runs first and may have opened a round that has not been executed yet — a ticket planned twice but executed once is round 2, and its first results row must say 2, not 1.

Then **append** — never overwrite. Both tables lead with a `Round` column:

```markdown
| Round | ID | Title | Result | Evidence |
|-------|----|-------|--------|----------|
| 1 | TC-001 | Search returns results | pass | screenshots/... |
| 1 | TC-003 | Shows 5 results | fail | screenshots/... |
| 2 | TC-003 | Shows 10 results | pass | screenshots/... |
```

TC-003 appearing twice is the point: the history shows it failed, then passed once the fix landed. Overwriting would erase exactly the fact the QA needs to report.

Run only the cases the user approved for this round. A case classified `skip` produces **no row** for the new round — do not copy its old result forward under the new number, which would claim a run that never happened. Its absence is the record, and `test-summary` is what makes that legible.

The same holds for the hand-off table. A round-1 row still sitting at `pending` stays exactly where it is, under round 1 — an unanswered hand-off is not a round-2 event. Add a fresh `pending` row under the new round only for a case this round actually re-approved and handed off again.

## Handoff

- **Produces:** `.qa/<ticket-id>/execution-results.md`, `execution-log.json`, `screenshots/` (under `.qa/screenshots/<ticket-id>/`), `automation/<ticket-id>.spec.ts`.
- **Next:** `invoke bug-report` once per confirmed failure; then await QA verdicts on the manual hand-off list before `invoke test-summary`.
