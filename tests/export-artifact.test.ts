import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { test, expect, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { getTicketArtifactFilenames } from '../scripts/lib/export/artifact-filenames.ts';
import { parseTestCasesMarkdown } from '../scripts/lib/export/parse-test-cases-markdown.ts';
import { parseTestPlanMarkdown } from '../scripts/lib/export/parse-test-plan-markdown.ts';
import { parseGfmBlocks, parseRichText, isSafeExternalHref } from '../scripts/lib/export/markdown/parse.ts';
import { blockPlainText } from '../scripts/lib/export/markdown/plain-text.ts';
import { readCompletionState } from '../scripts/lib/export/preserve-completion-state.ts';
import { renderTestCasesXlsx } from '../scripts/lib/export/render-test-cases-xlsx.ts';
import { renderTestPlanDocx } from '../scripts/lib/export/render-test-plan-docx.ts';
import {
  getEmbeddedPdfFallbackFontForCodePoint,
  renderTestPlanPdf,
} from '../scripts/lib/export/render-test-plan-pdf.ts';
import {
  COMPLETION_VALUES,
  PRIORITY_VALUES,
  ExportValidationError,
  type TestPlanDocument,
} from '../scripts/lib/export/types.ts';
import { writeAtomically } from '../scripts/lib/export/write-atomically.ts';

const EXPORT_FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'export');
const TEST_CASES_FIXTURE = join(EXPORT_FIXTURES, 'PROJ-123-test-cases.md');
const TEST_PLAN_FIXTURE = join(EXPORT_FIXTURES, 'PROJ-123-plan.md');
const GFM_PLAN_FIXTURE = join(EXPORT_FIXTURES, 'PROJ-124-plan-gfm.md');
const GFM_PLAN_SOURCE = readFileSync(GFM_PLAN_FIXTURE, 'utf8');
const GFM_BODY = GFM_PLAN_SOURCE.slice(GFM_PLAN_SOURCE.indexOf('## Overview'));
const EXPORT_SCRIPT = join(process.cwd(), 'scripts', 'export-artifact.ts');
const PDF_TEXT_DECODER = new TextDecoder('windows-1252');
const PDF_UTF16BE_DECODER = new TextDecoder('utf-16be');
const PDF_MARGIN = 54;
const PDF_FOOTER_HEIGHT = 24;
const TEXT_ENCODER = new TextEncoder();
const PDF_RENDERER_MODULE_URL = new URL('../scripts/lib/export/render-test-plan-pdf.ts', import.meta.url).href;
const NAMED_ENTITY_CORPUS = [
  { entity: '&Amacr;', character: 'Ā' },
  { entity: '&Alpha;', character: 'Α' },
  { entity: '&ZHcy;', character: 'Ж' },
  { entity: '&rarr;', character: '→' },
  { entity: '&hearts;', character: '♥' },
  { entity: '&CounterClockwiseContourIntegral;', character: '∳' },
  { entity: '&Afr;', character: '𝔄' },
] as const;

function joinLines(lines: string[]): string {
  return lines.join('\n');
}

function priorityFixture(priority: string): string {
  return joinLines([
    '# Test Cases — PROJ-123: Priority validation',
    '',
    '## Frontend',
    '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| TC-001 | Priority case | ${priority} | automatable | None | 1. Open page | Works |`,
    '',
    '## Coverage Notes',
    'Priority coverage',
  ]);
}

function expectExportError(
  action: () => unknown,
  options: {
    message: string;
    sourcePath: string;
    line: number;
  },
): void {
  let caught: unknown;

  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ExportValidationError);

  const exportError = caught as ExportValidationError;
  expect(exportError.sourcePath).toBe(options.sourcePath);
  expect(exportError.line).toBe(options.line);
  expect(exportError.message).toContain(options.message);
  expect(exportError.message).toContain(`${options.sourcePath}:${options.line}`);
}

function createTempFixturePath(name: string): string {
  return join(process.cwd(), 'tests', 'fixtures', `${randomUUID()}-${name}`);
}

type RunResult = { code: number; stdout: string; stderr: string };
const EXPORT_CLI_TEST_TIMEOUT = 15_000;

