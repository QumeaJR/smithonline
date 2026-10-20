import {
  availableGainCircle,
  dbToLinear,
  loadStabilityCircle,
  noiseCircle,
  operatingGainCircle,
  sourceStabilityCircle,
  unilateralGain,
  unilateralGainCircle,
  type Circle,
} from '@smithonline/core';
import type { Design, GainCircleType } from './design';

export type ChartCircleKind = 'stability' | 'gain' | 'noise';

/** One circle ready to draw, with the label the chart shows next to it. */
export interface ChartCircle {
  readonly kind: ChartCircleKind;
  readonly circle: Circle;
  readonly label: string;
  /** Stability circles only: which side is stable. */
  readonly stableInside?: boolean;
}

export const GAIN_TYPE_LABELS: Readonly<Record<GainCircleType, string>> = {
  available: 'Ga (source plane)',
  operating: 'Gp (load plane)',
  unilateralSource: 'Gs unilateral (source plane)',
  unilateralLoad: 'Gl unilateral (load plane)',
};

const SHORT: Readonly<Record<GainCircleType, string>> = {
  available: 'Ga',
  operating: 'Gp',
  unilateralSource: 'Gs',
  unilateralLoad: 'Gl',
};

/** All two-port circles the design asks for. Empty without device parameters. */
export function designCircles(design: Design): ChartCircle[] {
  const tp = design.twoPort;
  if (!tp) return [];
  const out: ChartCircle[] = [];
  if (design.showStability) {
    const src = sourceStabilityCircle(tp.s);
    const load = loadStabilityCircle(tp.s);
    out.push({
      kind: 'stability',
      circle: src,
      label: `S in, stable ${src.stableInside ? 'inside' : 'outside'}`,
      stableInside: src.stableInside,
    });
    out.push({
      kind: 'stability',
      circle: load,
      label: `S out, stable ${load.stableInside ? 'inside' : 'outside'}`,
      stableInside: load.stableInside,
    });
  }
  const u = unilateralGain(tp.s);
  for (const g of design.gainCircles) {
    const lin = dbToLinear(g.gainDb);
    let circle: Circle;
    switch (g.type) {
      case 'available':
        circle = availableGainCircle(tp.s, lin);
        break;
      case 'operating':
        circle = operatingGainCircle(tp.s, lin);
        break;
      case 'unilateralSource':
        circle = unilateralGainCircle(tp.s, 'source', Math.min(lin, u.gsMax));
        break;
      case 'unilateralLoad':
        circle = unilateralGainCircle(tp.s, 'load', Math.min(lin, u.glMax));
        break;
    }
    if (Number.isFinite(circle.radius) && Number.isFinite(circle.center.re)) {
      out.push({
        kind: 'gain',
        circle,
        label: `${SHORT[g.type]} ${Number(g.gainDb.toFixed(3))} dB`,
      });
    }
  }
  if (tp.noise) {
    for (const nf of design.noiseCircles) {
      const circle = noiseCircle(tp.noise, nf);
      out.push({ kind: 'noise', circle, label: `NF ${nf} dB` });
    }
  }
  return out;
}
