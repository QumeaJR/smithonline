/**
 * Guided tours: short lessons that build a design step by step.
 *
 * A tour is a start design plus a list of steps. Each step is a pure function
 * from the current design to the next one (what pressing Next does) and a
 * narration computed from the design the step produced. Nothing narrated is
 * typed in: every number comes from the same evaluation the chart uses, so an
 * edit to the start values changes the story with it.
 *
 * The tour store records the start design once and then swaps designs without
 * history entries, so a whole tour is one undo. The three lessons here are the
 * basics; toursAdvanced.ts has the ones on bandwidth, building and devices.
 */
import {
  cabs,
  chartDistance,
  complex,
  gammaToZ,
  gmaxDb,
  isShunt,
  lengthFromWavelengths,
  linearToDb,
  msg,
  mag,
  noiseFigureDb,
  sourceStabilityCircle,
  stubAdmittance,
  stability,
  zToGamma,
  type Complex,
  type SParameters,
} from '@smithonline/core';
import { targetOf, type TwoPort } from './design';
import { fmtComplex, fmtNum } from './format';
import {
  addElement,
  closingLPart,
  deg,
  edited,
  enableSweep,
  evaluate,
  firstLPart,
  hz,
  mS,
  ohm,
  partText,
  reactanceOf,
  signed,
  startDesign,
  val,
  bandwidthText,
  type Tour,
} from './tourKit';
import { ADVANCED_TOURS } from './toursAdvanced';

export { firstLPart, closingLPart } from './tourKit';
export type { Tour, TourStep } from './tourKit';

const lNetwork: Tour = {
  id: 'l-network',
  title: 'L-network match',
  blurb: 'Two parts, one series and one shunt, take 20 + j30 ohm to 50 ohm.',
  start: () => startDesign('L-network match', { frequency: 150e6, load: complex(20, 30) }),
  steps: [
    {
      title: 'The problem',
      apply: (d) => d,
      narrate: (d) => {
        const info = evaluate(d).info[0];
        if (!info) return edited();
        return [
          `The load ZL = ${ohm(d.load)} at ${hz(d.frequency)} is point DP1, in a ${d.z0} Ω system. Its reflection coefficient is |Γ| = ${fmtNum(info.gammaMag, 3)} at ${fmtNum(info.gammaAngleDeg, 1)} degrees: VSWR ${fmtNum(info.vswr, 2)}, return loss ${fmtNum(info.returnLossDb, 1)} dB.`,
          `The goal is the centre of the chart, where Zin = ${d.z0} Ω and nothing is reflected. An L-network gets there with two parts, one in series and one in shunt.`,
          `A series part moves the point along a circle of constant resistance (the Z grid). A shunt part moves it along a circle of constant conductance (the Y grid). So the series part has to bring the point onto the one conductance circle that passes through the centre, the circle where Re(Y) = 1/Z0 = ${fmtNum(1000 / d.z0, 1)} mS.`,
        ];
      },
    },
    {
      title: 'Series part: onto the centre circle',
      apply: (d) => {
        const part = firstLPart(d, 'series');
        return part ? addElement(d, part) : d;
      },
      narrate: (d) => {
        const r = evaluate(d);
        const e0 = d.elements[0];
        const x = reactanceOf(e0, d.frequency);
        const z1 = r.datapoints[1];
        const info = r.info[1];
        if (d.elements.length !== 1 || !e0 || !z1 || !info || Number.isNaN(x)) return edited();
        const R = d.load.re;
        const root = Math.sqrt(Math.max(R * (d.z0 - R), 0));
        const roots = [-d.load.im + root, -d.load.im - root];
        const other = roots.find((v) => Math.abs(v - x) > 1e-6 * Math.max(Math.abs(x), 1)) ?? x;
        return [
          `Added ${partText(e0, d.frequency)}. It moves the point along the R = ${fmtNum(R, 1)} Ω circle from ${ohm(d.load)} to ${ohm(z1)} (TP2).`,
          `The value is not a guess. For the admittance to have Re(Y) = 1/Z0, the series reactance must be X = -Xload ± √(R (Z0 - R)) = ${signed(-d.load.im)} ± ${root.toFixed(1)} Ω, which gives ${signed(roots[0] ?? 0)} Ω or ${signed(roots[1] ?? 0)} Ω. This tour takes ${signed(x)} Ω, the shorter way along the circle. The other root ends at ${ohm(complex(R, d.load.im + other))}.`,
          `At TP2 the admittance is ${mS(info.y)}. Its real part, ${fmtNum(info.y.re * 1e3, 1)} mS, is 1/Z0, so the point is on the circle through the centre. Only a susceptance is left to cancel.`,
        ];
      },
    },
    {
      title: 'Shunt part: along the circle to the centre',
      apply: (d) => {
        const part = closingLPart(d);
        return part ? addElement(d, part) : d;
      },
      narrate: (d) => {
        const r = evaluate(d);
        const e1 = d.elements[1];
        const before = r.info[1];
        const after = r.info[2];
        if (d.elements.length !== 2 || !e1 || !before || !after) return edited();
        return [
          `Added ${partText(e1, d.frequency)}. A shunt part adds susceptance, so the point slides along the conductance circle. It adds ${signed(reactanceOf(e1, d.frequency) * 1e3)} mS, which cancels the ${signed(before.y.im * 1e3)} mS left at TP2.`,
          `The network now presents Zin = ${ohm(r.zin, 2)}: |Γ| = ${fmtNum(after.gammaMag, 4)}, VSWR ${fmtNum(after.vswr, 3)}.`,
          `This is exact at ${hz(d.frequency)} only. Away from it every reactance changes, and the point leaves the centre.`,
        ];
      },
    },
    {
      title: 'How wide is the match?',
      apply: enableSweep,
      narrate: (d) => {
        const r = evaluate(d);
        return [
          `The sweep from ${hz(d.sweep.start)} to ${hz(d.sweep.stop)} is now drawn on the chart. It crosses the centre at ${hz(d.frequency)} and opens up on both sides.`,
          bandwidthText(d),
          `The loaded Q of the path is ${fmtNum(r.loadedQ, 2)}, the highest |X|/R the point passes through. An L-network leaves no free part to lower it. Auto match offers Pi and T networks at a Q you choose, and the Response tab shows the VSWR curve with this band shaded.`,
          'Undo takes the whole tour back out in one step.',
        ];
      },
    },
  ],
};