async function runExport(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', EXPORT_SCRIPT, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

function testExportCli(name: string, fn: () => Promise<void>): void {
  test(name, fn, EXPORT_CLI_TEST_TIMEOUT);
}

function createTempWorkspace(name: string): string {
  const workspacePath = createTempFixturePath(name);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

function removeTempWorkspace(workspacePath: string): void {
  if (existsSync(workspacePath)) rmSync(workspacePath, { recursive: true, force: true });
}

function writeExportFixture(
  workspacePath: string,
  relativePath: string,
  content: string = readFileSync(relativePath.endsWith('plan.md') ? TEST_PLAN_FIXTURE : TEST_CASES_FIXTURE, 'utf8'),
): string {
  const targetPath = join(workspacePath, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf8');
  return targetPath;
}

function createWorkspaceSources(workspacePath: string): {
  planPath: string;
  testCasesPath: string;
} {
  return {
    planPath: writeExportFixture(
      workspacePath,
      join('.qa', 'PROJ-123', 'PROJ-123-plan.md'),
      readFileSync(TEST_PLAN_FIXTURE, 'utf8'),
    ),
    testCasesPath: writeExportFixture(
      workspacePath,
      join('.qa', 'PROJ-123', 'PROJ-123-test-cases.md'),
      readFileSync(TEST_CASES_FIXTURE, 'utf8'),
    ),
  };
}

test('derives every artifact filename from the ticket ID', () => {
  expect(getTicketArtifactFilenames('PROJ-123')).toEqual({
    planMarkdown: 'PROJ-123-plan.md',
    testCasesMarkdown: 'PROJ-123-test-cases.md',
    planDocx: 'PROJ-123-plan.docx',
    planPdf: 'PROJ-123-plan.pdf',
    testCasesXlsx: 'PROJ-123-test-cases.xlsx',
  });
});

test('parses GFM bodies into renderer-neutral semantic nodes', () => {
  const blocks = parseGfmBlocks(GFM_BODY);

  expect(blocks.map((block) => block.kind)).toContain('table');
  expect(blocks.map((block) => block.kind)).toContain('blockquote');
  expect(blocks.map((block) => block.kind)).toContain('code-block');
});

test('normalizes images, HTML, and unsafe links without raw Markdown leakage', () => {
  const text = parseGfmBlocks(GFM_PLAN_SOURCE).map(blockPlainText).join('\n');

  expect(text).toContain('Architecture diagram');
  expect(text).toContain('HTML text');
  expect(text).toContain('next line');
  expect(text).toContain('Do not follow');
  expect(text).toContain('entity &');
  expect(text).not.toContain('entity &amp;');
  expect(text).not.toContain('javascript:alert');
  expect(text).not.toContain('<strong>');
  expect(text).not.toContain('![Architecture diagram]');
});

test('accepts only safe external link protocols', () => {
  expect(isSafeExternalHref('https://example.test')).toBe(true);
  expect(isSafeExternalHref('mailto:qa@example.test')).toBe(true);
  expect(isSafeExternalHref('javascript:alert(1)')).toBe(false);
  expect(isSafeExternalHref('../local')).toBe(false);
});

test('preserves inline HTML breaks', () => {
  expect(parseRichText('before<br>after').plainText).toBe('before\nafter');
});

test('normalizes comprehensive named HTML entities and strips decoded markup from parsed and exported text', async () => {
  const entityText = [
    ...NAMED_ENTITY_CORPUS.map(({ entity }) => entity),
    '&lt;!-- remove decoded comment --&gt;',
    '&lt;strong data-kind="decoded"&gt;decoded tag content&lt;/strong&gt;',
  ].join(' ');
  const content = parseRichText(entityText);
  const model: TestPlanDocument = {
    ticketId: 'PROJ-126',
    title: parseRichText('Entity &copy;'),
    metadata: [{ label: parseRichText('Tracker'), value: parseRichText('Jira') }],
    blocks: [{ kind: 'paragraph', content }],
  };

  const [docx, pdf] = await Promise.all([renderTestPlanDocx(model), renderTestPlanPdf(model)]);
  const documentXml = await readDocxArchiveEntry(docx, 'word/document.xml');
  const parsedPdf = parsePdfDocument(pdf);

  for (const { entity, character } of NAMED_ENTITY_CORPUS) {
    expect(content.plainText).toContain(character);
    expect(content.plainText).not.toContain(entity);
    expect(documentXml).toContain(character);
    expect(documentXml).not.toContain(entity);
    expect(parsedPdf.rawText).toContain(character);
    expect(parsedPdf.rawText).not.toContain(entity);
  }

  for (const text of [content.plainText, documentXml, parsedPdf.rawText]) {
    expect(text).toContain('decoded tag content');
    expect(text).not.toContain('remove decoded comment');
    expect(text).not.toContain('<!--');
    expect(text).not.toContain('<strong');
  }
});

test('maps comprehensive named entity glyphs to registered embedded PDF fallbacks', () => {
  const registeredFallbackFonts = [
    'NotoSansLatinExt',
    'NotoSansGreek',
    'NotoSansCyrillic',
    'NotoSansSymbols2',
    'NotoSansMath',
  ];

  for (const { character } of NAMED_ENTITY_CORPUS) {
    expect(registeredFallbackFonts).toContain(getEmbeddedPdfFallbackFontForCodePoint(character.codePointAt(0)!));
  }
});

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

async function expectWorkbookError(action: Promise<unknown>, sourcePath: string): Promise<void> {
  let caught: unknown;

  try {
    await action;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain(sourcePath);
}

async function readDocxArchiveEntry(bytes: Uint8Array, entryPath: string): Promise<string> {
  const archive = await JSZip.loadAsync(bytes);
  const entry = archive.file(entryPath);

  expect(entry).not.toBeNull();
  return await entry!.async('string');
}

function getExpectedExportDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizePdfText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parsePdfObjects(rawText: string): Map<number, string> {
  const objects = new Map<number, string>();
  const objectPattern = /(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g;

  for (const match of rawText.matchAll(objectPattern)) {
    objects.set(Number(match[1]), match[2]!);
  }

  return objects;
}

function decodePdfText(hexChunks: string[], unicodeMap: Map<string, string>): string {
  return hexChunks.map((chunk) => {
    const normalizedChunk = chunk.toLowerCase();
    if (unicodeMap.has(normalizedChunk)) {
      return unicodeMap.get(normalizedChunk)!;
    }

    if (chunk.length % 4 === 0) {
      const characterCodes = chunk.match(/.{4}/g) ?? [];
      const decoded = characterCodes.map((code) => unicodeMap.get(code.toLowerCase()));

      if (decoded.every((character) => character !== undefined)) {
        return decoded.join('');
      }
    }

    return PDF_TEXT_DECODER.decode(Buffer.from(chunk, 'hex'));
  }).join('');
}

function decodePdfStream(objectBody: string): string {
  const header = /stream\r?\n/.exec(objectBody);

  if (!header) {
    return '';
  }

  const dataStart = header.index + header[0].length;

  // Slice by the declared /Length rather than matching up to `endstream`. The EOL
  // before `endstream` is not part of the data, but deflate output can itself end
  // with CR, and a `\r?\nendstream` match then swallows that byte and leaves zlib
  // with a truncated stream (Z_BUF_ERROR).
  const declaredLength = Number(/\/Length (\d+)\b/.exec(objectBody)?.[1]);
  const streamData = Number.isInteger(declaredLength)
    ? objectBody.slice(dataStart, dataStart + declaredLength)
    : objectBody.slice(dataStart, objectBody.lastIndexOf('endstream')).replace(/\r?\n$/, '');

  return objectBody.includes('/Filter /FlateDecode')
    ? inflateSync(Buffer.from(streamData, 'latin1')).toString('latin1')
    : streamData;
}

function extractPdfUnicodeMap(fontObjectBody: string, objects: Map<number, string>): Map<string, string> {
  const unicodeMap = new Map<string, string>();

  const toUnicodeId = fontObjectBody.match(/\/ToUnicode\s+(\d+) 0 R/)?.[1];
  if (!toUnicodeId) {
    return unicodeMap;
  }

  const cmap = decodePdfStream(objects.get(Number(toUnicodeId)) ?? '');
  for (const block of cmap.matchAll(/\d+\s+beginbfchar\s*([\s\S]*?)\s*endbfchar/g)) {
    for (const match of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]+)>/g)) {
      unicodeMap.set(
        match[1]!.toLowerCase(),
        PDF_UTF16BE_DECODER.decode(Buffer.from(match[2]!.replace(/\s+/g, ''), 'hex')),
      );
    }
  }

  for (const block of cmap.matchAll(/\d+\s+beginbfrange\s*([\s\S]*?)\s*endbfrange/g)) {
    for (const match of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const sourceStart = Number.parseInt(match[1]!, 16);
      const sourceEnd = Number.parseInt(match[2]!, 16);
      const width = match[1]!.length;
      const targets = Array.from(
        match[3]!.matchAll(/<([0-9A-Fa-f\s]+)>/g),
        (target) => target[1]!.replace(/\s+/g, ''),
      );

      targets.forEach((target, index) => {
        const source = sourceStart + index;
        if (source <= sourceEnd) {
          unicodeMap.set(source.toString(16).padStart(width, '0'), PDF_UTF16BE_DECODER.decode(Buffer.from(target, 'hex')));
        }
      });
    }
  }

  return unicodeMap;
}

function extractPdfFontUnicodeMaps(pageBody: string, objects: Map<number, string>): Map<string, Map<string, string>> {
  const resourceId = pageBody.match(/\/Resources\s+(\d+) 0 R/)?.[1];
  const resources = resourceId ? objects.get(Number(resourceId)) ?? '' : '';
  const fontDictionary = resources.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? '';
  const unicodeMaps = new Map<string, Map<string, string>>();

  for (const match of fontDictionary.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
    unicodeMaps.set(match[1]!, extractPdfUnicodeMap(objects.get(Number(match[2])) ?? '', objects));
  }

  return unicodeMaps;
}

function extractPdfTextRuns(
  content: string,
  unicodeMaps: Map<string, Map<string, string>>,
): Array<{ text: string; y: number }> {
  const runs: Array<{ text: string; y: number }> = [];
  const blockPattern = /BT\s*([\s\S]*?)\s*ET/g;

  for (const match of content.matchAll(blockPattern)) {
    const block = match[1]!;
    const positionMatch = block.match(/1 0 0 1 [0-9.]+ ([0-9.]+) Tm/);
    let activeFont: string | undefined;
    let text = '';

    for (const operator of block.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>/g)) {
      if (operator[1]) {
        activeFont = operator[1];
      } else if (operator[2]) {
        text += decodePdfText([operator[2]], unicodeMaps.get(activeFont ?? '') ?? new Map());
      }
    }

    text = normalizePdfText(text);

    if (!text || !positionMatch) {
      continue;
    }

    runs.push({ text, y: Number(positionMatch[1]) });
  }

  return runs;
}

function parsePdfPageIds(objects: Map<number, string>): number[] {
  const pagesRoot = [...objects.values()].find((body) => /\/Type \/Pages\b/.test(body));
  const kidsMatch = pagesRoot?.match(/\/Kids\s*\[(.*?)\]/s);

  expect(kidsMatch).toBeDefined();
  return Array.from(kidsMatch![1]!.matchAll(/(\d+) 0 R/g), (match) => Number(match[1]));
}

function parsePdfContentIds(pageBody: string): number[] {
  const arrayMatch = pageBody.match(/\/Contents\s*\[(.*?)\]/s);

  if (arrayMatch) {
    return Array.from(arrayMatch[1]!.matchAll(/(\d+) 0 R/g), (match) => Number(match[1]));
  }

  const singleMatch = pageBody.match(/\/Contents\s+(\d+) 0 R/);
  return singleMatch ? [Number(singleMatch[1])] : [];
}

function parsePdfDocument(bytes: Uint8Array): {
  pages: Array<{ content: string; textRuns: Array<{ text: string; y: number }> }>;
  rawText: string;
} {
  const pdfSource = Buffer.from(bytes).toString('latin1');
  const objects = parsePdfObjects(pdfSource);
  const pages = parsePdfPageIds(objects).map((pageId) => {
    const pageBody = objects.get(pageId) ?? '';
    const unicodeMaps = extractPdfFontUnicodeMaps(pageBody, objects);
    const content = parsePdfContentIds(pageBody)
      .map((contentId) => decodePdfStream(objects.get(contentId) ?? ''))
      .join('\n');

    return {
      content,
      textRuns: extractPdfTextRuns(content, unicodeMaps),
    };
  });

  return {
    rawText: `${pdfSource}\n${pages.flatMap((page) => page.textRuns.map((run) => run.text)).join('')}`,
    pages,
  };
}

function extractPdfUriTargets(bytes: Uint8Array): string[] {
  const objects = parsePdfObjects(Buffer.from(bytes).toString('latin1'));

  return [...objects.values()].flatMap((objectBody) => {
    const actionId = objectBody.match(/\/Subtype \/Link\b[\s\S]*?\/A\s+(\d+) 0 R/)?.[1];
    const action = actionId ? objects.get(Number(actionId)) : undefined;
    const target = action?.match(/\/URI\s*\(([^)]*)\)/)?.[1];
    return target ? [target] : [];
  });
}

function expectPdfTextOrder(texts: string[], expectedTexts: string[]): void {
  let currentIndex = -1;

  for (const expectedText of expectedTexts) {
    const nextIndex = texts.findIndex((text, index) => index > currentIndex && text === expectedText);
    expect(nextIndex).toBeGreaterThan(currentIndex);
    currentIndex = nextIndex;
  }
}

function createLongPlanModel(): TestPlanDocument {
  return {
    ticketId: 'PROJ-999',
    title: parseRichText('Long plan'),
    metadata: [
      { label: parseRichText('Tracker'), value: parseRichText('Jira') },
      { label: parseRichText('Date'), value: parseRichText('2026-08-18') },
    ],
    blocks: [
      {
        kind: 'heading',
        depth: 2,
        content: parseRichText('Requirement Summary'),
      },
      {
        kind: 'paragraph',
        content: parseRichText(
          Array.from(
            { length: 220 },
            (_, index) =>
              `Paragraph segment ${index + 1} ensures the same block keeps flowing across the page boundary without manual breaks.`,
          ).join(' '),
        ),
      },
    ],
  };
}

