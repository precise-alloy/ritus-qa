#!/usr/bin/env bun

import { getTicketArtifactFilenames, type TicketArtifactFilenames } from './lib/export/artifact-filenames.ts';
import { parseTestCasesMarkdown } from './lib/export/parse-test-cases-markdown.ts';
import { parseTestPlanMarkdown } from './lib/export/parse-test-plan-markdown.ts';
import { readCompletionState } from './lib/export/preserve-completion-state.ts';
import { renderTestCasesXlsx } from './lib/export/render-test-cases-xlsx.ts';
import { renderTestPlanDocx } from './lib/export/render-test-plan-docx.ts';
import { renderTestPlanPdf } from './lib/export/render-test-plan-pdf.ts';
import { ExportValidationError, type ExportArtifact, type ExportFormat } from './lib/export/types.ts';
import { writeAtomically } from './lib/export/write-atomically.ts';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

interface ExportResult {
  ticketId: string;
  artifact: ExportArtifact;
  outputs: string[];
  carriedCompletionCount?: number;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

type ParsedArgs = {
  artifact: ExportArtifact;
  formatValue: string;
  formats: ExportFormat[];
  ticketId: string;
};

const TICKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function getCliArgs(argv: string[]): string[] {
  if (argv[1] === 'run') {
    return argv.slice(3);
  }

  return argv.slice(2);
}

function printUsage(): void {
  console.error('Usage: bun run scripts/export-artifact.ts --ticket <ticket-id> --artifact test-cases|test-plan --format xlsx|docx|pdf|docx,pdf');
}

function parseFormatValue(value: string): ExportFormat[] {
  if (value === 'docx,pdf') {
    return ['docx', 'pdf'];
  }

  if (value === 'xlsx' || value === 'docx' || value === 'pdf') {
    return [value];
  }

  if (value.includes(',')) {
    const formats = value.split(',');
    if (new Set(formats).size !== formats.length) {
      throw new UsageError(`Duplicate format in --format: ${value}`);
    }
  }

  throw new UsageError(`Unknown format for --format: ${value}`);
}

function validateArtifactFormats(artifact: ExportArtifact, formats: ExportFormat[], formatValue: string): void {
  if (artifact === 'test-cases' && formats[0] !== 'xlsx') {
    throw new UsageError(`Unsupported format for ${artifact}: ${formatValue}`);
  }

  if (artifact === 'test-plan' && formats.includes('xlsx')) {
    throw new UsageError(`Unsupported format for ${artifact}: ${formatValue}`);
  }
}

function resolveTicketDirectory(ticketId: string): string {
  const qaDirectory = resolve(process.cwd(), '.qa');
  const ticketDirectory = resolve(qaDirectory, ticketId);
  const ticketRelativePath = relative(qaDirectory, ticketDirectory);
  const isOutsideQaDirectory =
    ticketRelativePath === '' ||
    ticketRelativePath === '..' ||
    ticketRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(ticketRelativePath);

  if (
    !TICKET_ID_PATTERN.test(ticketId) ||
    ticketId.endsWith('.') ||
    ticketId.includes('..') ||
    isOutsideQaDirectory
  ) {
    throw new UsageError(`Invalid ticket ID for --ticket: ${ticketId}`);
  }

  return ticketDirectory;
}

function parseArgs(args: string[]): ParsedArgs {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];

    if (!flag?.startsWith('--')) {
      throw new UsageError(`Unknown flag: ${flag ?? '<missing>'}`);
    }

    if (flag !== '--ticket' && flag !== '--artifact' && flag !== '--format') {
      throw new UsageError(`Unknown flag: ${flag}`);
    }

