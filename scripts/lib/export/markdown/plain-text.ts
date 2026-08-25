import type { MarkdownBlock, MarkdownInline } from './types.ts';

export function inlinePlainText(inlines: MarkdownInline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
        case 'code':
          return inline.text;
        case 'break':
          return '\n';
        case 'strong':
        case 'emphasis':
        case 'deletion':
        case 'link':
          return inlinePlainText(inline.children);
      }
    })
    .join('');
}

export function blockPlainText(block: MarkdownBlock): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return block.content.plainText;
    case 'list':
      return block.items.map((item) => item.blocks.map(blockPlainText).join('\n')).join('\n');
    case 'blockquote':
      return block.blocks.map(blockPlainText).join('\n');
    case 'code-block':
      return block.text;
    case 'table':
      return [block.header, ...block.rows].map((row) => row.map((cell) => cell.plainText).join(' | ')).join('\n');
    case 'rule':
      return '';
  }
}
