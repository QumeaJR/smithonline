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

/**
 * Only these link targets are kept; anything else (javascript:, data:) is shown as plain text.
 * tour:, example: and view: are the guide's own actions, see helpActions.ts.
 */
export function safeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|#|(?:tour|example|view):)/i.test(href.trim());
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
      .replace(/^\d+\.(\s+|$)/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/**
 * A link starting at `[` in src: the label may hold code spans and escapes, the target may hold
 * balanced parentheses and no spaces. Returns null when it is not a complete link.
 */
function readLink(
  src: string,
  start: number,
): { readonly label: string; readonly href: string; readonly end: number } | null {
  let i = start + 1;
  while (i < src.length && src[i] !== ']') {
    if (src[i] === '\\') i += 2;
    else if (src[i] === '`') {
      const close = src.indexOf('`', i + 1);
      i = close > i ? close + 1 : i + 1;
    } else i += 1;
  }
  if (src[i] !== ']' || src[i + 1] !== '(' || i === start + 1) return null;
  let depth = 1;
  let j = i + 2;
  while (j < src.length && depth > 0) {
    const c = src[j] as string;
    if (/\s/.test(c)) return null;
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    j += 1;
  }
  if (depth !== 0 || j === i + 3) return null;
  return { label: src.slice(start + 1, i), href: src.slice(i + 2, j - 1), end: j };
}

/**
 * Where the closing mark of an emphasis run is: the next `open` that does not follow white space,
 * and only when the run does not start with white space (so `2 * 3 * 4` stays text).
 */
function closeOf(src: string, open: string, at: number): number {
  const from = at + open.length;
  if (from >= src.length || /\s/.test(src[from] as string)) return -1;
  // a handful of candidates is plenty; an unclosed opener must not rescan the rest of the text
  let end = src.indexOf(open, from + 1);
  for (let tries = 0; end > 0 && tries < 8; tries += 1) {
    if (!/\s/.test(src[end - 1] as string)) return end;
    end = src.indexOf(open, end + 1);
  }
  return -1;
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
      const link = readLink(src, i);
      if (link) {
        flush();
        const label = parseInline(link.label);
        if (safeHref(link.href)) out.push({ kind: 'link', href: link.href, children: label });
        else out.push(...label);
        i = link.end;
        continue;
      }
    }
    if (src.startsWith('***', i)) {
      // bold and italic together: ***text***
      const end = closeOf(src, '***', i);
      if (end > i + 3) {
        flush();
        out.push({
          kind: 'bold',
          children: [{ kind: 'italic', children: parseInline(src.slice(i + 3, end)) }],
        });
        i = end + 3;
        continue;
      }
    }
    const mark = c === '*' ? MARKS.find((k) => src.startsWith(k.open, i)) : undefined;
    if (mark) {
      const end = closeOf(src, mark.open, i);
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
  const used = new Set<string>();
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

  const text = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src; // a byte order mark hides the first heading
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
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
      // a repeated title gets -2, -3 and so on; an id another heading already took is skipped
      const base = slug(text);
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      blocks.push({
        kind: 'heading',
        level: (heading[1] as string).length,
        id,
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
