export interface TicketArtifactFilenames {
  planMarkdown: string;
  testCasesMarkdown: string;
  planDocx: string;
  planPdf: string;
  testCasesXlsx: string;
}

export function getTicketArtifactFilenames(ticketId: string): TicketArtifactFilenames {
  return {
    planMarkdown: `${ticketId}-plan.md`,
    testCasesMarkdown: `${ticketId}-test-cases.md`,
    planDocx: `${ticketId}-plan.docx`,
    planPdf: `${ticketId}-plan.pdf`,
    testCasesXlsx: `${ticketId}-test-cases.xlsx`,
  };
}
