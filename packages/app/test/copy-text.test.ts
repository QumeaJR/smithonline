import { complex, evaluateLadder } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { ladderOf } from '../src/lib/files';
import { emptyDesign, identify } from '../src/lib/design';
import { datapointTable, tableText } from '../src/lib/report';
import { ALL_PARTS, readReportSelection } from '../src/lib/reportParts';

describe('copy datapoints as text', () => {
  const design = {
    ...emptyDesign(),
    load: complex(20, -12),
    elements: identify([{ kind: 'L', orientation: 'shunt', value: 16e-9 }]),
  };
  const result = evaluateLadder(ladderOf(design));

  it('is tab separated with one header row and one row per datapoint', () => {
    const lines = tableText(datapointTable(result)).split('\n');
    expect(lines).toHaveLength(1 + result.datapoints.length);
    expect(lines[0]!.split('\t')).toEqual(['Point', 'Z (Ω)', '|Γ|', '∠Γ', 'VSWR', 'RL (dB)', 'Q']);
    expect(lines[1]!.split('\t')[0]).toBe('DP1');
    expect(lines[2]!.split('\t')[0]).toBe('TP2');
  });

  it('numbers the transformed points after the last user datapoint and names the start', () => {
    const rows = datapointTable(result, 'Datapoints', { count: 3, slot: 2 }).rows;
    expect(rows.map((r) => r[0])).toEqual(['DP3', 'TP4']);
  });
});

describe('print selection', () => {
  it('falls back to everything when nothing is stored (or storage is unavailable)', () => {
    expect(readReportSelection()).toEqual(ALL_PARTS);
  });
});