/* ---------------------------------------------------- tour 2: single stub */

/** The shortest line, from the point at `zin` towards the source, that puts Re(Y) at 1/Z0. */
export function stubLineLength(zin: Complex, z0: number): number | null {
  const r = zin.re;
  const x = zin.im;
  if (!(r > 0) || !(z0 > 0)) return null;
  const candidates: number[] = [];
  if (Math.abs(r - z0) < 1e-9 * z0) {
    // tan = -x / (2 Z0), and the quarter wave (tan infinite) is the other root.
    candidates.push(-x / (2 * z0), Infinity);
  } else {
    const root = Math.sqrt((r * ((z0 - r) ** 2 + x ** 2)) / z0);
    candidates.push((x + root) / (r - z0), (x - root) / (r - z0));
  }
  const lengths = candidates
    .map((t) => {
      const theta = Math.atan(t);
      return (theta < 0 ? theta + Math.PI : theta) / (2 * Math.PI);
    })
    .filter((l) => Number.isFinite(l) && l > 1e-9);
  return lengths.length > 0 ? Math.min(...lengths) : null;
}

/** The stub that cancels the susceptance of the point at `zin`, open or shorted, in wavelengths. */
export function stubLength(
  zin: Complex,
  z0: number,
  kind: 'openStub' | 'shortStub',
): number | null {
  // Normalized admittance y = 1 / z; the stub must add -Im(y).
  const denom = zin.re ** 2 + zin.im ** 2;
  const s = -((-zin.im / denom) * z0);
  if (!Number.isFinite(s) || Math.abs(s) < 1e-12) return null;
  const theta = Math.atan(kind === 'openStub' ? s : -1 / s);
  return (theta < 0 ? theta + Math.PI : theta) / (2 * Math.PI);
}