function createLongBulletPlanModel(): TestPlanDocument {
  return {
    ticketId: 'PROJ-998',
    title: parseRichText('Long bullet plan'),
    metadata: [
      { label: parseRichText('Tracker'), value: parseRichText('Jira') },
      { label: parseRichText('Date'), value: parseRichText('2026-08-18') },
    ],
    blocks: [
      {
        kind: 'heading',
        depth: 2,
        content: parseRichText('Acceptance Criteria'),
      },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          {
            blocks: [
              {
                kind: 'paragraph',
                content: parseRichText(
                  Array.from(
                    { length: 260 },
                    (_, index) =>
                      `Bullet segment ${index + 1} verifies a single list item can continue across pages while preserving the footer boundary.`,
                  ).join(' '),
                ),
              },
            ],
          },
        ],
      },
    ],
  };
}

function createOversizedTablePlanModel(): TestPlanDocument {
  return {
    ticketId: 'PROJ-997',
    title: parseRichText('Oversized table plan'),
    metadata: [{ label: parseRichText('Tracker'), value: parseRichText('Jira') }],
    blocks: [
      {
        kind: 'table',
        align: ['left'],
        header: [parseRichText('Details')],
        rows: [
          [
            parseRichText(
              Array.from({ length: 3_000 }, (_, index) => `word${index + 1}`).join(' '),
            ),
          ],
        ],
      },
    ],
  };
}

function createOversizedTableHeaderPlanModel(): TestPlanDocument {
  const headerA = [
    'HeaderAStart',
    ...Array.from({ length: 348 }, (_, index) => `HeaderA-${String(index).padStart(3, '0')}`),
    'HeaderAEnd',
  ].join(' ');
  const headerB = [
    'HeaderBStart',
    ...Array.from({ length: 348 }, (_, index) => `HeaderB-${String(index).padStart(3, '0')}`),
    'HeaderBEnd',
  ].join(' ');
  const bodyA = [
    'BodyAStart',
    ...Array.from({ length: 498 }, (_, index) => `BodyMarkerA-${String(index).padStart(3, '0')}`),
    'BodyAEnd',
  ].join(' ');
  const bodyB = [
    'BodyBStart',
    ...Array.from({ length: 498 }, (_, index) => `BodyMarkerB-${String(index).padStart(3, '0')}`),
    'BodyBEnd',
  ].join(' ');

  return {
    ticketId: 'PROJ-996',
    title: parseRichText('Oversized table header plan'),
    metadata: [{ label: parseRichText('Tracker'), value: parseRichText('Jira') }],
    blocks: [
      {
        kind: 'table',
        align: ['left', 'left'],
        header: [parseRichText(headerA), parseRichText(headerB)],
        rows: [[parseRichText(bodyA), parseRichText(bodyB)]],
      },
    ],
  };
}

async function renderPdfInBoundedChild(document: TestPlanDocument): Promise<Uint8Array> {
  const documentPath = createTempFixturePath('bounded-pdf-model.json');
  writeFileSync(documentPath, JSON.stringify(document), 'utf8');

  try {
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        [
          `import { renderTestPlanPdf } from ${JSON.stringify(PDF_RENDERER_MODULE_URL)};`,
          `const document = await Bun.file(${JSON.stringify(documentPath)}).json();`,
          'const pdf = await renderTestPlanPdf(document);',
          "process.stdout.write(Buffer.from(pdf).toString('base64'));",
        ].join('\n'),
      ],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
    );
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const exitCode = await Promise.race([
      child.exited,
      new Promise<number>((resolve) => {
        timeoutId = setTimeout(() => {
          child.kill();
          resolve(-1);
        }, 5_000);
      }),
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    if (exitCode === -1) {
      await child.exited;
      throw new Error('Oversized table header rendering timed out without page progress');
    }

    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    return new Uint8Array(Buffer.from(stdout, 'base64'));
  } finally {
    if (existsSync(documentPath)) unlinkSync(documentPath);
  }
}

function findDocxParagraphContaining(documentXml: string, text: string): string {
  const textIndex = documentXml.indexOf(text);
  expect(textIndex).toBeGreaterThanOrEqual(0);

  const paragraphStart = documentXml.lastIndexOf('<w:p>', textIndex);
  const paragraphEnd = documentXml.indexOf('</w:p>', textIndex);
  expect(paragraphStart).toBeGreaterThanOrEqual(0);
  expect(paragraphEnd).toBeGreaterThan(paragraphStart);

  return documentXml.slice(paragraphStart, paragraphEnd + '</w:p>'.length);
}

function findDocxRunContaining(documentXml: string, text: string): string {
  const textIndex = documentXml.indexOf(text);
  expect(textIndex).toBeGreaterThanOrEqual(0);

  const runStart = documentXml.lastIndexOf('<w:r>', textIndex);
  const runEnd = documentXml.indexOf('</w:r>', textIndex);
  expect(runStart).toBeGreaterThanOrEqual(0);
  expect(runEnd).toBeGreaterThan(runStart);

  return documentXml.slice(runStart, runEnd + '</w:r>'.length);
}

function expectDocxQuoteParagraph(documentXml: string, text: string): void {
  const paragraphXml = findDocxParagraphContaining(documentXml, text);

  expect(paragraphXml).toMatch(/<w:pBdr>[\s\S]*?<w:left\b[^>]*w:color="808080"/);
  const indent = paragraphXml.match(/<w:ind\b[^>]*w:left="(\d+)"/)?.[1];
  expect(indent).toBeDefined();
  expect(Number(indent)).toBeGreaterThanOrEqual(360);
}

function findDocxParagraphWithBottomBorder(documentXml: string): string {
  const paragraphXml = documentXml
    .match(/<w:p>[\s\S]*?<\/w:p>/g)
    ?.find((paragraph) => paragraph.includes('<w:bottom'));
  expect(paragraphXml).toBeDefined();
  return paragraphXml!;
}

function createQuotedBlocksPlanModel(): TestPlanDocument {
  return {
    ticketId: 'PROJ-125',
    title: parseRichText('Quoted blocks'),
    metadata: [{ label: parseRichText('Tracker'), value: parseRichText('Jira') }],
    blocks: [
      {
        kind: 'blockquote',
        blocks: [
          { kind: 'paragraph', content: parseRichText('Quoted paragraph') },
          { kind: 'heading', depth: 2, content: parseRichText('Quoted heading') },
          {
            kind: 'list',
            ordered: false,
            start: 1,
            items: [{ blocks: [{ kind: 'paragraph', content: parseRichText('Quoted list item') }] }],
          },
          { kind: 'code-block', language: 'ts', text: 'quotedCode();' },
          {
            kind: 'table',
            align: ['left'],
            header: [parseRichText('Quoted table header')],
            rows: [[parseRichText('Quoted table cell')]],
          },
          { kind: 'rule' },
          {
            kind: 'blockquote',
            blocks: [{ kind: 'paragraph', content: parseRichText('Nested quoted paragraph') }],
          },
        ],
      },
    ],
  };
}

test('parses grouped test cases and preserves manual table content', () => {
  const model = parseTestCasesMarkdown(readFileSync(TEST_CASES_FIXTURE, 'utf8'), TEST_CASES_FIXTURE);

  expect(model.ticketId).toBe('PROJ-123');
  expect(model.title).toBe('Example checkout flow');
  expect(model.generated).toBe('2026-08-18');
  expect(model.sourcePlan).toBe('PROJ-123-plan.md');
  expect(model.cases.map((item) => [item.group, item.id])).toEqual([
    ['Setup / CMS', 'TC-001'],
    ['Frontend functionality', 'TC-002'],
  ]);
  expect(model.cases[0]!.steps).toBe('1. Open the homepage entry\n2. Set CTA to A | B');
  expect(model.cases[1]!.preconditions).toBe(
    'Homepage entry saved with banner CTA copy (TC-001)\nPublished content is visible',
  );
  expect(model.cases[1]!.expectedResult).toBe('E1. CTA label shows "A | B"\nE2. CTA links to /signup');
  expect(model.coverageNotes).toContain('AC1 -> TC-001, TC-002');
});

test('parses every supported Priority value', () => {
  const model = parseTestCasesMarkdown(
    joinLines([
      '# Test Cases — PROJ-123: Priority validation',
      '',
      '## Frontend',
      '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| TC-001 | High case | High | automatable | None | 1. Open page | Works |',
      '| TC-002 | Medium case | Medium | automatable | None | 1. Open page | Works |',
      '| TC-003 | Low case | Low | automatable | None | 1. Open page | Works |',
      '',
      '## Coverage Notes',
      'Priority coverage',
    ]),
    'priority-values.md',
  );

  expect(PRIORITY_VALUES).toEqual(['High', 'Medium', 'Low']);
  expect(model.cases.map((testCase) => testCase.priority)).toEqual(['High', 'Medium', 'Low']);
});

test('trims standard table-cell padding before validating Priority semantics', () => {
  const model = parseTestCasesMarkdown(
    joinLines([
      '# Test Cases — PROJ-123: Padded Priority validation',
      '',
      '## Frontend',
      '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| TC-001 | High case |  High  | automatable | None | 1. Open page | Works |',
      '| TC-002 | Medium case |  Medium  | automatable | None | 1. Open page | Works |',
      '| TC-003 | Low case |  Low  | automatable | None | 1. Open page | Works |',
      '',
      '## Coverage Notes',
      'Priority coverage',
    ]),
    'padded-priority-values.md',
  );

  expect(model.cases.map((testCase) => testCase.priority)).toEqual(['High', 'Medium', 'Low']);
});

