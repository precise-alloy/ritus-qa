# Test Cases — {{TICKET_ID}}: {{TICKET_TITLE}}

Generated: {{DATE}} | Source plan: `{{TICKET_ID}}-plan.md`

Triage labels: `automatable` = agent can verify via DOM/browser; `assisted` = automatable but needs a human at some point (login, captcha); `manual` = requires human judgment (visual, email content, animation feel).

Cases are **grouped** by area (e.g. Setup/CMS, Frontend, UI/Visual) and **ordered so precondition/setup cases come first** within each group. A case whose steps depend on another case's setup states the resulting **state** in its Preconditions cell and tags the owning case at the end of that line, e.g. `Test page published with an Icon List Block of 3 cards (TC-001)`. Cases that share the same flow and differ only in expectation are **merged into one case with multiple expectations** (listed as `E1`, `E2`, ... in the Expected Result cell).

## {{GROUP_NAME}} <!-- e.g. "Setup / CMS", "Frontend functionality", "UI / Visual" -->

| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |
|----|-------|----------|--------|---------------|-------|-----------------|
| TC-001 | {{TITLE}} | {{PRIORITY — High | Medium | Low}} | automatable | {{PRECONDITIONS — one per line separated by <br>; a setup-derived line states the state and ends with ` (TC-XXX)`}} | 1. {{STEP}}<br>2. {{STEP}} | {{EXPECTED — or E1/E2/... when merged}} |

## Coverage Notes

{{COVERAGE_NOTES — include the recomputed triage split AFTER merging, and the AC→TC map referencing the final IDs}}
