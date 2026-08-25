import { marked } from 'marked';
import { decodeHTML } from 'entities';
import { htmlToText } from '../../sanitize.ts';
import { inlinePlainText } from './plain-text.ts';
import type { MarkdownBlock, MarkdownInline, RichText } from './types.ts';

const options = { gfm: true, breaks: false } as const;

type GfmToken = {
  type: string;
  text?: string;
  tokens?: GfmToken[];
  depth?: number;
  href?: string;
  checked?: boolean;
  ordered?: boolean;
  start?: number | '';
  items?: GfmToken[];
  lang?: string;
  align?: Array<'left' | 'center' | 'right' | null>;
  header?: GfmToken[];
  rows?: GfmToken[][];
};

function richText(inlines: MarkdownInline[]): RichText {
  return { inlines, plainText: inlinePlainText(inlines) };
}

function plainTextInlines(text: string): MarkdownInline[] {
  const lines = text.split('\n');
  return lines.flatMap((line, index) => {
    const nodes: MarkdownInline[] = [];
    if (line) nodes.push({ kind: 'text', text: line });
    if (index < lines.length - 1) nodes.push({ kind: 'break' });
    return nodes;
  });
}

function inlineHtmlInlines(html: string): MarkdownInline[] {
  const start = '\uE000';
  const end = '\uE001';
  const text = htmlToText(`${start}${html}${end}`);
  return plainTextInlines(decodeEntities(text.startsWith(start) && text.endsWith(end) ? text.slice(start.length, -end.length) : text));
}

function decodeEntities(text: string): string {
  return decodeHTML(text)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '');
}

function parseInlineTokens(tokens: GfmToken[]): MarkdownInline[] {
  return tokens.flatMap((token): MarkdownInline[] => {
    switch (token.type) {
      case 'text':
      case 'escape': {
        const text = decodeEntities(token.text ?? '');
        return text ? [{ kind: 'text', text }] : [];
      }
      case 'strong':
        return [{ kind: 'strong', children: parseInlineTokens(token.tokens ?? []) }];
      case 'em':
        return [{ kind: 'emphasis', children: parseInlineTokens(token.tokens ?? []) }];
      case 'del':
        return [{ kind: 'deletion', children: parseInlineTokens(token.tokens ?? []) }];
      case 'codespan':
        return token.text ? [{ kind: 'code', text: token.text }] : [];
      case 'link':
      case 'autolink': {
        const href = token.href && isSafeExternalHref(token.href) ? token.href : undefined;
        return [{ kind: 'link', ...(href ? { href } : {}), children: parseInlineTokens(token.tokens ?? []) }];
      }
      case 'br':
        return [{ kind: 'break' }];
      case 'image':
        return token.tokens ? parseInlineTokens(token.tokens) : parseRichText(token.text ?? '').inlines;
      case 'html':
        return inlineHtmlInlines(token.text ?? '');
      default:
        return [];
    }
  });
}

function tokenRichText(token: GfmToken): RichText {
  const tokens = token.tokens ?? marked.Lexer.lexInline(token.text ?? '', options) as GfmToken[];
  return richText(parseInlineTokens(tokens));
}

function parseBlockToken(token: GfmToken): MarkdownBlock[] {
  switch (token.type) {
    case 'heading':
      return [{ kind: 'heading', depth: token.depth ?? 1, content: tokenRichText(token) }];
    case 'paragraph':
    case 'text':
      return [{ kind: 'paragraph', content: tokenRichText(token) }];
    case 'list':
      return [{
        kind: 'list',
        ordered: token.ordered === true,
        start: typeof token.start === 'number' ? token.start : 1,
        items: (token.items ?? []).map((item) => ({
          ...(typeof item.checked === 'boolean' ? { checked: item.checked } : {}),
          blocks: (item.tokens ?? []).flatMap(parseBlockToken),
        })),
      }];
    case 'blockquote':
      return [{ kind: 'blockquote', blocks: (token.tokens ?? []).flatMap(parseBlockToken) }];
    case 'code':
      return [{ kind: 'code-block', ...(token.lang ? { language: token.lang } : {}), text: token.text ?? '' }];
    case 'table':
      return [{
        kind: 'table',
        align: (token.align ?? []).map((alignment) => alignment ?? undefined),
        header: (token.header ?? []).map(tokenRichText),
        rows: (token.rows ?? []).map((row) => row.map(tokenRichText)),
      }];
    case 'hr':
      return [{ kind: 'rule' }];
    case 'html':
      return [{ kind: 'paragraph', content: richText(plainTextInlines(decodeEntities(htmlToText(token.text)))) }];
    case 'space':
    case 'def':
    case 'checkbox':
      return [];
    default:
      return [];
  }
}

export function parseRichText(source: string): RichText {
  return richText(parseInlineTokens(marked.Lexer.lexInline(source, options) as GfmToken[]));
}

export function parseGfmBlocks(source: string): MarkdownBlock[] {
  return (marked.lexer(source, options) as GfmToken[]).flatMap(parseBlockToken);
}

export function isSafeExternalHref(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}
