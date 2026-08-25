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

function getProjectUnderTestInstallStatements(readme: string): string[] {
  return extractMarkdownSentences(readme)
    .filter((statement) => /\bproject(?:-| )under(?:-| )test\b/i.test(statement))
    .filter((statement) =>
      /\bbun install\b|\binstall(?:ation|ing)?\b|\bdependencies?\b|\bthat command\b|\bthe\s+command\s+above\b/i.test(
        statement,
      ),
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

function assertReadmeInstallSafety(readme: string): void {
  const setupIndex = readme.indexOf('## Setup');
  const usageIndex = readme.indexOf('## Usage');
  const setup = readme.slice(setupIndex, usageIndex);
  const installCommands = [...readme.matchAll(/\bbun install(?:\s+--[a-z-]+)*/g)];
  const approvedProjectUnderTestProhibition =
    'Never run that command in the project under test.';
  const projectUnderTestInstallStatements = getProjectUnderTestInstallStatements(readme);

  expect(setupIndex).toBeGreaterThan(-1);
  expect(usageIndex).toBeGreaterThan(setupIndex);
  expect(installCommands.map((match) => match[0])).toEqual(['bun install --frozen-lockfile']);
  for (const command of installCommands) {
    expect(command.index).toBeGreaterThan(setupIndex);
    expect(command.index).toBeLessThan(usageIndex);
  }
  expect(setup).toContain(
    'If you need to recover manually, run this from the plugin root that contains `package.json` and `bun.lock`:',
  );
  expect(projectUnderTestInstallStatements).toEqual([approvedProjectUnderTestProhibition]);
}

test('artifact-export is discoverable from both plugin manifests', () => {
  for (const manifestPath of ['.claude-plugin/plugin.json', '.github/copilot-plugin.json']) {
    const manifest = JSON.parse(read(manifestPath));
    expect(manifest.skills).toBe('./skills/');
    expect(existsSync(join(ROOT, manifest.skills, 'artifact-export', 'SKILL.md'))).toBe(true);
  }
});

test('artifact-export keeps dependency bootstrap at plugin root and the CLI at project root', () => {
  const skill = read('skills/artifact-export/SKILL.md');
  const readme = read('README.md');

  const rootsIndex = skill.indexOf('3. Name and retain two separate roots:');
  const sourceIndex = skill.indexOf('4. From `<project-root>`, check the source Markdown before invoking the CLI:');
  const dependencyIndex = skill.indexOf('5. From `<plugin-root>`, check only the export dependencies:');
  const cliIndex = skill.indexOf('6. Return to `<project-root>` and run the exact CLI command by its plugin-root path:');
  const rulesIndex = skill.indexOf('## Rules');

  expect(rootsIndex).toBeGreaterThan(-1);
  expect(sourceIndex).toBeGreaterThan(rootsIndex);
  expect(dependencyIndex).toBeGreaterThan(sourceIndex);
  expect(cliIndex).toBeGreaterThan(dependencyIndex);
  expect(rulesIndex).toBeGreaterThan(cliIndex);

  const rootsStep = skill.slice(rootsIndex, sourceIndex);
  const dependencyStep = skill.slice(dependencyIndex, cliIndex);
  const cliStep = skill.slice(cliIndex, rulesIndex);
  const procedure = skill.slice(skill.indexOf('## Procedure'), rulesIndex);
  const runtimePackageSetLines = dependencyStep
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('Runtime package set:'));
  const installCommands = [...skill.matchAll(/\bbun install(?:\s+--[a-z-]+)*/g)].map((match) => match[0]);
  const installationInstructionLines = procedure
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\binstall(?:ation)?\b/i.test(line));
  const expectedCliCommands = [
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket <ticket-id> --artifact test-cases --format xlsx',
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx',
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format pdf',
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket <ticket-id> --artifact test-plan --format docx,pdf',
  ];
  const skillCliCommands = [...skill.matchAll(/^\s*bun .*export-artifact\.ts.*$/gm)].map((match) => match[0].trim());
  const readmeCliCommands = [...readme.matchAll(/^\s*bun .*export-artifact\.ts.*$/gm)].map((match) => match[0].trim());

  expect(rootsStep).toContain(
    '`<project-root>` is the project-under-test root. Keep it as the current directory for source validation and the export CLI.',
  );
  expect(rootsStep).toContain(
    '`.qa/<ticket-id>/...` resolves from `<project-root>`, so source and output files must remain in the target project, never in the plugin installation directory.',
  );
  expect(rootsStep).toContain(
    '`<plugin-root>` contains this skill, `package.json`, and `bun.lock`; use it only for dependency checks and installation.',
  );
  expect(runtimePackageSetLines).toEqual([
    '- Runtime package set: `exceljs`, `docx`, and `pdfkit`.',
  ]);
  expect(installationInstructionLines).toEqual([
    '- `<plugin-root>` contains this skill, `package.json`, and `bun.lock`; use it only for dependency checks and installation.',
    '- `.qa/<ticket-id>/...` resolves from `<project-root>`, so source and output files must remain in the target project, never in the plugin installation directory.',
    '- Only when one or more packages in that exact set are missing, run exactly `bun install --frozen-lockfile` while the current directory is `<plugin-root>`.',
    '- Otherwise, skip installation entirely.',
    '- If Bun 1.3+ is unavailable or the installation fails, report the error and stop; do not invoke the CLI.',
    '- Do not check or install dependencies for an unsupported request or a missing source Markdown file.',
    '- Never run an install in `<project-root>` or any other project-under-test directory.',
  ]);
  expect(dependencyStep).toContain(
    'Only when one or more packages in that exact set are missing, run exactly `bun install --frozen-lockfile` while the current directory is `<plugin-root>`.',
  );
  expect(dependencyStep).toContain('Otherwise, skip installation entirely.');
  expect(dependencyStep).toContain(
    'If Bun 1.3+ is unavailable or the installation fails, report the error and stop; do not invoke the CLI.',
  );
  expect(dependencyStep).toContain(
    'Do not check or install dependencies for an unsupported request or a missing source Markdown file.',
  );
  expect(dependencyStep).toContain(
    'Never run an install in `<project-root>` or any other project-under-test directory.',
  );
  expect(installCommands).toEqual(['bun install --frozen-lockfile']);
  expect(skill.replace(dependencyStep, '')).not.toContain('bun install');
  expect(cliStep).toContain('# Current directory: <project-root>');
  expect(cliStep).toContain('Run the CLI by the plugin-root path, never by a path relative to the current directory.');
  expect(skillCliCommands).toEqual(expectedCliCommands);
  expect(procedure).not.toContain('bun scripts/export-artifact.ts');

  expect(readme).toMatch(/Bun[^\r\n]*1\.3\+/);
  expect(readme).toContain('bun install --frozen-lockfile');
  expect(readme).toContain('Never run that command in the project under test.');
  expect(readme).toContain(
    'Run every CLI command from `<project-root>`, the project-under-test root that contains `.qa`. Invoke the CLI by the plugin-root script path so `.qa/<ticket-id>/...` remains in the target project.',
  );
  expect(readmeCliCommands).toEqual([
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket PROJ-123 --artifact test-cases --format xlsx',
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket PROJ-123 --artifact test-plan --format docx,pdf',
    'bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket SM26-207 --artifact test-plan --format docx,pdf',
  ]);
  expect(readme).not.toContain('bun scripts/export-artifact.ts');
});

