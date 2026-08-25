import PDFDocument from 'pdfkit';
import { create as createFont } from 'fontkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSafeExternalHref } from './markdown/parse.ts';
import type { MarkdownBlock, MarkdownInline, RichText } from './markdown/types.ts';
import type { TestPlanDocument } from './types.ts';

const PDF_MARGIN = 54;
const FOOTER_HEIGHT = 24;
const FOOTER_TEXT_OFFSET = 10;
const LINE_GAP = 2;
const BULLET_INDENT = 12;
const BODY_FONT = 'Helvetica';
const HEADING_FONT = 'Helvetica-Bold';
const QUOTE_INDENT = 12;
const LIST_INDENT = 18;
const TABLE_PADDING = 4;
const FALLBACK_FONT_NAMES = {
  latinExt: 'NotoSansLatinExt',
  greek: 'NotoSansGreek',
  cyrillic: 'NotoSansCyrillic',
  symbols2: 'NotoSansSymbols2',
  math: 'NotoSansMath',
} as const;
export type EmbeddedPdfFallbackFontName = (typeof FALLBACK_FONT_NAMES)[keyof typeof FALLBACK_FONT_NAMES];
type PdfFontName =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Courier'
  | EmbeddedPdfFallbackFontName;

interface FontCoverage {
  hasGlyphForCodePoint: (codePoint: number) => boolean;
}

interface EmbeddedPdfFallbackFont {
  name: EmbeddedPdfFallbackFontName;
  bytes: Buffer;
  coverage: FontCoverage;
}

function loadEmbeddedPdfFallbackFont(
  name: EmbeddedPdfFallbackFontName,
  packagePath: string,
): EmbeddedPdfFallbackFont {
  const bytes = readFileSync(fileURLToPath(import.meta.resolve(packagePath)));
  return { name, bytes, coverage: createFont(bytes) as FontCoverage };
}

const EMBEDDED_PDF_FALLBACK_FONTS: readonly EmbeddedPdfFallbackFont[] = [
  loadEmbeddedPdfFallbackFont(
    FALLBACK_FONT_NAMES.latinExt,
    '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff',
  ),
  loadEmbeddedPdfFallbackFont(
    FALLBACK_FONT_NAMES.greek,
    '@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff',
  ),
  loadEmbeddedPdfFallbackFont(
    FALLBACK_FONT_NAMES.cyrillic,
    '@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff',
  ),
  loadEmbeddedPdfFallbackFont(
    FALLBACK_FONT_NAMES.symbols2,
    '@fontsource/noto-sans-symbols-2/files/noto-sans-symbols-2-symbols-400-normal.woff',
  ),
  loadEmbeddedPdfFallbackFont(
    FALLBACK_FONT_NAMES.math,
    '@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff',
  ),
];
const WIN_ANSI_EXTRA_CODE_POINTS = new Set([
  0x0152,
  0x0153,
  0x0160,
  0x0161,
  0x0178,
  0x017d,
  0x017e,
  0x0192,
  0x02c6,
  0x02dc,
  0x2013,
  0x2014,
  0x2018,
  0x2019,
  0x201a,
  0x201c,
  0x201d,
  0x201e,
  0x2020,
  0x2021,
  0x2022,
  0x2026,
  0x2030,
  0x2039,
  0x203a,
  0x20ac,
  0x2122,
]);

interface PdfSpan {
  text: string;
  font: PdfFontName;
  code?: boolean;
  strike?: boolean;
  href?: string;
}

function getExportDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function fontForStyle(style: { bold?: boolean; italic?: boolean }): PdfFontName {
  if (style.bold && style.italic) {
    return 'Helvetica-BoldOblique';
  }

  if (style.bold) {
    return 'Helvetica-Bold';
  }

  return style.italic ? 'Helvetica-Oblique' : 'Helvetica';
}

export function getEmbeddedPdfFallbackFontForCodePoint(codePoint: number): EmbeddedPdfFallbackFontName | undefined {
  return EMBEDDED_PDF_FALLBACK_FONTS.find((font) => font.coverage.hasGlyphForCodePoint(codePoint))?.name;
}

function isWinAnsiCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (
    codePoint <= 0x7f ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WIN_ANSI_EXTRA_CODE_POINTS.has(codePoint)
  );
}

function createPdfTextSpans(
  text: string,
  font: PdfFontName,
  options: Pick<PdfSpan, 'code' | 'strike' | 'href'>,
): PdfSpan[] {
  const spans: PdfSpan[] = [];

  for (const character of text) {
    const characterFont =
      isWinAnsiCharacter(character)
        ? font
        : getEmbeddedPdfFallbackFontForCodePoint(character.codePointAt(0)!) ?? font;
    const previous = spans.at(-1);

    if (previous && previous.font === characterFont && previous.code === options.code && previous.strike === options.strike && previous.href === options.href) {
      previous.text += character;
    } else {
      spans.push({ text: character, font: characterFont, ...options });
    }
  }

  return spans;
}

function toPdfSpans(
  inlines: MarkdownInline[],
  style: { bold?: boolean; italic?: boolean } = {},
): PdfSpan[] {
  function visit(
    children: MarkdownInline[],
    currentStyle: { bold?: boolean; italic?: boolean },
    strike = false,
    href?: string,
  ): PdfSpan[] {
    return children.flatMap((inline): PdfSpan[] => {
      switch (inline.kind) {
        case 'text':
          return inline.text
            ? createPdfTextSpans(inline.text, fontForStyle(currentStyle), { strike, href })
            : [];
        case 'strong':
          return visit(inline.children, { ...currentStyle, bold: true }, strike, href);
        case 'emphasis':
          return visit(inline.children, { ...currentStyle, italic: true }, strike, href);
        case 'deletion':
          return visit(inline.children, currentStyle, true, href);
        case 'code':
          return inline.text ? createPdfTextSpans(inline.text, 'Courier', { code: true, strike, href }) : [];
        case 'link':
          return visit(
            inline.children,
            currentStyle,
            strike,
            inline.href && isSafeExternalHref(inline.href) ? inline.href : undefined,
          );
        case 'break':
          return [{ text: '\n', font: fontForStyle(currentStyle), strike, href }];
      }
    });
  }

  return visit(inlines, style);
}

function combineRichText(...parts: RichText[]): RichText {
  return {
    inlines: parts.flatMap((part) => part.inlines),
    plainText: parts.map((part) => part.plainText).join(''),
  };
}