    if (values.has(flag)) {
      throw new UsageError(`Duplicate flag: ${flag}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new UsageError(`Missing value for ${flag}`);
    }

    values.set(flag, value);
  }

  if (args.length !== 6 || values.size !== 3) {
    throw new UsageError('Missing required flags');
  }

  const ticketId = values.get('--ticket');
  const artifact = values.get('--artifact');
  const formatValue = values.get('--format');

  if (!ticketId || !artifact || !formatValue) {
    throw new UsageError('Missing required flags');
  }

  if (artifact !== 'test-cases' && artifact !== 'test-plan') {
    throw new UsageError(`Unknown artifact for --artifact: ${artifact}`);
  }

  const formats = parseFormatValue(formatValue);
  validateArtifactFormats(artifact, formats, formatValue);
  resolveTicketDirectory(ticketId);

  return {
    artifact,
    formatValue,
    formats,
    ticketId,
  };
}

async function readSourceText(sourcePath: string, sourceDisplayPath: string): Promise<string> {
  const file = Bun.file(sourcePath);
  if (!(await file.exists())) {
    throw new Error(`Missing source file at ${sourceDisplayPath}`);
  }

  return await file.text();
}

async function exportTestCases(ticketId: string): Promise<ExportResult> {
  const ticketDirectory = resolveTicketDirectory(ticketId);
  const filenames = getTicketArtifactFilenames(ticketId);
  const sourcePath = join(ticketDirectory, filenames.testCasesMarkdown);
  const sourceDisplayPath = join('.qa', ticketId, filenames.testCasesMarkdown);
  const outputPath = join(ticketDirectory, 'exports', filenames.testCasesXlsx);
  const outputDisplayPath = join('.qa', ticketId, 'exports', filenames.testCasesXlsx);
  const document = parseTestCasesMarkdown(await readSourceText(sourcePath, sourceDisplayPath), sourceDisplayPath);
  let priorCompletion = new Map();
  let carriedCompletionCount: number | undefined;

  if (await Bun.file(outputPath).exists()) {
    priorCompletion = await readCompletionState(outputPath);
    carriedCompletionCount = document.cases.filter((testCase) => priorCompletion.has(testCase.id)).length;
  }

  const workbook = await renderTestCasesXlsx(document, priorCompletion);
  await writeAtomically(outputPath, workbook);

  return {
    ticketId,
    artifact: 'test-cases',
    outputs: [outputDisplayPath],
    ...(carriedCompletionCount === undefined ? {} : { carriedCompletionCount }),
  };
}

async function renderPlanOutput(
  ticketDirectory: string,
  ticketId: string,
  filenames: TicketArtifactFilenames,
  format: ExportFormat,
  document: ReturnType<typeof parseTestPlanMarkdown>,
): Promise<{ buffer: Uint8Array; outputPath: string; outputDisplayPath: string }> {
  if (format === 'docx') {
    return {
      buffer: await renderTestPlanDocx(document),
      outputPath: join(ticketDirectory, 'exports', filenames.planDocx),
      outputDisplayPath: join('.qa', ticketId, 'exports', filenames.planDocx),
    };
  }

  return {
    buffer: await renderTestPlanPdf(document),
    outputPath: join(ticketDirectory, 'exports', filenames.planPdf),
    outputDisplayPath: join('.qa', ticketId, 'exports', filenames.planPdf),
  };
}

async function exportTestPlan(ticketId: string, formats: ExportFormat[]): Promise<ExportResult> {
  const ticketDirectory = resolveTicketDirectory(ticketId);
  const filenames = getTicketArtifactFilenames(ticketId);
  const sourcePath = join(ticketDirectory, filenames.planMarkdown);
  const sourceDisplayPath = join('.qa', ticketId, filenames.planMarkdown);
  const document = parseTestPlanMarkdown(await readSourceText(sourcePath, sourceDisplayPath), sourceDisplayPath);
  const renderedOutputs = await Promise.all(
    formats.map((format) => renderPlanOutput(ticketDirectory, ticketId, filenames, format, document)),
  );

  for (const renderedOutput of renderedOutputs) {
    await writeAtomically(renderedOutput.outputPath, renderedOutput.buffer);
  }

  return {
    ticketId,
    artifact: 'test-plan',
    outputs: renderedOutputs.map((renderedOutput) => renderedOutput.outputDisplayPath),
  };
}

async function main(): Promise<void> {
  try {
    const { artifact, formats, ticketId } = parseArgs(getCliArgs(Bun.argv));
    const result = artifact === 'test-cases' ? await exportTestCases(ticketId) : await exportTestPlan(ticketId, formats);
    console.log(JSON.stringify(result));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      printUsage();
      process.exit(2);
    }

    if (error instanceof ExportValidationError && error.sourcePath.endsWith('.md')) {
      console.error(error.message);
      process.exit(2);
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

await main();
