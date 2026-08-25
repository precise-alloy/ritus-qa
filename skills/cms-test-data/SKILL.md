---
name: cms-test-data
description: Use when the user asks to create, generate, or prepare CMS test data for a ticket — pages, blocks and content trees for an Optimizely CMS 12 site (e.g. "generate test data", "create test content for PROJ-123", "tạo test data", "sinh dữ liệu test cho ticket này"). Produces an importable .episerverdata package from the ticket's test cases; the QA imports it in the CMS.
---

# CMS test data (Optimizely CMS 12)

Turn the content a ticket's test cases need into an importable `.episerverdata` package.

**Core principle:** the generator never touches the CMS. It reads a schema export and writes a file. A human moves data in both directions — and a human approves the data before it is built.

```
QA   Admin → Export Data (content types only)
you  plan → validate_plan → test-data.md      ← nothing is built yet
QA   reviews the data, approves or amends it
you  build_package                            ← never touches the CMS
QA   Admin → Import Data (picks the destination)
```

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Read <ticket-id>-test-cases.md Preconditions, propose the content list, get the user's confirmation
- [ ] Check .qa/cms-schema/content-types.episerverdata and the optimizely-test-data MCP server
- [ ] load_schema, then choose types with list_content_types / query_schema / describe_content_type
- [ ] Build the plan, validate_plan, fix every error
- [ ] Write content-plan.json + test-data.md, walk the user through the data, get approval
- [ ] build_package only after approval, then refresh test-data.md's Import section
- [ ] Hand off the import step and hold until the user confirms it is imported and verified
```

## Prerequisites

Check both before the first tool call. Either one missing is a hard stop — produce no artifacts.

1. **Schema export** at `.qa/cms-schema/content-types.episerverdata` in the project under test. Missing → tell the QA to produce it in the CMS under **Admin → Export Data**, ticking **content types only**, save it to that path, and stop. It is re-exported only when the site's schema changes.

   Ask for content types, never for a content export. A content export carries the customer's real page data, and you do not need it — everything the generator classifies comes from the type definitions.

2. **MCP server** `optimizely-test-data`. The plugin declares it, so there is nothing for the QA to register — the host starts it when the plugin is enabled. If its tools are not available, the plugin is disabled or `bun` is not on the `PATH`; say which and stop. Do not fall back to running the generator any other way.

## Procedure

1. **Decide whether this ticket needs generated content.** Read `.qa/<ticket-id>/<ticket-id>-test-cases.md` and take the content requirements from the **Preconditions** column; read `.qa/<ticket-id>/<ticket-id>-plan.md` for scope. Present the items you propose to generate — type, name, and which case needs it — and ask the user to confirm or adjust. If the environment already satisfies every precondition, say so and stop: no plan, no package.

2. **`load_schema`** with `.qa/cms-schema/content-types.episerverdata`. Every other tool fails until this succeeds; if `load_schema` errors, the file is probably corrupt or not a content-types export, so ask the QA to re-export it under **Admin → Export Data** with content types only rather than retrying.

3. **Choose types the site actually has.** `list_content_types` filtered by `kind`, and by name when the ticket names something specific. Use `query_schema` before `describe_content_type` when you need metadata filters such as property names, captions, help text, `editorHint`, hidden fields, `DisplayEditUI=false`, `ExistsOnModel=false`, value kind, changed-since discovery, or page-tree child availability. Then `describe_content_type` for each type you intend to use — it lists every property, notes export limitations, explains skeleton omissions, and returns a working plan with correctly shaped placeholders, so edit that rather than writing a plan from scratch. If nothing matches what the ticket describes, say so and ask which type is meant. Never substitute a plausible-sounding one; see `references/tool-guide.md`.

4. **Build the plan.** `planId` is the ticket id (`PROJ-123`), suffixed per scenario when one ticket needs genuinely independent sets (`PROJ-123-empty-state`). Content GUIDs derive from `planId`, so re-importing the same `planId` updates the same content instead of creating a second copy — right while iterating, wrong when the QA wants a fresh set. Name items so the QA can find and delete them in the CMS tree: `PROJ-123 — search empty state 1`. Generate what the cases need and no more; use `count` with `{{i}}` instead of repeating near-identical items by hand. Choose the property values with **Designing the values** below — the values are what decide whether the data can test anything.

5. **`validate_plan`.** Errors name the property and the shape expected — fix them and revalidate rather than guessing. Its warnings mean a supplied value will not be applied as given; use `describe_content_type` and `query_schema` notes for the broader empty-field and caution list in step 6. `build_package` can add the same drop warnings, so keep the artifact in sync instead of treating a later warning as new behavior.

6. **Write the review artifacts.** `content-plan.json` and `test-data.md` (below). Nothing has been built yet and nothing is sent to the CMS — these two files exist so the QA can judge the data before a package is produced.

7. **Get the data approved.** Walk the user through `test-data.md` — the items, their actual property values, and the fields that will be empty — and ask whether the content is right or needs changing. Act on what they say: adjust the plan, re-run `validate_plan`, rewrite both files, and ask again. Do not call `build_package` until they approve; an unapproved package wastes the QA's import, and a wrong one wastes their time twice.

8. **Build, then reconcile.** `build_package` with `outputPath` `.qa/<ticket-id>/test-data/<ticket-id>.episerverdata`; optionally run `inspect_package` on the result to confirm the content tree. Fill in `test-data.md`'s **Import** section, and if the build reported a warning the validation did not, add it to **Fields left empty** rather than leaving the file stale.

9. **Hand off, then hold.** Give the user the package path, the import instructions — **Admin → Import Data**, and the QA picks the destination there — and the list of fields left empty. Then stop. The QA imports and verifies it themselves; continue to `auto-execute` only when they confirm.

## Designing the values

Choosing the right content type is the easy half. The values decide whether the data can tell a passing build from a failing one, and that is the half QAs notice only after the import.

**Derive every value from the case's expected result.** Read what the case asserts, then ask what the data must look like for that assertion to be able to fail. A case that expects "newest first" cannot fail against three articles published the same day — the order looks right whichever way the site sorts. Give them `{{date:-1d}}`, `{{date:-8d}}`, `{{date:-30d}}` and create them out of order, so a broken sort is visible.

**Make the items distinguishable in the way the case checks.** Distinct names are enough when the case counts items; they are not enough when it checks which item rendered where. If the case reads a teaser, the teasers must differ. Identical body text across three items hides exactly the bug the case exists to catch.

**Generate past the boundary the case names.** "Shows the first 5" needs more than five, or the truncation never happens. "Falls back when there is no image" needs the item with no image, not a populated one the QA has to empty by hand. A length limit needs one item at the limit and, when the case mentions truncation, one over it.

**An empty state is data too.** A case about "no results" needs a real item that yields nothing — an empty ContentArea, a category with no children — and it needs to exist before the QA can test it. Do not leave it to them to delete something.

**Use text that survives the round trip.** Encoding bugs live in Vietnamese diacritics, `&`, quotes and angle brackets, and ASCII-only filler never finds them. When the site under test serves Vietnamese content, at least one item should carry real Vietnamese text. Keep it plausible rather than lorem ipsum where that costs nothing: a QA reviewing `test-data.md` spots a wrong value faster in content that reads like the site's own.

**Say what a value is for when it is not obvious.** `{{date:-400d}}` in an archive case, a title at exactly 60 characters for an SEO rule — note the intent in `test-data.md`'s Item detail so the QA can tell a deliberate boundary from a typo.

## Artifacts

All under `.qa/<ticket-id>/test-data/`:

| File | Written | For | Content |
|---|---|---|---|
| `test-data.md` | step 6 | the QA | The review surface. Everything needed to judge the data before it is built. |
| `content-plan.json` | step 6 | the generator | The exact plan sent to `build_package` — re-runnable and diffable across iterations. **This is not the review surface**: never ask the QA to read or approve the JSON. |
| `<ticket-id>.episerverdata` | step 8 | the CMS | The importable package. Only exists after approval. |

`test-data.md` carries six sections, in this order:

- **Scenario** — the `planId`, the language branch, one line on what this data is for, and the test case IDs it serves. Note that re-importing the same `planId` updates the same content rather than creating a second copy.
- **What will be created** — an indented tree of the items, so the QA sees the shape and the parent/child nesting at a glance.
- **Item detail** — one subsection per item: its type, name, URL segment, and a `| Property | Value | Why |` table listing **every property the plan sets, with the value it sets**. This is the section that makes the data reviewable — an item's name alone tells the QA nothing about whether the content is right. Truncate long HTML or text to its first ~100 characters and mark it `…`; show `{{i}}` / `{{date:…}}` tokens as written *and* what they resolve to. Fill **Why** only where the value is a deliberate choice — a boundary length, a date that must sort last, text chosen to exercise encoding — so a QA can tell an intentional edge case from a typo. Leave it blank for ordinary filler.
- **Fields left empty** — one row per field the generator will not fill: content type, property, why (unproven serialisation, inline block serialization, media/DAM binary content, or another unsupported export limitation), and whether the test case actually needs it. Include caution-only notes that affect QA setup, such as `DisplayEditUI=false`, `ExistsOnModel=false`, and integer fields whose enum labels are absent from the export. A field the case depends on is a gap to raise now, not after the import.
- **Coverage** — a `| Test case | Items it depends on |` table, plus any precondition you could not satisfy. This is where the QA sees that a case they care about got nothing.
- **Import** — the package path and the **Admin → Import Data** steps. Left as "not built yet — pending approval" until step 8 fills it in.

## Rules

- **No package before approval.** `test-data.md` is written first and the user approves the data there. Building early is not a harmless head start: the QA imports whatever you hand them, so a package built on unreviewed data costs them an import, a cleanup, and a second review.
- **Review the values, not the item names.** "Three article pages" tells the QA nothing. Show what each property is actually set to, and let them catch a heading, date, or reference that does not match the case.
- **Data that cannot fail is not test data.** Before you write the plan out, take each case and ask what the site would have to get wrong for this data to look wrong. If nothing comes to mind, the values are decoration — see **Designing the values**.
- **Never invent a content type.** Read them from `list_content_types` or `query_schema`. A wrong type generates content that tests nothing.
- **An "unproven" warning is not a failure.** It means the generator refused to guess a serialisation it cannot prove and left the field empty. Report those fields — the QA is looking at a CMS page, not at your warnings, and an unexplained blank field gets filed as a bug against the site. Never retry to make the warning disappear.
- **Never guess enum values.** The export has no enum labels or value mapping. Every integer property is int-backed, and if CMS edit mode presents it as a selection, QA must confirm legal values there.
- **Do not treat page-tree child availability as ContentArea allowed types.** The exported `<availablecontenttypes>` section describes which page types can be children in the page tree only. ContentArea `[AllowedTypes]` is absent from the export.
- **Treat `editorHint` as site-specific.** The tool reports the hint string verbatim; its meaning varies by site and installed plugin, so do not hard-code vendor or DAM assumptions.
- **Never say where the content will land.** The QA picks the destination at import time.
- **Say early what the generator cannot do**, whenever the scenario depends on it: media/DAM binary serialization (images, video, files), inline block properties (a property whose type *is* a block — blocks inside a **ContentArea** work normally), unpublished content, more than one language, `Category`, untyped `Json`, enum-label recovery, ContentArea `[AllowedTypes]` recovery, and `[ScaffoldColumn]` recovery. Working: pages, blocks, nested page trees, text, HTML, ContentArea, content references, and `{{date:±Nd}}` / `{{date:±Nh}}` / `{{date:±Nm}}` tokens for dates relative to now.
- Read `references/tool-guide.md` when choosing types, sizing the data, or interpreting warnings.

## Handoff

- **Produces:** `.qa/<ticket-id>/test-data/test-data.md` and `.qa/<ticket-id>/test-data/content-plan.json` at the review step, then `.qa/<ticket-id>/test-data/<ticket-id>.episerverdata` once the user approves the data. A run that ends without approval leaves the first two and no package — that is a valid outcome, not a failure.
- **Next:** `invoke auto-execute` — but only after the user confirms they have imported the package under **Admin → Import Data** and verified the content. Never run execution against content that has not been imported.