export async function renderTestPlanPdf(document: TestPlanDocument): Promise<Uint8Array> {
  const exportDate = getExportDate();
  const title = document.title.plainText;

  return await new Promise<Uint8Array>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: {
        top: PDF_MARGIN,
        right: PDF_MARGIN,
        bottom: PDF_MARGIN + FOOTER_HEIGHT,
        left: PDF_MARGIN,
      },
      autoFirstPage: false,
      info: {
        Title: title,
        Subject: `QA test plan for ${document.ticketId}`,
      },
    });
    const chunks: Buffer[] = [];
    const footerText = `${document.ticketId} • Exported ${exportDate}`;
    let cursorY = PDF_MARGIN;
    let hasPage = false;
    for (const font of EMBEDDED_PDF_FALLBACK_FONTS) {
      pdf.registerFont(font.name, font.bytes);
    }

    function contentWidth(): number {
      return pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    }

    function contentBottom(): number {
      return pdf.page.maxY();
    }

    function drawFooter(): void {
      pdf.font(BODY_FONT).fontSize(9).fillColor('#666666');

      const footerWidth = pdf.widthOfString(footerText);
      const footerX = pdf.page.margins.left + Math.max(0, (contentWidth() - footerWidth) / 2);
      const footerY = pdf.page.height - PDF_MARGIN - FOOTER_TEXT_OFFSET;

      pdf.text(footerText, footerX, footerY, { lineBreak: false });
      pdf.fillColor('black');
    }

    function addContentPage(): void {
      if (hasPage) {
        drawFooter();
      }

      pdf.addPage();
      hasPage = true;
      cursorY = pdf.page.margins.top;
    }

    function ensureLineFits(lineHeight: number): void {
      if (cursorY + lineHeight <= contentBottom()) {
        return;
      }

      addContentPage();
    }

    function spanWidth(span: PdfSpan, fontSize: number): number {
      return pdf.font(span.font).fontSize(fontSize).widthOfString(span.text);
    }

    function splitSpansAtBreaks(spans: PdfSpan[]): Array<PdfSpan[] | undefined> {
      const lines: Array<PdfSpan[] | undefined> = [[]];

      for (const span of spans) {
        const pieces = span.text.split('\n');

        pieces.forEach((piece, index) => {
          if (piece) {
            lines[lines.length - 1]!.push({ ...span, text: piece });
          }

          if (index < pieces.length - 1) {
            lines.push([]);
          }
        });
      }

      return lines;
    }

    function findFittingPrefix(span: PdfSpan, availableWidth: number, fontSize: number): [string, string] {
      if (spanWidth(span, fontSize) <= availableWidth) {
        return [span.text, ''];
      }

      let bestEnd = -1;
      const boundaryPattern = /\s+/g;

      for (const match of span.text.matchAll(boundaryPattern)) {
        const candidate = span.text.slice(0, match.index! + match[0].length).trimEnd();

        if (candidate && spanWidth({ ...span, text: candidate }, fontSize) <= availableWidth) {
          bestEnd = match.index! + match[0].length;
        } else {
          break;
        }
      }

      if (bestEnd === -1) {
        return ['', span.text];
      }

      return [span.text.slice(0, bestEnd).trimEnd(), span.text.slice(bestEnd).trimStart()];
    }

    function wrapSpans(spans: PdfSpan[], width: number, fontSize: number): PdfSpan[][] {
      const lines: PdfSpan[][] = [];

      for (const sourceLine of splitSpansAtBreaks(spans)) {
        if (sourceLine === undefined || sourceLine.length === 0) {
          lines.push([]);
          continue;
        }

        let line: PdfSpan[] = [];
        let usedWidth = 0;
        const pending = [...sourceLine];

        while (pending.length > 0) {
          const span = pending.shift()!;
          const availableWidth = width - usedWidth;
          const [fittingText, remainingText] = findFittingPrefix(span, availableWidth, fontSize);

          if (fittingText) {
            line.push({ ...span, text: fittingText });
            usedWidth += spanWidth({ ...span, text: fittingText }, fontSize);
          }

          if (!remainingText) {
            continue;
          }

          if (line.length > 0) {
            lines.push(line);
            line = [];
            usedWidth = 0;
            pending.unshift({ ...span, text: remainingText });
            continue;
          }

          const firstWord = remainingText.match(/^\S+/)?.[0] ?? remainingText;
          line.push({ ...span, text: firstWord });
          lines.push(line);
          line = [];
          usedWidth = 0;

          const nextText = remainingText.slice(firstWord.length).trimStart();
          if (nextText) {
            pending.unshift({ ...span, text: nextText });
          }
        }

        if (line.length > 0) {
          lines.push(line);
        }
      }

      return lines.length > 0 ? lines : [[]];
    }

    function drawSpans(spans: PdfSpan[], x: number, y: number, fontSize: number, lineHeight: number): void {
      let cursorX = x;

      for (const span of spans) {
        const width = spanWidth(span, fontSize);

        if (span.code) {
          pdf.save().fillColor('#F2F2F2').rect(cursorX - 1, y - 1, width + 2, lineHeight).fill().restore();
        }

        pdf.font(span.font).fontSize(fontSize).fillColor(span.href ? '#0563C1' : 'black');
        pdf.text(span.text, cursorX, y, { lineBreak: false });

        if (span.href) {
          pdf.underline(cursorX, y, width, lineHeight, { color: '#0563C1' });
          pdf.link(cursorX, y, width, lineHeight, span.href);
        }

        if (span.strike) {
          pdf.strike(cursorX, y, width, lineHeight, { color: 'black' });
        }

        cursorX += width;
      }

      pdf.fillColor('black');
    }

    function lineHeightFor(fontSize: number): number {
      return pdf.font(BODY_FONT).fontSize(fontSize).currentLineHeight(true);
    }

    function renderRichText(
      content: RichText,
      options: {
        after: number;
        bullet?: boolean;
        quote?: boolean;
        fontSize: number;
        indent?: number;
        prefix?: string;
        style?: { bold?: boolean; italic?: boolean };
        quoteDepth?: number;
      },
    ): void {
      const prefix = options.prefix ?? (options.bullet ? '• ' : '');
      let spans = toPdfSpans(content.inlines, options.style);

      if (prefix && spans[0] && !spans[0].code && !spans[0].href && !spans[0].strike && spans[0].font === BODY_FONT) {
        spans = [{ ...spans[0], text: `${prefix}${spans[0].text}` }, ...spans.slice(1)];
      } else if (prefix) {
        spans = [{ text: prefix, font: BODY_FONT }, ...spans];
      }

      const quoteDepth = options.quoteDepth ?? (options.quote ? 1 : 0);
      const baseIndent = (options.indent ?? 0) + quoteDepth * QUOTE_INDENT;
      const firstLinePrefixWidth = prefix ? spanWidth({ text: prefix, font: BODY_FONT }, options.fontSize) : 0;
      const firstLineWidth = contentWidth() - baseIndent;
      const continuationWidth = contentWidth() - baseIndent - (prefix ? Math.max(firstLinePrefixWidth, BULLET_INDENT) : 0);
      const allLines = wrapSpans(spans, firstLineWidth, options.fontSize);
      const lineHeight = lineHeightFor(options.fontSize);

      for (const [index, line] of allLines.entries()) {
        ensureLineFits(lineHeight);
        const continuationIndent = index === 0 || !prefix ? 0 : Math.max(firstLinePrefixWidth, BULLET_INDENT);
        const lineX = pdf.page.margins.left + baseIndent + continuationIndent;
        const availableWidth = index === 0 ? firstLineWidth : continuationWidth;
        const fittedLines = wrapSpans(line, availableWidth, options.fontSize);

        for (const fittedLine of fittedLines) {
          ensureLineFits(lineHeight);

          if (quoteDepth > 0) {
            pdf
              .save()
              .fillColor('#808080')
              .rect(pdf.page.margins.left + (options.indent ?? 0) + (quoteDepth - 1) * QUOTE_INDENT, cursorY, 3, lineHeight)
              .fill()
              .restore();
          }

          drawSpans(fittedLine, lineX, cursorY, options.fontSize, lineHeight);
          cursorY += lineHeight + LINE_GAP;
        }
      }

      cursorY += options.after;
    }

    function renderTable(
      block: Extract<MarkdownBlock, { kind: 'table' }>,
      listDepth: number,
      quoteDepth: number,
    ): void {
      const indent = listDepth * LIST_INDENT + quoteDepth * QUOTE_INDENT;
      const tableX = pdf.page.margins.left + indent;
      const tableWidth = contentWidth() - indent;
      const columnCount = Math.max(block.header.length, ...block.rows.map((row) => row.length));
      const cellWidth = tableWidth / columnCount;
      const fontSize = 9;
      const lineHeight = lineHeightFor(fontSize);

      function getCellLines(cells: RichText[], header: boolean): PdfSpan[][][] {
        return Array.from({ length: columnCount }, (_, index) =>
          wrapSpans(
            toPdfSpans(cells[index]?.inlines ?? [], header ? { bold: true } : undefined),
            cellWidth - TABLE_PADDING * 2,
            fontSize,
          ),
        );
      }

      function rowHeight(lineCount: number): number {
        return lineCount * lineHeight + TABLE_PADDING * 2;
      }

      function drawRowFragment(
        cellLines: PdfSpan[][][],
        startLine: number,
        lineCount: number,
        header: boolean,
      ): void {
        const fragmentHeight = rowHeight(lineCount);
        if (header) {
          pdf.save().fillColor('#D9EAD3').rect(tableX, cursorY, tableWidth, fragmentHeight).fill().restore();
        }

        if (quoteDepth > 0) {
          pdf.save().fillColor('#808080').rect(tableX - QUOTE_INDENT, cursorY, 3, fragmentHeight).fill().restore();
        }

        for (let column = 0; column < columnCount; column += 1) {
          const cellX = tableX + column * cellWidth;
          pdf
            .save()
            .lineWidth(0.5)
            .strokeColor('#808080')
            .rect(cellX, cursorY, cellWidth, fragmentHeight)
            .stroke()
            .restore();

          for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
            const line = cellLines[column]![startLine + lineIndex] ?? [];
            const textWidth = line.reduce((width, span) => width + spanWidth(span, fontSize), 0);
            const alignment = block.align[column];
            const alignmentOffset =
              alignment === 'right'
                ? cellWidth - TABLE_PADDING * 2 - textWidth
                : alignment === 'center'
                  ? (cellWidth - TABLE_PADDING * 2 - textWidth) / 2
                  : 0;

            drawSpans(line, cellX + TABLE_PADDING + alignmentOffset, cursorY + TABLE_PADDING + lineIndex * lineHeight, fontSize, lineHeight);
          }
        }

        cursorY += fragmentHeight;
      }

      const headerLines = getCellLines(block.header, true);
      const headerLineCount = Math.max(...headerLines.map((lines) => lines.length));
      const headerHeight = rowHeight(headerLineCount);
      const minimumRowHeight = rowHeight(1);
      const headerFitsWithMinimumRow =
        headerHeight + minimumRowHeight <= contentBottom() - pdf.page.margins.top;
      const continuationHeaderLines = headerLines.map((lines, column) => {
        const firstLine = lines[0] ?? [];
        return column === 0
          ? [[{ text: 'Header continuation: ', font: HEADING_FONT }], firstLine]
          : [firstLine, []];
      });
      const continuationHeaderLineCount = 2;
      const continuationHeaderHeight = rowHeight(continuationHeaderLineCount);
      let headerOnCurrentPage = false;
      let oversizedHeaderRendered = false;
      let oversizedHeaderContinuationNeeded = false;

      function renderHeader(): void {
        ensureLineFits(headerHeight + minimumRowHeight);
        drawRowFragment(headerLines, 0, headerLineCount, true);
        headerOnCurrentPage = true;
      }

      function availableLineCount(reservedHeight = 0): number {
        return Math.floor((contentBottom() - cursorY - TABLE_PADDING * 2 - reservedHeight) / lineHeight);
      }

      function renderOversizedHeader(reservedHeight = 0): void {
        let startLine = 0;

        while (startLine < headerLineCount) {
          const availableLines = availableLineCount();

          if (availableLines < 1) {
            addContentPage();
            continue;
          }

          const remainingLines = headerLineCount - startLine;
          const finalFragmentCapacity = reservedHeight > 0 ? availableLineCount(reservedHeight) : availableLines;
          const fragmentLineCount =
            remainingLines <= finalFragmentCapacity
              ? remainingLines
              : remainingLines > availableLines
                ? availableLines
                : 0;

          if (fragmentLineCount < 1) {
            addContentPage();
            continue;
          }

          drawRowFragment(headerLines, startLine, fragmentLineCount, true);
          startLine += fragmentLineCount;

          if (startLine < headerLineCount) {
            addContentPage();
          }
        }
      }

      function renderOversizedHeaderContinuation(): void {
        ensureLineFits(continuationHeaderHeight + minimumRowHeight);
        drawRowFragment(continuationHeaderLines, 0, continuationHeaderLineCount, true);
      }

      function addTableBodyContinuationPage(): void {
        addContentPage();
        headerOnCurrentPage = false;
        oversizedHeaderContinuationNeeded = oversizedHeaderRendered;
      }

      function renderRow(cells: RichText[]): void {
        const cellLines = getCellLines(cells, false);
        const rowLineCount = Math.max(...cellLines.map((lines) => lines.length));
        let startLine = 0;

        while (startLine < rowLineCount) {
          if (!headerFitsWithMinimumRow && !oversizedHeaderRendered) {
            renderOversizedHeader(continuationHeaderHeight + minimumRowHeight);
            oversizedHeaderRendered = true;
            oversizedHeaderContinuationNeeded = true;
          }

          if (!headerFitsWithMinimumRow && oversizedHeaderContinuationNeeded) {
            renderOversizedHeaderContinuation();
            oversizedHeaderContinuationNeeded = false;
          } else if (headerFitsWithMinimumRow && !headerOnCurrentPage) {
            renderHeader();
          }

          const availableLines = availableLineCount();
          if (availableLines < 1) {
            addTableBodyContinuationPage();
            continue;
          }

          const fragmentLineCount = Math.min(rowLineCount - startLine, availableLines);
          drawRowFragment(cellLines, startLine, fragmentLineCount, false);
          startLine += fragmentLineCount;
          if (startLine < rowLineCount) {
            addTableBodyContinuationPage();
          }
        }
      }

      if (block.rows.length === 0) {
        if (headerFitsWithMinimumRow) {
          ensureLineFits(headerHeight);
          drawRowFragment(headerLines, 0, headerLineCount, true);
        } else {
          renderOversizedHeader();
        }
      } else {
        block.rows.forEach(renderRow);
      }
      cursorY += 8;
    }

    function renderPdfList(
      block: Extract<MarkdownBlock, { kind: 'list' }>,
      listDepth: number,
      quoteDepth: number,
    ): void {
      block.items.forEach((item, itemIndex) => {
        item.blocks.forEach((itemBlock) => {
          if (itemBlock.kind === 'paragraph') {
            const prefix =
              item.checked === undefined ? (block.ordered ? `${block.start + itemIndex}. ` : '• ') : item.checked ? '[x] ' : '[ ] ';
            renderRichText(itemBlock.content, {
              after: 4,
              fontSize: 11,
              indent: listDepth * LIST_INDENT,
              prefix,
              quoteDepth,
            });
            return;
          }

          if (itemBlock.kind === 'list') {
            renderPdfList(itemBlock, listDepth + 1, quoteDepth);
            return;
          }

          renderPdfBlocks([itemBlock], listDepth + 1, quoteDepth);
        });
      });
    }

    function renderPdfBlocks(blocks: MarkdownBlock[], listDepth = 0, quoteDepth = 0): void {
      for (const block of blocks) {
        switch (block.kind) {
          case 'heading':
            renderRichText(block.content, {
              after: 8,
              fontSize: block.depth <= 1 ? 18 : block.depth === 2 ? 15 : 13,
              indent: listDepth * LIST_INDENT,
              style: { bold: true },
              quoteDepth,
            });
            break;
          case 'paragraph':
            renderRichText(block.content, {
              after: 6,
              fontSize: 11,
              indent: listDepth * LIST_INDENT,
              quoteDepth,
            });
            break;
          case 'list':
            renderPdfList(block, listDepth, quoteDepth);
            break;
          case 'blockquote':
            renderPdfBlocks(block.blocks, listDepth, quoteDepth + 1);
            break;
          case 'code-block':
            renderRichText(
              {
                inlines: [{ kind: 'code', text: block.text }],
                plainText: block.text,
              },
              {
                after: 8,
                fontSize: 10,
                indent: listDepth * LIST_INDENT,
                quoteDepth,
              },
            );
            break;
          case 'table':
            renderTable(block, listDepth, quoteDepth);
            break;
          case 'rule':
            ensureLineFits(12);
            pdf
              .save()
              .strokeColor('#808080')
              .lineWidth(0.75)
              .moveTo(pdf.page.margins.left + listDepth * LIST_INDENT + quoteDepth * QUOTE_INDENT, cursorY + 5)
              .lineTo(pdf.page.margins.left + contentWidth(), cursorY + 5)
              .stroke()
              .restore();
            cursorY += 12;
            break;
        }
      }
    }

    pdf.on('data', (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));

    addContentPage();

    renderRichText(document.title, { fontSize: 20, after: 12, style: { bold: true } });

    for (const entry of document.metadata) {
      renderRichText(
        combineRichText(
          { inlines: [{ kind: 'strong', children: entry.label.inlines }, { kind: 'text', text: ': ' }], plainText: `${entry.label.plainText}: ` },
          entry.value,
        ),
        { fontSize: 10, after: 4 },
      );
    }

    cursorY += 8;
    renderPdfBlocks(document.blocks);

    drawFooter();
    pdf.end();
  });
}
