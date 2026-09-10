import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function extractMarkdownSentences(text: string): string[] {
  const codeSpans: string[] = [];
  const prose = text
    .replace(/```[\s\S]*?```/g, '.')
    .replace(/`([^`]*)`/g, (_, code: string) => {
      const token = `__CODE_${codeSpans.length}__`;
      codeSpans.push(code);
      return token;
    })
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (prose.match(/[^.!?]+[.!?]/g) ?? []).map((sentence) =>
    sentence.replace(/__CODE_(\d+)__/g, (_, index: string) => codeSpans[Number(index)]).trim(),
  );
}

function extractGoogleSheetsSentences(readme: string): string[] {
  return extractMarkdownSentences(readme)
    .filter((statement) => /Google Sheets/i.test(statement));
}

function assertGoogleSheetsDropdownSupportStatement(readme: string): void {
  const googleSheetsSentences = extractGoogleSheetsSentences(readme).filter((statement) =>
    /\b(dropdown|conversion|editing|supported)\b/i.test(statement),
  );

  expect(googleSheetsSentences).toEqual([
    'Google Sheets: opening <ticket-id>-test-cases.xlsx through Drive/Sheets may normalize nonessential formatting, but Google Sheets dropdown conversion/editing for Priority and Completed is not supported.',
  ]);
}

test('artifact-export is discoverable from both plugin manifests', () => {
  for (const manifestPath of ['.claude-plugin/plugin.json', '.github/copilot-plugin.json']) {
    const manifest = JSON.parse(read(manifestPath));
    expect(manifest.skills).toBe('./skills/');
    expect(existsSync(join(ROOT, manifest.skills, 'artifact-export', 'SKILL.md'))).toBe(true);
  }
});

test('artifact export installs only at plugin root and invokes the source CLI from project root', () => {
  const skill = read('skills/artifact-export/SKILL.md');
  const readme = read('README.md');
  const rootsIndex = skill.indexOf('3. Name and retain two separate roots:');
  const sourceIndex = skill.indexOf('4. From `<project-root>`, check the source Markdown before invoking the CLI:');
  expect(rootsIndex).toBeGreaterThan(-1);
  expect(sourceIndex).toBeGreaterThan(rootsIndex);
  const rootsStep = skill.slice(rootsIndex, sourceIndex);
  expect(rootsStep).toContain(
    '`<project-root>` is the project-under-test root. Keep it as the current directory for source validation and the export CLI.',
  );
  expect(rootsStep).toContain(
    '`.qa/<ticket-id>/...` resolves from `<project-root>`, so source and output files must remain in the target project, never in the plugin installation directory.',
  );
  expect(rootsStep).toContain(
    '`<plugin-root>` contains this skill, `package.json`, `bun.lock`, and `scripts/export-artifact.ts`; use it for dependency checks and installation only.',
  );
  const commands = (text: string) => [...text.matchAll(/^\s*bun .*export-artifact\.(?:js|ts).*$/gm)].map(match => match[0].trim());
  expect(commands(skill)).toEqual([
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-cases --format xlsx',
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx',
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format pdf',
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx,pdf',
  ]);
  expect(skill).toContain('# Current directory: <project-root>');
  expect(skill).toContain('Run the CLI by the plugin-root path, never by a path relative to the current directory.');
  expect(readme).toContain(
    'Run every CLI command from `<project-root>`, the project-under-test root that contains `.qa`. Invoke the CLI by the absolute plugin-root script path so `.qa/<ticket-id>/...` remains in the target project.',
  );
  expect(commands(readme)).toEqual([
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket PROJ-123 --artifact test-cases --format xlsx',
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket PROJ-123 --artifact test-plan --format docx,pdf',
    'bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket SM26-207 --artifact test-plan --format docx,pdf',
  ]);
  for (const text of [skill, readme]) expect(text).not.toMatch(/dist[\\/]export-artifact\.js|build:export|export-bundle\.yml/);
});

test('artifact export resolves the matrix and source before checking or installing dependencies', () => {
  const skill = read('skills/artifact-export/SKILL.md');
  const resolutionIndex = skill.indexOf('2. Resolve the requested artifact and format, then enforce the supported matrix:');
  const sourceIndex = skill.indexOf('4. From `<project-root>`, check the source Markdown before invoking the CLI:');
  const prerequisiteIndex = skill.indexOf('5. From `<plugin-root>`, check or install the export dependencies:');
  const cliIndex = skill.indexOf('6. From `<project-root>`, run the exact CLI command by its plugin-root path:');
  const resolutionStep = skill.slice(resolutionIndex, sourceIndex);
  expect(skill).toContain('- [ ] Check plugin-root dependencies; install with Bun and use npm once if needed');
  expect(resolutionIndex).toBeGreaterThan(-1);
  expect(resolutionStep).toContain(
    '| `.qa/<ticket-id>/<ticket-id>-test-cases.md` | `.qa/<ticket-id>/exports/<ticket-id>-test-cases.xlsx` |',
  );
  expect(resolutionStep).toContain(
    '| `.qa/<ticket-id>/<ticket-id>-plan.md` | `.qa/<ticket-id>/exports/<ticket-id>-plan.docx`, `.qa/<ticket-id>/exports/<ticket-id>-plan.pdf` |',
  );
  expect(sourceIndex).toBeGreaterThan(resolutionIndex);
  expect(prerequisiteIndex).toBeGreaterThan(sourceIndex);
  expect(cliIndex).toBeGreaterThan(prerequisiteIndex);
  const check = skill.slice(prerequisiteIndex, cliIndex);
  expect(check).toContain('Bun 1.3+');
  expect(check).toContain('unavailable or older');
  expect(check).toContain('explain the prerequisite and stop');
  expect(check).toContain('Check actual module loading with `bun --no-install`, not just whether a package directory exists.');
  expect(check).toContain("selected format's parser and renderer");
  expect(check).toContain('preserve-completion-state.ts');
  expect(check).toContain('If the required modules load, skip installation.');
  expect(check).toContain("Do not load an unrelated format's renderer");
  expect(check).toContain('Never install in `<project-root>` or another project-under-test directory.');
  expect(check).toContain('Do not check/install for an unsupported request or missing source Markdown.');
  expect(check).toContain('return to `<project-root>`');
  expect(skill).toContain('carriedCompletionCount');
  expect(skill).toContain('It does **not** upload anything');
});

test('artifact export uses Bun first and one npm fallback without changing lockfiles or repairing unrelated failures', () => {
  const skill = read('skills/artifact-export/SKILL.md');
  const readme = read('README.md');
  for (const text of [skill, readme]) {
    const bun = text.indexOf('bun install --frozen-lockfile');
    const npm = text.indexOf('npm install --no-save --package-lock=false');
    expect(bun).toBeGreaterThan(-1);
    expect(npm).toBeGreaterThan(bun);
    expect(text).toContain('npm does not enforce `bun.lock`');
    expect(text).toContain('`package.json` ranges');
    expect(text).toContain('with `bun --no-install`');
    expect(text).toContain('npm is unavailable');
    expect(text).toContain('plugin root');
    expect(text).toContain('exit code');
    expect(text).toMatch(/credentials.*redact|redact.*credentials/);
    expect(text).toMatch(/Markdown.*errors.*not|Source-code, Markdown/);
    expect(text).toContain('temporary junctions/symlinks');
    expect(text).toContain('global caches');
    expect(text).toContain('registry/TLS settings');
    expect(text).toContain('elevate privileges');
    expect(text).not.toMatch(/npm (?:ci|install --force)|bun install --force/);
  }
  expect(skill).toContain('A successful install exit code with empty/unloadable packages is still an installation failure.');
  expect(skill).toContain('If Bun installation fails, or the post-install check still cannot load a dependency');
  expect(skill).toContain('npm as a one-time fallback');
  expect(skill).toContain('Do not run both installers when Bun succeeded and imports work.');
  expect(skill).toContain('Do not loop through more installation attempts.');
  expect(skill).toContain('do not rewrite `package.json` or either lockfile');
  expect(readme).toContain('try npm **once**');
  expect(readme).toContain('Do not run npm when Bun installation and imports already succeeded.');
  expect(readme).toContain('No generated exporter distribution, bundle build step or CI auto-commit is required.');
});

test('artifact export install and CLI instructions are OS-agnostic', () => {
  const skill = read('skills/artifact-export/SKILL.md');
  const readme = read('README.md');
  const exportDocs = readme.slice(readme.indexOf('## QA artifact export'), readme.indexOf('## E2E regression script generation'));
  for (const text of [skill, exportDocs]) {
    expect(text).toContain('Windows, macOS, and Linux');
    expect(text).toContain('shell/PATH');
    expect(text).toContain('npm install --no-save --package-lock=false');
    expect(text).toContain('npm.cmd');
    expect(text).toMatch(/only if the environment requires it|only a shell-specific alternative when needed/);
    expect(text).toContain('documentation separator');
    expect(text).not.toMatch(/```(?:powershell|bash|cmd)\b/);
    expect(text).not.toMatch(/npm\.cmd install|[A-Za-z]:\\Users\\|\/Users\/|\/home\//);
  }
});

