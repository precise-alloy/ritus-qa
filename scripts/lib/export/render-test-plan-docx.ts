import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FileChild,
  Footer,
  HeadingLevel,
  LevelFormat,
  LevelSuffix,
  Packer,
  Paragraph,
  ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from 'docx';
import type { MarkdownBlock, MarkdownInline, RichText } from './markdown/types.ts';
import type { TestPlanDocument } from './types.ts';

const DOCX_MARGIN_TWIPS = 1440;
const BODY_FONT = 'Arial';
const CODE_FONT = 'Courier New';
const CODE_SHADING = { type: ShadingType.CLEAR, fill: 'F2F2F2' } as const;
const LIST_REFERENCE = 'gfm-list';
const ORDERED_LIST_REFERENCE = 'gfm-ordered-list';
const QUOTE_INDENT_TWIPS = 360;
const QUOTE_BORDER = { color: '808080', space: 6, style: BorderStyle.SINGLE, size: 12 } as const;

type ParagraphOptions = Exclude<ConstructorParameters<typeof Paragraph>[0], string>;
type TextRunOptions = Exclude<ConstructorParameters<typeof TextRun>[0], string>;
type MarkdownListBlock = Extract<MarkdownBlock, { kind: 'list' }>;

interface ListNumberingReference {
  reference: string;
  instance: number;
}

interface ListNumberingContext {
  config: Array<{ reference: string; levels: ReturnType<typeof numberingLevels> }>;
  referenceFor: (block: MarkdownListBlock, listDepth: number) => ListNumberingReference;
}

function getExportDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function createTextRun(text: string, options?: Partial<TextRunOptions>): TextRun {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: 22,
    ...options,
  });
}

function createDocxInlineChildrenWithStyle(
  inlines: MarkdownInline[],
  style: Partial<TextRunOptions>,
): ParagraphChild[] {
  return inlines.flatMap((inline): ParagraphChild[] => {
    switch (inline.kind) {
      case 'text':
        return [createTextRun(inline.text, style)];
      case 'strong':
        return createDocxInlineChildrenWithStyle(inline.children, { ...style, bold: true });
      case 'emphasis':
        return createDocxInlineChildrenWithStyle(inline.children, { ...style, italics: true });
      case 'deletion':
        return createDocxInlineChildrenWithStyle(inline.children, { ...style, strike: true });
      case 'code':
        return [createTextRun(inline.text, { ...style, font: CODE_FONT, shading: CODE_SHADING })];
      case 'link': {
        const children = createDocxInlineChildrenWithStyle(inline.children, style);
        return inline.href
          ? [
              new ExternalHyperlink({
                link: inline.href,
                children: createDocxInlineChildrenWithStyle(inline.children, {
                  ...style,
                  color: '0563C1',
                  underline: { type: UnderlineType.SINGLE },
                }),
              }),
            ]
          : children;
      }
      case 'break':
        return [createTextRun('', { ...style, break: 1 })];
    }
  });
}

function createDocxInlineChildren(inlines: MarkdownInline[]): ParagraphChild[] {
  return createDocxInlineChildrenWithStyle(inlines, {});
}

function createDocxRichParagraph(
  content: RichText,
  options?: ParagraphOptions,
  runStyle: Partial<TextRunOptions> = {},
): Paragraph {
  return new Paragraph({
    ...options,
    children: createDocxInlineChildrenWithStyle(content.inlines, runStyle),
  });
}

function quoteParagraphOptions(options: ParagraphOptions, quoteDepth: number): ParagraphOptions {
  if (quoteDepth === 0) {
    return options;
  }

  return {
    ...options,
    border: { ...options.border, left: QUOTE_BORDER },
    indent: {
      ...options.indent,
      left:
        (typeof options.indent?.left === 'number' ? options.indent.left : 0) +
        quoteDepth * QUOTE_INDENT_TWIPS,
    },
  };
}

function createMetadataTable(document: TestPlanDocument): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: document.metadata.map(
      (entry) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: createDocxInlineChildrenWithStyle(entry.label.inlines, { bold: true }),
                }),
              ],
            }),
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE },
              children: [createDocxRichParagraph(entry.value)],
            }),
          ],
        }),
    ),
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
  });
}

function headingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (Math.max(1, Math.min(6, depth))) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

function createCodeBlockParagraph(text: string, quoteDepth: number): Paragraph {
  return new Paragraph({
    ...quoteParagraphOptions(
      {
        shading: CODE_SHADING,
        spacing: { after: 120 },
      },
      quoteDepth,
    ),
    children: text.split('\n').map((line, index) =>
      createTextRun(line, {
        font: CODE_FONT,
        shading: CODE_SHADING,
        break: index === 0 ? undefined : 1,
      }),
    ),
  });
}

function createListParagraph(
  content: RichText,
  numberingReference: ListNumberingReference,
  depth: number,
  checked?: boolean,
  quoteDepth = 0,
): Paragraph {
  return new Paragraph({
    ...quoteParagraphOptions(
      {
        numbering: {
          reference: numberingReference.reference,
          level: Math.min(depth, 8),
          instance: numberingReference.instance,
        },
        indent:
          quoteDepth === 0
            ? undefined
            : { left: 720 + Math.min(depth, 8) * QUOTE_INDENT_TWIPS, hanging: 360 },
        spacing: { after: 120 },
      },
      quoteDepth,
    ),
    children: [
      ...(checked === undefined ? [] : [createTextRun(checked ? '☑ ' : '☐ ')]),
      ...createDocxInlineChildren(content.inlines),
    ],
  });
}

