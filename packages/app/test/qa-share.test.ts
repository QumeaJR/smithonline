import { describe, expect, it } from 'vitest';
import { DEFAULT_SWEEP, emptyDesign, type Design } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';

const loads = [
  { frequency: 1e8, z: { re: 100, im: 0 } },
  { frequency: 2e8, z: { re: 50, im: 50 } },
];

const twoPort = {
  s: {
    s11: { re: 0.3, im: -0.4 },
    s12: { re: 0.05, im: 0 },
    s21: { re: 2, im: 1 },
    s22: { re: 0.2, im: 0.1 },
  },
  noise: { nfMinDb: 1.2, gammaOpt: { re: 0.1, im: 0.2 }, rn: 0.16 },
  source: {
    fileName: 'amp-synthetic.s2p',
    frequency: 2.25e9,
    covers: [0.5e9, 6e9] as const,
    clamped: true,
  },
};

describe('qa: share codec with loads and a file source', () => {
  it('round-trips the datapoint sweep, its name, the device and where it came from', () => {
    const d: Design = {
      ...emptyDesign(),
      sweep: { ...DEFAULT_SWEEP, enabled: true, loads, loadsName: 'Lastz.txt' },
      twoPort,
      showStability: true,
      gainCircles: [{ type: 'unilateralLoad', gainDb: 7 }],
      noiseCircles: [2, 2.5],
    };
    const back = decodeDesign(encodeDesign(d))!;
    expect(back.sweep).toEqual(d.sweep);
    expect(back.twoPort).toEqual(twoPort);
    expect(back.showStability).toBe(true);
    expect(back.gainCircles).toEqual([{ type: 'unilateralLoad', gainDb: 7 }]);
    expect(back.noiseCircles).toEqual([2, 2.5]);
  });

  it('keeps a device without source or noise as such', () => {
    const d: Design = { ...emptyDesign(), twoPort: { s: twoPort.s, noise: null } };
    const back = decodeDesign(encodeDesign(d))!;
    expect(back.twoPort).toEqual({ s: twoPort.s, noise: null });
    expect('source' in back.twoPort!).toBe(false);
  });

  it('drops malformed loads, sources, noise and gain circles but keeps the rest', () => {
    const raw = {
      elements: [],
      sweep: {
        enabled: true,
        loads: [
          { frequency: 1e8, z: { re: 100, im: 0 } },
          { frequency: '2e8', z: { re: 50, im: 50 } },
          { frequency: 3e8, z: { re: 25 } },
          null,
        ],
        loadsName: 42,
      },
      twoPort: {
        s: twoPort.s,
        noise: { nfMinDb: 1, gammaOpt: { re: 0.1, im: 0.2 } },
        source: { fileName: 'x.s2p', frequency: 1e9, covers: [1e9] },
      },
      gainCircles: [
        { type: 'warp', gainDb: 1 },
        { type: 'operating' },
        { type: 'operating', gainDb: 9 },
      ],
    };
    const back = decodeDesign(btoa(JSON.stringify(raw)))!;
    expect(back.sweep.loads).toEqual([{ frequency: 1e8, z: { re: 100, im: 0 } }]);
    expect(back.sweep.loadsName).toBeUndefined();
    expect(back.twoPort).toEqual({ s: twoPort.s, noise: null });
    expect(back.gainCircles).toEqual([{ type: 'operating', gainDb: 9 }]);
  });

  it('leaves out an empty loads list and a device without S-parameters', () => {
    const back = decodeDesign(
      btoa(JSON.stringify({ elements: [], sweep: { loads: [] }, twoPort: { noise: null } })),
    )!;
    expect('loads' in back.sweep).toBe(false);
    expect(back.twoPort).toBeNull();
  });
});
