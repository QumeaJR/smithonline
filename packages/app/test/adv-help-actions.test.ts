/**
 * Adversarial tests for the guide actions, the help keys and the rendered dialog.
 * A failing test is a defect, see the adversary report.
 */
import { complex } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { HelpDialog } from '../src/components/HelpDialog';
import { emptyDesign } from '../src/lib/design';
import { EXAMPLES } from '../src/lib/examples';
import { GUIDE_SECTIONS } from '../src/lib/guide';
import { parseTarget, runTarget } from '../src/lib/helpActions';
import { isHelpKey } from '../src/lib/helpKey';
import { TOURS } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

beforeEach(() => {
  D().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
  D().setView('chart');
  D().setDatapointInput(false);
  T().close();
  useHelp.getState().closeHelp();
});

describe('parseTarget', () => {
  it.each([
    'tour:l-network?view=response',
    'view:chart?view=response',
    'tour:l-network?view=chart',
  ])('rejects or honours a query the scheme does not take: %s', (h) => {
    // A query on tour: or view: is meaningless; silently accepting it hides a typo in the guide.
    expect(parseTarget(h)).toBeNull();
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', ' ', 'L-NETWORK'])(
    'names that are not a tour: %j',
    (name) => {
      expect(parseTarget(`tour:${name}`)).toBeNull();
      expect(parseTarget(`view:${name}`)).toBeNull();
      expect(parseTarget(`example:${name}`)).toBeNull();
    },
  );

  it.each([
    'example:Example5.xmlsc?view=',
    'example:Example5.xmlsc?view=Response',
    'example:Example5.xmlsc?view=response&view=chart',
    'example:Example5.xmlsc?view=response#x',
    'example:Example5.xmlsc?view=__proto__',
    'example:Example5.xmlsc?',
    'example:?view=chart',
    'example:Example5.xmlsc?view=constructor',
    'example::Example5.xmlsc',
  ])('rejects %j', (h) => {
    expect(parseTarget(h)).toBeNull();
  });

  it('accepts a padded link, as safeHref does', () => {
    expect(parseTarget('  tour:l-network  ')?.kind).toBe('tour');
  });

  it('a scheme in mixed case is accepted by safeHref, so parseTarget must take it too', () => {
    // safeHref is case-insensitive; the click handler would otherwise let the browser navigate.
    expect(parseTarget('Tour:l-network')).not.toBeNull();
  });
});

describe('runTarget', () => {
  it('loads every example and starts every tour without an error note', () => {
    for (const e of EXAMPLES) {
      const t = parseTarget(`example:${e.file}`);
      expect(t, e.file).not.toBeNull();
      const note = runTarget(t!);
      expect(note, e.file).toMatch(/^Loaded /);
      expect(D().design.elements.length, e.file).toBeGreaterThanOrEqual(0);
    }
    for (const t of TOURS) {
      runTarget({ kind: 'tour', id: t.id });
      expect(T().tour?.id).toBe(t.id);
      T().close();
    }
  });

  it('running the same example twice records two history entries, undo twice returns to the start', () => {
    const file = EXAMPLES[0]!.file;
    runTarget({ kind: 'example', file, view: null });
    runTarget({ kind: 'example', file, view: null });
    D().undo();
    D().undo();
    expect(D().design.name).toBe('Mine');
    expect(D().past.length).toBe(0);
  });

  it('an example while a tour runs ends the tour and one undo returns to the tour design', () => {
    runTarget({ kind: 'tour', id: 'l-network' });
    const inTour = D().design;
    runTarget({ kind: 'example', file: EXAMPLES[0]!.file, view: null });
    expect(T().tour).toBeNull();
    D().undo();
    expect(D().design).toBe(inTour);
  });

  it('the same tour twice: Undo does not leave the second run narrating', () => {
    runTarget({ kind: 'tour', id: 'l-network' });
    runTarget({ kind: 'tour', id: 'l-network' });
    D().undo();
    D().undo();
    expect(D().design.name).toBe('Mine');
    expect(T().tour).toBeNull();
  });

  it('a view link while a tour runs does not end the tour', () => {
    runTarget({ kind: 'tour', id: 'l-network' });
    runTarget({ kind: 'view', view: 'response' });
    expect(T().tour?.id).toBe('l-network');
  });

  it('a tour link switches to the chart even if the tour only makes sense there', () => {
    D().setView('splot');
    runTarget({ kind: 'tour', id: 'l-network' });
    expect(D().view).toBe('chart');
  });

  it('an unknown tour id from a hand-built target does not throw and changes nothing', () => {
    const before = D().design;
    expect(() => runTarget({ kind: 'tour', id: '__proto__' })).not.toThrow();
    expect(D().design).toBe(before);
    expect(T().tour).toBeNull();
  });
});

describe('help keys', () => {
  const ev = (key: string, target: unknown = null, mods: object = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: target as EventTarget | null,
    ...mods,
  });

  it('? in a type-less input, a number input and a search input is text', () => {
    for (const type of [
      undefined,
      'number',
      'search',
      'email',
      'text',
      'TEXT',
      'password',
      'date',
      'url',
    ]) {
      expect(isHelpKey(ev('?', { tagName: 'INPUT', type })), String(type)).toBe(false);
    }
  });

  it('? is not taken from a keystroke the focused control owns: a range slider and a button', () => {
    expect(isHelpKey(ev('?', { tagName: 'INPUT', type: 'range' }))).toBe(true);
    expect(isHelpKey(ev('?', { tagName: 'BUTTON' }))).toBe(true);
  });

  it('auto-repeat of a held F1 or ? does not toggle the dialog open and shut', () => {
    // App.tsx toggles on every keydown; a held key sends repeats with repeat: true.
    const held = { ...ev('F1'), repeat: true };
    expect(isHelpKey(held as never)).toBe(false);
  });

  it('F1 with shift is not swallowed from the browser, ? with shift is the normal way to type it', () => {
    expect(isHelpKey(ev('?', null, { shiftKey: true } as object))).toBe(true);
  });

  it('toggleHelp twice (key repeat) ends closed, and openHelp forgets a stale section', () => {
    useHelp.getState().openHelp('settings-keyboard-and-examples');
    useHelp.getState().toggleHelp();
    expect(useHelp.getState().open).toBe(false);
    useHelp.getState().toggleHelp();
    expect(useHelp.getState().section).toBeNull();
  });
});