test('artifact-export resolves the supported matrix before source validation and dependency bootstrap', () => {
  const skill = read('skills/artifact-export/SKILL.md');

  const resolutionIndex = skill.indexOf('2. Resolve the requested artifact and format, then enforce the supported matrix:');
  const sourceIndex = skill.indexOf('4. From `<project-root>`, check the source Markdown before invoking the CLI:');
  const dependencyIndex = skill.indexOf('5. From `<plugin-root>`, check only the export dependencies:');
  const cliIndex = skill.indexOf('6. Return to `<project-root>` and run the exact CLI command by its plugin-root path:');
  const resolutionStep = skill.slice(resolutionIndex, sourceIndex);

  expect(resolutionIndex).toBeGreaterThan(-1);
  expect(resolutionStep).toContain(
    '| `.qa/<ticket-id>/<ticket-id>-test-cases.md` | `.qa/<ticket-id>/exports/<ticket-id>-test-cases.xlsx` |',
  );
  expect(resolutionStep).toContain(
    '| `.qa/<ticket-id>/<ticket-id>-plan.md` | `.qa/<ticket-id>/exports/<ticket-id>-plan.docx`, `.qa/<ticket-id>/exports/<ticket-id>-plan.pdf` |',
  );
  expect(sourceIndex).toBeGreaterThan(resolutionIndex);
  expect(dependencyIndex).toBeGreaterThan(sourceIndex);
  expect(cliIndex).toBeGreaterThan(dependencyIndex);
});

test('README confines every Bun install command to frozen plugin-root recovery setup', () => {
  const readme = read('README.md');

  assertReadmeInstallSafety(readme);
  expect(() =>
    assertReadmeInstallSafety(`${readme}\nThe command above may also be run in the project under test.`),
  ).toThrow();
  expect(
    getProjectUnderTestInstallStatements(
      `${readme}\nYou may run \`bun install --frozen-lockfile\` in the project under test.`,
    ),
  ).toContain('You may run bun install --frozen-lockfile in the project under test.');
  expect(() =>
    assertReadmeInstallSafety(`${readme}\nYou may run \`bun install --frozen-lockfile\` in the project under test.`),
  ).toThrow();
});

test('README documents the supported export commands, outputs, and compatibility limits', () => {
  const readme = read('README.md');
  const xlsxRenderer = read('scripts/lib/export/render-test-cases-xlsx.ts');

  expect(readme).toContain('bun install --frozen-lockfile');
  expect(readme).toContain('exceljs');
  expect(readme).toContain('docx');
  expect(readme).toContain('pdfkit');
  expect(readme).toContain('bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket PROJ-123 --artifact test-cases --format xlsx');
  expect(readme).toContain('bun "<plugin-root>\\scripts\\export-artifact.ts" --ticket PROJ-123 --artifact test-plan --format docx,pdf');
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
