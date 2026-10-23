/**
 * Round 2 adversarial tests for the rendered guide, the generated index and the guide actions.
 * A failing test is a defect, see the adversary report.
 */
import { complex } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { HelpDialog } from '../src/components/HelpDialog';
import { emptyDesign } from '../src/lib/design';
import { EXAMPLES } from '../src/lib/examples';
import { GUIDE, INDEX_SOURCE } from '../src/lib/guide';
import { parseTarget, runTarget } from '../src/lib/helpActions';
import { inlineText, parseInline, parseMarkdown } from '../src/lib/markdown';
import { TOURS } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();

beforeEach(() => {
  D().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
  D().setView('chart');
  useTourStore.getState().close();
  useHelp.getState().closeHelp();
});

const html = (): string => renderToStaticMarkup(createElement(HelpDialog, { onClose: () => {} }));

describe('the generated index', () => {
  it('every tour and example title and text survives the Markdown round trip', () => {
    const blocks = parseMarkdown(INDEX_SOURCE);
    const lists = blocks.flatMap((b) => (b.kind === 'list' ? b.items : []));
    const entries = [
      ...TOURS.map((t) => ({ title: t.title, rest: t.blurb, href: `tour:${t.id}` })),
      ...EXAMPLES.map((e) => ({ title: e.title, rest: e.description, href: `example:${e.file}` })),
    ];
    for (const e of entries) {
      const item = lists.find((l) => l[0]?.kind === 'link' && l[0].href === e.href);
      expect(item, `${e.href} has no link item`).toBeDefined();
      const text = inlineText(item ?? []);
      expect(text, e.href).toBe(`${e.title}: ${e.rest}`);
    }
  });
  it('titles and blurbs carry no Markdown specials', () => {
    const special = /[*`[\]\\]/;
    for (const t of TOURS) {
      expect(t.title, t.id).not.toMatch(special);
      expect(t.blurb, t.id).not.toMatch(special);
    }
    for (const e of EXAMPLES) {
      expect(e.title, e.file).not.toMatch(special);
      expect(e.description, e.file).not.toMatch(special);
    }
  });
});

describe('the rendered dialog', () => {
  it('has no duplicate element ids', () => {
    const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, ids.filter((x, i) => ids.indexOf(x) !== i).join(',')).toBe(
      ids.length,
    );
  });
  it('every href is https, mailto, #section that exists, or a guide target that resolves', () => {
    const out = html();
    const ids = new Set([...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const hrefs = [...out.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) =>
      (m[1] as string).replace(/&amp;/g, '&'),
    );
    expect(hrefs.length).toBeGreaterThan(40);
    for (const h of hrefs) {
      if (/^https?:|^mailto:/.test(h)) continue;
      if (h.startsWith('#')) expect(ids.has(`help-${h.slice(1)}`), h).toBe(true);
      else expect(parseTarget(h), h).not.toBeNull();
    }
  });
  it('every external link opens with noopener', () => {
    for (const m of html().matchAll(/<a [^>]*href="https?:[^>]*>/g))
      expect(m[0]).toContain('noopener');
  });
  it('no link renders an unsafe scheme', () => {
    expect(html()).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
  });
  it('every guide link has non-empty visible text', () => {
    for (const m of html().matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)) {
      expect((m[1] as string).replace(/<[^>]+>/g, '').trim(), m[0]).not.toBe('');
    }
  });
  it('the table of contents buttons all have a heading to jump to', () => {
    const out = html();
    const toc = [...out.matchAll(/class="help-toc-item[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(toc.length).toBeGreaterThan(10);
    for (const h of GUIDE.flatMap((b) => (b.kind === 'heading' && b.level === 2 ? [b] : []))) {
      expect(out).toContain(`id="help-${h.id}"`);
    }
  });
});

describe('runTarget', () => {
  it('every example in the guide loads, is one undo step, and undo brings the design back', () => {
    for (const e of EXAMPLES) {
      D().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
      const t = performance.now();
      const msg = runTarget({ kind: 'example', file: e.file, view: null });
      expect(msg, e.file).toMatch(/^Loaded /);
      expect(D().design.name, e.file).toBe(e.title);
      D().undo();
      expect(D().design.name, e.file).toBe('Mine');
      expect(D().design.load.re, e.file).toBe(77);
      expect(performance.now() - t).toBeLessThan(1000);
    }
  });
  it('an example with ?view lands on that view, one without lands on the chart', () => {
    D().setView('splot');
    runTarget({ kind: 'example', file: 'Example5.xmlsc', view: null });
    expect(D().view).toBe('chart');
    runTarget({ kind: 'example', file: 'Example16.xmlsc', view: 'response' });
    expect(D().view).toBe('response');
  });
  it('an example link ends a running tour', () => {
    useTourStore.getState().start('l-network');
    expect(useTourStore.getState().tour).not.toBeNull();
    runTarget({ kind: 'example', file: 'Example5.xmlsc', view: null });
    expect(useTourStore.getState().tour).toBeNull();
  });
  it('a view link keeps the design and the undo history', () => {
    const before = D().design;
    const hist = D().past.length;
    runTarget({ kind: 'view', view: 'splot' });
    expect(D().design).toBe(before);
    expect(D().past.length).toBe(hist);
  });
  it('the same example twice is two undo steps, and the second undo returns to the first load', () => {
    runTarget({ kind: 'example', file: 'Example5.xmlsc', view: null });
    runTarget({ kind: 'example', file: 'Example5.xmlsc', view: null });
    D().undo();
    expect(D().design.name).toBe(EXAMPLES.find((e) => e.file === 'Example5.xmlsc')?.title);
    D().undo();
    expect(D().design.name).toBe('Mine');
  });
  it('a tour link while an example sits on a view puts the chart up', () => {
    D().setView('response');
    runTarget({ kind: 'tour', id: 'l-network' });
    expect(D().view).toBe('chart');
  });
  it('a tour started twice in a row keeps the first origin undoable', () => {
    runTarget({ kind: 'tour', id: 'l-network' });
    runTarget({ kind: 'tour', id: 'pi-t' });
    D().undo();
    D().undo();
    expect(D().design.name).toBe('Mine');
  });
});

describe('parseTarget corners', () => {
  it.each([
    'EXAMPLE:Example5.xmlsc?view=response',
    'Tour:l-network',
    ' view:chart ',
    'example:Example5.xmlsc?view=response',
  ])('accepts %j', (h) => {
    expect(parseTarget(h)).not.toBeNull();
  });
  it.each([
    'tour:l-network%20',
    'tour:l-network;',
    'view:chart\u0000',
    'example:example5.xmlsc',
    'view:CHART',
  ])('rejects %j', (h) => {
    expect(parseTarget(h)).toBeNull();
  });
  it('parseInline of a guide-style link with a query keeps the whole target', () => {
    const r = parseInline('[x](example:Example16.xmlsc?view=response)');
    expect(r[0]?.kind === 'link' && r[0].href).toBe('example:Example16.xmlsc?view=response');
  });
});
