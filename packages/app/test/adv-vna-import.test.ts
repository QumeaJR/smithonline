/** Adversarial tests of the VNA CSV import in the app (commit 137ed2b). Each test states the correct behaviour. */
import { describe, expect, it, beforeEach } from 'vitest';
import { readImportFile } from '../src/lib/import';
import { readSPlotFiles, analysisOf } from '../src/lib/splot';
import {
  exportTouchstoneText,
  fillDeviceFromFile,
  hasPort,
  sendLoadToChart,
  sendSweepToChart,
} from '../src/lib/splotActions';
import { PolarLocus } from '../src/splot/Locus';
import { emptyDesign } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';
import type { SPlotEntry } from '../src/store/useSPlotStore';

const entryOf = (fileName: string, text: string): SPlotEntry => {
  const [p] = readSPlotFiles(fileName, text);
  return {
    ...p!,
    id: `${fileName}#1`,
    original: p!.data,
    visible: true,
    color: '#000',
    unit: p!.data.frequencyUnit,
  };
};
const finite = (c: { re: number; im: number }): boolean =>
  Number.isFinite(c.re) && Number.isFinite(c.im);

const FULL_HEADER =
  'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S22(REAL),S22(IMAG)\n';

beforeEach(() => {
  useDesignStore.setState({ design: emptyDesign(), past: [], future: [], message: null });
});

describe('adv vna app: NaN reaching the design store', () => {
  const HUGE =
    'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG)\n1e9,1e200,0,0.5,0\n2e9,0.1,0,0.5,0\n3e9,0.2,0,0.5,0\n';

  it('import dialog rows of a huge-Gamma file are finite', () => {
    const f = readImportFile('huge.csv', HUGE);
    for (const r of f.rows) expect(finite(r.z)).toBe(true);
  });

  it('S-Plot "Send s11 to chart" does not put a NaN load into the store', () => {
    const e = entryOf('huge.csv', HUGE);
    expect(hasPort(e, 1)).toBe(true);
    sendLoadToChart(e, 1, 1e9);
    const load = useDesignStore.getState().design.load;
    expect(finite(load)).toBe(true);
  });

  it('S-Plot "Sweep s11" does not put NaN sweep loads into the store', () => {
    const e = entryOf('huge.csv', HUGE);
    sendSweepToChart(e, 1);
    const d = useDesignStore.getState().design;
    for (const l of d.sweep.loads ?? []) expect(finite(l.z)).toBe(true);
    // The share link must carry what the user sees.
    const back = decodeDesign(encodeDesign(d));
    expect(back?.sweep.loads?.length).toBe(d.sweep.loads?.length);
  });

  it('a dB value that overflows does not reach the dialog rows', () => {
    const f = readImportFile(
      'db.csv',
      'Freq(Hz),S11(DB),S11(DEG)\n1e9,7000,0\n2e9,-10,0\n3e9,-12,0\n',
    );
    for (const r of f.rows) expect(finite(r.z)).toBe(true);
  });
});

describe('adv vna app: frequency order and the two-port panel', () => {
  it('a descending 4-parameter CSV fills the two-port panel with the right S11 at the design frequency', () => {
    const text =
      FULL_HEADER +
      '3e9,0.3,0,1,0,0.1,0,0.3,0\n2e9,0.2,0,1,0,0.1,0,0.2,0\n1e9,0.1,0,1,0,0.1,0,0.1,0\n';
    const f = readImportFile('desc.csv', text);
    expect(f.kind).toBe('twoPort');
    useDesignStore.getState().setFrequency(1.5e9);
    if (f.kind === 'twoPort') useDesignStore.getState().importTwoPort(f.data, f.fileName);
    const st = useDesignStore.getState();
    expect(st.message).toBe('Device filled from desc.csv');
    expect(st.design.twoPort?.s.s11.re).toBeCloseTo(0.15, 9);
  });

  it('S-Plot "Use as device" on an unsorted file gives the interpolated S11', () => {
    const text =
      FULL_HEADER +
      '1e9,0.1,0,1,0,0.1,0,0.1,0\n3e9,0.3,0,1,0,0.1,0,0.3,0\n2e9,0.9,0,1,0,0.1,0,0.2,0\n';
    useDesignStore.getState().setFrequency(2.5e9);
    fillDeviceFromFile(entryOf('unsorted.csv', text));
    expect(useDesignStore.getState().design.twoPort?.s.s11.re).toBeCloseTo(0.6, 9);
  });
});

describe('adv vna app: Touchstone saved as .txt', () => {
  it('a .txt Touchstone 1-port "# MHz S MA R 50" gives rows at 100 MHz with |Gamma| 0.5', () => {
    const f = readImportFile('dut.txt', '# MHz S MA R 50\n100 0.5 90\n200 0.5 45\n');
    expect(f.rows[0]?.frequency).toBe(100e6);
  });
});

describe('adv vna app: S-Plot export and graphs', () => {
  // Decision (round 1): a Touchstone file needs every S-parameter, so the export is refused with the
  // missing terms named and the button is disabled, instead of writing NaN.
  it('an S11+S21 CSV is refused for Touchstone export with the missing terms named', () => {
    const e = entryOf(
      'amp.csv',
      'Freq(Hz),S11(DB),S11(DEG),S21(DB),S21(DEG)\n1e9,-20,0,10,90\n2e9,-18,10,9,80\n',
    );
    expect(() =>
      exportTouchstoneText(e, { parameter: 'S', normalized: false, format: 'DB', unit: 'GHZ' }),
    ).toThrow('the file has no s12 and s22, and a Touchstone file needs every S-parameter');
  });

  it('the polar locus renders a 70k-point S21+S12 file', () => {
    const rows = ['Freq(Hz),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S11(REAL),S11(IMAG)'];
    for (let i = 1; i <= 70_000; i++) rows.push(`${i * 1e5},0.5,0.1,0.01,0,0.1,0`);
    const e = entryOf('big.csv', rows.join('\n'));
    const files = [{ entry: e, analysis: analysisOf(e.data) }];
    expect(() =>
      PolarLocus({
        files,
        traces: { s11: true, s21: true, s12: true, s22: true },
        selected: null,
        cursor: null,
      }),
    ).not.toThrow();
  });
});

describe('adv vna app: NaN past the store guard', () => {
  const HUGE =
    'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG)\n1e9,1e200,0,0.5,0\n2e9,0.1,0,0.5,0\n3e9,0.2,0,0.5,0\n';

  it('Sweep s11 with DP1 on a finite row keeps NaN sweep loads out of the store', () => {
    useDesignStore.getState().setFrequency(2e9);
    sendSweepToChart(entryOf('huge.csv', HUGE), 1);
    const d = useDesignStore.getState().design;
    expect(d.sweep.enabled).toBe(true);
    for (const l of d.sweep.loads ?? []) expect(finite(l.z)).toBe(true);
  });

  it('a file at Z0 75 with a huge S11 does not put a NaN two-port into the store', () => {
    const text =
      '! Z0 = 75\n' +
      FULL_HEADER +
      '1e9,1e200,0,1,0,0.1,0,0.1,0\n2e9,0.2,0,1,0,0.1,0,0.1,0\n3e9,0.3,0,1,0,0.1,0,0.1,0\n';
    const f = readImportFile('z75.csv', text);
    if (f.kind === 'twoPort') useDesignStore.getState().importTwoPort(f.data, f.fileName);
    const tp = useDesignStore.getState().design.twoPort;
    if (tp) expect(finite(tp.s.s11)).toBe(true);
  });
});