for (const priority of ['Critical', 'high', '']) {
  test(`rejects unsupported Priority ${JSON.stringify(priority)}`, () => {
    expectExportError(
      () => parseTestCasesMarkdown(priorityFixture(priority), 'invalid-priority.md'),
      {
        message: 'Invalid test-case priority',
        sourcePath: 'invalid-priority.md',
        line: 6,
      },
    );
  });
}

test('reports the source path and line for an invalid test-case table header', () => {
  expectExportError(
    () => parseTestCasesMarkdown('# Test Cases — PROJ-123: Example\n\n## Setup\n\n| ID | Wrong |', 'bad.md'),
    { message: 'Invalid test-case table header', sourcePath: 'bad.md', line: 5 },
  );
});

test('reports the coverage-notes line when a group is missing its header', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '',
          '## Coverage Notes',
          'AC1 -> Missing',
        ]),
        'missing-header.md',
      ),
    { message: 'Missing test-case table header', sourcePath: 'missing-header.md', line: 5 },
  );
});

test('reports the next section line when a group is missing its separator', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '',
          '## Frontend functionality',
        ]),
        'missing-separator.md',
      ),
    { message: 'Missing test-case table separator', sourcePath: 'missing-separator.md', line: 6 },
  );
});

test('reports the source path and line for an invalid test-case table separator', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | nope | --- | --- | --- | --- | --- |',
        ]),
        'bad-separator.md',
      ),
    { message: 'Invalid test-case table separator', sourcePath: 'bad-separator.md', line: 5 },
  );
});

test('reports duplicate test-case IDs on the duplicate row', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          '| TC-001 | First case | High | Ready | None | 1. Step | Works |',
          '| TC-001 | Duplicate case | High | Ready | None | 1. Step | Works |',
          '',
          '## Coverage Notes',
          'AC1 -> TC-001',
        ]),
        'duplicate-id.md',
      ),
    { message: 'Duplicate test-case ID "TC-001"', sourcePath: 'duplicate-id.md', line: 7 },
  );
});

test('reports invalid formatted test-case IDs on the offending row', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          '| CASE-001 | First case | High | Ready | None | 1. Step | Works |',
          '',
          '## Coverage Notes',
          'AC1 -> CASE-001',
        ]),
        'invalid-id.md',
      ),
    { message: 'Invalid test-case ID', sourcePath: 'invalid-id.md', line: 6 },
  );
});

test('reports malformed test-case rows on the offending row', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          '| TC-001 | First case | High | Ready | None | 1. Step |',
          '',
          '## Coverage Notes',
          'AC1 -> TC-001',
        ]),
        'malformed-row.md',
      ),
    { message: 'Malformed test-case row', sourcePath: 'malformed-row.md', line: 6 },
  );
});

test('reports a missing Coverage Notes heading at the end of the source', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          '| TC-001 | First case | High | Ready | None | 1. Step | Works |',
        ]),
        'missing-coverage.md',
      ),
    { message: 'Missing Coverage Notes heading', sourcePath: 'missing-coverage.md', line: 6 },
  );
});

test('reports a missing test-case group on the title line', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          'Generated: 2026-08-18 | Source plan: `PROJ-123-plan.md`',
          '',
          '## Coverage Notes',
          'AC1 -> TC-001',
        ]),
        'missing-group.md',
      ),
    { message: 'Missing test-case group', sourcePath: 'missing-group.md', line: 1 },
  );
});

test('reports an empty required ID field on the offending row', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          '|  | First case | High | Ready | None | 1. Step | Works |',
          '',
          '## Coverage Notes',
          'AC1 -> Missing',
        ]),
        'empty-id.md',
      ),
    { message: 'Invalid test-case ID', sourcePath: 'empty-id.md', line: 6 },
  );
});

test('reports an empty required title field on the offending row', () => {
  expectExportError(
    () =>
      parseTestCasesMarkdown(
        joinLines([
          '# Test Cases — PROJ-123: Example',
          '',
          '## Setup',
          '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          '| TC-001 |  | High | Ready | None | 1. Step | Works |',
          '',
          '## Coverage Notes',
          'AC1 -> TC-001',
        ]),
        'empty-title.md',
      ),
    { message: 'Missing test-case title', sourcePath: 'empty-title.md', line: 6 },
  );
});

test('renders portable test-case workbooks with priority and completion dropdowns', async () => {
  const model = parseTestCasesMarkdown(readFileSync(TEST_CASES_FIXTURE, 'utf8'), TEST_CASES_FIXTURE);
  const priorCompletion = new Map<string, 'Fail'>([['TC-002', 'Fail']]);

  const bytes = await renderTestCasesXlsx(model, priorCompletion);
  const workbook = await loadWorkbook(bytes);
  const overview = workbook.getWorksheet('Overview');
  const testCases = workbook.getWorksheet('Test Cases');
  const validationSheet = workbook.getWorksheet('_Validation');
  const testCasesXml = await readDocxArchiveEntry(bytes, 'xl/worksheets/sheet2.xml');

  expect(COMPLETION_VALUES).toEqual(['Not run', 'Done', 'Fail']);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Overview', 'Test Cases', '_Validation']);
  expect(overview).toBeDefined();
  expect(testCases).toBeDefined();
  expect(validationSheet).toBeDefined();
  expect(validationSheet!.state).toBe('veryHidden');
  expect(workbook.definedNames.getRanges('CompletionStatusOptions').ranges).toEqual(["'_Validation'!$A$1:$A$3"]);
  expect(workbook.definedNames.getRanges('PriorityOptions').ranges).toEqual(["'_Validation'!$B$1:$B$3"]);
  expect(validationSheet!.getCell('A1').value).toBe('Not run');
  expect(validationSheet!.getCell('A2').value).toBe('Done');
  expect(validationSheet!.getCell('A3').value).toBe('Fail');
  expect(validationSheet!.getCell('B1').value).toBe('High');
  expect(validationSheet!.getCell('B2').value).toBe('Medium');
  expect(validationSheet!.getCell('B3').value).toBe('Low');
  expect(overview!.getCell('A1').value).toBe('Ticket ID');
  expect(overview!.getCell('B1').value).toBe('PROJ-123');
  expect(overview!.getCell('A2').value).toBe('Title');
  expect(overview!.getCell('B2').value).toBe('Example checkout flow');
  expect(overview!.getCell('A3').value).toBe('Generated');
  expect(overview!.getCell('B3').value).toBe('2026-08-18');
  expect(overview!.getCell('A4').value).toBe('Source Plan');
  expect(overview!.getCell('B4').value).toBe('PROJ-123-plan.md');
  expect(overview!.getCell('A5').value).toBe('Markdown Source Path');
  expect(overview!.getCell('B5').value).toBe(TEST_CASES_FIXTURE);
  expect(overview!.getCell('A6').value).toBe('Export Time');
  expect(String(overview!.getCell('B6').value)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(overview!.getCell('A7').value).toBe('Total Cases');
  expect(overview!.getCell('B7').value).toBe(2);
  expect(overview!.getCell('A8').value).toBe('Coverage Notes');
  expect(overview!.getCell('B8').value).toBe(
    'Merged cases: 2 total (1 automatable, 1 assisted, 0 manual).\nAC1 -> TC-001, TC-002',
  );
  expect(overview!.getCell('A10').value).toBe('Cases by Priority');
  expect(overview!.getCell('A11').value).toBe('Priority');
  expect(overview!.getCell('B11').value).toBe('Count');
  expect(overview!.getCell('A12').value).toBe('High');
  expect(overview!.getCell('B12').value).toBe(2);
  expect(overview!.getCell('D10').value).toBe('Cases by Triage');
  expect(overview!.getCell('D11').value).toBe('Triage');
  expect(overview!.getCell('E11').value).toBe('Count');
  expect(overview!.getCell('D12').value).toBe('assisted');
  expect(overview!.getCell('E12').value).toBe(1);
  expect(overview!.getCell('D13').value).toBe('automatable');
  expect(overview!.getCell('E13').value).toBe(1);
  expect(overview!.getCell('G10').value).toBe('Cases by Completed status');
  expect(overview!.getCell('G11').value).toBe('Completed');
  expect(overview!.getCell('H11').value).toBe('Count');
  expect(overview!.getCell('G12').value).toBe('Not run');
  expect(overview!.getCell('H12').value).toBe(1);
  expect(overview!.getCell('G13').value).toBe('Done');
  expect(overview!.getCell('H13').value).toBe(0);
  expect(overview!.getCell('G14').value).toBe('Fail');
  expect(overview!.getCell('H14').value).toBe(1);
  expect(testCases!.getRow(1).values).toEqual([
    undefined,
    'ID',
    'Group',
    'Title',
    'Priority',
    'Triage',
    'Preconditions',
    'Steps',
    'Expected Result',
    'Completed',
  ]);
  expect(testCases!.columnCount).toBe(9);
  expect(testCases!.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  expect(testCases!.autoFilter).toBe(`A1:I${testCases!.rowCount}`);
  expect(testCases!.getCell('I2').value).toBe('Not run');
  expect(testCases!.getCell('I3').value).toBe('Fail');
  expect(testCases!.getCell('D2').dataValidation).toMatchObject({
    type: 'list',
    formulae: ['=PriorityOptions'],
    showErrorMessage: true,
    errorStyle: 'stop',
  });
  expect(testCases!.getCell('I2').dataValidation).toMatchObject({
    type: 'list',
    formulae: ['=CompletionStatusOptions'],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid completion status',
    error: 'Choose Not run, Done, or Fail.',
  });
  expect(testCases!.getCell('I2').dataValidation.allowBlank ?? false).toBe(false);
  expect(testCasesXml).toMatch(
    new RegExp(`<dataValidation(?=[^>]*type="list")(?=[^>]*sqref="D2:D${testCases!.rowCount}")(?=[^>]*errorStyle="stop")[^>]*><formula1>=PriorityOptions</formula1></dataValidation>`),
  );
  expect(testCasesXml).toMatch(
    new RegExp(`<dataValidation(?=[^>]*type="list")(?=[^>]*sqref="I2:I${testCases!.rowCount}")(?=[^>]*errorStyle="stop")[^>]*><formula1>=CompletionStatusOptions</formula1></dataValidation>`),
  );
  expect(testCasesXml).toContain('PriorityOptions');
  expect(testCasesXml).toContain('<formula1>=CompletionStatusOptions</formula1>');
  expect(testCasesXml).not.toContain('showDropDown="1"');
});

test('carries forward prior completion state by test-case ID', async () => {
  const workbookPath = createTempFixturePath('prior-completion.xlsx');

  try {
    const priorWorkbook = new ExcelJS.Workbook();
    const priorSheet = priorWorkbook.addWorksheet('Test Cases');
    priorSheet.getCell('B1').value = 'Completed';
    priorSheet.getCell('H1').value = 'ID';
    priorSheet.getCell('B2').value = 'Fail';
    priorSheet.getCell('H2').value = 'TC-002';
    await priorWorkbook.xlsx.writeFile(workbookPath);

    const model = parseTestCasesMarkdown(readFileSync(TEST_CASES_FIXTURE, 'utf8'), TEST_CASES_FIXTURE);
    const priorCompletion = await readCompletionState(workbookPath);
    const workbook = await loadWorkbook(await renderTestCasesXlsx(model, priorCompletion));
    const testCases = workbook.getWorksheet('Test Cases');

    expect(priorCompletion).toEqual(new Map([['TC-002', 'Fail']]));
    expect(testCases!.getCell('I2').value).toBe('Not run');
    expect(testCases!.getCell('I3').value).toBe('Fail');
  } finally {
    if (existsSync(workbookPath)) unlinkSync(workbookPath);
  }
});

test('rejects unreadable prior workbooks with the source path', async () => {
  const workbookPath = createTempFixturePath('corrupt-completion.xlsx');

  try {
    writeFileSync(workbookPath, 'not a workbook', 'utf8');
    await expectWorkbookError(readCompletionState(workbookPath), workbookPath);
  } finally {
    if (existsSync(workbookPath)) unlinkSync(workbookPath);
  }
});

test('rejects prior workbooks missing the Test Cases sheet', async () => {
  const workbookPath = createTempFixturePath('missing-test-cases-sheet.xlsx');

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Overview');
    await workbook.xlsx.writeFile(workbookPath);

    await expectWorkbookError(readCompletionState(workbookPath), workbookPath);
  } finally {
    if (existsSync(workbookPath)) unlinkSync(workbookPath);
  }
});

test('rejects prior workbooks missing required headers', async () => {
  const workbookPath = createTempFixturePath('missing-required-headers.xlsx');

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Test Cases');
    sheet.getCell('A1').value = 'Wrong';
    sheet.getCell('B1').value = 'Headers';
    await workbook.xlsx.writeFile(workbookPath);

    await expectWorkbookError(readCompletionState(workbookPath), workbookPath);
  } finally {
    if (existsSync(workbookPath)) unlinkSync(workbookPath);
  }
});

