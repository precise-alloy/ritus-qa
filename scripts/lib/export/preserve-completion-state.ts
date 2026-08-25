import ExcelJS from 'exceljs';
import {
  COMPLETION_VALUES,
  ExportValidationError,
  type CompletionStatus,
} from './types.ts';

const COMPLETION_SET = new Set<string>(COMPLETION_VALUES);

function fail(message: string, workbookPath: string): never {
  throw new ExportValidationError(message, workbookPath);
}

function findHeaderRow(worksheet: ExcelJS.Worksheet, workbookPath: string): {
  rowNumber: number;
  idColumn: number;
  completedColumn: number;
} {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let idColumn = 0;
    let completedColumn = 0;

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const value = cell.text.trim();
      if (value === 'ID') idColumn = columnNumber;
      if (value === 'Completed') completedColumn = columnNumber;
    });

    if (idColumn > 0 && completedColumn > 0) {
      return { rowNumber, idColumn, completedColumn };
    }
  }

  fail('Missing required Test Cases headers', workbookPath);
}

export async function readCompletionState(workbookPath: string): Promise<Map<string, CompletionStatus>> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(workbookPath);
  } catch {
    fail('Unreadable workbook', workbookPath);
  }

  const worksheet = workbook.getWorksheet('Test Cases');
  if (!worksheet) fail('Missing Test Cases worksheet', workbookPath);

  const { rowNumber: headerRow, idColumn, completedColumn } = findHeaderRow(worksheet, workbookPath);
  const completionById = new Map<string, CompletionStatus>();

  for (let currentRow = headerRow + 1; currentRow <= worksheet.rowCount; currentRow += 1) {
    const row = worksheet.getRow(currentRow);
    const id = row.getCell(idColumn).text.trim();
    const completedValue = row.getCell(completedColumn).text.trim();

    if (!id && !completedValue) continue;
    if (!id) fail('Missing test-case ID in prior workbook', workbookPath);
    if (!COMPLETION_SET.has(completedValue)) {
      fail(`Invalid completion status "${completedValue}"`, workbookPath);
    }
    if (completionById.has(id)) fail(`Duplicate test-case ID "${id}"`, workbookPath);

    completionById.set(id, completedValue as CompletionStatus);
  }

  return completionById;
}
