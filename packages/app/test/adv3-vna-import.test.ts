/** Adversarial tests, round 3, of the VNA CSV import in the app (commits 137ed2b, 4cf7e44, 778ad24). Each test states the correct behaviour; synthetic inputs only. */
import { describe, expect, it } from 'vitest';
import { readImportFile } from '../src/lib/import';
import { readSPlotFiles } from '../src/lib/splot';

describe('adv3 vna app: a blank # comment line', () => {
  const text = '#\n# f S11_re S11_im\n1e6 0.1 0.2\n2e6 0.2 0.1\n3e6 0.3 0\n';
  it('the rows are at 1, 2, 3 MHz, not 1e15 Hz', () => {
    const r = readImportFile('antenna.csv', text);
    expect(r.rows[0]?.frequency).toBe(1e6);
  });
  it('the load of the first row is Gamma 0.1 + j0.2 against 50 ohm, not 0.1 at 0.2 degrees', () => {
    const r = readImportFile('antenna.txt', text);
    // Z = 50 (1 + G) / (1 - G) for G = 0.1 + j0.2: 55.88 + j23.53.
    expect(r.rows[0]?.z.re).toBeCloseTo(55.882, 2);
    expect(r.rows[0]?.z.im).toBeCloseTo(23.529, 2);
  });
  it('the S-Plot entry is a VNA table in Hz', () => {
    const [p] = readSPlotFiles('antenna.csv', text);
    expect(p?.kind).toBe('vna');
    expect(p?.data.points[0]?.frequency).toBe(1e6);
  });
  it('numpy savetxt output with a trailing "# " header line opens', () => {
    expect(() =>
      readImportFile('np.csv', '# f S11_re S11_im\n# \n1e6 0.1 0.2\n2e6 0.2 0.1\n3e6 0.3 0\n'),
    ).not.toThrow();
  });
});

describe('adv3 vna app: dashed underline under the header', () => {
  it('a .csv with a dashed line under the header opens', () => {
    const r = readImportFile(
      't.csv',
      'Freq,S11 dB,S11 deg\n-------------------\n1e9,-10,45\n2e9,-20,0\n',
    );
    expect(r.rows.length).toBe(2);
  });
});

describe('adv3 vna app: one reflection written twice', () => {
  const text =
    'Frequency (Hz),Real,Imaginary,Magnitude,Phase\n1e6,0.1,0.2,0.2236,63.43\n2e6,0.2,0.1,0.2236,26.57\n';
  it('is a one-port load table, not a partial two-port with S21 = S11', () => {
    const r = readImportFile('refl.csv', text);
    expect(r.description).not.toMatch(/S21/);
    expect(r.sPlot).toBe(false);
  });
  it('the S-Plot entry has one port', () => {
    const [p] = readSPlotFiles('refl.csv', text);
    expect(p?.data.ports).toBe(1);
  });
});
