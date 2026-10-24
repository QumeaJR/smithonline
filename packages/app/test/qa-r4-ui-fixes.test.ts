import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { twinOf } from '../src/lib/datapoints';
import { emptyDesign } from '../src/lib/design';
import { GUIDE_SECTIONS } from '../src/lib/guide';
import { parseInline, type Inline } from '../src/lib/markdown';
import { useDesignStore } from '../src/store/useDesignStore';

const D = () => useDesignStore.getState();

describe('markdown: emphasis nested in emphasis of the same kind', () => {
  const text = (parts: readonly Inline[]): string =>
    parts
      .map((p) =>
        p.kind === 'text' || p.kind === 'code'
          ? p.text
          : `<${p.kind}>${text(p.children)}</${p.kind}>`,
      )
      .join('');

  it('*a *b* c* is one italic run holding another, with no stray star', () => {
    const out = parseInline('*a *b* c*');
    expect(out).toHaveLength(1);
    expect(text(out)).toBe('<italic>a <italic>b</italic> c</italic>');
  });

  it('**a **b** c** nests bold the same way', () => {
    expect(text(parseInline('**a **b** c**'))).toBe('<bold>a <bold>b</bold> c</bold>');
  });

  it('a star run after a space with nothing to close stays text', () => {
    expect(text(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(text(parseInline('*open and * never closed'))).toBe('*open and * never closed');
  });
});

describe('help links name sections the guide has', () => {
  it('the ids used by the panel headings exist', () => {
    const ids = new Set(GUIDE_SECTIONS.map((s) => s.id));
    for (const id of ['starting-a-design', 'matching', 'response-view', 'circles-and-contours']) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe('store: undo and redo say what they undo, a chart click announces its datapoint', () => {
  beforeEach(() => {
    D().init({ ...emptyDesign(), frequency: 150e6, load: complex(20, 30) });
  });

  it('addDatapoint from any caller sets the status line', () => {
    D().addDatapoint({ frequency: 150e6, z: complex(40, -10) });
    expect(D().message).toBe('Added DP2: 40.00 - j10.00 Ω at 150 MHz');
  });

  it('Undo and Redo repeat the message of the step', () => {
    D().addDatapoint({ frequency: 150e6, z: complex(40, -10) });
    D().undo();
    expect(D().message).toBe('Undo: Added DP2: 40.00 - j10.00 Ω at 150 MHz');
    D().redo();
    expect(D().message).toBe('Redo: Added DP2: 40.00 - j10.00 Ω at 150 MHz');
  });

  it('a step without a message undoes as a plain Undo', () => {
    D().setLoad(complex(30, 0));
    D().undo();
    expect(D().message).toBe('Undo');
  });

  it('twinOf finds the datapoint a chart click or the form would duplicate', () => {
    const points = [
      { frequency: 150e6, z: complex(20, 30) },
      { frequency: 150e6, z: complex(40, -10) },
    ];
    expect(twinOf(points, { frequency: 150e6, z: complex(40, -10) })).toBe(1);
    expect(twinOf(points, { frequency: 160e6, z: complex(40, -10) })).toBe(-1);
    expect(twinOf(points, { frequency: 150e6, z: complex(40, -10.001) })).toBe(-1);
  });
});