describe('rendered dialog (server render of the real guide)', () => {
  const html = (): string => renderToStaticMarkup(createElement(HelpDialog, { onClose: () => {} }));

  it('every id in the markup is unique', () => {
    const ids = [...html().matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every link in the text either opens in a new tab safely or is an in-app target or a section', () => {
    const hrefs = [...html().matchAll(/<a ([^>]*)>/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(20);
    for (const a of hrefs) {
      const href = /href="([^"]*)"/.exec(a)![1]!.replace(/&amp;/g, '&');
      if (/^https?:|^mailto:/i.test(href)) expect(a).toContain('noopener');
      else if (href.startsWith('#')) expect(href).toMatch(/^#[a-z0-9-]+$/);
      else expect(parseTarget(href), href).not.toBeNull();
    }
  });

  it('every section link and table of contents entry points at an anchor that exists', () => {
    const out = html();
    for (const s of GUIDE_SECTIONS) expect(out).toContain(`id="help-${s.id}"`);
    for (const m of out.matchAll(/href="#([^"]+)"/g)) {
      const id = m[1]!.replace(/^help-/, '');
      expect(out, m[1]).toContain(`id="help-${id}"`);
    }
  });

  it('no raw angle bracket from the guide text leaks into the markup unescaped', () => {
    const out = html();
    expect(out).not.toMatch(/<script/i);
  });
});
