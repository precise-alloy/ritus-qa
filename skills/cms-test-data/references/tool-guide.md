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

**Reuse `planId` deliberately.** Content GUIDs derive from it, so re-importing the same `planId` updates the same content instead of creating a second copy. That is the right behaviour when you are iterating on a scenario, and the wrong one when QA wants a fresh independent set — then change the `planId`. It is the only control for this: the **update existing content** checkbox on the import screen does not change the outcome, because the package preserves identity either way.

**Tell QA to import to the same destination each time.** Recognising the content by GUID is what makes an update an update — and the same recognition means that a second import naming a *different* destination **moves** the existing items there rather than copying them. They vanish from where they were, which reads as data loss to a QA who was not warned. This is the CMS's own update behaviour, verified against CMS 12, not something the package chooses. Media is the exception: it is pinned to the site's global assets folder on every import, so images stay put while pages move.

## Reading what comes back

**Errors block generation.** They name the property and the shape expected. Fix the plan and validate again.

**Warnings do not block.** `validate_plan` and `build_package` warn when a supplied value will not be applied as given, such as unproven serialisation left empty or inline block-valued properties dropped. `describe_content_type` and `query_schema` carry the broader advisory notes: `DisplayEditUI=false` means the field is not shown in CMS edit mode, and `ExistsOnModel=false` means the export contains a property no longer present on the current model.

**Always tell QA which fields will be empty.** They are looking at a CMS page, not at your warnings — an unexplained blank field gets filed as a bug against the site. `describe_content_type` lists every property and marks skeleton omissions before you build; `validate_plan` and `build_package` warn only for supplied values that will be dropped, so build the empty-field list from schema discovery first and reconcile any build warnings afterward.

**Treat absent metadata as a limitation, not a puzzle.** Content-type exports do not carry enum labels/values, ContentArea `[AllowedTypes]`, or `[ScaffoldColumn]` metadata. Every integer field is int-backed; if CMS edit mode presents it as a selection/enum, confirm the legal values there instead of guessing. `editorHint` is reported verbatim from the export and is site-specific, so do not infer global semantics from a hint string.

## What the generator does not do

Do not promise these, and say so early when QA's scenario depends on one:

| | |
|---|---|
| SVG, PDF and video media | Not generated. The generator writes PNG only, because the CMS produces a thumbnail by rasterising the image and cannot do that for these. A case that turns on a PDF download or a video poster needs the file uploaded by hand. |
| Inline block properties (a property whose type *is* a block, rather than a block placed in a ContentArea) | Value is dropped with a warning. Blocks inside a **ContentArea** work normally, verified four levels deep. |
| Selection enum labels/values | Not present in the export. Integer fields may be backed by CMS selections, but legal labels and values must be confirmed in CMS edit mode. |
| ContentArea `[AllowedTypes]` | Not present in the export. The `<availablecontenttypes>` data exposed by the tool is page-tree child availability only. |
| `[ScaffoldColumn]` | Not present in the export, so the generator cannot know whether a model property was scaffold-hidden by code. |
| Unpublished content | Everything imports as published. |
| More than one language | One branch per package, `en` by default. |
| `Category`, untyped `Json` | Always empty. |

Working: pages, blocks, nested page trees, raster image media, text, HTML, ContentArea, content references, and `{{date:±Nd}}` / `{{date:±Nh}}` / `{{date:±Nm}}` tokens for dates relative to now — `{{date:-30d}}` for content that must look thirty days old.

## Images

A media item is an ordinary plan item whose content type is one the site declares as media. Give it an optional size and the generator writes a placeholder PNG into the package:

```json
{ "key": "hero", "type": "ImageFile", "name": "PROJ-123 — hero 16:9",
  "image": { "width": 1600, "height": 900 } }
```

Other items then point at it the same way they point at anything else — `{ "ref": "hero" }` for a content reference, `[{ "ref": "hero" }]` for a ContentArea. Nothing about referencing is media-specific.

