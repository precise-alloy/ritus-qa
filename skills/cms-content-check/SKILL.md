---
name: cms-content-check
description: Use when the user asks to verify CMS content against the frontend, check Optimizely edit mode properties, or validate page/block configuration (e.g. "check CMS content", "verify this page in CMS", "đối chiếu CMS với FE"). Provides an Optimizely-specific checklist and walks through it with the QA.
---

# CMS Content Check

Verify Optimizely CMS edit-mode configuration against frontend rendering.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Confirm scope: which pages/blocks, from plan or user
- [ ] Load .qa/cms-knowledge.md for previously saved CMS procedures
- [ ] Establish CMS access: drive browser to CMS login, QA authenticates
- [ ] Check page-level properties (SEO, publishing, navigation)
- [ ] Check block properties (content fields, display flags, visitor groups)
- [ ] Check media (renditions, alt text, broken references)
- [ ] Save any newly learned CMS procedure to .qa/cms-knowledge.md
- [ ] Record findings in .qa/<ticket-id>/checklist-cms.md
- [ ] Offer bug-report per mismatch
```

## Input

A page or block to check. Read `.qa/<ticket-id>/<ticket-id>-plan.md` and `.qa/<ticket-id>/<ticket-id>-test-cases.md` for scope when they exist.

## CMS access (edit mode)

The agent reads edit-mode values itself by driving the browser via Playwright MCP. Credentials never enter the prompt.

1. Derive the CMS edit-mode URL: for an Optimizely site it is the frontend origin plus `/EPiServer/CMS` — i.e. `TEST_BASE_URL` from `.qa/.env.local` with `/EPiServer/CMS` appended (e.g. `https://frontend-view.com` → `https://frontend-view.com/EPiServer/CMS`). Only ask the QA for the URL if the derived one does not respond or redirects to an unexpected login host.
2. If a login screen appears, **pause and hand the browser to the QA** to authenticate. Resume once the QA confirms they are logged in and the edit UI is visible.
3. Reuse the authenticated browser session for the whole checklist run.

If the CMS lives at a non-standard path (not `/EPiServer/CMS`) for a given project, record the correct edit-mode URL in `.qa/cms-knowledge.md` so later runs skip the derivation step.

## CMS knowledge base

`.qa/cms-knowledge.md` persists CMS procedures the agent has learned, so recurring operations are automated instead of re-asked. It is shared across tickets.

**Read first.** Before asking the QA how to do anything in the CMS, read `.qa/cms-knowledge.md` (skip silently if absent). If a saved entry covers the operation, follow its recorded steps via Playwright MCP.

**Ask when unknown.** If no entry covers the operation, ask the QA for a short numbered step list (e.g. "how do I reach the magnifier-icon toggle?"). Execute the steps, then verify the target property is reachable.

**Save what worked.** When a QA-provided (or newly discovered) procedure succeeds, append it to `.qa/cms-knowledge.md` using this entry shape — create the file with a `# CMS Knowledge` heading if absent:

```markdown
## <Operation name>
- **Applies to:** <page/block/property, e.g. "Search optimization > magnifier icon toggle">
- **Steps:**
  1. <step as executed, with selector or navigation target>
  2. <step>
- **Verified:** <YYYY-MM-DD> on <environment URL>
```

Record steps at the level of detail that lets the agent replay them: menu paths, button labels, field names, URLs. Update an existing entry when the UI has moved instead of adding a duplicate.

## Checklist

Walk the QA through the applicable groups. For each item, state what to check in edit mode and what should appear on the frontend:

### Page-level properties
- **SEO:** meta title, meta description, canonical/robots settings → inspect the rendered `<head>` (via Playwright MCP `browser_evaluate`: `document.title`, `document.querySelector('meta[name="description"]')`).
- **Publishing:** publish status, scheduled publish/expire dates → verify the page is/isn't reachable on the frontend accordingly.
- **Navigation visibility:** "display in navigation" flags, sort order → check menus/breadcrumbs.

### Block properties
- **Content fields:** teaser text, headings, link URLs, image selection + alt text → compare rendered output.
- **Display flags:** "hide on mobile" / device-specific blocks → verify at the relevant viewport (Playwright MCP `browser_resize`).
- **Visitor groups / personalization:** which audience sees which variant → verify each configured variant renders for the right audience; note that simulating visitor group membership may require CMS preview mode rather than the public site.

### Media
- Image renditions (correct size/crop per breakpoint), alt text presence, broken media references.

## Procedure

1. Ask which page(s)/block(s) are in scope if not clear from the plan.
2. Load `.qa/cms-knowledge.md` for any previously saved procedures relevant to this scope.
3. Establish CMS access (see **CMS access** section): drive the browser to the CMS, let the QA log in if prompted.
4. For each checklist group that applies, check items one by one. Read the edit-mode side yourself via the authenticated browser session; for any CMS operation you don't know, consult the knowledge base first, then ask the QA (see **CMS knowledge base**). Read the frontend side via Playwright MCP.
5. Save newly learned procedures to `.qa/cms-knowledge.md`.
6. Record findings as `.qa/<ticket-id>/checklist-cms.md`: a table `| Item | CMS value | Frontend value | Match |` filled in English.
7. Every mismatch is a candidate bug: offer the `bug-report` skill per mismatch.

## Rules

- Never assert a match without seeing both sides (CMS value AND rendered value).
- Visitor-group and scheduled-publish checks must state HOW they were verified (preview mode, date simulation, or not verified).
- Never type or store CMS credentials — the QA authenticates in the browser themselves; only procedures (navigation steps) go into `.qa/cms-knowledge.md`.

## Handoff

- **Produces:** `.qa/<ticket-id>/checklist-cms.md`; updates `.qa/cms-knowledge.md` with newly learned procedures.
- **Next:** `invoke bug-report` per confirmed mismatch; otherwise await the QA's next instruction.
