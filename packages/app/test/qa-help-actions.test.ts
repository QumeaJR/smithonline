/**
 * QA round for the guide actions and the guide itself: failure paths of runTarget
 * (the Smith V4.1 reader is replaced so it throws), the generated index, and the
 * factual claims the guide makes about the examples, checked against the stored
 * fixtures (values read from the .xmlsc files by hand).
 */
import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as designModule from '../src/lib/design';
import { emptyDesign } from '../src/lib/design';
import { EXAMPLES } from '../src/lib/examples';
import { GUIDE, GUIDE_SECTIONS, GUIDE_SOURCE, INDEX_SOURCE, INDEX_TITLE } from '../src/lib/guide';
import { parseTarget, runTarget } from '../src/lib/helpActions';
import { userDatapoints } from '../src/lib/datapoints';
import { inlineText, safeHref, type Block, type Inline } from '../src/lib/markdown';
import { TOURS } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';

/** What the stubbed designFromXmlsc does: null runs the real one. */
let failWith: unknown = null;
vi.mock('../src/lib/design', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/design')>();
  return {
    ...real,
    designFromXmlsc: (xml: string, name: string) => {
      if (failWith !== null) throw failWith;
      return real.designFromXmlsc(xml, name);
    },
  };
});

const D = () => useDesignStore.getState();

beforeEach(() => {
  failWith = null;
  D().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
  D().setView('response');
  useTourStore.getState().close();
});

describe('runTarget failure paths', () => {
  it('reports an Error from the reader by message and leaves design and view alone', () => {
    failWith = new Error('bad xml');
    const before = D().design;
    const note = runTarget({ kind: 'example', file: 'Example5.xmlsc', view: 'chart' });
    expect(note).toBe('Could not load Example5.xmlsc: bad xml');
    expect(D().design).toBe(before);
    expect(D().view).toBe('response');
    expect(D().past).toHaveLength(0);
  });

  it('reports a thrown non-Error value as its string', () => {
    failWith = 'plain string';
    expect(runTarget({ kind: 'example', file: 'Example1.xmlsc', view: null })).toBe(
      'Could not load Example1.xmlsc: plain string',
    );
  });

  it('returns null and changes nothing for an example the application does not have', () => {
    const before = D().design;
    expect(runTarget({ kind: 'example', file: 'Nope.xmlsc', view: null })).toBeNull();
    expect(D().design).toBe(before);
  });

  it('the stub is transparent when it does not throw (guards the tests above)', () => {
    expect(designModule.designFromXmlsc).toBeTypeOf('function');
    const note = runTarget({ kind: 'example', file: 'Example5.xmlsc', view: null });
    expect(note).toBe('Loaded Example 5. Undo brings your previous design back.');
    expect(D().view).toBe('chart');
    expect(D().design.name).toBe('Example 5');
  });
});

describe('runTarget success paths', () => {
  it('a view link changes only the view and returns no note', () => {
    const before = D().design;
    expect(runTarget({ kind: 'view', view: 'splot' })).toBeNull();
    expect(D().view).toBe('splot');
    expect(D().design).toBe(before);
    expect(D().past).toHaveLength(0);
  });

  it('an example load is one undo step', () => {
    runTarget({ kind: 'example', file: 'Example16.xmlsc', view: 'response' });
    expect(D().past).toHaveLength(1);
    D().undo();
    expect(D().design.name).toBe('Mine');
  });

  it('an example link without a view lands on the chart even from S-Plot', () => {
    D().setView('splot');
    runTarget({ kind: 'example', file: 'Example1.xmlsc', view: null });
    expect(D().view).toBe('chart');
  });
});

describe('parseTarget, branches not reached by help.test.ts', () => {
  it('accepts the three views and the example with each of the three views', () => {
    for (const v of ['chart', 'response', 'splot'] as const) {
      expect(parseTarget(`view:${v}`)).toEqual({ kind: 'view', view: v });
      expect(parseTarget(`example:Example1.xmlsc?view=${v}`)).toEqual({
        kind: 'example',
        file: 'Example1.xmlsc',
        view: v,
      });
    }
    expect(parseTarget('example:Example1.xmlsc')).toEqual({
      kind: 'example',
      file: 'Example1.xmlsc',
      view: null,
    });
  });

  it('refuses empty names and non-links', () => {
    for (const h of ['tour:', 'view:', 'example:', '', 'tour', 'https://x.y', '#a', 'tour:a:b']) {
      expect(parseTarget(h), h).toBeNull();
    }
  });

  it('every href safeHref lets through is either a target, a section, web, mail or a path', () => {
    // A click on an allowed-but-unknown link such as "tour:typo" or "/x" is not caught by the
    // dialog (no preventDefault), so the browser would navigate away from the application.
    for (const h of ['tour:typo', 'example:Typo.xmlsc', 'view:nope']) {
      expect(safeHref(h), h).toBe(true);
      expect(parseTarget(h), h).toBeNull();
    }
  });
});

/** Every link target in the blocks, depth first, with the inline parts of its label. */
function links(blocks: readonly Block[]): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const walk = (parts: readonly Inline[]): void => {
    for (const p of parts) {
      if (p.kind === 'link') out.push({ href: p.href, label: inlineText(p.children) });
      if (p.kind !== 'text' && p.kind !== 'code') walk(p.children);
    }
  };
  for (const b of blocks) {
    if (b.kind === 'list') b.items.forEach(walk);
    else if (b.kind === 'table') [...b.head, ...b.rows.flat()].forEach(walk);
    else walk(b.children);
  }
  return out;
}