test('rejects unsupported legacy Unicode completion values from prior workbooks', async () => {
  const workbookPath = createTempFixturePath('invalid-completion.xlsx');

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Test Cases');
    sheet.getCell('A1').value = 'ID';
    sheet.getCell('I1').value = 'Completed';
    sheet.getCell('A2').value = 'TC-001';
    sheet.getCell('I2').value = '☑ Done';
    await workbook.xlsx.writeFile(workbookPath);

    await expectWorkbookError(readCompletionState(workbookPath), workbookPath);
  } finally {
    if (existsSync(workbookPath)) unlinkSync(workbookPath);
  }
});

test('rejects duplicate test-case IDs from prior workbooks', async () => {
  const workbookPath = createTempFixturePath('duplicate-completion-id.xlsx');

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Test Cases');
    sheet.getCell('A1').value = 'ID';
    sheet.getCell('I1').value = 'Completed';
    sheet.getCell('A2').value = 'TC-001';
    sheet.getCell('I2').value = 'Done';
    sheet.getCell('A3').value = 'TC-001';
    sheet.getCell('I3').value = 'Fail';
    await workbook.xlsx.writeFile(workbookPath);

    await expectWorkbookError(readCompletionState(workbookPath), workbookPath);
  } finally {
    if (existsSync(workbookPath)) unlinkSync(workbookPath);
  }
});

test('parses rich plan metadata and GFM body blocks', () => {
  const model = parseTestPlanMarkdown(readFileSync(TEST_PLAN_FIXTURE, 'utf8'), TEST_PLAN_FIXTURE);

  expect(model.ticketId).toBe('PROJ-123');
  expect(model.title.plainText).toBe('Example checkout flow');
  expect(model.metadata[0]!.value.plainText).toBe('Jira');
  expect(model.blocks.map((block) => block.kind)).toContain('list');
  expect(model.blocks.map((block) => block.kind)).toContain('heading');
});