const singleStub: Tour = {
  id: 'single-stub',
  title: 'Single stub match',
  blurb: 'A line and a stub take 120 + j70 ohm to 50 ohm at 1 GHz.',
  start: () => startDesign('single stub match', { frequency: 1e9, load: complex(120, 70) }),
  steps: [
    {
      title: 'The problem',
      apply: (d) => d,
      narrate: (d) => {
        const info = evaluate(d).info[0];
        if (!info) return edited();
        return [
          `The load ZL = ${ohm(d.load)} at ${hz(d.frequency)} is point DP1: |Γ| = ${fmtNum(info.gammaMag, 3)}, VSWR ${fmtNum(info.vswr, 2)}.`,
          'A single stub tuner needs two parts: a series line and a shunt stub. At microwave frequencies they are cut from the same track as everything else.',
          `The line moves the point clockwise around the centre, towards the source, at constant |Γ| = ${fmtNum(info.gammaMag, 3)}, until it meets the circle where Re(Y) = 1/Z0 = ${fmtNum(1000 / d.z0, 1)} mS. There the admittance is 1 + jb in units of 1/Z0. The stub then adds exactly -jb.`,
        ];
      },
    },
    {
      title: 'Line: round to the centre circle',
      apply: (d) => {
        const l = stubLineLength(d.load, d.z0);
        if (l === null) return d;
        return addElement(d, {
          kind: 'line',
          z0: d.z0,
          length: l,
          refFrequency: d.frequency,
          er: 1,
          alphaDbPerM: 0,
        });
      },
      narrate: (d) => {
        const r = evaluate(d);
        const e0 = d.elements[0];
        const before = r.info[0];
        const after = r.info[1];
        if (d.elements.length !== 1 || !e0 || e0.kind !== 'line' || !before || !after)
          return edited();
        const yn = complex(after.y.re * d.z0, after.y.im * d.z0);
        const air = lengthFromWavelengths(e0.length, d.frequency, 1);
        return [
          `Added ${partText(e0, d.frequency)}. The point moves from ${ohm(d.load)} to ${ohm(after.z)} (TP2). |Γ| stays ${fmtNum(before.gammaMag, 3)} before and ${fmtNum(after.gammaMag, 3)} after: a lossless line only rotates the point.`,
          `The line length is where Re(Y) reaches 1/Z0: the normalized admittance is now ${fmtComplex(yn, 3)}, so the real part is 1 and ${signed(yn.im, 3)} is the susceptance left to cancel. A second, longer line length also reaches the circle, from the other side, and gives the stub the opposite sign.`,
          `In air this line is ${val(air, 'm')} long. On a board, the Dimensions button on the line card gives the track width and physical length for your substrate.`,
        ];
      },
    },
    {
      title: 'Stub: cancel the susceptance',
      apply: (d) => {
        const zin = evaluate(d).zin;
        const open = stubLength(zin, d.z0, 'openStub');
        const short = stubLength(zin, d.z0, 'shortStub');
        if (open === null || short === null) return d;
        // An open and a shorted stub differ by a quarter wave; take the shorter of the two.
        const kind = open <= short ? 'openStub' : 'shortStub';
        return addElement(d, {
          kind,
          z0: d.z0,
          length: Math.min(open, short),
          refFrequency: d.frequency,
        });
      },
      narrate: (d) => {
        const r = evaluate(d);
        const stub = d.elements[1];
        const before = r.info[1];
        const after = r.info[2];
        if (
          d.elements.length !== 2 ||
          !stub ||
          (stub.kind !== 'openStub' && stub.kind !== 'shortStub') ||
          !before ||
          !after
        ) {
          return edited();
        }
        const added = stubAdmittance(stub, d.frequency).im;
        const open = stub.kind === 'openStub';
        const other = stubLength(before.z, d.z0, open ? 'shortStub' : 'openStub');
        return [
          `Added ${partText(stub, d.frequency)}. ${open ? 'An open stub is a pure susceptance of +j tan(βl) / Z0' : 'A shorted stub is a pure susceptance of -j cot(βl) / Z0'} = ${signed(added * 1e3)} mS at this length, which cancels the ${signed(before.y.im * 1e3)} mS at TP2. The point slides along the conductance circle to the centre.`,
          `The network now presents Zin = ${ohm(r.zin, 2)}, VSWR ${fmtNum(after.vswr, 3)}.`,
          other === null
            ? 'The other kind of stub would need no length here.'
            : `${open ? 'A shorted' : 'An open'} stub does the same job at ${other.toFixed(4)} wavelengths (${(other * 360).toFixed(1)} degrees); this tour takes the shorter one. Open stubs are easier on a board, shorted stubs need a via.`,
        ];
      },
    },
    {
      title: 'How wide is the match?',
      apply: enableSweep,
      narrate: (d) => [
        `The sweep from ${hz(d.sweep.start)} to ${hz(d.sweep.stop)} is drawn on the chart.`,
        bandwidthText(d),
        'A line and a stub keep their physical length, so their electrical length follows the frequency. The Response tab shows the VSWR curve with the usable band shaded.',
        'Undo takes the whole tour back out in one step.',
      ],
    },
  ],
};

