import {
  applyElement,
  chartDistance,
  designStubFilter,
  inRange,
  MAX_FILTER_ORDER,
  MAX_TRANSFORMER_SECTIONS,
  multisectionTransformer,
  rippleDbFromGamma,
  type Complex,
  type MatchSolution,
  type PrototypeResponse,
  type StubFilterDesign,
  type StubFilterKind,
  type TransformerDesign,
  type TransformerType,
} from '@smithonline/core';
import { useMemo, useState } from 'react';
import { appendDistributed, atDesignFrequency, type Distributed } from '../lib/distributed';
import { elementName } from '../lib/elements';
import { fmtComplex, fmtFrequency, fmtNum } from '../lib/format';
import { useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
import { useDesignStore } from '../store/useDesignStore';
import { SolutionList } from './SolutionList';
import { ValueInput } from './ValueInput';

interface ToolProps {
  /** The impedance the new elements start from: Zin of the current ladder. */
  readonly zin: Complex;
  readonly target: Complex;
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
}

/** Largest |Gamma| and ripple the fields accept. */
const MIN_GAMMA = 0.001;
const MAX_GAMMA = 0.9;
const MIN_RIPPLE_DB = 0.001;
const MAX_RIPPLE_DB = 10;

/**
 * The tools' settings, kept for the session: closing the panel, looking at
 * the Response view, undoing and coming back finds them as they were.
 */
const memory = new Map<string, unknown>();

function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
  const set = (next: T): void => {
    memory.set(key, next);
    setValue(next);
  };
  return [value, set];
}

/**
 * A remembered frequency (cutoff, f0) that belongs to the design it was set
 * on: a design at another frequency (New, Open, an example) starts again
 * from its own design frequency.
 */
function useRememberedFrequency(
  key: string,
  designFrequency: number,
): [number, (v: number) => void] {
  const [, rerender] = useState(0);
  const kept = memory.get(key) as { readonly value: number; readonly at: number } | undefined;
  // A value set on a design at another frequency is forgotten, not only hidden, so it cannot
  // come back when a later design happens to have that frequency again.
  const current = kept && kept.at === designFrequency ? kept.value : designFrequency;
  if (!kept || kept.at !== designFrequency) {
    memory.set(key, { value: designFrequency, at: designFrequency });
  }
  return [
    current,
    (next: number) => {
      memory.set(key, { value: next, at: designFrequency });
      rerender((n) => n + 1);
    },
  ];
}

/** Keep a typed value inside [min, max]; out of it, say so and keep the nearest bound or the old value. */
function bounded(v: number, min: number, max: number, name: string, unit = ''): number | null {
  const store = useDesignStore.getState();
  if (v < min) {
    store.setMessage(`${name} must be at least ${min}${unit}`, { error: true });
    return null;
  }
  if (v > max) {
    store.setMessage(`${name} is limited to ${max}${unit}`, { error: true });
    return max;
  }
  return v;
}

/** Where the elements land at the design frequency, for the preview marker. */
function landing(elements: readonly Distributed[], zin: Complex, f: number): Complex {
  return elements.reduce((z, el) => applyElement(el, z, f), zin);
}

/** The exact band of the built lines, or why there is none. */
function bandLabel(t: TransformerDesign): string {
  if (t.bandwidth === null) return 'whole band';
  if (t.bandwidth === 0) return `|Γ| ${fmtNum(t.centreGamma, 3)} at f0`;
  return `BW ${fmtNum(t.bandwidth * 100, 0)} %`;
}

function typeName(type: TransformerType): string {
  return type === 'binomial' ? 'binomial' : 'Chebyshev';
}

/**
 * Multi-section quarter-wave transformers from the resistance of Zin to the
 * target resistance: binomial (maximally flat) or Chebyshev (equal ripple at
 * the chosen reflection), one to six sections, listed with the bandwidth
 * each keeps |Gamma| under the limit. Hover previews, click appends.
 */
