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
- [ ] Check plugin-root dependencies; install with Bun and use npm once if needed
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
   - `<plugin-root>` contains this skill, `package.json`, `bun.lock`, and `scripts/export-artifact.ts`; use it for dependency checks and installation only.
   - `.qa/<ticket-id>/...` resolves from `<project-root>`, so source and output files must remain in the target project, never in the plugin installation directory.
   - Support Windows, macOS, and Linux. Resolve paths from the actual plugin location and choose executable invocation, quoting, and path separators for the current shell/PATH. Do not hardcode PowerShell, a user directory, or an OS-specific executable. The logical commands below are portable; use a shell-specific executable such as `npm.cmd` only if the environment requires it.

4. From `<project-root>`, check the source Markdown before invoking the CLI:
   - `test-cases` requires `.qa/<ticket-id>/<ticket-id>-test-cases.md`
   - `test-plan` requires `.qa/<ticket-id>/<ticket-id>-plan.md`

   If the source file is missing, say exactly which path is missing and stop. The Markdown file is the source of truth, so any manual edits there must flow into the export.

5. From `<plugin-root>`, check or install the export dependencies:
   - Verify Bun 1.3+ is available. If it is unavailable or older, explain the prerequisite and stop; do not provision Bun automatically.
   - Check actual module loading with `bun --no-install`, not just whether a package directory exists. Import the selected format's parser and renderer from `scripts/lib/export`; for XLSX also import `preserve-completion-state.ts`. For `docx,pdf`, check both renderers. This checks their transitive dependencies and, for PDF, font assets without exporting or modifying Markdown.
   - If the required modules load, skip installation. Do not load an unrelated format's renderer just to check dependencies.
   - If a dependency is missing or unusable, run `bun install --frozen-lockfile` once while the current directory is `<plugin-root>`.
   - If Bun installation exits successfully, repeat the same `bun --no-install` import check. A successful install exit code with empty/unloadable packages is still an installation failure.
   - If Bun installation fails, or the post-install check still cannot load a dependency, use npm as a one-time fallback: `npm install --no-save --package-lock=false`, also from `<plugin-root>`. Do not run both installers when Bun succeeded and imports work.
   - If npm is unavailable, report that and the original Bun failure, then stop. After the fallback, require both a successful npm exit code and successful module loading with `bun --no-install`; otherwise report the command, plugin root, exit code and relevant errors (redacting credentials), then stop. Do not loop through more installation attempts.
   - npm does not enforce `bun.lock`: fallback versions follow `package.json` ranges. The flags avoid saving manifest changes or creating/updating a package lock; do not rewrite `package.json` or either lockfile to make an install pass.
   - Only installation/dependency-loading failures qualify for npm fallback. Source-code, Markdown, argument-validation and output-filesystem errors must be reported directly, not treated as reasons to reinstall.
   - Never install in `<project-root>` or another project-under-test directory. Do not check/install for an unsupported request or missing source Markdown. Before continuing, return to `<project-root>`.

6. From `<project-root>`, run the exact CLI command by its plugin-root path:
   - Run the CLI by the plugin-root path, never by a path relative to the current directory.

   ```text
   # Current directory: <project-root>
   bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-cases --format xlsx
   bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx
   bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format pdf
   bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx,pdf
   ```

   Substitute the absolute script path using the host's path conventions; `/` above is a documentation separator, not a required shell.

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
- Only install when selected export dependencies need it: Bun first, npm fallback at most once, always in the plugin root.
- Never create temporary junctions/symlinks, delete global caches, change registry/TLS settings, elevate privileges, or add extra repair attempts to work around an installation failure.
- Never edit project manifests or the source Markdown as part of dependency installation.

## Handoff

- **Produces:** local export files under `.qa/<ticket-id>/exports/` using ticket-prefixed filenames, plus a carried-forward `Completed` count when `<ticket-id>-test-cases.xlsx` reused existing checklist state.
- **Next:** terminal — export is an on-demand action and ends here unless the user asks for another file.
