import {
  ExportValidationError,
  PRIORITY_VALUES,
  TEST_CASE_HEADERS,
  type Priority,
  type TestCaseRow,
  type TestCasesDocument,
} from './types.ts';

const TITLE_PATTERN = /^# Test Cases — ([^:]+):\s+(.+)$/;
const BR_PATTERN = /<br\s*\/?>/gi;
const PRIORITY_SET = new Set<string>(PRIORITY_VALUES);

type GroupState = {
  name: string;
  headerSeen: boolean;
  separatorSeen: boolean;
};

function fail(message: string, sourcePath: string, line?: number): never {
  throw new ExportValidationError(message, sourcePath, line);
}

function splitTableRow(row: string): string[] {
  const content = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
 
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }

    if (char === '\\' && content[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeCell(cell: string): string {
  return cell.trim().replace(BR_PATTERN, '\n');
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length === TEST_CASE_HEADERS.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function assertGroupHasTable(
  currentGroup: GroupState | null,
  sourcePath: string,
  lineNumber: number,
): void {
  if (currentGroup && !currentGroup.headerSeen) fail('Missing test-case table header', sourcePath, lineNumber);
  if (currentGroup && currentGroup.headerSeen && !currentGroup.separatorSeen) {
    fail('Missing test-case table separator', sourcePath, lineNumber);
  }
}

export function parseTestCasesMarkdown(source: string, sourcePath: string): TestCasesDocument {
  const lines = source.split(/\r?\n/);
  const titleLine = lines[0]?.trim() ?? '';
  const titleMatch = titleLine.match(TITLE_PATTERN);

  if (!titleMatch) fail('Missing test-cases title', sourcePath, 1);

  const [, ticketId, title] = titleMatch;
  const cases: TestCaseRow[] = [];
  const seenIds = new Set<string>();
  let generated = '';
  let sourcePlan = '';
  let currentGroup: GroupState | null = null;
  let sawGroup = false;
  let coverageLine: number | undefined;

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (trimmed === '## Coverage Notes') {
      assertGroupHasTable(currentGroup, sourcePath, lineNumber);
      coverageLine = lineNumber;
      break;
    }

    if (trimmed.startsWith('## ')) {
      assertGroupHasTable(currentGroup, sourcePath, lineNumber);
      currentGroup = { name: trimmed.slice(3).trim(), headerSeen: false, separatorSeen: false };
      sawGroup = true;
      continue;
    }

    if (trimmed === '') continue;

    if (!sawGroup) {
      const generatedMatch = rawLine.match(/Generated:\s*(.*?)(?:\s*\|\s*Source plan:|$)/);
      const sourcePlanMatch = rawLine.match(/Source plan:\s*`?([^`]+?)`?\s*$/);
      if (generatedMatch) generated = generatedMatch[1]!.trim();
      if (sourcePlanMatch) sourcePlan = sourcePlanMatch[1]!.trim();
      continue;
    }

    if (!currentGroup) fail('Missing test-case group', sourcePath, lineNumber);

    if (!currentGroup.headerSeen) {
      const headerCells = splitTableRow(rawLine).map((cell) => cell.trim());
      if (headerCells.length !== TEST_CASE_HEADERS.length || headerCells.some((cell, i) => cell !== TEST_CASE_HEADERS[i])) {
        fail('Invalid test-case table header', sourcePath, lineNumber);
      }
      currentGroup.headerSeen = true;
      continue;
    }

    if (!currentGroup.separatorSeen) {
      if (!isSeparatorRow(splitTableRow(rawLine))) fail('Invalid test-case table separator', sourcePath, lineNumber);
      currentGroup.separatorSeen = true;
      continue;
    }

    if (!trimmed.startsWith('|')) fail('Malformed test-case row', sourcePath, lineNumber);

    const cells = splitTableRow(rawLine).map(normalizeCell);
    if (cells.length !== TEST_CASE_HEADERS.length) fail('Malformed test-case row', sourcePath, lineNumber);

    const [id, rowTitle, priority, triage, preconditions, steps, expectedResult] = cells;

    if (!id || !/^TC-\d+$/.test(id)) fail('Invalid test-case ID', sourcePath, lineNumber);
    if (seenIds.has(id)) fail(`Duplicate test-case ID "${id}"`, sourcePath, lineNumber);
    if (!rowTitle) fail('Missing test-case title', sourcePath, lineNumber);
    if (!PRIORITY_SET.has(priority)) {
      fail(`Invalid test-case priority "${priority}"`, sourcePath, lineNumber);
    }

    seenIds.add(id);
    cases.push({
      group: currentGroup.name,
      id,
      title: rowTitle,
      priority: priority as Priority,
      triage,
      preconditions,
      steps,
      expectedResult,
    });
  }

  if (!sawGroup) fail('Missing test-case group', sourcePath, 1);
  if (coverageLine === undefined) fail('Missing Coverage Notes heading', sourcePath, lines.length || 1);

  const coverageNotes = lines
    .slice(coverageLine)
    .join('\n')
    .trim();

  return {
    ticketId,
    title,
    generated,
    sourcePlan,
    sourcePath,
    cases,
    coverageNotes,
  };
}