export function TransformerTool({ zin, target, onPreview, onClose }: ToolProps) {
  const hints = pointerHints(useCoarsePointer());
  const design = useDesignStore((s) => s.design);
  const [type, setType] = useRemembered<TransformerType>('transformer.type', 'chebyshev');
  const [gammaMax, setGammaMax] = useRemembered('transformer.gammaMax', 0.05);
  const [f0, setF0] = useRememberedFrequency('transformer.f0', design.frequency);
  const zl = zin.re;
  const zs = target.re;
  const usable = zl > 0 && zs > 0 && Number.isFinite(zl) && Number.isFinite(zs);
  const onTarget = usable && Math.abs(Math.log(zl / zs)) < 1e-6;
  const reactive = usable && Math.abs(zin.im) > 1e-3 * zl;

  const designs = useMemo((): readonly TransformerDesign[] => {
    if (!usable || onTarget) return [];
    try {
      return Array.from({ length: MAX_TRANSFORMER_SECTIONS }, (_, i) =>
        multisectionTransformer(zs, zl, i + 1, { type, frequency: f0, gammaMax }),
      );
    } catch {
      return [];
    }
  }, [usable, onTarget, zs, zl, type, f0, gammaMax]);

  const rows = useMemo(
    () =>
      designs.map((t) => {
        const elements = atDesignFrequency(t.elements, design.frequency);
        const solution: MatchSolution = {
          elements,
          q: 0,
          result: landing(elements, zin, design.frequency),
          description: `${t.sections}-section ${typeName(t.type)}`,
        };
        return { design: t, solution };
      }),
    [designs, zin, design.frequency],
  );
  // The small-reflection theory is first order: past about 2:1 the built lines ripple higher.
  const worst = designs.reduce((m, t) => Math.max(m, t.peakGamma), 0);
  const theoryOff = worst > 1.1 * gammaMax;
  const lowered = designs.filter((t) => t.designGamma < gammaMax * 0.999);
  const centreRipple = designs.reduce((m, t) => Math.max(m, t.centreGamma), 0);
  const labels = rows.map(
    ({ design: t }) => `N = ${t.sections}, ${bandLabel(t)}${reactive ? ' (R only)' : ''}`,
  );

  const apply = (sol: MatchSolution): void => {
    const row = rows.find((r) => r.solution === sol);
    if (!row) return;
    const t = row.design;
    const start = f0 * 0.25;
    const stop = f0 * 1.75;
    // One step, named by its message for Undo and Redo.
    appendDistributed(
      row.solution.elements as readonly Distributed[],
      start,
      stop,
      (sweep) =>
        `Added a ${t.sections}-section ${typeName(t.type)} transformer at ${fmtFrequency(f0)}: ${t.impedances.map((z) => fmtNum(z, 1)).join(', ')} Ω from the load${sweep}`,
    );
    onClose();
  };

  const commitGamma = (v: number): void => {
    const next = bounded(v, MIN_GAMMA, MAX_GAMMA, 'Max |Γ|');
    if (next !== null) setGammaMax(next);
  };

  return (
    <>
      <div className="fields">
        <label>
          Type
          <select
            className="btn"
            value={type}
            onChange={(e) => setType(e.target.value as TransformerType)}
            aria-label="Transformer type"
          >
            <option value="binomial">Binomial (maximally flat)</option>
            <option value="chebyshev">Chebyshev (equal ripple)</option>
          </select>
        </label>
        <label>
          Max |Γ|
          <ValueInput
            value={gammaMax}
            plain
            digits={3}
            onCommit={commitGamma}
            width="4.5em"
            ariaLabel="Maximum reflection"
          />
        </label>
        <label>
          f0
          <ValueInput
            value={f0}
            unit="Hz"
            digits={5}
            min={1}
            onCommit={setF0}
            width="6.5em"
            ariaLabel="Centre frequency"
          />
        </label>
      </div>
      <div className="dropdown-note">
        {usable
          ? `Quarter-wave sections at ${fmtFrequency(f0)} from ${fmtNum(zl, 2)} Ω (Zin) to ${fmtNum(zs, 2)} Ω (the target), by the small-reflection theory. The bandwidth is where |Γ| stays under ${fmtNum(gammaMax, 3)} (VSWR ${fmtNum((1 + gammaMax) / (1 - gammaMax), 3)}${type === 'chebyshev' ? `, ripple ${fmtNum(rippleDbFromGamma(gammaMax), 3)} dB` : ''}).`
          : 'Zin and the target need a resistance above zero.'}
        {usable && !onTarget && Math.abs(zl - zs) / (zl + zs) <= gammaMax && (
          <>
            {' '}
            The step itself is already under the limit (|Γ|{' '}
            {fmtNum(Math.abs(zl - zs) / (zl + zs), 3)}
            ), so no transformer is needed; one only lowers |Γ| further near f0.
          </>
        )}
        {theoryOff && (
          <>
            {' '}
            For a {fmtNum(Math.max(zl / zs, zs / zl), 1)}:1 step the theory is only approximate (the
            textbook design reaches |Γ| {fmtNum(worst, 3)} inside its band), so the bandwidths
            listed are those of the built lines.
            {lowered.length > 0 &&
              ` For N = ${lowered.map((t) => t.sections).join(', ')} the sections are synthesized for a lower ripple (down to |Γ| ${fmtNum(Math.min(...lowered.map((t) => t.designGamma)), 3)}) so the built lines stay under the limit across the band.`}
          </>
        )}
        {centreRipple > 1e-9 && (
          <>
            {' '}
            An even number of Chebyshev sections ripples at f0: |Γ| there is{' '}
            {fmtNum(centreRipple, 3)}, not 0.
          </>
        )}
        {f0 !== design.frequency && rows.length > 0 && (
          <>
            {' '}
            Lengths are given at the design frequency {fmtFrequency(design.frequency)}, as for every
            line: a quarter wave at {fmtFrequency(f0)} is{' '}
            {fmtNum((0.25 * design.frequency) / f0, 4)} λ there.
          </>
        )}
        {reactive && !onTarget && (
          <>
            {' '}
            Zin has a reactance of {fmtNum(zin.im, 2)} Ω that a transformer does not remove, so the
            bandwidths hold for the resistance only; cancel the reactance first (Add parts) for a
            full match.
          </>
        )}
        {usable && Math.abs(target.im) > 0 && (
          <> The target reactance is left out: the transformer goes to the target resistance.</>
        )}
        {rows.length > 0 && ` ${hints.preview}`}
      </div>
      <SolutionList
        solutions={rows.map((r) => r.solution)}
        labels={labels}
        empty={
          onTarget
            ? reactive
              ? `Zin already has the target resistance; only its reactance of ${fmtNum(zin.im, 2)} Ω is left, which Add parts cancels.`
              : 'Zin already has the target resistance; there is nothing to transform.'
            : usable
              ? 'No transformer for these impedances.'
              : ''
        }
        onPreview={onPreview}
        onApply={apply}
      />
    </>
  );
}