describe('the generated index', () => {
  const at = GUIDE.findIndex((b) => b.kind === 'heading' && b.text === INDEX_TITLE);
  const tail = GUIDE.slice(at + 1);

  it('is the last section of the guide, with the tours and examples as listed', () => {
    expect(at).toBeGreaterThan(0);
    expect(GUIDE_SECTIONS.at(-1)?.text).toBe(INDEX_TITLE);
    expect(GUIDE_SECTIONS.at(-1)?.id).toBe('tour-and-example-index');
    expect(TOURS).toHaveLength(10);
    expect(EXAMPLES).toHaveLength(22);
  });

  it('has one list item per tour and per example, each a link with its title and description', () => {
    const lists = tail.filter((b) => b.kind === 'list');
    expect(lists).toHaveLength(3);
    const [tours, examples, views] = lists as Extract<Block, { kind: 'list' }>[];
    expect(tours?.items).toHaveLength(TOURS.length);
    expect(examples?.items).toHaveLength(EXAMPLES.length);
    TOURS.forEach((t, i) => {
      const item = tours?.items[i] as readonly Inline[];
      expect(item[0]).toMatchObject({ kind: 'link', href: `tour:${t.id}` });
      expect(inlineText(item), t.id).toBe(`${t.title}: ${t.blurb}`);
    });
    EXAMPLES.forEach((e, i) => {
      const item = examples?.items[i] as readonly Inline[];
      expect(item[0]).toMatchObject({ kind: 'link', href: `example:${e.file}` });
      expect(inlineText(item), e.file).toBe(`${e.title}: ${e.description}`);
    });
    expect(views?.items).toHaveLength(1);
    expect(links([views as Block]).map((l) => l.href)).toEqual([
      'view:chart',
      'view:response',
      'view:splot',
    ]);
  });

  it('example and tour titles and files are unique, so each index link is unambiguous', () => {
    expect(new Set(EXAMPLES.map((e) => e.file)).size).toBe(EXAMPLES.length);
    expect(new Set(EXAMPLES.map((e) => e.title)).size).toBe(EXAMPLES.length);
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    expect(new Set(TOURS.map((t) => t.title)).size).toBe(TOURS.length);
  });

  it('is appended after the guide with a blank line, so a file with no final newline still parses', () => {
    expect(INDEX_SOURCE.startsWith(`## ${INDEX_TITLE}\n`)).toBe(true);
    expect(GUIDE_SOURCE.includes(INDEX_TITLE)).toBe(false);
  });
});

describe('the guide text', () => {
  const all = links(GUIDE);

  it('every in-page link names a heading that exists', () => {
    const ids = new Set(GUIDE.flatMap((b) => (b.kind === 'heading' ? [b.id] : [])));
    for (const l of all.filter((x) => x.href.startsWith('#'))) {
      expect(ids.has(l.href.slice(1).replace(/^help-/, '')), l.href).toBe(true);
    }
  });

  it('the section on settings lists all ten tours by link, as it says', () => {
    const at = GUIDE.findIndex((b) => b.kind === 'heading' && b.text.startsWith('10.'));
    const end = GUIDE.findIndex((b) => b.kind === 'heading' && b.text.startsWith('11.'));
    expect(at).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(at);
    const hrefs = links(GUIDE.slice(at, end)).map((l) => l.href);
    for (const t of TOURS) expect(hrefs, t.id).toContain(`tour:${t.id}`);
  });

  it('the Try links outside the index are all resolvable and there are at least 15', () => {
    const at = GUIDE.findIndex((b) => b.kind === 'heading' && b.text === INDEX_TITLE);
    const own = links(GUIDE.slice(0, at)).filter((l) => /^(tour|example|view):/.test(l.href));
    expect(own.length).toBeGreaterThanOrEqual(15);
    for (const l of own) expect(parseTarget(l.href), l.href).not.toBeNull();
  });
});

describe('claims the guide makes about the examples, against the stored files', () => {
  const load = (file: string) => {
    const e = EXAMPLES.find((x) => x.file === file);
    if (!e) throw new Error(`missing ${file}`);
    return designModule.designFromXmlsc(e.xml, e.title);
  };

  it('Example 5: five elements, load 20 - j12 ohm at 450 MHz, one Q contour 0.6', () => {
    const d = load('Example5.xmlsc');
    expect(d.elements).toHaveLength(5);
    expect(d.load).toEqual(complex(20, -12));
    expect(d.frequency).toBe(450e6);
    expect(d.qContours).toEqual([0.6]);
  });

  it('Example 17: four elements and three user datapoints', () => {
    const d = load('Example17.xmlsc');
    expect(d.elements).toHaveLength(4);
    expect(userDatapoints(d)).toHaveLength(3);
  });

  it('Example 1: two elements; Example 7: three elements; Example 16: three elements', () => {
    expect(load('Example1.xmlsc').elements).toHaveLength(2);
    expect(load('Example7.xmlsc').elements).toHaveLength(3);
    expect(load('Example16.xmlsc').elements).toHaveLength(3);
  });

  it('Example 16: a frequency sweep from 10 MHz to 450 MHz', () => {
    const d = load('Example16.xmlsc');
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.start).toBe(10e6);
    expect(d.sweep.stop).toBe(450e6);
  });

  it('Example 1 is not the design the Realize tour starts from (the guide says the tour snaps "it")', () => {
    // Example 1 loads 10 + j7 ohm; the Realize tour starts from 20 + j30 ohm at 150 MHz.
    // The guide sentence "Example 1 is a two-element L-network to edit; the tour Realize ... snaps
    // it to E series values" therefore reads as if the tour used Example 1.
    const tour = TOURS.find((t) => t.id === 'realize');
    const start = tour?.start();
    expect(load('Example1.xmlsc').load).toEqual(complex(10, 7));
    expect(start?.load).toEqual(complex(20, 30));
  });
});
