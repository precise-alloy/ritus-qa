# Test Cases — PROJ-123: Example checkout flow

Generated: 2026-08-18 | Source plan: `PROJ-123-plan.md`

Triage labels: `automatable` = agent can verify via DOM/browser; `assisted` = automatable but needs a human at some point (login, captcha); `manual` = requires human judgment (visual, email content, animation feel).

Cases are **grouped** by area (e.g. Setup/CMS, Frontend, UI/Visual) and **ordered so precondition/setup cases come first** within each group. A case whose steps depend on another case's setup states the resulting **state** in its Preconditions cell and tags the owning case at the end of that line, e.g. `Homepage entry saved with banner CTA copy (TC-001)`. Cases that share the same flow and differ only in expectation are **merged into one case with multiple expectations** (listed as `E1`, `E2`, ... in the Expected Result cell).

## Setup / CMS

| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |
|----|-------|----------|--------|---------------|-------|-----------------|
| TC-001 | Configure banner copy | High | assisted | CMS access | 1. Open the homepage entry<br>2. Set CTA to A \| B | Entry saves without validation errors |

## Frontend functionality

| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |
|----|-------|----------|--------|---------------|-------|-----------------|
| TC-002 | Banner CTA renders configured copy | High | automatable | Homepage entry saved with banner CTA copy (TC-001)<br>Published content is visible | 1. Open the homepage<br>2. Inspect the CTA label | E1. CTA label shows "A \| B"<br>E2. CTA links to /signup |

## Coverage Notes

Merged cases: 2 total (1 automatable, 1 assisted, 0 manual).
AC1 -> TC-001, TC-002