**Referencing is free; `count` is not.** One media item referenced by twenty pages is one item and one file in the CMS. `count: 20` on the media item is twenty images with twenty binaries. Reach for `count` only when the case needs images it can tell apart. `count` is capped at 1000, and the generator also enforces a budget on total pixels across every image in a plan — about 139 images at the default size — so a plan that asks for hundreds of large images is rejected rather than left to block. A test-data plan should never come close to either.

**State the size when the case turns on it.** The default is 1280×720. Content-type exports carry no dimension metadata, so the generator cannot infer that a property wants a square avatar or a portrait card — and neither can you from the property name. A case about cropping, aspect ratio, or a responsive breakpoint has to name the pixels; a case that just needs "an image present" should take the default.

**The placeholder is a test pattern, and that is deliberate.** It carries a circle, a square grid, corner brackets and its own size printed on it, because a flat colour cannot show the failure: squash a flat image into the wrong aspect ratio and it still looks like itself. Under distortion the circle becomes an ellipse and the grid cells become rectangles; under a crop the corner brackets go missing; a wrong rendition disagrees with the size printed on the image. When a case is about cropping or aspect ratio, tell the QA what to look at — otherwise they see an odd graphic and no reason for it.

**The bytes are always PNG**, whatever the item is named, and the URL segment uses `.png` too. Naming an item `banner.jpg` earns a warning and still produces a PNG — writing PNG bytes into a `.jpg` file would look right and be wrong.

**Media lands in the site's global assets folder**, not where QA picks at import, and not in the plan's block folder. Tell QA the names so they can find and delete them.

**Thumbnails are the CMS's job.** The package deliberately carries no thumbnail: the CMS generates the 48×48 itself from the image, and shipping a placeholder would stop it doing so permanently. If the media list shows a generic icon after import, opening the item or running the **Clear Thumbnail Properties** scheduled job produces it. Say this in the handoff — an unexplained missing thumbnail gets filed as a site bug.

**A media type must be able to hold a PNG, or the plan is rejected.** A type that declares `supportedMediaExtensions` without `png`, and a `Video`-based type, are both **errors** — a video type given a still image is content that looks right and is wrong. A generic `Media` base still builds with a warning: it is the most common base in real exports and the export cannot prove either way, but the CMS only auto-generates thumbnails for image types, so such an item may keep a generic icon. Prefer an `Image`-based type when the site has one. `load_schema` and `describe_content_type` both list which media types are image-capable and which will be rejected, so read that rather than guessing from the name.

## Red flags

| Thought | Reality |
|---|---|
| "I'll ask QA to export their content so I have real examples" | You need type definitions, not customer data. Ask for content types only. |
| "The site must have an ArticlePage" | Read `list_content_types`. A wrong type generates content that tests nothing. |
| "The unproven warning means something failed" | It means the generator refused to guess. Report the empty fields; do not retry. |
| "This int looks like an enum, so I'll try a few likely numbers" | The export has no enum labels. Ask QA to confirm legal values in CMS edit mode. |
| "Page-tree child availability tells me which blocks a ContentArea allows" | It does not. ContentArea `[AllowedTypes]` is absent from the export. |
| "I'll skip validate_plan, build_package validates anyway" | It does — but validating first tells you what to fix without producing a file you then discard. |
| "I'll tell QA where the content will appear" | QA picks the destination for pages at import time. Blocks go to the plan's folder and media to global assets wherever they point it — say those, since that is where they delete them. |
| "Twenty pages need a hero, so I'll generate twenty images" | One image referenced twenty times is one item and one file. Generate several only when the case has to tell them apart. |
| "The property is called `HeroImage`, so it must want 16:9" | The export carries no dimension metadata and the name is not evidence. Take the default, or ask what the case needs. |
| "The thumbnail is missing after import, the package is broken" | The package leaves it empty on purpose so the CMS generates it. Open the item or run Clear Thumbnail Properties. |
| "Same scenario again, so I'll bump the planId to be safe" | Reusing it updates in place, which is what you want while iterating. Change it only for a genuinely separate set. |
| "QA can import wherever they like each time" | The first import, yes. A later import to a different destination moves the existing content there instead of copying it — tell them to pick the same place each time. |
| "QA unticked the update-existing checkbox, so they'll get a fresh set" | They will not. The package preserves identity either way; `planId` is the only control. |