/* ----------------------------------------------------------- tour 3: LNA */

/** An illustrative device, built for the tour: not the data of a real part. */
const LNA_S = (() => {
  const p = (m: number, a: number): Complex =>
    complex(m * Math.cos((a * Math.PI) / 180), m * Math.sin((a * Math.PI) / 180));
  const s: SParameters = {
    s11: p(0.72, -98),
    s12: p(0.07, 58),
    s21: p(4.6, 92),
    s22: p(0.38, -42),
  };
  return s;
})();

const LNA_TWO_PORT: TwoPort = {
  s: LNA_S,
  noise: {
    nfMinDb: 0.85,
    gammaOpt: complex(
      0.42 * Math.cos((148 * Math.PI) / 180),
      0.42 * Math.sin((148 * Math.PI) / 180),
    ),
    rn: 0.22,
  },
};

/**
 * Available power gain of the device for a source reflection coefficient,
 * linear. NaN when the source makes the device oscillate (|Gamma out| of 1
 * or more), where the available gain is not defined.
 */
export function availableGain(s: SParameters, gammaSource: Complex): number {
  const num = cabs(s.s21) ** 2 * (1 - cabs(gammaSource) ** 2);
  const one = complex(
    1 - (s.s11.re * gammaSource.re - s.s11.im * gammaSource.im),
    -(s.s11.re * gammaSource.im + s.s11.im * gammaSource.re),
  );
  // Gamma_out = S22 + S12 S21 Gs / (1 - S11 Gs)
  const k = complex(
    s.s12.re * s.s21.re - s.s12.im * s.s21.im,
    s.s12.re * s.s21.im + s.s12.im * s.s21.re,
  );
  const kg = complex(
    k.re * gammaSource.re - k.im * gammaSource.im,
    k.re * gammaSource.im + k.im * gammaSource.re,
  );
  const oneMag2 = one.re ** 2 + one.im ** 2;
  const gout = complex(
    s.s22.re + (kg.re * one.re + kg.im * one.im) / oneMag2,
    s.s22.im + (kg.im * one.re - kg.re * one.im) / oneMag2,
  );
  const denom = oneMag2 * (1 - cabs(gout) ** 2);
  return denom > 0 ? num / denom : NaN;
}

function polar(z: Complex): string {
  return `${fmtNum(cabs(z), 3)} at ${fmtNum(deg(Math.atan2(z.im, z.re)), 1)} degrees`;
}

