# Final Review Fix 2 Report: Export Dependency Bootstrap

## Scope

- Branch: `export-dependency-bootstrap`
- Implementation commit: `d67646dfa205e9e5ac526297a0ca1cc4029cdd78` (`test: close export bootstrap doc contracts`)
- Modified file: `tests/export-docs.test.ts`
- No skill, README, plan, or specification wording changed. The approved documentation already met the intended behavior; this fix closes only the remaining contract-test gaps.

## Gap 1: Request Matrix, Source, and Bootstrap Ordering

### Test change

Added `artifact-export resolves the supported matrix before source validation and dependency bootstrap`.

The test requires the artifact-export procedure to:

1. resolve and enforce the supported artifact/format matrix, including both approved source/output rows;
2. validate the Markdown source after that resolution;
3. bootstrap plugin-root dependencies only after source validation; and
4. invoke the CLI only after bootstrap.

This catches a regression that validates a source before confirming it belongs to a supported request, or that bootstraps dependencies before matrix resolution/source validation.

### Red evidence

The skill procedure was temporarily mutated in memory/on disk to move dependency bootstrap and source validation ahead of matrix resolution, then restored byte-for-byte in `finally`:

```powershell
bun test tests\export-docs.test.ts -t 'artifact-export resolves the supported matrix before source validation and dependency bootstrap'
```

Result: expected failure — `0 pass`, `1 fail`, `2` expectations. The test expected the supported test-case matrix row in the resolution step but received an empty resolution slice after the ordering regression.

## Gap 2: Exhaustive README Installation Safety

### Test change

Added `README confines every Bun install command to frozen plugin-root recovery setup`.

The test:

1. captures every documented `bun install` occurrence in `README.md`;
2. requires the complete occurrence set to be exactly `bun install --frozen-lockfile`;
3. requires every occurrence to be inside the `Setup` section, before `Usage`;
4. requires the manual recovery wording to name only the plugin root containing `package.json` and `bun.lock`; and
5. retains the explicit prohibition against running the command in the project under test.

This rejects an additional or contradictory target-project installation command as well as a non-frozen recovery command.

### Red evidence

The README command was temporarily mutated from `bun install --frozen-lockfile` to `bun install`, then restored byte-for-byte in `finally`:

```powershell
bun test tests\export-docs.test.ts -t 'README confines every Bun install command to frozen plugin-root recovery setup'
```

Result: expected failure — `0 pass`, `1 fail`, `3` expectations. The assertion expected the frozen-lockfile command and received bare `bun install`.

## Verification

```powershell
bun test tests\export-docs.test.ts tests\skills.test.ts
```

Result: `35 pass`, `0 fail`, `180` expectations across `2` files.

```powershell
bun test
```

Result: `112 pass`, `0 fail`, `575` expectations across `9` files.

```powershell
git diff --check
```

Result: clean before committing; only `tests/export-docs.test.ts` was staged for the implementation commit.

## Concerns

- No unresolved implementation concerns.
- The pre-existing untracked plan files `docs/superpowers/plans/2026-08-18-export-dependency-bootstrap.md` and `docs/superpowers/plans/2026-08-18-qa-artifact-export.md` were left untouched and excluded from the implementation commit.
