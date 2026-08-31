---
name: cms-test-data
description: Use when the user asks to create, generate, or prepare CMS test data for a ticket — pages, blocks and content trees for an Optimizely CMS 12 site (e.g. "generate test data", "create test content for PROJ-123", "prepare CMS data for this ticket"). Produces an importable .episerverdata package from the ticket's test cases; the QA imports it in the CMS.
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

**This skill owns the workflow; the generator owns its own contract.** What the tool can and cannot produce, its limits, how to design values that can actually fail a test, image sizing, and what happens on re-import all come from the `usage_guide` tool at run time, rendered from the constants the generator enforces. Read it there rather than trusting a copy — including a copy in this file.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Read <ticket-id>-test-cases.md Preconditions, propose the content list, get the user's confirmation
- [ ] Check .qa/cms-schema/content-types.episerverdata and the cms-test-data MCP server
- [ ] load_schema, then usage_guide before writing any plan
- [ ] Choose types with list_content_types / query_schema / describe_content_type
- [ ] Build the plan, validate_plan, fix every error
- [ ] Write content-plan.json + test-data.md, walk the user through the data, get approval
- [ ] build_package only after approval, then refresh test-data.md's Import section
- [ ] Hand off the import step and hold until the user confirms it is imported and verified
```

## Prerequisites

Check both before the first tool call. Either one missing is a hard stop — produce no artifacts.

1. **Schema export** at `.qa/cms-schema/content-types.episerverdata` in the project under test. Missing → tell the QA to produce it in the CMS under **Admin → Export Data**, ticking **content types only**, save it to that path, and stop. It is re-exported only when the site's schema changes.

   Ask for content types, never for a content export. A content export carries the customer's real page data, and you do not need it — everything the generator classifies comes from the type definitions.

2. **MCP server** `cms-test-data`. The plugin declares it, so there is nothing for the QA to register — the host starts it when the plugin is enabled. If its tools are not available, the plugin is disabled or `bun` is not on the `PATH`; say which and stop. Do not fall back to running the generator any other way.

## Procedure

1. **Decide whether this ticket needs generated content.** Read `.qa/<ticket-id>/<ticket-id>-test-cases.md` and take the content requirements from the **Preconditions** column; read `.qa/<ticket-id>/<ticket-id>-plan.md` for scope. Present the items you propose to generate — type, name, and which case needs it — and ask the user to confirm or adjust. If the environment already satisfies every precondition, say so and stop: no plan, no package.

2. **`load_schema`** with `.qa/cms-schema/content-types.episerverdata`. Every other tool fails until this succeeds; if `load_schema` errors, the file is probably corrupt or not a content-types export, so ask the QA to re-export it under **Admin → Export Data** with content types only rather than retrying.

3. **`usage_guide`** before writing your first plan for this schema. It returns the generator's own contract — what it does not produce, the limits it enforces, how to design values a test can actually fail against, image sizing, and how re-import behaves. It takes no arguments and its numbers come from the code, so it is the authority when anything here or in your own memory disagrees with it.

4. **Choose types the site actually has.** `list_content_types` filtered by `kind`, and by name when the ticket names something specific. Use `query_schema` before `describe_content_type` when you need metadata filters such as property names, captions, help text, `editorHint`, hidden fields, `DisplayEditUI=false`, `ExistsOnModel=false`, value kind, changed-since discovery, or page-tree child availability. Then `describe_content_type` for each type you intend to use — its `skeleton` is a working plan with correctly shaped placeholders, so edit that rather than writing one from scratch. If nothing matches what the ticket describes, say so and ask which type is meant.

5. **Build the plan.** `planId` is the ticket id (`PROJ-123`), suffixed per scenario when one ticket needs genuinely independent sets (`PROJ-123-empty-state`). Name items so the QA can find and delete them in the CMS tree: `PROJ-123 — search empty state 1`. Generate what the cases need and no more. Derive the property values from what each case asserts — `usage_guide`'s value-design guidance is the reference, and the values are what decide whether the data can test anything.

6. **`validate_plan`.** Errors name the property and the shape expected — fix them and revalidate rather than guessing. Warnings do not block; read them together with the `describe_content_type` and `query_schema` notes to build the empty-field list for step 8. `build_package` can report warnings the validation did not, so reconcile rather than treating a later warning as new behaviour.

7. **Write the review artifacts.** `content-plan.json` and `test-data.md` (below). Nothing has been built yet and nothing is sent to the CMS — these two files exist so the QA can judge the data before a package is produced.

8. **Get the data approved.** Walk the user through `test-data.md` — the items, their actual property values, and the fields that will be empty — and ask whether the content is right or needs changing. Act on what they say: adjust the plan, re-run `validate_plan`, rewrite both files, and ask again. Do not call `build_package` until they approve; an unapproved package wastes the QA's import, and a wrong one wastes their time twice.

9. **Build, then reconcile.** `build_package` with `outputPath` `.qa/<ticket-id>/test-data/<ticket-id>.episerverdata`; optionally run `inspect_package` on the result to confirm the content tree. Fill in `test-data.md`'s **Import** section, and if the build reported a warning the validation did not, add it to **Fields left empty** rather than leaving the file stale.

10. **Hand off, then hold.** Give the user the package path, the import instructions — **Admin → Import Data**, and the QA picks the destination there — and the list of fields left empty. Then stop. The QA imports and verifies it themselves; continue to `auto-execute` only when they confirm.

## Artifacts

All under `.qa/<ticket-id>/test-data/`:

| File | Written | For | Content |
|---|---|---|---|
| `test-data.md` | step 7 | the QA | The review surface. Everything needed to judge the data before it is built. |
| `content-plan.json` | step 7 | the generator | The exact plan sent to `build_package` — re-runnable and diffable across iterations. **This is not the review surface**: never ask the QA to read or approve the JSON. |
| `<ticket-id>.episerverdata` | step 9 | the CMS | The importable package. Only exists after approval. |

`test-data.md` carries six sections, in this order:

- **Scenario** — the `planId`, the language branch, one line on what this data is for, and the test case IDs it serves. State what re-importing this package does and what produces a separate set instead, taking the identity rules from `usage_guide` rather than from memory.
- **What will be created** — an indented tree of the items, so the QA sees the shape and the parent/child nesting at a glance.
- **Item detail** — one subsection per item: its type, name, URL segment, and a `| Property | Value | Why |` table listing **every property the plan sets, with the value it sets**. This is the section that makes the data reviewable — an item's name alone tells the QA nothing about whether the content is right. Truncate long HTML or text to its first ~100 characters and mark it `…`; show `{{i}}` / `{{date:…}}` tokens as written *and* what they resolve to. For a media item, give its pixel size on the same footing as a property value — that is the only thing a QA can review about a generated placeholder. Fill **Why** only where the value is a deliberate choice — a boundary length, a date that must sort last, an aspect ratio the layout depends on, text chosen to exercise encoding — so a QA can tell an intentional edge case from a typo. Leave it blank for ordinary filler.
- **Fields left empty** — one row per field the generator will not fill: content type, property, why, and whether the test case actually needs it. Take the reasons from `describe_content_type`'s notes and `usage_guide`'s limitations rather than paraphrasing them here. Include caution-only notes that affect QA setup, such as `DisplayEditUI=false`, `ExistsOnModel=false`, and integer fields whose enum labels are absent from the export. A field the case depends on is a gap to raise now, not after the import.
- **Coverage** — a `| Test case | Items it depends on |` table, plus any precondition you could not satisfy. This is where the QA sees that a case they care about got nothing.
- **Import** — the package path and the **Admin → Import Data** steps. Left as "not built yet — pending approval" until step 9 fills it in. Whenever the QA may import more than once, this section must also carry the re-import behaviour `usage_guide` describes: what a second import does, what picking a different destination does to content that already exists, and where media lands regardless of the destination. None of it is visible in the CMS until it happens, and a QA who was not warned reads it as data loss. When the package contains media, add what `usage_guide` says about thumbnails — without that line a QA files a missing thumbnail as a site bug.

  Quote these from `usage_guide` at the time you write the file. They are the facts most likely to drift, and a stale copy here is worse than no copy.

## Rules

- **No package before approval.** `test-data.md` is written first and the user approves the data there. Building early is not a harmless head start: the QA imports whatever you hand them, so a package built on unreviewed data costs them an import, a cleanup, and a second review.
- **Review the values, not the item names.** "Three article pages" tells the QA nothing. Show what each property is actually set to, and let them catch a heading, date, or reference that does not match the case.
- **Data that cannot fail is not test data.** Before you write the plan out, take each case and ask what the site would have to get wrong for this data to look wrong. If nothing comes to mind, the values are decoration — `usage_guide` covers how to fix that.
- **Never invent a content type.** Read them from `list_content_types` or `query_schema`. A wrong type generates content that tests nothing.
- **Report every field the generator leaves empty.** The QA is looking at a CMS page, not at your warnings, and an unexplained blank field gets filed as a bug against the site. A warning that a value was dropped is the generator refusing to guess — never retry to make it disappear.
- **Never say where pages will land.** The QA picks the destination at import time. Say where blocks and media go instead, because that is where the QA goes to delete them.
- **Say early what the generator cannot do**, whenever the scenario depends on it. `load_schema` and `usage_guide` both report the current limitations; take them from there, because this file is not the source of truth for them.
- **The tool's own guide wins.** If anything in this file disagrees with `usage_guide`, follow `usage_guide` and tell the user this file needs updating. Its content is rendered from the constants the generator enforces; this file is hand-written and can go stale.

## Handoff

- **Produces:** `.qa/<ticket-id>/test-data/test-data.md` and `.qa/<ticket-id>/test-data/content-plan.json` at the review step, then `.qa/<ticket-id>/test-data/<ticket-id>.episerverdata` once the user approves the data. A run that ends without approval leaves the first two and no package — that is a valid outcome, not a failure.
- **Next:** `invoke auto-execute` — but only after the user confirms they have imported the package under **Admin → Import Data** and verified the content. Never run execution against content that has not been imported.
