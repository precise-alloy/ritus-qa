import type { MarkdownBlock, RichText } from './markdown/types.ts';

export const COMPLETION_VALUES = ['Not run', 'Done', 'Fail'] as const;
export type CompletionStatus = (typeof COMPLETION_VALUES)[number];

export const PRIORITY_VALUES = ['High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITY_VALUES)[number];

export const TEST_CASE_HEADERS = [
  'ID',
  'Title',
  'Priority',
  'Triage',
  'Preconditions',
  'Steps',
  'Expected Result',
] as const;

export type ExportArtifact = 'test-cases' | 'test-plan';
export type ExportFormat = 'xlsx' | 'docx' | 'pdf';

export interface TestCaseRow {
  group: string;
  id: string;
  title: string;
  priority: Priority;
  triage: string;
  preconditions: string;
  steps: string;
  expectedResult: string;
}

export interface TestCasesDocument {
  ticketId: string;
  title: string;
  generated: string;
  sourcePlan: string;
  sourcePath: string;
  cases: TestCaseRow[];
  coverageNotes: string;
}

export interface PlanMetadata {
  label: RichText;
  value: RichText;
}

export interface TestPlanDocument {
  ticketId: string;
  title: RichText;
  metadata: PlanMetadata[];
  blocks: MarkdownBlock[];
}

export class ExportValidationError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
    readonly line?: number,
  ) {
    super(line === undefined ? `${message} at ${sourcePath}` : `${message} at ${sourcePath}:${line}`);
    this.name = 'ExportValidationError';
  }
}
