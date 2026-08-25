import { parseGfmBlocks, parseRichText } from './markdown/parse.ts';
import { ExportValidationError, type PlanMetadata, type TestPlanDocument } from './types.ts';

const TITLE_PATTERN = /^# Test Plan — ([^:]+):\s+(.+)$/;
const METADATA_PATTERN = /^- \*\*(.+?):\*\*\s*(.*)$/;

function fail(message: string, sourcePath: string, line?: number): never {
  throw new ExportValidationError(message, sourcePath, line);
}

export function parseTestPlanMarkdown(source: string, sourcePath: string): TestPlanDocument {
  const lines = source.split(/\r?\n/);
  const titleLine = lines[0]?.trim() ?? '';
  const titleMatch = titleLine.match(TITLE_PATTERN);

  if (!titleMatch) fail('Missing test-plan title', sourcePath, 1);

  const [, ticketId, title] = titleMatch;
  const metadata: PlanMetadata[] = [];
  let bodyStart = lines.length;

  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (trimmed === '') continue;

    const metadataMatch = trimmed.match(METADATA_PATTERN);
    if (metadataMatch) {
      metadata.push({
        label: parseRichText(metadataMatch[1]!.trim()),
        value: parseRichText(metadataMatch[2]!.trim()),
      });
      continue;
    }

    bodyStart = index;
    break;
  }

  const blocks = parseGfmBlocks(lines.slice(bodyStart).join('\n'));
  if (blocks.length === 0) fail('Missing test-plan content', sourcePath, lines.length || 1);

  return {
    ticketId,
    title: parseRichText(title),
    metadata,
    blocks,
  };
}
