/**
 * A small Markdown reader for the user guide: headings, paragraphs, bullet and
 * numbered lists, bold, italic, inline code and links. It returns a tree that
 * React renders as elements, so no HTML string is ever built or injected.
 */

/** Text with its inline marks. */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'bold'; readonly children: readonly Inline[] }
  | { readonly kind: 'italic'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | {
      readonly kind: 'heading';
      readonly level: number;
      readonly id: string;
      readonly children: readonly Inline[];
      readonly text: string;
    }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    };

/** A heading for the table of contents. */
export interface Heading {
  readonly level: number;
  readonly id: string;
  readonly text: string;
}

/** Only these link targets are kept; anything else (javascript:, data:) is shown as plain text. */
export function safeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|#|\.{0,2}\/)/i.test(href.trim());
}

/** Plain text of a run of inline marks, for ids and the table of contents. */
export function inlineText(parts: readonly Inline[]): string {
  return parts
    .map((p) => (p.kind === 'text' || p.kind === 'code' ? p.text : inlineText(p.children)))
    .join('');
}

/** `## 3. Building the network` becomes `building-the-network`; the number is dropped. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/^\d+\.\s*/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** Marks that open and close a run, longest first so `**` wins over `*`. */
const MARKS: readonly { readonly open: string; readonly kind: 'bold' | 'italic' }[] = [
  { open: '**', kind: 'bold' },
  { open: '*', kind: 'italic' },
];

/** Read inline marks: `code`, **bold**, *italic*, [text](target). Unclosed marks stay as text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = (): void => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === '\\' && i + 1 < src.length && /[\\`*[\]()#_]/.test(src[i + 1] as string)) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const label = parseInline(m[1] as string);
        const href = m[2] as string;
        if (safeHref(href)) out.push({ kind: 'link', href, children: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }
    const mark = c === '*' ? MARKS.find((k) => src.startsWith(k.open, i)) : undefined;
    if (mark) {
      const end = src.indexOf(mark.open, i + mark.open.length);
      if (end > i + mark.open.length) {
        flush();
        out.push({
          kind: mark.kind,
          children: parseInline(src.slice(i + mark.open.length, end)),
        });
        i = end + mark.open.length;
        continue;
      }
    }
    text += c;
    i += 1;
  }
  flush();
  return out;
}

/** Read a document into blocks. Blank lines separate paragraphs; a list item may continue on indented lines. */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const endParagraph = (): void => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const endList = (): void => {
    if (list) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        items: list.items.map((t) => parseInline(t)),
      });
      list = null;
    }
  };

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) {
      endParagraph();
      endList();
    } else if (heading) {
      endParagraph();
      endList();
      const children = parseInline(heading[2] as string);
      const text = inlineText(children);
      const base = slug(text);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      blocks.push({
        kind: 'heading',
        level: (heading[1] as string).length,
        id: n === 0 ? base : `${base}-${n + 1}`,
        children,
        text,
      });
    } else if (item) {
      endParagraph();
      const ordered = item[2] !== undefined;
      if (list && list.ordered !== ordered) endList();
      list ??= { ordered, items: [] };
      list.items.push(item[3] as string);
    } else if (list && /^\s/.test(raw)) {
      // an indented line continues the item above it
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      endList();
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  endList();
  return blocks;
}

/** The headings at or above a level, in document order. */
export function headingsOf(blocks: readonly Block[], maxLevel = 2): Heading[] {
  return blocks.flatMap((b) =>
    b.kind === 'heading' && b.level <= maxLevel ? [{ level: b.level, id: b.id, text: b.text }] : [],
  );
}
