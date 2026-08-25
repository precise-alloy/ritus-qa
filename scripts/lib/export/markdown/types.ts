export interface RichText {
  inlines: MarkdownInline[];
  plainText: string;
}

export type MarkdownInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: MarkdownInline[] }
  | { kind: 'emphasis'; children: MarkdownInline[] }
  | { kind: 'deletion'; children: MarkdownInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href?: string; children: MarkdownInline[] }
  | { kind: 'break' };

export interface MarkdownListItem {
  checked?: boolean;
  blocks: MarkdownBlock[];
}

export type MarkdownBlock =
  | { kind: 'heading'; depth: number; content: RichText }
  | { kind: 'paragraph'; content: RichText }
  | { kind: 'list'; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { kind: 'blockquote'; blocks: MarkdownBlock[] }
  | { kind: 'code-block'; language?: string; text: string }
  | {
      kind: 'table';
      align: Array<'left' | 'center' | 'right' | undefined>;
      header: RichText[];
      rows: RichText[][];
    }
  | { kind: 'rule' };