test('artifact export README preserves outputs, semantics, and compatibility limits', () => {
  const readme = read('README.md');
  const xlsxRenderer = read('scripts/lib/export/render-test-cases-xlsx.ts');

  expect(readme).toContain('bun install --frozen-lockfile');
  expect(readme).toContain('bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket PROJ-123 --artifact test-cases --format xlsx');
  expect(readme).toContain('bun --no-install "<plugin-root>/scripts/export-artifact.ts" --ticket PROJ-123 --artifact test-plan --format docx,pdf');
  expect(readme).toContain('.qa/<ticket-id>/<ticket-id>-test-cases.md');
  expect(readme).toContain('.qa/<ticket-id>/<ticket-id>-plan.md');
  expect(readme).toContain('.qa/<ticket-id>/exports/<ticket-id>-test-cases.xlsx');
  expect(readme).toContain('.qa/<ticket-id>/exports/<ticket-id>-plan.docx');
  expect(readme).toContain('.qa/<ticket-id>/exports/<ticket-id>-plan.pdf');
  expect(readme).toMatch(/Markdown.*source of truth/i);
  expect(readme).toContain('Not run');
  expect(readme).toContain('Done');
  expect(readme).toContain('Fail');
  expect(readme).toContain('PriorityOptions');
  expect(readme).toMatch(/High.*Medium.*Low/s);
  expect(readme).toMatch(/real.*dropdown|dropdown.*Microsoft Excel/i);
  expect(readme).toContain('CompletionStatusOptions');
  expect(readme).toMatch(/named range|named-range/i);
  expect(xlsxRenderer).toContain("workbook.definedNames.add('_Validation!$A$1:$A$3', 'CompletionStatusOptions');");
  expect(readme).toMatch(/carry(?:-| )forward|carried forward/i);
  expect(readme).toMatch(/Microsoft 365/i);
  expect(readme).toMatch(/Google Drive/i);
  assertGoogleSheetsDropdownSupportStatement(readme);
  expect(() => assertGoogleSheetsDropdownSupportStatement(readme.replace('is not supported.', 'is supported.'))).toThrow();
  expect(readme).toMatch(/normalize nonessential formatting|formatting normalization/i);
  expect(readme).toMatch(/no legacy fallback|no automatic rename|no auto-rename/i);
  expect(readme).not.toMatch(/pandoc/i);
});

