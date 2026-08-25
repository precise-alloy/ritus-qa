# Final Review Fix Report: Export Dependency Bootstrap

## Scope

- Branch: `export-dependency-bootstrap`
- Implementation commit: `77a6c3583c19708c3ddf4c28246c109b14d18c55` (`fix: clarify export bootstrap directories`)
- No approved plan or design file was modified.

## Finding 1: Separate Plugin and Project Roots

### Code/documentation changes

- `skills/artifact-export/SKILL.md`
  - Adds an ordered two-root procedure: `<project-root>` remains the current
    directory for source validation and the export CLI, while `<plugin-root>`
    is used only for dependency checks and the frozen installation.
  - Makes `.qa/<ticket-id>/...` explicitly resolve from `<project-root>`, so
    sources and outputs remain in the target project rather than the plugin
    installation directory.
  - Requires returning to `<project-root>` before invoking
    `bun "<plugin-root>\scripts\export-artifact.ts" ...`.
- `README.md`
  - Replaces ambiguous relative CLI examples with project-root working-directory
    examples that invoke the script by its plugin-root path.

### Contract coverage

- `tests/export-docs.test.ts` asserts the roots, source validation,
  dependency-bootstrap, and CLI steps occur in that order.
- It requires every documented skill CLI command to use the plugin-root script
  path and rejects the former relative `bun scripts/export-artifact.ts` form.
- It requires the README examples to use the same project-root invocation.

## Finding 2: Exact Bootstrap Safety Contract

### Test changes

- `tests/export-docs.test.ts` now requires:
  - exactly `exceljs`, `docx`, and `pdfkit` as the runtime package set;
  - exactly one installation command, `bun install --frozen-lockfile`;
  - installation only when one or more of those packages are missing;
  - skipping installation when all packages exist;
  - Bun/install failure to report the error and stop before the CLI;
  - no dependency check/install for unsupported or missing-source requests;
  - no installation in `<project-root>` or another project-under-test directory.
- The test compares all installation-related procedure lines and all documented
  CLI command lines, preventing an additional contradictory instruction from
  passing alongside the required wording.

## Test-First and Verification Evidence

1. Red test run before documentation changes:

   ```powershell
   bun test tests\export-docs.test.ts tests\skills.test.ts
   ```

   Result: expected failure (`31` passing, `2` failing). The new two-root
   procedure was absent and the README still used the relative CLI invocation.

2. Focused final verification:

   ```powershell
   bun test tests\export-docs.test.ts tests\skills.test.ts
   ```

   Result: `33` passing, `0` failing, `167` expectations across `2` files.

3. Full regression:

   ```powershell
   bun test
   ```

   Result: `110` passing, `0` failing, `562` expectations across `9` files.

4. Self-review:

   ```powershell
   git diff --check
   ```

   Result: clean; the focused implementation diff contained only `README.md`,
   `skills/artifact-export/SKILL.md`, and `tests/export-docs.test.ts`.

## Concerns

- No unresolved implementation concerns.
- The pre-existing untracked plan files
  `docs/superpowers/plans/2026-08-18-export-dependency-bootstrap.md` and
  `docs/superpowers/plans/2026-08-18-qa-artifact-export.md` were left
  untouched and were not included in the implementation commit.
