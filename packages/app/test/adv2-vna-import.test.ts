/** Adversarial tests, round 2, of the VNA CSV import in the app (commits 137ed2b and 4cf7e44). Each test states the correct behaviour. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readImportFile, readTableFile, SPlotOnlyError } from '../src/lib/import';
import { readSPlotFiles } from '../src/lib/splot';
import { hasPort, loadSPlotText, sendSweepToChart } from '../src/lib/splotActions';
import { emptyDesign } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';
import { useSPlotStore, type SPlotEntry } from '../src/store/useSPlotStore';

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

beforeEach(() => {
  useDesignStore.setState({ design: emptyDesign(), past: [], future: [], message: null });
});

describe('adv2 vna app: Touchstone text read as a VNA table', () => {
  it('"# GHz S MA R 50 ! comment" under .csv is opened as Touchstone at 1 GHz', () => {
    const f = readImportFile(
      'dut.csv',
      '# GHz S MA R 50 ! from the VNA\n1 0.5 90\n2 0.5 45\n3 0.4 30\n',
    );
    expect(f.description).toMatch(/^Touchstone text/);
    expect(f.rows[0]?.frequency).toBe(1e9);
  });

  it('the same file in the S-Plot view is Touchstone at 1 GHz', () => {
    const [p] = readSPlotFiles(
      'dut.txt',
      '# GHz S MA R 50 ! from the VNA\n1 0.5 90\n2 0.5 45\n3 0.4 30\n',
    );
    expect(p?.data.points[0]?.frequency).toBe(1e9);
  });
});

describe('adv2 vna app: S(i,j) names', () => {
  const HFSS = '"Freq [GHz]","dB(S(2,1)) []","ang_deg(S(2,1)) [deg]"\n1,20,0\n2,19,0\n3,18,0\n';

  it('an HFSS S21 export is not offered as load rows (it holds no S11)', () => {
    let rows: readonly { z: { re: number; im: number } }[];
    try {
      rows = readImportFile('hfss.csv', HFSS).rows;
    } catch (e) {
      expect(e).toBeInstanceOf(SPlotOnlyError);
      return;
    }
    // Read as S11, Gamma = 10 (the 20 dB gain) is a load of about -61 ohm.
    expect(rows.map((r) => r.z.re)).toEqual([]);
  });

  it('the HFSS S21 export in the S-Plot view has no port 1', () => {
    expect(hasPort(entryOf('hfss.csv', HFSS), 1)).toBe(false);
  });

  it('an ADS 4-parameter export in S11 S12 S21 S22 order fills the two-port panel with S21 = gain', () => {
    const header =
      'freq\tdB(S(1,1))\tphase(S(1,1))\tdB(S(1,2))\tphase(S(1,2))\tdB(S(2,1))\tphase(S(2,1))\tdB(S(2,2))\tphase(S(2,2))';
    const row = (f: number): string => `${f}\t-10\t0\t-40\t0\t20\t0\t-12\t0`;
    const f = readImportFile('amp.txt', [header, row(1e9), row(2e9), row(3e9)].join('\n'));
    expect(f.kind).toBe('twoPort');
    if (f.kind !== 'twoPort') return;
    useDesignStore.getState().setFrequency(2e9);
    useDesignStore.getState().importTwoPort(f.data, f.fileName);
    const s = useDesignStore.getState().design.twoPort?.s;
    expect(s?.s21.re).toBeCloseTo(10, 6);
    expect(s?.s12.re).toBeCloseTo(0.01, 6);
  });
});

describe('adv2 vna app: admittance read as S11', () => {
  it('an "Admittance Real, Admittance Imag" table does not give 50 ohm rows as Gamma 0.02', () => {
    let rows: readonly { z: { re: number } }[];
    try {
      rows = readImportFile(
        'y.csv',
        'Frequency,Admittance Real,Admittance Imag\n1e9,0.02,0\n2e9,0.02,0\n3e9,0.02,0\n',
      ).rows;
    } catch {
      return; // refusal is acceptable
    }
    // Y = 0.02 S is 50 ohm; Gamma 0.02 read as S11 is 52.04 ohm.
    for (const r of rows) expect(r.z.re).toBeCloseTo(50, 6);
  });
});

describe('adv2 vna app: paths that survived', () => {
  it('an S21-only table throws SPlotOnlyError and goes to the S-Plot list', () => {
    useSPlotStore.setState({ files: [] } as never);
    const text = 'Freq(Hz),S21(DB),S21(DEG)\n1e9,20,0\n2e9,19,0\n3e9,18,0\n';
    expect(() => readImportFile('s21.txt', text)).toThrow(SPlotOnlyError);
    expect(loadSPlotText('s21.txt', text)).toMatch(/2-port, 3 points/);
  });

  it('EZNEC Lastz.txt still goes to the EZNEC reader', () => {
    const lastz = readFileSync(
      join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'Lastz.txt'),
      'utf8',
    );
    expect(readTableFile('Lastz.txt', lastz).kind).toBe('eznec');
  });

  it('a 2-port Touchstone text under .txt fills the two-port panel', () => {
    const f = readImportFile(
      'amp.txt',
      '# GHz S MA R 50\n1 0.3 0 10 0 0.01 0 0.3 0\n2 0.3 0 10 0 0.01 0 0.3 0\n',
    );
    expect(f.kind).toBe('twoPort');
  });

  it('a Z-parameter Touchstone text under .csv is refused', () => {
    expect(() => readImportFile('z.csv', '# GHz Z RI R 50\n1 50 0\n2 50 0\n')).toThrow(
      /Z-parameter/,
    );
  });

  it('a descending VNA two-port follows a frequency change and undo', () => {
    const header =
      'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S22(REAL),S22(IMAG)\n';
    const text =
      header + '3e9,0.3,0,3,0,0.1,0,0.3,0\n2e9,0.2,0,2,0,0.1,0,0.2,0\n1e9,0.1,0,1,0,0.1,0,0.1,0\n';
    const f = readImportFile('desc.csv', text);
    if (f.kind !== 'twoPort') throw new Error('expected a two-port');
    const st = useDesignStore.getState();
    st.setFrequency(1e9);
    st.importTwoPort(f.data, f.fileName);
    useDesignStore.getState().setFrequency(3e9);
    expect(useDesignStore.getState().design.twoPort?.s.s21.re).toBeCloseTo(3, 9);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.twoPort?.s.s21.re).toBeCloseTo(1, 9);
  });

  it('a sweep from an ideal open (S11 = 1) gives finite loads that survive a share link', () => {
    const e = entryOf('open.csv', 'Freq(Hz),S11(MAG),S11(DEG)\n1e6,1,0\n2e6,1,-10\n3e6,1,-20\n');
    sendSweepToChart(e, 1);
    const d = useDesignStore.getState().design;
    expect(d.sweep.loads?.length).toBe(3);
    const back = decodeDesign(encodeDesign(d));
    expect(back?.sweep.loads?.length).toBe(3);
  });
});
