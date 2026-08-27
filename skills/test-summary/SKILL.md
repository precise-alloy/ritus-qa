---
name: test-summary
description: Use when the user asks to wrap up testing, summarize results, or write a test summary report (e.g. "write test summary", "wrap up testing", "create a test report"). Aggregates execution results and bugs into a client-facing English summary.
---

# Test Summary

Produce the final, client-facing summary for a ticket.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Read execution-results.md: identify the current round, count its automated pass/fail/blocked and manual verdicts
- [ ] Later rounds: read the plan's Change Log for the cases not re-run + reasons, for Remaining Risks
- [ ] Read bugs/ for the defect table; reconcile each against this round's result (fixed / open / not retested / obsolete)
- [ ] Read test-data/test-data.md if present: planId, generated items, fields left empty
- [ ] Write summary.md with separate Automated/Manual Coverage lines
- [ ] Fill Remaining Risks + Recommendation
```

## Input

A ticket id with `.qa/<ticket-id>/execution-results.md` (and optionally `bugs/`, `checklist-*.md`, and `<ticket-id>-plan.md` — required on a later round, because its `## Change Log` is where the skipped cases and their reasons live). If results are missing, say so and stop — do not fabricate results.

## Procedure

> **Two roots.** `<project-root>` is the project under test — the current directory for every command, and where `.qa/` lives. `<plugin-root>` is the installed ritus-qa directory holding this skill, `scripts/`, and `templates/`. Those assets are NOT in the project: always read templates and invoke scripts by their plugin-root path while the current directory stays `<project-root>`. Run scripts with `bun`, never `node`.

1. Read `execution-results.md`. When it carries more than one `Round`, report the **current round** — the highest number — and say which round the summary covers. Never blend rounds into one pass rate: a result from round 1 was produced against code that has since changed, and averaging it in overstates what was verified. Count separately:
   - Automated: executed / passed / failed / blocked from the `## Automated Results` table, for this round's rows.
   - Manual: hand-off rows for this round and how many now carry a QA verdict (vs. still `pending`).
2. Read every file in `.qa/<ticket-id>/bugs/` for the defect table (id, title, severity), and reconcile each one against this round's results before reporting it. A bug names the case it came from and the round it was found in:
   - Its case passed in the current round → `Fixed (verified round N)`. It is not an open defect.
   - Its case ran in the current round and failed or was blocked again → `Open`.
   - Its case was not re-run this round, or the bug names no case → `Open (not retested this round)`. Never silently promote it to fixed: nothing verified it.
   - Its case is now under `## Deprecated` → `Obsolete (criterion removed)`. It is not an open defect and not an accepted risk either — the behaviour it described is no longer required.

   That verdict fills the defect table's `Status`. Reporting a round-1 bug as open after the round-2 run proved its case passes is how a ready ticket gets held back; reporting it as fixed without a passing case is worse.
3. Write `.qa/<ticket-id>/summary.md` from `<plugin-root>/templates/test-summary.md`. Coverage MUST be reported as the two separate lines (Automated Coverage / Manual Coverage) — never blend hand-off cases into the automated pass rate. `{{ROUND}}` is the current round identified in step 1, and on a single-round ticket it is `1`.
4. Remaining Risks: unverified manual items, blocked cases, checklist groups not covered, and the test data situation — when `.qa/<ticket-id>/test-data/test-data.md` exists, name the `planId`, the generated items, and every field the generator left empty; when it does not, state that execution ran against pre-existing content.

   On a later round, this section MUST also name every case that was not re-run, with the reason it was judged unaffected. Read them from the `Cases skipped:` line in this round's `## Change Log` entry in `<ticket-id>-plan.md` — a skipped case leaves no row in `execution-results.md`, so that entry is the only record. If the entry is missing, say the skipped set could not be established rather than inferring it: an absent row could equally mean the case was deprecated. Those cases carry a result from an earlier build, and the client is accepting that risk — leaving them unmentioned presents old evidence as current.
5. Recommendation: one of "Ready for release", "Ready after manual verification", "Not ready — N open defects" with a one-line rationale. N counts only the defects step 2 reconciled as open — a bug whose case passed this round is fixed, not open, and counting it holds back a ticket the evidence says is ready.

## Rules

- Numbers must come from the artifact files, not from memory.
- If manual hand-off items are still `pending`, the summary must say "manual verification incomplete" in Remaining Risks.

## Handoff

- **Produces:** `.qa/<ticket-id>/summary.md`.
- **Next:** terminal — the QA cycle for this ticket is complete.