test('Google Sheets sentence extractor preserves inline code contents', () => {
  expect(
    extractGoogleSheetsSentences(
      'Google Sheets dropdown conversion/editing for `Priority` and `Completed` is not supported. Google Drive sharing is allowed.',
    ),
  ).toEqual(['Google Sheets dropdown conversion/editing for Priority and Completed is not supported.']);
});

test('skill docs constrain priority values and Excel-only dropdown support', () => {
  const testCaseDesign = read('skills/test-case-design/SKILL.md');
  const artifactExport = read('skills/artifact-export/SKILL.md');

  expect(testCaseDesign).toMatch(/Priority.*High.*Medium.*Low/i);
  expect(artifactExport).toMatch(
    /Microsoft Excel.*Priority.*Completed|Priority.*Completed.*Microsoft Excel/i,
  );
  expect(artifactExport).toMatch(/Google Sheets.*not supported|not supported.*Google Sheets/i);
});

test('path-bearing skills use canonical ticket-prefixed plan and test-case paths', () => {
  for (const [path, canonical, legacy] of [
    ['skills/test-plan/SKILL.md', '<ticket-id>-plan.md', '.qa/<ticket-id>/plan.md'],
    ['skills/test-case-design/SKILL.md', '<ticket-id>-test-cases.md', '.qa/<ticket-id>/test-cases.md'],
    ['skills/auto-execute/SKILL.md', '<ticket-id>-test-cases.md', '.qa/<ticket-id>/test-cases.md'],
    ['skills/cms-content-check/SKILL.md', '<ticket-id>-plan.md', '.qa/<ticket-id>/plan.md'],
    ['skills/artifact-export/SKILL.md', '<ticket-id>-test-cases.md', '.qa/<ticket-id>/test-cases.md'],
  ] as const) {
    const content = read(path);
    expect(content).toContain(canonical);
    expect(content).not.toContain(legacy);
  }
});