test('renders DOCX test plans with metadata table, heading styles, footer, and margins', async () => {
  const model = parseTestPlanMarkdown(readFileSync(TEST_PLAN_FIXTURE, 'utf8'), TEST_PLAN_FIXTURE);
  const docx = await renderTestPlanDocx(model);
  const documentXml = await readDocxArchiveEntry(docx, 'word/document.xml');
  const footerXml = await readDocxArchiveEntry(docx, 'word/footer1.xml');

  expect(Buffer.from(docx).subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
  expect(documentXml).toContain('<w:tbl>');
  expect(documentXml).toContain('Tracker');
  expect(documentXml).toContain('https://example.test/browse/PROJ-123');
  expect(documentXml).toMatch(
    /<w:pPr><w:pStyle w:val="Heading2"\/><w:spacing w:after="120" w:before="240"\/><\/w:pPr>[\s\S]*?<w:t xml:space="preserve">Requirement Summary<\/w:t>/,
  );
  expect(documentXml).toMatch(
    /<w:pPr><w:pStyle w:val="Heading3"\/><w:spacing w:after="120" w:before="240"\/><\/w:pPr>[\s\S]*?<w:t xml:space="preserve">In Scope<\/w:t>/,
  );
  expect(documentXml).toMatch(
    /<w:pgMar[^>]*w:top="1440"[^>]*w:right="1440"[^>]*w:bottom="1440"[^>]*w:left="1440"/,
  );
  expect(footerXml).toContain(`PROJ-123 • Exported ${getExpectedExportDate()}`);
});

test('renders rich GFM test plans to semantic DOCX without raw Markdown', async () => {
  const model = parseTestPlanMarkdown(readFileSync(GFM_PLAN_FIXTURE, 'utf8'), GFM_PLAN_FIXTURE);
  const docx = await renderTestPlanDocx(model);
  const documentXml = await readDocxArchiveEntry(docx, 'word/document.xml');
  const relationshipsXml = await readDocxArchiveEntry(docx, 'word/_rels/document.xml.rels');

  expect(model.title.plainText).toBe('Rich export with code');
  expect(model.metadata[0]!.value.plainText).toBe('Jira');
  expect(model.blocks.map((block) => block.kind)).toContain('table');
  expect(documentXml).toContain('Rich');
  expect(documentXml).toContain('export with');
  expect(documentXml).toContain('<w:b/>');
  expect(documentXml).toContain('<w:i/>');
  expect(documentXml).toContain('<w:strike/>');
  expect(documentXml).toContain('Courier New');
  expect(documentXml).toContain('<w:tbl>');
  expect(documentXml).toContain('Architecture diagram');
  expect(documentXml).toContain('HTML text');
  expect(documentXml).not.toContain('**Rich**');
  expect(documentXml).not.toContain('`inline code`');
  expect(documentXml).not.toContain('~~deletion~~');
  expect(documentXml).not.toContain('![Architecture diagram]');
  expect(relationshipsXml).toContain('https://example.test/docs');
  expect(relationshipsXml).toContain('mailto:qa@example.test');
  expect(relationshipsXml).not.toContain('javascript:alert');
  expect(relationshipsXml).not.toContain('../local');
});

test('preserves explicit title styling with rich inline title nodes', async () => {
  const model = parseTestPlanMarkdown(readFileSync(GFM_PLAN_FIXTURE, 'utf8'), GFM_PLAN_FIXTURE);
  const docx = await renderTestPlanDocx(model);
  const documentXml = await readDocxArchiveEntry(docx, 'word/document.xml');
  const titleParagraph = findDocxParagraphContaining(documentXml, 'Rich');
  const richRun = findDocxRunContaining(titleParagraph, 'Rich');
  const textRun = findDocxRunContaining(titleParagraph, ' export with ');
  const codeRun = findDocxRunContaining(titleParagraph, '>code</w:t>');

  expect(titleParagraph).toContain('<w:pStyle w:val="Title"/>');
  expect(titleParagraph).not.toContain('**Rich**');
  expect(richRun).toMatch(/<w:b\/>/);
  expect(richRun).toMatch(/<w:sz w:val="32"\/>/);
  expect(textRun).toMatch(/<w:b\/>/);
  expect(textRun).toMatch(/<w:sz w:val="32"\/>/);
  expect(codeRun).toContain('Courier New');
  expect(codeRun).toMatch(/<w:b\/>/);
  expect(codeRun).toMatch(/<w:sz w:val="32"\/>/);
});

test('preserves ordered Markdown starts with distinct DOCX numbering instances', async () => {
  const model = parseTestPlanMarkdown(
    joinLines([
      '# Test Plan — PROJ-126: Ordered list semantics',
      '',
      '- **Tracker:** Jira',
      '',
      '4. Fourth list item',
      '',
      'Paragraph between ordered lists.',
      '',
      '1. First list item',
    ]),
    'ordered-list-starts.md',
  );
  const docx = await renderTestPlanDocx(model);
  const documentXml = await readDocxArchiveEntry(docx, 'word/document.xml');
  const numberingXml = await readDocxArchiveEntry(docx, 'word/numbering.xml');
  const fourthItem = findDocxParagraphContaining(documentXml, 'Fourth list item');
  const firstItem = findDocxParagraphContaining(documentXml, 'First list item');
  const fourthNumId = fourthItem.match(/<w:numId w:val="(\d+)"\/>/)?.[1];
  const firstNumId = firstItem.match(/<w:numId w:val="(\d+)"\/>/)?.[1];

  expect(model.blocks[0]).toMatchObject({ kind: 'list', ordered: true, start: 4 });
  expect(model.blocks[2]).toMatchObject({ kind: 'list', ordered: true, start: 1 });
  expect(fourthNumId).toBeDefined();
  expect(firstNumId).toBeDefined();
  expect(fourthNumId).not.toBe(firstNumId);
  expect(numberingXml).toMatch(
    new RegExp(`<w:num w:numId="${fourthNumId}">[\\s\\S]*?<w:startOverride w:val="4"/>`),
  );
  expect(numberingXml).toMatch(
    new RegExp(`<w:num w:numId="${firstNumId}">[\\s\\S]*?<w:startOverride w:val="1"/>`),
  );
});

test('applies quote treatment to every nested DOCX block type', async () => {
  const docx = await renderTestPlanDocx(createQuotedBlocksPlanModel());
  const documentXml = await readDocxArchiveEntry(docx, 'word/document.xml');

  for (const text of [
    'Quoted paragraph',
    'Quoted heading',
    'Quoted list item',
    'quotedCode();',
    'Nested quoted paragraph',
  ]) {
    expectDocxQuoteParagraph(documentXml, text);
  }

  const quotedTableHeaderIndex = documentXml.indexOf('Quoted table header');
  expect(quotedTableHeaderIndex).toBeGreaterThanOrEqual(0);
  const quotedTableStart = documentXml.lastIndexOf('<w:tbl>', quotedTableHeaderIndex);
  const quotedTableEnd = documentXml.indexOf('</w:tbl>', quotedTableHeaderIndex);
  const quotedTableXml = documentXml.slice(quotedTableStart, quotedTableEnd + '</w:tbl>'.length);
  expect(quotedTableXml).toMatch(/<w:tblInd w:type="dxa" w:w="360"\/>/);
  expect(quotedTableXml).toMatch(/<w:tblBorders>[\s\S]*?<w:left\b[^>]*w:color="808080"/);

  const quotedRuleXml = findDocxParagraphWithBottomBorder(documentXml);
  expect(quotedRuleXml).toMatch(/<w:pBdr>[\s\S]*?<w:left\b[^>]*w:color="808080"/);
  expect(quotedRuleXml).toMatch(/<w:ind\b[^>]*w:left="360"/);
});

test('renders fixture PDF with metadata, model order, footer, and a single content page', async () => {
  const model = parseTestPlanMarkdown(readFileSync(TEST_PLAN_FIXTURE, 'utf8'), TEST_PLAN_FIXTURE);
  const pdf = await renderTestPlanPdf(model);
  const parsedPdf = parsePdfDocument(pdf);
  const pageTexts = parsedPdf.pages.flatMap((page) => page.textRuns.map((run) => run.text));

  expect(Buffer.from(pdf).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(Buffer.from(pdf).length).toBeGreaterThan(500);
  expect(parsedPdf.rawText).toContain(model.title.plainText);
  expect(parsedPdf.rawText).toContain(`QA test plan for ${model.ticketId}`);
  expect(parsedPdf.pages).toHaveLength(1);
  expect(pageTexts).toContain(`${model.ticketId} • Exported ${getExpectedExportDate()}`);
  expectPdfTextOrder(pageTexts, [
    model.title.plainText,
    'Tracker',
    ':',
    'Jira',
    'Ticket URL',
    ':',
    'https://example.test/browse/PROJ-123',
    'Status / Type',
    ':',
    'Ready for QA / Story',
    'Date',
    ':',
    '2026-08-18',
    'QA',
    ':',
    'Jamie Doe',
    'Requirement Summary',
    'Editors can configure the homepage CTA copy and destination in CMS.',
    'Acceptance Criteria',
    '• CTA copy updates after publish.',
    'Environments',
    '•',
    'Design (Figma):',
    'None',
  ]);
});

test('renders rich plan PDFs with semantic content and safe link annotations', async () => {
  const model = parseTestPlanMarkdown(readFileSync(GFM_PLAN_FIXTURE, 'utf8'), GFM_PLAN_FIXTURE);
  const pdf = await renderTestPlanPdf(model);
  const parsedPdf = parsePdfDocument(pdf);
  const pageTexts = parsedPdf.pages.flatMap((page) => page.textRuns.map((run) => run.text));

  expect(parsedPdf.rawText).toContain('Rich export with code');
  expect(parsedPdf.rawText).toContain('Architecture diagram');
  expect(parsedPdf.rawText).toContain('HTML text');
  expect(parsedPdf.rawText).not.toContain('**Rich**');
  expect(parsedPdf.rawText).not.toContain('`inline code`');
  expect(parsedPdf.rawText).not.toContain('~~deletion~~');
  expect(parsedPdf.rawText).not.toContain('![Architecture diagram]');
  expect(extractPdfUriTargets(pdf)).toContain('https://example.test/docs');
  expect(extractPdfUriTargets(pdf)).toContain('mailto:qa@example.test');
  expect(extractPdfUriTargets(pdf)).not.toContain('javascript:alert(1)');
  expect(extractPdfUriTargets(pdf)).not.toContain('../local');
  expectPdfTextOrder(pageTexts, [
    'Quote',
    'content',
    'with',
    'code',
    '• Parent item',
    '• Nested item',
    '[x] Completed task',
    '[ ] Pending task',
    'const answer = 42;',
    'Header A',
    'Header B',
    'cell code',
    'old',
  ]);
});

test('repeats the PDF footer and reserves footer space when one block spans multiple pages', async () => {
  const model = createLongPlanModel();
  const pdf = await renderTestPlanPdf(model);
  const parsedPdf = parsePdfDocument(pdf);
  const footerText = `${model.ticketId} • Exported ${getExpectedExportDate()}`;
  const reservedFooterTop = PDF_MARGIN + PDF_FOOTER_HEIGHT;

  expect(parsedPdf.pages.length).toBeGreaterThan(1);

  for (const page of parsedPdf.pages) {
    const contentRuns = page.textRuns.filter((run) => run.text !== footerText);
    const lowestContentY = Math.min(...contentRuns.map((run) => run.y));

    expect(page.textRuns.some((run) => run.text === footerText)).toBe(true);
    expect(contentRuns.length).toBeGreaterThan(0);
    expect(lowestContentY).toBeGreaterThanOrEqual(reservedFooterTop);
  }
}, 10_000);

test('renders multi-page bullet content with repeated footers using only public PDFKit APIs', async () => {
  const model = createLongBulletPlanModel();
  const pdf = await renderTestPlanPdf(model);
  const parsedPdf = parsePdfDocument(pdf);
  const footerText = `${model.ticketId} • Exported ${getExpectedExportDate()}`;
  const reservedFooterTop = PDF_MARGIN + PDF_FOOTER_HEIGHT;

  expect(parsedPdf.pages.length).toBeGreaterThan(1);

  for (const page of parsedPdf.pages) {
    const contentRuns = page.textRuns.filter((run) => run.text !== footerText);
    const lowestContentY = Math.min(...contentRuns.map((run) => run.y));

    expect(page.textRuns.some((run) => run.text === footerText)).toBe(true);
    expect(contentRuns.length).toBeGreaterThan(0);
    expect(contentRuns.some((run) => run.text.includes('Bullet segment'))).toBe(true);
    expect(lowestContentY).toBeGreaterThanOrEqual(reservedFooterTop);
  }
}, 10_000);

test('paginates an oversized table row above repeated footers', async () => {
  const model = createOversizedTablePlanModel();
  const pdf = await renderTestPlanPdf(model);
  const parsedPdf = parsePdfDocument(pdf);
  const footerText = `${model.ticketId} • Exported ${getExpectedExportDate()}`;
  const reservedFooterTop = PDF_MARGIN + PDF_FOOTER_HEIGHT;

  expect(parsedPdf.pages.length).toBeGreaterThan(1);

  for (const page of parsedPdf.pages) {
    const contentRuns = page.textRuns.filter((run) => run.text !== footerText);

    expect(page.textRuns.some((run) => run.text === footerText)).toBe(true);
    expect(page.textRuns.some((run) => run.text === 'Details')).toBe(true);
    expect(contentRuns.length).toBeGreaterThan(0);
    expect(Math.min(...contentRuns.map((run) => run.y))).toBeGreaterThanOrEqual(reservedFooterTop);
  }
}, 10_000);

test('renders a marked two-column continuation before every oversized-header body fragment', async () => {
  const model = createOversizedTableHeaderPlanModel();
  const pdf = await renderPdfInBoundedChild(model);
  const parsedPdf = parsePdfDocument(pdf);
  const footerText = `${model.ticketId} • Exported ${getExpectedExportDate()}`;
  const reservedFooterTop = PDF_MARGIN + PDF_FOOTER_HEIGHT;
  const table = model.blocks[0] as Extract<TestPlanDocument['blocks'][number], { kind: 'table' }>;
  const headerTokens = table.header.flatMap((cell) => cell.plainText.split(' '));
  const bodyTokens = table.rows.flatMap((row) => row.flatMap((cell) => cell.plainText.split(' ')));
  const bodyPages = parsedPdf.pages.filter((page) => page.textRuns.some((run) => run.text.includes('BodyMarker')));

  expect(parsedPdf.pages.length).toBeGreaterThan(1);
  expect(bodyPages.length).toBeGreaterThan(1);

  for (const token of [...headerTokens, ...bodyTokens]) {
    expect(parsedPdf.rawText).toContain(token);
  }

  for (const page of bodyPages) {
    const contentRuns = page.textRuns.filter((run) => run.text !== footerText);
    const pageText = page.textRuns.map((run) => run.text).join(' ');

    expect(page.textRuns.some((run) => run.text === footerText)).toBe(true);
    expect(contentRuns.length).toBeGreaterThan(0);
    expect(pageText).toContain('Header continuation');
    expect(pageText).toContain('HeaderAStart');
    expect(pageText).toContain('HeaderBStart');
    expect(Math.min(...contentRuns.map((run) => run.y))).toBeGreaterThanOrEqual(reservedFooterTop);
  }
}, 10_000);

test('reports the source path and line for a missing plan title', () => {
  expect(() => parseTestPlanMarkdown('## Requirement Summary', 'plan-bad.md')).toThrow(ExportValidationError);
  expect(() => parseTestPlanMarkdown('## Requirement Summary', 'plan-bad.md')).toThrow(/plan-bad\.md:1/);
});

test('reports the source path and line for missing test-plan content', () => {
  expectExportError(
    () => parseTestPlanMarkdown('# Test Plan — PROJ-123: Empty', 'plan-empty.md'),
    { message: 'Missing test-plan content', sourcePath: 'plan-empty.md', line: 1 },
  );
});

test('writeAtomically creates parent directories and leaves only the target file', async () => {
  const workspacePath = createTempWorkspace('atomic-write-success');
  const targetPath = join(workspacePath, 'exports', 'plan.pdf');

  try {
    await writeAtomically(targetPath, TEXT_ENCODER.encode('generated-pdf'));

    expect(readFileSync(targetPath, 'utf8')).toBe('generated-pdf');
    expect(readdirSync(join(workspacePath, 'exports'))).toEqual(['plan.pdf']);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

test('writeAtomically surfaces the target path when creating its parent directory fails', async () => {
  const workspacePath = createTempWorkspace('atomic-mkdir-failure');
  const targetPath = join(workspacePath, 'exports', 'plan.pdf');
  const fsPromises = await import('node:fs/promises');
  const originalMkdir = fsPromises.mkdir;

  mock.module('node:fs/promises', () => ({
    ...fsPromises,
    mkdir: async (..._args: Parameters<typeof originalMkdir>) => {
      throw new Error('Simulated mkdir failure');
    },
  }));

  try {
    const { writeAtomically: writeAtomicallyWithMockedFs } = await import(
      `../scripts/lib/export/write-atomically.ts?mkdir-failure=${randomUUID()}`
    );
    let caught: unknown;

    try {
      await writeAtomicallyWithMockedFs(targetPath, TEXT_ENCODER.encode('generated-pdf'));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('create parent directory');
    expect((caught as Error).message).toContain(targetPath);
    expect(existsSync(join(workspacePath, 'exports'))).toBe(false);
  } finally {
    mock.restore();
    removeTempWorkspace(workspacePath);
  }
});

test('writeAtomically surfaces the target path and removes its temporary sibling when replacement fails', async () => {
  const workspacePath = createTempWorkspace('atomic-write-failure');
  const targetPath = join(workspacePath, 'exports');
  mkdirSync(targetPath, { recursive: true });

  let caught: unknown;

  try {
    await writeAtomically(targetPath, TEXT_ENCODER.encode('will-fail'));
  } catch (error) {
    caught = error;
  }

  try {
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(targetPath);
    expect(readdirSync(workspacePath)).toEqual(['exports']);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

test('writeAtomically removes only its known temporary sibling when writeFile throws after creating it', async () => {
  const workspacePath = createTempWorkspace('atomic-write-partial-failure');
  const exportsPath = join(workspacePath, 'exports');
  const targetPath = join(exportsPath, 'plan.pdf');
  mkdirSync(exportsPath, { recursive: true });
  writeFileSync(join(exportsPath, 'keep.txt'), 'keep', 'utf8');

  const fsPromises = await import('node:fs/promises');
  const originalWriteFile = fsPromises.writeFile;

  mock.module('node:fs/promises', () => ({
    ...fsPromises,
    writeFile: async (...args: Parameters<typeof originalWriteFile>) => {
      await originalWriteFile(...args);
      throw new Error('Simulated partial write failure');
    },
  }));

  try {
    const { writeAtomically: writeAtomicallyWithMockedFs } = await import(
      `../scripts/lib/export/write-atomically.ts?partial-write=${randomUUID()}`
    );
    let caught: unknown;

    try {
      await writeAtomicallyWithMockedFs(targetPath, TEXT_ENCODER.encode('partial'));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(targetPath);
    expect(readdirSync(exportsPath)).toEqual(['keep.txt']);
  } finally {
    mock.restore();
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('exports test cases to XLSX and prints a single JSON result after success', async () => {
  const workspacePath = createTempWorkspace('export-test-cases-xlsx');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);
    const outputPath = join(workspacePath, '.qa', 'PROJ-123', 'exports', 'PROJ-123-test-cases.xlsx');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ticketId: 'PROJ-123',
      artifact: 'test-cases',
      outputs: [join('.qa', 'PROJ-123', 'exports', 'PROJ-123-test-cases.xlsx')],
    });
    expect(existsSync(outputPath)).toBe(true);
    expect(readdirSync(join(workspacePath, '.qa', 'PROJ-123', 'exports'))).toEqual(['PROJ-123-test-cases.xlsx']);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('re-exports Markdown priority while carrying completion forward by test-case ID', async () => {
  const workspacePath = createTempWorkspace('export-test-cases-state');
  createWorkspaceSources(workspacePath);
  const outputPath = join(workspacePath, '.qa', 'PROJ-123', 'exports', 'PROJ-123-test-cases.xlsx');

  try {
    mkdirSync(dirname(outputPath), { recursive: true });

    const priorWorkbook = new ExcelJS.Workbook();
    const priorSheet = priorWorkbook.addWorksheet('Test Cases');
    priorSheet.getCell('A1').value = 'ID';
    priorSheet.getCell('D1').value = 'Priority';
    priorSheet.getCell('I1').value = 'Completed';
    priorSheet.getCell('A2').value = 'TC-002';
    priorSheet.getCell('D2').value = 'Low';
    priorSheet.getCell('I2').value = 'Done';
    await priorWorkbook.xlsx.writeFile(outputPath);

    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ticketId: 'PROJ-123',
      artifact: 'test-cases',
      outputs: [join('.qa', 'PROJ-123', 'exports', 'PROJ-123-test-cases.xlsx')],
      carriedCompletionCount: 1,
    });
    const testCases = workbook.getWorksheet('Test Cases')!;
    expect(testCases.getCell('D3').value).toBe('High');
    expect(testCases.getCell('I3').value).toBe('Done');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('counts only completion states carried into current test cases', async () => {
  const workspacePath = createTempWorkspace('export-test-cases-current-state-count');
  createWorkspaceSources(workspacePath);
  const outputPath = join(workspacePath, '.qa', 'PROJ-123', 'exports', 'PROJ-123-test-cases.xlsx');

  try {
    mkdirSync(dirname(outputPath), { recursive: true });

    const priorWorkbook = new ExcelJS.Workbook();
    const priorSheet = priorWorkbook.addWorksheet('Test Cases');
    priorSheet.getCell('A1').value = 'ID';
    priorSheet.getCell('I1').value = 'Completed';
    priorSheet.getCell('A2').value = 'TC-002';
    priorSheet.getCell('I2').value = 'Done';
    priorSheet.getCell('A3').value = 'TC-999';
    priorSheet.getCell('I3').value = 'Fail';
    await priorWorkbook.xlsx.writeFile(outputPath);

    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ carriedCompletionCount: 1 });
    expect(workbook.getWorksheet('Test Cases')!.getCell('I3').value).toBe('Done');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('rejects unsupported test-cases PDF exports with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-unsupported-test-cases-pdf');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'pdf'], workspacePath);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unsupported format');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('rejects unsupported test-cases DOCX exports with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-unsupported-test-cases-docx');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'docx'], workspacePath);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unsupported format');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('rejects unsupported test-plan XLSX exports with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-unsupported-test-plan-xlsx');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-plan', '--format', 'xlsx'], workspacePath);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unsupported format');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('rejects duplicate CLI flags with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-duplicate-flags');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(
      ['--ticket', 'PROJ-123', '--ticket', 'PROJ-456', '--artifact', 'test-cases', '--format', 'xlsx'],
      workspacePath,
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Duplicate flag');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('rejects unknown CLI flags with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-unknown-flag');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(
      ['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx', '--unknown', 'value'],
      workspacePath,
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown flag');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

for (const ticketId of ['..', '../outside', '..\\outside', '.', '/absolute-ticket', 'C:\\absolute-ticket']) {
  testExportCli(`rejects unsafe ticket ID ${JSON.stringify(ticketId)} before reading or writing artifacts`, async () => {
    const workspacePath = createTempWorkspace('export-invalid-ticket');

    if (ticketId === '..') {
      writeFileSync(join(workspacePath, 'test-cases.md'), readFileSync(TEST_CASES_FIXTURE, 'utf8'), 'utf8');
    }

    try {
      const result = await runExport(['--ticket', ticketId, '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);

      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Invalid ticket ID');
      expect(existsSync(join(workspacePath, 'exports'))).toBe(false);
      expect(existsSync(join(workspacePath, 'outside', 'exports'))).toBe(false);
    } finally {
      removeTempWorkspace(workspacePath);
    }
  });
}

testExportCli('rejects omitted CLI values with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-missing-value');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format'], workspacePath);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Missing value');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('rejects duplicate formats with exit 2', async () => {
  const workspacePath = createTempWorkspace('export-duplicate-formats');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-plan', '--format', 'docx,docx'], workspacePath);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Duplicate format');
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('fails with exit 1 when the source Markdown file is missing', async () => {
  const workspacePath = createTempWorkspace('export-missing-source');
  const relativeSourcePath = join('.qa', 'PROJ-123', 'PROJ-123-test-cases.md');

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(relativeSourcePath);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('fails with exit 2 for malformed test-case Markdown', async () => {
  const workspacePath = createTempWorkspace('export-malformed-test-cases');
  const relativeTestCasesPath = join('.qa', 'PROJ-123', 'PROJ-123-test-cases.md');
  const testCasesPath = join(workspacePath, relativeTestCasesPath);
  mkdirSync(dirname(testCasesPath), { recursive: true });
  writeFileSync(testCasesPath, '# Test Cases — PROJ-123: Broken\n\n## Setup\n| Wrong |\n', 'utf8');

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(relativeTestCasesPath);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('fails with exit 1 when the existing workbook state is corrupt and leaves it unchanged', async () => {
  const workspacePath = createTempWorkspace('export-corrupt-workbook');
  createWorkspaceSources(workspacePath);
  const relativeOutputPath = join('.qa', 'PROJ-123', 'exports', 'PROJ-123-test-cases.xlsx');
  const outputPath = join(workspacePath, relativeOutputPath);

  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, 'corrupt workbook', 'utf8');

    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(relativeOutputPath);
    expect(readFileSync(outputPath, 'utf8')).toBe('corrupt workbook');
    expect(readdirSync(join(workspacePath, '.qa', 'PROJ-123', 'exports'))).toEqual(['PROJ-123-test-cases.xlsx']);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('does not fall back to legacy test-case Markdown names', async () => {
  const workspacePath = createTempWorkspace('export-legacy-test-cases');
  writeExportFixture(
    workspacePath,
    join('.qa', 'PROJ-123', 'test-cases.md'),
    readFileSync(TEST_CASES_FIXTURE, 'utf8'),
  );

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-cases', '--format', 'xlsx'], workspacePath);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(join('.qa', 'PROJ-123', 'PROJ-123-test-cases.md'));
    expect(existsSync(join(workspacePath, '.qa', 'PROJ-123', 'exports'))).toBe(false);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('does not fall back to legacy plan Markdown names for DOCX or PDF exports', async () => {
  const workspacePath = createTempWorkspace('export-legacy-plan');
  writeExportFixture(
    workspacePath,
    join('.qa', 'PROJ-123', 'plan.md'),
    readFileSync(TEST_PLAN_FIXTURE, 'utf8'),
  );

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-plan', '--format', 'docx,pdf'], workspacePath);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(join('.qa', 'PROJ-123', 'PROJ-123-plan.md'));
    expect(existsSync(join(workspacePath, '.qa', 'PROJ-123', 'exports'))).toBe(false);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('exports test plans to DOCX and PDF after rendering both buffers first', async () => {
  const workspacePath = createTempWorkspace('export-test-plan-docx-pdf');
  createWorkspaceSources(workspacePath);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-plan', '--format', 'docx,pdf'], workspacePath);
    const docxPath = join(workspacePath, '.qa', 'PROJ-123', 'exports', 'PROJ-123-plan.docx');
    const pdfPath = join(workspacePath, '.qa', 'PROJ-123', 'exports', 'PROJ-123-plan.pdf');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ticketId: 'PROJ-123',
      artifact: 'test-plan',
      outputs: [join('.qa', 'PROJ-123', 'exports', 'PROJ-123-plan.docx'), join('.qa', 'PROJ-123', 'exports', 'PROJ-123-plan.pdf')],
    });
    expect(Buffer.from(readFileSync(docxPath)).subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
    expect(Buffer.from(readFileSync(pdfPath)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(readdirSync(join(workspacePath, '.qa', 'PROJ-123', 'exports')).sort()).toEqual([
      'PROJ-123-plan.docx',
      'PROJ-123-plan.pdf',
    ]);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

testExportCli('exports test plans using the validated CLI ticket for outputs even when the source title disagrees', async () => {
  const workspacePath = createTempWorkspace('export-test-plan-cli-ticket');
  const mismatchedPlan = readFileSync(TEST_PLAN_FIXTURE, 'utf8').replace('# Test Plan — PROJ-123:', '# Test Plan — WRONG-999:');
  writeExportFixture(workspacePath, join('.qa', 'PROJ-123', 'PROJ-123-plan.md'), mismatchedPlan);

  try {
    const result = await runExport(['--ticket', 'PROJ-123', '--artifact', 'test-plan', '--format', 'docx,pdf'], workspacePath);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ticketId: 'PROJ-123',
      artifact: 'test-plan',
      outputs: [join('.qa', 'PROJ-123', 'exports', 'PROJ-123-plan.docx'), join('.qa', 'PROJ-123', 'exports', 'PROJ-123-plan.pdf')],
    });
    expect(readdirSync(join(workspacePath, '.qa', 'PROJ-123', 'exports')).sort()).toEqual([
      'PROJ-123-plan.docx',
      'PROJ-123-plan.pdf',
    ]);
    expect(existsSync(join(workspacePath, '.qa', 'WRONG-999'))).toBe(false);
  } finally {
    removeTempWorkspace(workspacePath);
  }
});

test('deprecated cases stay in the sheet but do not inflate the overview counts', async () => {
  const model = parseTestCasesMarkdown(
    joinLines([
      '# Test Cases — PROJ-123: Retired case handling',
      '',
      '## Frontend',
      '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| TC-001 | Live case | High | automatable | None | 1. Open page | Works |',
      '',
      '## Deprecated',
      '| ID | Title | Priority | Triage | Preconditions | Steps | Expected Result |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| TC-002 | Retired case | Low | manual | None | 1. Open page | Works |',
      '',
      '## Coverage Notes',
      'Round 2 retired TC-002 with AC-2.',
    ]),
    'deprecated-cases.md',
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await renderTestCasesXlsx(model, new Map())));
  const overview = workbook.getWorksheet('Overview');

  // Counting a retired case as live overstates the suite on every re-tested ticket.
  expect(overview!.getCell('B7').value).toBe(1);
  expect(overview!.getCell('A9').value).toBe('Deprecated Cases');
  expect(overview!.getCell('B9').value).toBe(1);
  // It still has to appear in the sheet: a case that existed and stopped applying is history.
  const rows = workbook.getWorksheet('Test Cases')!;
  expect(rows.getCell('A3').value).toBe('TC-002');
  expect(rows.getCell('B3').value).toBe('Deprecated');
});
