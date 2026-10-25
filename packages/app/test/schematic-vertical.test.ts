import { complex, evaluateLadder } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { Schematic, VerticalLadder } from '../src/components/Schematic';
import { startIndex } from '../src/lib/datapoints';
import { emptyDesign } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import { reportSvg, type ReportParts } from '../src/lib/report';
import { useDesignStore } from '../src/store/useDesignStore';

beforeEach(() => {
  useDesignStore.getState().init({ ...emptyDesign(), load: complex(20, -12) });
  const s = useDesignStore.getState();
  s.addElement({ kind: 'L', orientation: 'shunt', value: 16e-9 });
  s.addElement({ kind: 'C', orientation: 'series', value: 21e-12 });
  s.addDatapoint({ frequency: 2e9, z: complex(40, 10) });
  s.setStartDatapoint(1);
});

/** zustand serves its initial state to the server renderer, so the vertical drawing gets the live design as props. */
const draw = (vertical: boolean): string => {
  const d = useDesignStore.getState().design;
  const result = evaluateLadder(ladderOf(d));
  return vertical
    ? renderToStaticMarkup(
        createElement(VerticalLadder, {
          result,
          elements: d.elements,
          load: d.load,
          startNumber: startIndex(d) + 1,
          selected: null,
          onSelect: () => undefined,
        }),
      )
    : renderToStaticMarkup(createElement(Schematic, { result }));
};

describe('vertical schematic', () => {
  it('draws the load at the top, both parts, the source and the start datapoint number', () => {
    const svg = draw(true);
    expect(svg).toContain('class="schematic vertical"');
    expect(svg).toContain('>ZL<');
    // The source end carries Zin and the VSWR in two lines.
    expect(svg).toMatch(/>Zin [^<]+ Ω</);
    expect(svg).toMatch(/>VSWR [^<]+</);
    expect(svg).toContain('DP2');
    // Two element badges, a shunt branch and a rotated series symbol.
    expect(svg).toContain('>1<');
    expect(svg).toContain('>2<');
    expect(svg).toContain('rotate(90)');
  });

  it('is taller than wide and grows with the number of parts', () => {
    const height = (svg: string): number => Number(/viewBox="0 0 190 (\d+)"/.exec(svg)?.[1]);
    const two = height(draw(true));
    useDesignStore.getState().addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    expect(height(draw(true))).toBeGreaterThan(two);
    expect(two).toBe(56 * 4);
  });

  it('leaves the horizontal drawing as it was', () => {
    const svg = draw(false);
    expect(svg).toContain('class="schematic"');
    expect(svg).not.toContain('schematic vertical');
  });
});

describe('report with a vertical schematic', () => {
  it('places the piece by its own width, not by the horizontal strip height', () => {
    const parts: ReportParts = {
      title: 't',
      subtitle: 's',
      chart: null,
      schematic: { markup: '<svg viewBox="0 0 190 224"></svg>', aspect: 190 / 224, width: 190 },
      datapoints: [],
      circles: { title: 'c', header: ['a'], rows: [] },
    };
    const svg = reportSvg(parts, {
      chart: false,
      schematic: true,
      datapoints: false,
      circles: false,
    });
    // 1.5 times the natural width, 285 px, with the height following the aspect ratio.
    expect(svg).toMatch(/<svg x="[\d.]+" y="[\d.]+" width="285" height="336\.\d"/);
  });
});
