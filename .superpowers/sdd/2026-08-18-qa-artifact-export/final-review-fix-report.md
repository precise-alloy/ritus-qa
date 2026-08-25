# QA Artifact Export Final-Review Fix Report

## Status

Complete.

## Fix Commit

- `e8200f5ba2e12e05bfc4ec3fbc52b9478c3c64d7` — `fix: address QA artifact export final review`

## Finding-to-Fix Mapping

| Finding | Code change | Regression coverage |
|---|---|---|
| Ticket traversal could escape `.qa`. | `scripts/export-artifact.ts` now validates a simple ticket-ID component, rejects traversal/path syntax, resolves the ticket directory from the project `.qa` root, and uses that absolute anchor for all source and output I/O. JSON output remains project-relative. | Process-level CLI tests reject `..`, slash and backslash traversal, `.`, POSIX absolute paths, and Windows drive-form paths before any outside output is created. |
| `finally` could suppress atomic-write failures. | `scripts/lib/export/write-atomically.ts` no longer returns from `finally`; it only performs best-effort cleanup for its generated temp sibling. | A mocked `mkdir` failure now must throw an error containing both the parent-directory action and target path. Existing replacement and partial-write tests verify temp-sibling-only cleanup. |
| XLSX Overview omitted required export information. | `TestCasesDocument` now retains `sourcePath`; the parser preserves it. `render-test-cases-xlsx.ts` writes Markdown Source Path, Export Time, Coverage Notes, all source metadata, and priority/triage/completion counts. | The renderer test reloads the XLSX and asserts each metadata/value cell, ISO export timestamp, Coverage Notes, and all count cells. |
| `carriedCompletionCount` included removed IDs. | `scripts/export-artifact.ts` now counts the intersection of current parsed test-case IDs and prior completion IDs. | CLI regression workbook contains `TC-002` and removed `TC-999`; the JSON count is asserted as `1` and `TC-002` remains carried forward. |
| AutoFilter used column J despite a nine-column sheet. | `render-test-cases-xlsx.ts` sets the range to `A1:I<last-populated-row>`. | Reloaded workbook assertions require exactly nine columns and `A1:I${rowCount}`. |

## Test-First Evidence

Each production behavior was changed only after its focused regression failed:

1. Ticket traversal test: expected usage exit `2`; unpatched CLI returned `0` for `--ticket ..`.
2. Atomic mkdir test: unpatched `finally` returned normally, leaving the caught error `undefined`.
3. Overview test: expected `Markdown Source Path`; unpatched sheet contained `Total Cases`.
4. Completion-count test: expected `1`; unpatched CLI returned `2`.

## Final Validation

| Command | Result |
|---|---|
| `bun test tests\export-artifact.test.ts` | PASS — 50 pass, 0 fail, 307 expectations. |
| `bun test` | PASS — 109 pass, 0 fail, 534 expectations. |
| `git diff --check` | PASS — no whitespace errors. |

## Self-Review

- Confirmed all filesystem reads and writes use the resolved ticket directory under the project `.qa` root after CLI validation.
- Confirmed atomic cleanup can no longer override mkdir, write, or rename failures.
- Confirmed Overview retains prior parsed metadata while adding the required source/export/coverage fields.
- Confirmed the Test Cases header is nine columns and its filter ends at `I`.
- Confirmed only final-review code and regression tests were included in the fix commit.

## Concerns

- The existing multi-page PDF regression exceeded Bun's default five-second timeout during focused-suite runs despite passing alone. Its test now has a scoped 10-second timeout; no PDF production behavior changed.
- The approved plan file was already untracked in the workspace. It was read as requested and intentionally left unmodified and unstaged.
- Microsoft 365 and Google Workspace manual compatibility checks remain pending as recorded in the SDD ledger.