test('test-plan and test-case-design handoffs name ticket-prefixed exports', () => {
  const testPlan = read('skills/test-plan/SKILL.md');
  const testCaseDesign = read('skills/test-case-design/SKILL.md');

  expect(testPlan).toContain(
    'Optional user-requested follow-up: `invoke artifact-export` for `<ticket-id>-plan.docx` and/or `<ticket-id>-plan.pdf`.',
  );
  expect(testCaseDesign).toContain(
    'Optional user-requested follow-up: `invoke artifact-export` for `<ticket-id>-test-cases.xlsx`.',
  );
  expect(testPlan).not.toContain('`invoke artifact-export` for `plan.docx` and/or `plan.pdf`.');
  expect(testCaseDesign).not.toContain('`invoke artifact-export` for `test-cases.xlsx`.');
});

test('skill docs describe artifact-export as the only optional export follow-up', () => {
  const testPlan = read('skills/test-plan/SKILL.md');
  const testCaseDesign = read('skills/test-case-design/SKILL.md');
  const qaWorkflow = read('skills/qa-workflow/SKILL.md');
  const testSummary = read('skills/test-summary/SKILL.md');

  expect(testPlan).toMatch(/artifact-export/i);
  expect(testPlan).toMatch(/optional|ask the user|user-requested/i);
  expect(testCaseDesign).toMatch(/artifact-export/i);
  expect(testCaseDesign).toMatch(/optional|ask the user|user-requested/i);
  expect(qaWorkflow).toMatch(/artifact-export/i);
  expect(qaWorkflow).toMatch(/supported plan\/test-case files|plan\/test-case/i);
  expect(qaWorkflow).not.toMatch(/pandoc/i);
  expect(testSummary).not.toMatch(/pandoc|summary\.xlsx/i);
});

test('README and artifact-export skill document semantic plan rendering', () => {
  const readme = read('README.md');
  const artifactExport = read('skills/artifact-export/SKILL.md');

  expect(readme).toMatch(/DOCX.*PDF.*Markdown.*semantic|Markdown.*semantic.*DOCX.*PDF/i);
  expect(readme).toMatch(/images?.*alt text|alt text.*images?/i);
  expect(readme).toMatch(/raw HTML.*text|HTML.*strip/i);
  expect(readme).toMatch(/http.*https.*mailto/i);
  expect(readme).toMatch(/unsafe.*plain text|plain text.*unsafe/i);
  expect(artifactExport).toMatch(
    /plan DOCX\/PDF exports render supported Markdown semantics instead of copying formatting tokens literally/i,
  );
});
