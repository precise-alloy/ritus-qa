---
name: ui-ux-check
description: Use when the user asks to check UI, verify responsive behavior, compare the page against Figma design, or run accessibility basics (e.g. "check UI", "test responsive", "so sánh với design", "kiểm tra giao diện"). Measures with numbers via DOM/computed styles — never judges screenshots by eye.
---

# UI/UX Check

Measure the frontend against the design and responsive/a11y rules. Core principle: **measure with numbers, never judge by eye.** LLM vision is unreliable for fine visual detail, so the model never issues a visual verdict.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Resolve target URL + optional Figma link
- [ ] Design vs frontend: numeric comparison via getComputedStyle vs Figma values
- [ ] Responsive: check breakpoints 375/768/1280/1440 via DOM measurement
- [ ] Accessibility basics: alt, heading order, labels, tab order
- [ ] Visual hand-off: prepare side-by-side evidence, record QA verdicts
- [ ] Write .qa/<ticket-id>/checklist-ui.md
```

## Input

A target URL (default `TEST_BASE_URL` from `.qa/.env.local`) and optionally a Figma link (from `<ticket-id>-plan.md` under `.qa/<ticket-id>/` or pasted by the user). Skip Figma-dependent checks when no link exists.

## 1. Design vs frontend (requires Figma link)

1. Read design values via Figma MCP for the selected frame: font-family, font-size, font-weight, colors, spacing for the key elements.
2. Open the page via Playwright MCP. For each element, read computed styles:

   `browser_evaluate` with e.g.
   ```js
   const el = document.querySelector('h1');
   const cs = getComputedStyle(el);
   ({ fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color })
   ```
3. Produce a comparison table: `| Element | Property | Figma | Computed | Match |`. Values must be exact strings/numbers from the two sources — no "looks close enough".
4. Mismatches are candidate bugs: offer `bug-report`.

## 2. Responsive

For each breakpoint (default: 375, 768, 1280, 1440 — adjust if the plan specifies others):

1. `browser_resize` to the width.
2. Check via `browser_evaluate`:
   - horizontal scroll: `document.documentElement.scrollWidth > document.documentElement.clientWidth`
   - overflowing elements: elements whose `getBoundingClientRect().right` exceeds the viewport width
   - truncated text: `el.scrollWidth > el.clientWidth` on text containers expected to fit
3. Record findings numerically (which element, how many px overflow).

## 3. Accessibility basics (DOM only)

- Images without `alt` (`document.querySelectorAll('img:not([alt])')`)
- Heading order violations (h1 → h3 skips, multiple h1)
- Inputs without associated labels
- Tab order sanity: interactive elements reachable and in DOM order

## 4. Visual judgment hand-off

For anything that genuinely needs eyes (overall look-and-feel, animation, hover subtleties):

1. Capture a Playwright screenshot; if a Figma link exists, also fetch the design export via Figma MCP.
2. Present them side by side to the QA with a short list of what to look at.
3. The QA states the verdict; record it. The model never says "this matches" or "this is off" about the images.

## Output

Write `.qa/<ticket-id>/checklist-ui.md` (English): the comparison tables, responsive numbers, a11y findings, and the QA's visual verdicts. Offer `bug-report` for each confirmed mismatch.

## Rules

- If a check cannot be performed numerically or via DOM, it goes to section 4 (human verdict) — it is never answered by the model from a screenshot.
- State measurement conditions: viewport, URL, and (for Figma) frame/node id.

## Handoff

- **Produces:** `.qa/<ticket-id>/checklist-ui.md` (comparison tables, responsive numbers, a11y findings, QA visual verdicts).
- **Next:** `invoke bug-report` per confirmed mismatch; otherwise await the QA's next instruction.
