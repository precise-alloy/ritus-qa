# Generating Optimizely CMS 12 test data

## Overview

You drive an MCP server that turns a content plan into a `.episerverdata` file. QA imports that file into their CMS.

The tool manifest already tells you the shape of every argument. This guide covers what it cannot: how to choose what to generate, and how to read what the generator gives back. The `cms-test-data` skill owns the workflow around it — when the stage runs, where artifacts land, and when the pipeline waits.

**Core principle:** the generator never touches the CMS. It reads an export and writes a file. A human moves data in both directions.

## The two human steps

```
QA: Admin → Export Data          you: load_schema … build_package        QA: Admin → Import Data
    (content types only)              (never touches the CMS)                (picks the destination)
```

**Before you can do anything**, you need the site's content types. Ask QA to produce them in the CMS under **Admin → Export Data**, selecting content types only.

Ask for content types, never for a content export. A content export carries the customer's real page data, and you do not need it — everything the generator classifies comes from the type definitions.

**After you produce the file**, QA imports it under **Admin → Import Data** and chooses the destination there. Nothing in the plan decides where content lands, so do not tell QA it will appear in a particular place.

## Choosing what to generate

**Use the types the site actually has.** Read them from `list_content_types`; do not assume an `ArticlePage` or a `HeroBlock` exists because most sites have one. Use `query_schema` before `describe_content_type` when you need metadata filters: property/caption/help-text search, picker `editorHint`, hidden or edit-UI-invisible fields, fields missing from the model, value kind, or changed-since discovery. `query_schema` is bounded and reports `total`, `truncated`, and `limit`, so it avoids dumping a large schema into the prompt. If nothing matches what QA described, say so and ask which type they mean — a plausible-sounding wrong type produces content that tests nothing.

**Generate enough to exercise the case, and no more.** A listing that needs "several" articles needs three, not thirty. Use `count` with `{{i}}` instead of repeating near-identical items by hand.

**Give QA a way to find and delete it.** Names appear in the CMS tree, so make them recognisable and scoped to the scenario — `"Search results — empty state 1"` beats `"Test page 1"`. The plan's blocks are collected into one folder named after `planId`, so a `planId` per test scenario means QA deletes a scenario in one action.

**Reuse `planId` deliberately.** Content GUIDs derive from it, so re-importing the same `planId` updates the same content instead of creating a second copy. That is the right behaviour when you are iterating on a scenario, and the wrong one when QA wants a fresh independent set — then change the `planId`.

## Reading what comes back

**Errors block generation.** They name the property and the shape expected. Fix the plan and validate again.

**Warnings do not block.** `validate_plan` and `build_package` warn when a supplied value will not be applied as given, such as unproven serialisation left empty or inline block-valued properties dropped. `describe_content_type` and `query_schema` carry the broader advisory notes: media/DAM binary content is not generated, `DisplayEditUI=false` means the field is not shown in CMS edit mode, and `ExistsOnModel=false` means the export contains a property no longer present on the current model.

**Always tell QA which fields will be empty.** They are looking at a CMS page, not at your warnings — an unexplained blank field gets filed as a bug against the site. `describe_content_type` lists every property and marks skeleton omissions before you build; `validate_plan` and `build_package` warn only for supplied values that will be dropped, so build the empty-field list from schema discovery first and reconcile any build warnings afterward.

**Treat absent metadata as a limitation, not a puzzle.** Content-type exports do not carry enum labels/values, ContentArea `[AllowedTypes]`, or `[ScaffoldColumn]` metadata. Every integer field is int-backed; if CMS edit mode presents it as a selection/enum, confirm the legal values there instead of guessing. `editorHint` is reported verbatim from the export and is site-specific, so do not infer global semantics from a hint string.

## What the generator does not do

Do not promise these, and say so early when QA's scenario depends on one:

| | |
|---|---|
| Media/DAM binary serialization — images, video, files | Not supported. A page needing a hero image gets everything except the image. Media content types are derived from the loaded schema at runtime. |
| Inline block properties (a property whose type *is* a block, rather than a block placed in a ContentArea) | Value is dropped with a warning. Blocks inside a **ContentArea** work normally, verified four levels deep. |
| Selection enum labels/values | Not present in the export. Integer fields may be backed by CMS selections, but legal labels and values must be confirmed in CMS edit mode. |
| ContentArea `[AllowedTypes]` | Not present in the export. The `<availablecontenttypes>` data exposed by the tool is page-tree child availability only. |
| `[ScaffoldColumn]` | Not present in the export, so the generator cannot know whether a model property was scaffold-hidden by code. |
| Unpublished content | Everything imports as published. |
| More than one language | One branch per package, `en` by default. |
| `Category`, untyped `Json` | Always empty. |

Working: pages, blocks, nested page trees, text, HTML, ContentArea, content references, and `{{date:±Nd}}` / `{{date:±Nh}}` / `{{date:±Nm}}` tokens for dates relative to now — `{{date:-30d}}` for content that must look thirty days old.

## Red flags

| Thought | Reality |
|---|---|
| "I'll ask QA to export their content so I have real examples" | You need type definitions, not customer data. Ask for content types only. |
| "The site must have an ArticlePage" | Read `list_content_types`. A wrong type generates content that tests nothing. |
| "The unproven warning means something failed" | It means the generator refused to guess. Report the empty fields; do not retry. |
| "This int looks like an enum, so I'll try a few likely numbers" | The export has no enum labels. Ask QA to confirm legal values in CMS edit mode. |
| "Page-tree child availability tells me which blocks a ContentArea allows" | It does not. ContentArea `[AllowedTypes]` is absent from the export. |
| "I'll skip validate_plan, build_package validates anyway" | It does — but validating first tells you what to fix without producing a file you then discard. |
| "I'll tell QA where the content will appear" | QA picks the destination at import time. You cannot know it. |
| "Same scenario again, so I'll bump the planId to be safe" | Reusing it updates in place, which is what you want while iterating. Change it only for a genuinely separate set. |