function tableAlignment(alignment: 'left' | 'center' | 'right' | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (alignment) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'left':
      return AlignmentType.LEFT;
    default:
      return undefined;
  }
}

function createTableCell(
  content: RichText,
  alignment: 'left' | 'center' | 'right' | undefined,
  header: boolean,
): TableCell {
  return new TableCell({
    shading: header ? { type: ShadingType.CLEAR, fill: 'D9EAD3' } : undefined,
    children: [
      new Paragraph({
        alignment: tableAlignment(alignment),
        children: header
          ? createDocxInlineChildrenWithStyle(content.inlines, { bold: true })
          : createDocxInlineChildren(content.inlines),
      }),
    ],
  });
}

function renderDocxList(
  block: MarkdownListBlock,
  listDepth: number,
  quoteDepth: number,
  numbering: ListNumberingContext,
): FileChild[] {
  const numberingReference = numbering.referenceFor(block, listDepth);

  return block.items.flatMap((item) =>
    item.blocks.flatMap((itemBlock): FileChild[] => {
      if (itemBlock.kind === 'paragraph') {
        return [createListParagraph(itemBlock.content, numberingReference, listDepth, item.checked, quoteDepth)];
      }

      if (itemBlock.kind === 'list') {
        return renderDocxList(itemBlock, listDepth + 1, quoteDepth, numbering);
      }

      return renderDocxBlocks([itemBlock], listDepth + 1, quoteDepth, numbering);
    }),
  );
}

function renderDocxBlocks(
  blocks: MarkdownBlock[],
  listDepth: number,
  quoteDepth: number,
  numbering: ListNumberingContext,
): FileChild[] {
  return blocks.flatMap((block): FileChild[] => {
    switch (block.kind) {
      case 'heading':
        return [
          createDocxRichParagraph(
            block.content,
            quoteParagraphOptions(
              {
                heading: headingLevel(block.depth),
                spacing: { before: 240, after: 120 },
              },
              quoteDepth,
            ),
          ),
        ];
      case 'paragraph':
        return [createDocxRichParagraph(block.content, quoteParagraphOptions({ spacing: { after: 120 } }, quoteDepth))];
      case 'list':
        return renderDocxList(block, listDepth, quoteDepth, numbering);
      case 'blockquote':
        return renderDocxBlocks(block.blocks, listDepth, quoteDepth + 1, numbering);
      case 'code-block':
        return [createCodeBlockParagraph(block.text, quoteDepth)];
      case 'table':
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            indent:
              quoteDepth === 0
                ? undefined
                : { size: quoteDepth * QUOTE_INDENT_TWIPS, type: WidthType.DXA },
            borders: quoteDepth === 0 ? undefined : { left: QUOTE_BORDER },
            rows: [
              new TableRow({
                children: block.header.map((cell, index) => createTableCell(cell, block.align[index], true)),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map((cell, index) => createTableCell(cell, block.align[index], false)),
                  }),
              ),
            ],
          }),
        ];
      case 'rule':
        return [
          new Paragraph({
            ...quoteParagraphOptions(
              {
                border: {
                  bottom: { color: '808080', space: 1, style: BorderStyle.SINGLE, size: 6 },
                },
                spacing: { before: 120, after: 120 },
              },
              quoteDepth,
            ),
          }),
        ];
    }
  });
}

function numberingLevels(
  format: (typeof LevelFormat)[keyof typeof LevelFormat],
  start = 1,
  startLevel = 0,
) {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format,
    start: level === startLevel ? start : 1,
    text: format === LevelFormat.BULLET ? '•' : `%${level + 1}.`,
    suffix: LevelSuffix.SPACE,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: 720 + level * 360, hanging: 360 },
      },
    },
  }));
}

function createListNumberingContext(): ListNumberingContext {
  const references = new WeakMap<MarkdownListBlock, ListNumberingReference>();
  const config = [{ reference: LIST_REFERENCE, levels: numberingLevels(LevelFormat.BULLET) }];
  let nextInstance = 1;

  return {
    config,
    referenceFor(block, listDepth) {
      if (!block.ordered) {
        return { reference: LIST_REFERENCE, instance: 0 };
      }

      const existing = references.get(block);
      if (existing) {
        return existing;
      }

      const instance = nextInstance;
      nextInstance += 1;
      const reference = `${ORDERED_LIST_REFERENCE}-${instance}`;
      const numberingReference = { reference, instance };

      references.set(block, numberingReference);
      config.push({
        reference,
        levels: numberingLevels(LevelFormat.DECIMAL, block.start, listDepth),
      });
      return numberingReference;
    },
  };
}

export async function renderTestPlanDocx(document: TestPlanDocument): Promise<Uint8Array> {
  const exportDate = getExportDate();
  const listNumbering = createListNumberingContext();
  const children: FileChild[] = [
    createDocxRichParagraph(document.title, {
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
    }, { bold: true, size: 32 }),
    createMetadataTable(document),
    ...renderDocxBlocks(document.blocks, 0, 0, listNumbering),
  ];
  const officeDocument = new Document({
    numbering: {
      config: listNumbering.config,
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: DOCX_MARGIN_TWIPS,
              right: DOCX_MARGIN_TWIPS,
              bottom: DOCX_MARGIN_TWIPS,
              left: DOCX_MARGIN_TWIPS,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [createTextRun(`${document.ticketId} • Exported ${exportDate}`, { size: 18, color: '666666' })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return await Packer.toBuffer(officeDocument);
}