function filterName(d: StubFilterDesign): string {
  const response =
    d.response === 'butterworth' ? 'Butterworth' : `${fmtNum(d.rippleDb ?? 0, 3)} dB Chebyshev`;
  return `${response} N = ${d.order} ${d.kind === 'lowpass' ? 'low-pass' : 'high-pass'}`;
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The sweep that shows a filter: past the stopband pole at 2 fc for a low-pass, the whole passband for a high-pass. */
function filterSweep(d: StubFilterDesign): readonly [number, number] {
  return d.kind === 'lowpass' ? [d.cutoff / 20, d.cutoff * 3] : [d.cutoff / 10, d.cutoff * 4];
}

/**
 * Commensurate-line stub filters: a Butterworth or Chebyshev prototype,
 * Richards' transform and the Kuroda identities give a low-pass of shunt
 * open stubs and lines; the high-pass of shunt shorted stubs is the classic
 * approximate design. Every element is an eighth wave at the cutoff. Hover
 * previews, click appends.
 */
export function StubFilterTool({ zin, onPreview, onClose }: ToolProps) {
  const hints = pointerHints(useCoarsePointer());
  const design = useDesignStore((s) => s.design);
  const [kind, setKind] = useRemembered<StubFilterKind>('filter.kind', 'lowpass');
  const [response, setResponse] = useRemembered<PrototypeResponse>(
    'filter.response',
    'butterworth',
  );
  const [order, setOrder] = useRemembered('filter.order', 3);
  const [ripple, setRipple] = useRemembered('filter.ripple', 0.5);
  const [cutoff, setCutoff] = useRememberedFrequency('filter.cutoff', design.frequency);

  const filter = useMemo((): StubFilterDesign | null => {
    try {
      return designStubFilter({ kind, response, order, rippleDb: ripple, cutoff, z0: design.z0 });
    } catch {
      return null;
    }
  }, [kind, response, order, ripple, cutoff, design.z0]);
  const elements = useMemo(
    () => (filter ? atDesignFrequency(filter.elements, design.frequency) : []),
    [filter, design.frequency],
  );
  const solution = useMemo(
    (): MatchSolution | null =>
      filter && {
        elements,
        q: 0,
        result: landing(elements, zin, design.frequency),
        description: filterName(filter),
      },
    [filter, elements, zin, design.frequency],
  );
  const terminated = chartDistance(zin, { re: design.z0, im: 0 }, design.z0) < 0.05;
  const evenLoad = filter !== null && Math.abs(filter.designLoad - design.z0) > 1e-6 * design.z0;

  const apply = (): void => {
    if (!filter) return;
    const [lo, hi] = filter.range;
    const [start, stop] = filterSweep(filter);
    const out = filter.outOfRange.length;
    // One step, named by its message for Undo and Redo.
    appendDistributed(
      elements,
      start,
      stop,
      (sweep) =>
        `Added a ${filterName(filter)} at ${fmtFrequency(filter.cutoff)}: ${count(filter.stubImpedances.length, 'stub')} and ${count(filter.lineImpedances.length, 'line')}, an eighth wave at the cutoff${out > 0 ? `; ${count(out, 'impedance')} outside ${lo} to ${hi} Ω` : ''}${sweep}`,
    );
    onClose();
  };

  const commitRipple = (v: number): void => {
    const next = bounded(v, MIN_RIPPLE_DB, MAX_RIPPLE_DB, 'The ripple', ' dB');
    if (next !== null) setRipple(next);
  };

  return (
    <>
      <div className="fields">
        <label>
          Filter
          <select
            className="btn"
            value={kind}
            onChange={(e) => setKind(e.target.value as StubFilterKind)}
            aria-label="Filter kind"
          >
            <option value="lowpass">Low-pass (open stubs)</option>
            <option value="highpass">High-pass (shorted stubs)</option>
          </select>
        </label>
        <label>
          Response
          <select
            className="btn"
            value={response}
            onChange={(e) => setResponse(e.target.value as PrototypeResponse)}
            aria-label="Filter response"
          >
            <option value="butterworth">Butterworth</option>
            <option value="chebyshev">Chebyshev</option>
          </select>
        </label>
        <label>
          N
          <select
            className="btn"
            value={order}
            onChange={(e) => setOrder(Number(e.target.value))}
            aria-label="Filter order"
          >
            {Array.from({ length: MAX_FILTER_ORDER }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fields">
        <label>
          Cutoff
          <ValueInput
            value={cutoff}
            unit="Hz"
            digits={5}
            min={1}
            onCommit={setCutoff}
            width="6.5em"
            ariaLabel="Cutoff frequency"
          />
        </label>
        {response === 'chebyshev' && (
          <label>
            Ripple
            <ValueInput
              value={ripple}
              unit="dB"
              plain
              digits={3}
              onCommit={commitRipple}
              width="5em"
              ariaLabel="Passband ripple"
            />
          </label>
        )}
        <span className="muted">Z0 {fmtNum(design.z0, 1)} Ω</span>
      </div>
      <div className="dropdown-note">
        {kind === 'lowpass'
          ? `Richards' transform and the Kuroda identities turn the prototype into shunt open stubs with lines between, exactly. Every stub and line is an eighth wave at the cutoff, a quarter wave at ${fmtFrequency(2 * cutoff)} where the stubs short the line; the response repeats from ${fmtFrequency(3 * cutoff)} on.`
          : `Shunt shorted stubs joined by Z0 lines, all an eighth wave at the cutoff and a quarter wave at ${fmtFrequency(2 * cutoff)}. The cutoff is exact; the passband shape is the classic approximation, and it passes up to ${fmtFrequency(3 * cutoff)}.`}
        {cutoff !== design.frequency && (
          <>
            {' '}
            Lengths are given at the design frequency {fmtFrequency(design.frequency)}, as for every
            line: an eighth wave at the cutoff is {fmtNum((0.125 * design.frequency) / cutoff, 4)} λ
            there.
          </>
        )}{' '}
        {hints.preview}
      </div>
      {filter && solution ? (
        <>
          <SolutionList
            solutions={[solution]}
            titles={[
              `${filterName(filter)}: ${count(filter.stubImpedances.length, 'stub')}, ${count(filter.lineImpedances.length, 'line')}`,
            ]}
            labels={[
              filter.exact
                ? evenLoad
                  ? `exact on ${fmtNum(filter.designLoad, 1)} Ω`
                  : 'exact'
                : 'approximate',
            ]}
            empty=""
            onPreview={onPreview}
            onApply={apply}
          />
          <div className="table-scroll">
            <table className="fit-table">
              <thead>
                <tr>
                  <th>From the load</th>
                  <th>Z</th>
                </tr>
              </thead>
              <tbody>
                {filter.elements.map((el, i) => {
                  const out = !inRange(el.z0, filter.range);
                  return (
                    <tr key={i} className={out ? 'danger' : ''}>
                      <td>
                        {i + 1}. {elementName(el)}
                      </td>
                      <td className="mono">
                        {fmtNum(el.z0, 2)} Ω{out ? ' (hard to build)' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filter.outOfRange.length > 0 && (
            <div className="row danger">
              {count(filter.outOfRange.length, 'impedance')} lie outside {filter.range[0]} to{' '}
              {filter.range[1]} Ω, the range a printed board usually makes. A lower order or another
              Z0 brings them closer
              {response === 'chebyshev'
                ? '; the ripple moves them too, but not always the same way, so try a few values'
                : ''}
              .
            </div>
          )}
          {evenLoad && (
            <div className="row">
              An even-order Chebyshev prototype ends in {fmtNum(filter.designLoad, 1)} Ω, not Z0; on
              a Z0 load the passband ripple grows. Odd orders end in Z0.
            </div>
          )}
          {!terminated && (
            <div className="row">
              The filter is designed between Z0 terminations; Zin here is {fmtComplex(zin, 1)} Ω, so
              the response will differ.
            </div>
          )}
        </>
      ) : (
        <div className="row danger">No filter for these settings.</div>
      )}
    </>
  );
}
