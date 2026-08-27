---
name: artifact-export
description: Use when the user asks to export or convert QA artifacts to Excel/XLSX, spreadsheet, DOCX, or PDF (e.g. "export test cases to Excel", "convert the test plan to PDF", "export the test plan to DOCX"). Exports existing local Markdown artifacts without regenerating content.
---

# Artifact Export

Export an existing QA artifact on demand without regenerating its content.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Resolve ticket id, artifact, and supported format from the request
- [ ] Check the Markdown source file exists before exporting
- [ ] Check or install missing plugin-root export dependencies
- [ ] Run the export CLI from project root by its plugin-root script path
- [ ] Report output path(s) and any carried-forward Completed values
- [ ] Confirm the export stayed local with no cloud upload
```

## Input

A ticket id plus a requested artifact and format. If the ticket id is missing, ask for it. If the request is ambiguous, resolve it with these mappings:

- **Test cases** + `Excel`, `XLSX`, or `spreadsheet` → `test-cases` + `xlsx`
- **Test plan** + `DOCX` → `test-plan` + `docx`
- **Test plan** + `PDF` → `test-plan` + `pdf`
- **Test plan** + `all formats` / `DOCX and PDF` → `test-plan` + `docx,pdf`

Unsupported in this release:

- `test-cases` → `docx` or `pdf`
- `test-plan` → `xlsx`
- `summary.md`, bug reports, execution results, or any cloud upload/sync request

## Procedure

1. Resolve the ticket id. If the user did not provide one and it cannot be inferred from the current `.qa/<ticket-id>/` context, ask for it before exporting.

2. Resolve the requested artifact and format, then enforce the supported matrix:

   | Markdown source | Supported export |
   |---|---|
   | `.qa/<ticket-id>/<ticket-id>-test-cases.md` | `.qa/<ticket-id>/exports/<ticket-id>-test-cases.xlsx` |
   | `.qa/<ticket-id>/<ticket-id>-plan.md` | `.qa/<ticket-id>/exports/<ticket-id>-plan.docx`, `.qa/<ticket-id>/exports/<ticket-id>-plan.pdf` |

   Plan DOCX/PDF exports render supported Markdown semantics instead of copying formatting tokens literally. Images become alt text; raw HTML becomes text; only `http`, `https`, and `mailto` links are clickable, while unsafe links remain plain text labels.

3. Name and retain two separate roots:
   - `<project-root>` is the project-under-test root. Keep it as the current directory for source validation and the export CLI.
   - `<plugin-root>` contains this skill, `package.json`, and `bun.lock`; use it only for dependency checks and installation.
   - `.qa/<ticket-id>/...` resolves from `<project-root>`, so source and output files must remain in the target project, never in the plugin installation directory.

4. From `<project-root>`, check the source Markdown before invoking the CLI:
   - `test-cases` requires `.qa/<ticket-id>/<ticket-id>-test-cases.md`
   - `test-plan` requires `.qa/<ticket-id>/<ticket-id>-plan.md`

   If the source file is missing, say exactly which path is missing and stop. The Markdown file is the source of truth, so any manual edits there must flow into the export.

5. From `<plugin-root>`, check only the export dependencies:
   - Runtime package set: `exceljs`, `docx`, and `pdfkit`.
   - Verify Bun 1.3+ is available and check all three packages in `<plugin-root>/node_modules`.
   - Only when one or more packages in that exact set are missing, run exactly `bun install --frozen-lockfile` while the current directory is `<plugin-root>`.
   - Otherwise, skip installation entirely.
   - If Bun 1.3+ is unavailable or the installation fails, report the error and stop; do not invoke the CLI.
   - Do not check or install dependencies for an unsupported request or a missing source Markdown file.
   - Never run an install in `<project-root>` or any other project-under-test directory.
   - Before continuing, return to `<project-root>` so it is again the current directory.

6. Return to `<project-root>` and run the exact CLI command by its plugin-root path:
   - Run the CLI by the plugin-root path, never by a path relative to the current directory.

   ```powershell
   # Current directory: <project-root>
   bun "<plugin-root>\scripts\export-artifact.ts" --ticket <ticket-id> --artifact test-cases --format xlsx
   bun "<plugin-root>\scripts\export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx
   bun "<plugin-root>\scripts\export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format pdf
   bun "<plugin-root>\scripts\export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx,pdf
   ```

7. Parse the CLI JSON result and report:
   - every generated file path under `.qa/<ticket-id>/exports/`
   - for test-case exports, whether `carriedCompletionCount` was returned and how many existing `Completed` values were carried forward into `<ticket-id>-test-cases.xlsx`

8. State that the skill only creates local files. It does **not** upload anything to Microsoft 365, Google Drive, Google Sheets, or any other cloud service.

   Interactive Priority and Completed dropdowns are supported in Microsoft Excel. Google Sheets dropdown conversion/editing is not supported.

## Rules

- Never rewrite or regenerate the source Markdown just to export it.
- Never claim support for any artifact/format pair outside the matrix above.
- If the CLI returns a validation or filesystem error, relay it clearly and stop instead of guessing.
- Keep the action on demand only — do not export automatically after `test-plan` or `test-case-design`.
- Never install dependencies in the project under test or for an unsupported/missing-source export request.

## Handoff

- **Produces:** local export files under `.qa/<ticket-id>/exports/` using ticket-prefixed filenames, plus a carried-forward `Completed` count when `<ticket-id>-test-cases.xlsx` reused existing checklist state.
- **Next:** terminal — export is an on-demand action and ends here unless the user asks for another file.