function round(v: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

const lna: Tour = {
  id: 'lna-input',
  title: 'LNA input match with circles',
  blurb:
    'Match a 50 ohm source to the noise-optimal impedance of a transistor, with stability, noise and gain circles.',
  start: () =>
    startDesign('LNA input match', {
      frequency: 1.575e9,
      load: complex(50, 0),
      twoPort: LNA_TWO_PORT,
    }),
  steps: [
    {
      title: 'The device and the goal',
      apply: (d) => d,
      narrate: (d) => {
        const s = d.twoPort?.s;
        if (!s) return edited();
        const st = stability(s);
        const gain = Number.isNaN(mag(s))
          ? `K < 1, so MAG does not exist and the best you can quote is MSG = ${fmtNum(linearToDb(msg(s)), 1)} dB`
          : `MAG = ${fmtNum(gmaxDb(s), 1)} dB`;
        return [
          `An illustrative transistor at ${hz(d.frequency)} (made-up values for this tour, not a datasheet part): S11 = ${polar(s.s11)}, S21 = ${polar(s.s21)}, S12 = ${polar(s.s12)}, S22 = ${polar(s.s22)}.`,
          `Rollett K = ${fmtNum(st.k, 2)}, |Δ| = ${fmtNum(st.deltaMag, 2)}, μ = ${fmtNum(st.mu, 2)}: the device is ${st.unconditionallyStable ? 'unconditionally stable' : 'only conditionally stable'}. ${gain}.`,
          `The ladder here runs from the ${d.load.re} Ω source (DP1) to the impedance the transistor sees as its source. The chart circles are drawn in that source plane. A low noise stage wants a source near Γopt, a high gain stage wants one near the conjugate of S11, and the two are rarely the same point.`,
        ];
      },
    },
    {
      title: 'Stability circle',
      apply: (d) => ({ ...d, showStability: true }),
      narrate: (d) => {
        const s = d.twoPort?.s;
        if (!s) return edited();
        // The circle the chart draws, from the same formula.
        const c = sourceStabilityCircle(s);
        const centre = cabs(c.center);
        const crosses = Math.abs(centre - c.radius) < 1 && centre + c.radius > 1;
        const originStable = centre < c.radius === c.stableInside;
        return [
          `The input stability circle marks the source impedances for which the output reflection reaches |Γout| = 1, where the stage would oscillate. Here it has its centre at Γ = ${polar(c.center)} and radius ${fmtNum(c.radius, 2)}, and the stable side is the ${c.stableInside ? 'inside' : 'outside'}.`,
          crosses
            ? 'The circle cuts into the chart, so some passive source impedances are unstable. The chart marks the stable side. Keep the source impedance on it, with margin.'
            : originStable
              ? 'The circle stays clear of the chart and the chart is on the stable side: every passive source is safe.'
              : 'The circle stays clear of the chart but the chart is on the unstable side: no passive source is safe.',
        ];
      },
    },
    {
      title: 'Noise circles',
      apply: (d) => {
        const n = d.twoPort?.noise;
        if (!n) return d;
        const steps = [0.1, 0.3, 0.6].map((x) => round(n.nfMinDb + x, 2));
        return { ...d, noiseCircles: steps };
      },
      narrate: (d) => {
        const n = d.twoPort?.noise;
        if (!n) return edited();
        const zopt = gammaToZ(n.gammaOpt, d.z0);
        return [
          `The device reaches its minimum noise figure NFmin = ${fmtNum(n.nfMinDb, 2)} dB when the source presents Γopt = ${polar(n.gammaOpt)}, that is Zopt = ${ohm(zopt)}.`,
          `Each circle is a set of source impedances with the same noise figure: ${d.noiseCircles.map((v) => `${fmtNum(v, 2)} dB`).join(', ')}. The equivalent noise resistance Rn = ${fmtNum(n.rn * d.z0, 1)} Ω sets how fast the noise figure rises when you move away from Γopt.`,
        ];
      },
    },
    {
      title: 'Gain circle',
      apply: (d) => {
        const n = d.twoPort?.noise;
        const s = d.twoPort?.s;
        if (!n || !s) return d;
        const ga = round(linearToDb(availableGain(s, n.gammaOpt)), 2);
        // No circle where the gain is not defined (a source that makes the device oscillate).
        return Number.isFinite(ga)
          ? { ...d, gainCircles: [{ type: 'available', gainDb: ga }] }
          : { ...d, gainCircles: [] };
      },
      narrate: (d) => {
        const n = d.twoPort?.noise;
        const s = d.twoPort?.s;
        if (!n || !s) return edited();
        const gaOpt = linearToDb(availableGain(s, n.gammaOpt));
        if (!Number.isFinite(gaOpt)) {
          return [
            'With the source at Γopt this device is potentially unstable, so the available gain is not defined there and no gain circle is drawn. Look at the stability circle first.',
          ];
        }
        const ceiling = Number.isNaN(mag(s))
          ? `MSG = ${fmtNum(linearToDb(msg(s)), 1)} dB`
          : `MAG = ${fmtNum(gmaxDb(s), 1)} dB`;
        return [
          `The available gain circle for Ga = ${d.gainCircles.map((g) => `${fmtNum(g.gainDb, 2)} dB`).join(', ')} passes through Γopt: this is the gain the stage delivers when it is tuned for the lowest noise.`,
          `Against the ceiling of ${ceiling}, tuning for noise gives up ${fmtNum(Math.max(linearToDb(msg(s)) - gaOpt, 0), 1)} dB of gain. That is the price of NFmin, and the circles show how much of it you can buy back by moving the source impedance towards the gain centre, at the cost of noise.`,
        ];
      },
    },
    {
      title: 'Target: the noise-optimal impedance',
      apply: (d) => {
        const n = d.twoPort?.noise;
        return n ? { ...d, target: gammaToZ(n.gammaOpt, d.z0) } : d;
      },
      narrate: (d) => {
        const t = targetOf(d);
        return [
          `The target is set to Zopt = ${ohm(t)}, the hollow square on the chart. The network has to turn the ${d.load.re} Ω source into this impedance.`,
          `The source is at ${fmtNum(chartDistance(d.load, t, d.z0), 2)} chart units from the target (|Γ1 - Γ2|), so a matching network is needed.`,
        ];
      },
    },
    {
      title: 'First part',
      apply: (d) => {
        const part = firstLPart(d, 'any');
        return part ? addElement(d, part) : d;
      },
      narrate: (d) => {
        const r = evaluate(d);
        const e0 = d.elements[0];
        const z1 = r.datapoints[1];
        if (d.elements.length !== 1 || !e0 || !z1) return edited();
        return [
          `Added ${partText(e0, d.frequency)}. The point moves from ${ohm(d.load)} to ${ohm(z1)} (TP2).`,
          `Of the L-networks that reach the target, this one has the shorter first move. The value is the one that puts the point on the ${isShunt(e0) ? 'constant-resistance circle through the target' : 'constant-conductance circle through the target'}, so one more part finishes the job.`,
        ];
      },
    },
    {
      title: 'Second part and the result',
      apply: (d) => {
        const part = closingLPart(d);
        return part ? addElement(d, part) : d;
      },
      narrate: (d) => {
        const r = evaluate(d);
        const e1 = d.elements[1];
        const s = d.twoPort?.s;
        const n = d.twoPort?.noise;
        const t = targetOf(d);
        if (d.elements.length !== 2 || !e1 || !s || !n) return edited();
        const gs = zToGamma(r.zin, d.z0);
        const nf = noiseFigureDb(n, gs);
        const ga = linearToDb(availableGain(s, gs));
        const miss = chartDistance(r.zin, t, d.z0);
        return [
          `Added ${partText(e1, d.frequency)}. The network now presents Zs = ${ohm(r.zin, 2)} to the transistor, ${miss < 1e-6 ? 'exactly on the target' : `${fmtNum(miss, 3)} chart units from the target`}.`,
          Number.isFinite(ga)
            ? `At this source impedance the noise figure is ${fmtNum(nf, 2)} dB (NFmin ${fmtNum(n.nfMinDb, 2)} dB) and the available gain is ${fmtNum(ga, 1)} dB.`
            : `At this source impedance the noise figure is ${fmtNum(nf, 2)} dB (NFmin ${fmtNum(n.nfMinDb, 2)} dB). The device is potentially unstable with this source, so the available gain is not defined.`,
          `This is the noise-optimal design. If the gain is too low, drag the last point towards the gain centre and watch the noise figure rise through the circles. Undo takes the whole tour back out in one step.`,
        ];
      },
    },
  ],
};

export const TOURS: readonly Tour[] = [lNetwork, singleStub, lna, ...ADVANCED_TOURS];
