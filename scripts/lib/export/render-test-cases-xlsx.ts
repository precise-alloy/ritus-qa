import ExcelJS from 'exceljs';
import {
  COMPLETION_VALUES,
  PRIORITY_VALUES,
  type CompletionStatus,
  type TestCasesDocument,
} from './types.ts';

const TEST_CASE_XLSX_HEADERS = [
  'ID',
  'Group',
  'Title',
  'Priority',
  'Triage',
  'Preconditions',
  'Steps',
  'Expected Result',
  'Completed',
] as const;
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } } as const;
const ODD_ROW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FBFF' } } as const;
const EVEN_ROW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EAF2F8' } } as const;
const DEPRECATED_GROUP = 'Deprecated';

function countValues(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()];
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
}

function styleBodyRow(row: ExcelJS.Row, fill: typeof ODD_ROW_FILL | typeof EVEN_ROW_FILL): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.fill = fill;
  });
}

function addCountSection(
  worksheet: ExcelJS.Worksheet,
  titleCell: string,
  headerCell: string,
  valueHeader: string,
  entries: ReadonlyArray<[string, number]>,
): void {
  const title = worksheet.getCell(titleCell);
  title.value = valueHeader === 'Completed' ? 'Cases by Completed status' : `Cases by ${valueHeader}`;
  title.font = { bold: true };

  const headerRow = worksheet.getCell(headerCell).row;
  const headerColumn = worksheet.getCell(headerCell).col;
  worksheet.getCell(headerRow, headerColumn).value = valueHeader;
  worksheet.getCell(headerRow, headerColumn + 1).value = 'Count';
  styleHeaderRow(worksheet.getRow(headerRow));

  entries.forEach(([value, count], index) => {
    const row = worksheet.getRow(headerRow + 1 + index);
    row.getCell(headerColumn).value = value;
    row.getCell(headerColumn + 1).value = count;
    row.getCell(headerColumn).alignment = { vertical: 'top', wrapText: true };
    row.getCell(headerColumn + 1).alignment = { vertical: 'top' };
  });
}

export async function renderTestCasesXlsx(
  document: TestCasesDocument,
  priorCompletion: ReadonlyMap<string, CompletionStatus>,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  // Retired cases stay in the sheet as history but must not inflate the live
  // suite's headline counts.
  const activeCases = document.cases.filter((testCase) => testCase.group !== DEPRECATED_GROUP);
  const overview = workbook.addWorksheet('Overview');
  const cases = workbook.addWorksheet('Test Cases', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const validation = workbook.addWorksheet('_Validation');

  COMPLETION_VALUES.forEach((value, index) => {
    validation.getCell(index + 1, 1).value = value;
  });
  PRIORITY_VALUES.forEach((value, index) => {
    validation.getCell(index + 1, 2).value = value;
  });
  validation.state = 'veryHidden';
  workbook.definedNames.add('_Validation!$A$1:$A$3', 'CompletionStatusOptions');
  workbook.definedNames.add('_Validation!$B$1:$B$3', 'PriorityOptions');

  overview.columns = [
    { width: 18 },
    { width: 36 },
    { width: 4 },
    { width: 18 },
    { width: 14 },
    { width: 4 },
    { width: 22 },
    { width: 12 },
  ];
  overview.getCell('A1').value = 'Ticket ID';
  overview.getCell('B1').value = document.ticketId;
  overview.getCell('A2').value = 'Title';
  overview.getCell('B2').value = document.title;
  overview.getCell('A3').value = 'Generated';
  overview.getCell('B3').value = document.generated;
  overview.getCell('A4').value = 'Source Plan';
  overview.getCell('B4').value = document.sourcePlan;
  overview.getCell('A5').value = 'Markdown Source Path';
  overview.getCell('B5').value = document.sourcePath;
  overview.getCell('A6').value = 'Export Time';
  overview.getCell('B6').value = new Date().toISOString();
  overview.getCell('A7').value = 'Total Cases';
  overview.getCell('B7').value = activeCases.length;
  overview.getCell('A8').value = 'Coverage Notes';
  overview.getCell('B8').value = document.coverageNotes;
  overview.getCell('A9').value = 'Deprecated Cases';
  overview.getCell('B9').value = document.cases.length - activeCases.length;

  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'].forEach((cellAddress) => {
    overview.getCell(cellAddress).font = { bold: true };
  });

  addCountSection(overview, 'A10', 'A11', 'Priority', countValues(activeCases.map((testCase) => testCase.priority)));
  addCountSection(overview, 'D10', 'D11', 'Triage', countValues(activeCases.map((testCase) => testCase.triage)));
  addCountSection(
    overview,
    'G10',
    'G11',
    'Completed',
    COMPLETION_VALUES.map((value) => [
      value,
      activeCases.filter((testCase) => (priorCompletion.get(testCase.id) ?? COMPLETION_VALUES[0]) === value).length,
    ]),
  );
  overview.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });

  cases.columns = [
    { header: TEST_CASE_XLSX_HEADERS[0], key: 'id', width: 12 },
    { header: TEST_CASE_XLSX_HEADERS[1], key: 'group', width: 24 },
    { header: TEST_CASE_XLSX_HEADERS[2], key: 'title', width: 32 },
    { header: TEST_CASE_XLSX_HEADERS[3], key: 'priority', width: 12 },
    { header: TEST_CASE_XLSX_HEADERS[4], key: 'triage', width: 14 },
    { header: TEST_CASE_XLSX_HEADERS[5], key: 'preconditions', width: 28 },
    { header: TEST_CASE_XLSX_HEADERS[6], key: 'steps', width: 40 },
    { header: TEST_CASE_XLSX_HEADERS[7], key: 'expectedResult', width: 40 },
    { header: TEST_CASE_XLSX_HEADERS[8], key: 'completed', width: 14 },
  ];
  styleHeaderRow(cases.getRow(1));

  document.cases.forEach((testCase, index) => {
    const completed = priorCompletion.get(testCase.id) ?? COMPLETION_VALUES[0];
    const row = cases.addRow({
      id: testCase.id,
      group: testCase.group,
      title: testCase.title,
      priority: testCase.priority,
      triage: testCase.triage,
      preconditions: testCase.preconditions,
      steps: testCase.steps,
      expectedResult: testCase.expectedResult,
      completed,
    });

    styleBodyRow(row, index % 2 === 0 ? ODD_ROW_FILL : EVEN_ROW_FILL);
    row.getCell(4).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['=PriorityOptions'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid priority',
      error: 'Choose High, Medium, or Low.',
    };
    row.getCell(9).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['=CompletionStatusOptions'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid completion status',
      error: 'Choose Not run, Done, or Fail.',
    };
  });
  cases.autoFilter = { from: 'A1', to: `I${cases.rowCount}` };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
