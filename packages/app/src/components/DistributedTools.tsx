import {
  applyElement,
  chartDistance,
  designStubFilter,
  MAX_FILTER_ORDER,
  MAX_TRANSFORMER_SECTIONS,
  multisectionTransformer,
  rippleDbFromGamma,
  type Complex,
  type Element,
  type MatchSolution,
  type PrototypeResponse,
  type StubFilterDesign,
  type StubFilterKind,
  type TransformerDesign,
  type TransformerType,
} from '@smithonline/core';
import { useMemo, useState } from 'react';
import { withIdentity, type Design, type DesignElement } from '../lib/design';
import { elementName } from '../lib/elements';
import { fmtComplex, fmtFrequency, fmtNum } from '../lib/format';
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

/** Where the elements land at the design frequency, for the preview marker. */
function landing(elements: readonly Element[], zin: Complex, f: number): Complex {
  return elements.reduce((z, el) => applyElement(el, z, f), zin);
}

/**
 * Append the elements in one undo step. A sweep that is off is switched on
 * over the given range, so the Response view has a curve to show.
 */
function append(elements: readonly Element[], start: number, stop: number): boolean {
  const store = useDesignStore.getState();
  const sweepSet = !store.design.sweep.enabled;
  store.update((d: Design) => {
    let list: readonly DesignElement[] = d.elements;
    for (const el of elements) list = [...list, withIdentity(el, list)];
    if (!sweepSet) return { ...d, elements: list };
    return {
      ...d,
      elements: list,
      sweep: {
        ...d.sweep,
        enabled: true,
        start,
        stop,
        points: Math.max(d.sweep.points, 201),
        ...(d.sweep.loads?.length ? { mode: 'frequency' as const } : {}),
      },
    };
  });
  return sweepSet;
}

function sweepText(set: boolean, start: number, stop: number): string {
  return set ? `; sweep set to ${fmtFrequency(start)} to ${fmtFrequency(stop)}` : '';
}

/**
 * Multi-section quarter-wave transformers from the resistance of Zin to the
 * target resistance: binomial (maximally flat) or Chebyshev (equal ripple at
 * the chosen reflection), one to six sections, listed with the bandwidth
 * each keeps |Gamma| under the limit. Hover previews, click appends.
 */
export function TransformerTool({ zin, target, onPreview, onClose }: ToolProps) {
  const design = useDesignStore((s) => s.design);
  const [type, setType] = useState<TransformerType>('chebyshev');
  const [gammaMax, setGammaMax] = useState(0.05);
  const [f0, setF0] = useState(design.frequency);
  const zl = zin.re;
  const zs = target.re;
  const usable = zl > 0 && zs > 0 && Number.isFinite(zl) && Number.isFinite(zs);
  const onTarget = usable && Math.abs(Math.log(zl / zs)) < 1e-6;

  const designs = useMemo((): readonly TransformerDesign[] => {
    if (!usable || onTarget) return [];
    return Array.from({ length: MAX_TRANSFORMER_SECTIONS }, (_, i) =>
      multisectionTransformer(zs, zl, i + 1, { type, frequency: f0, gammaMax }),
    );
  }, [usable, onTarget, zs, zl, type, f0, gammaMax]);

  const solutions = useMemo(
    (): readonly MatchSolution[] =>
      designs.map((t) => ({
        elements: t.elements,
        q: 0,
        result: landing(t.elements, zin, design.frequency),
        description: `${t.sections}-section ${t.type}`,
      })),
    [designs, zin, design.frequency],
  );
  const labels = designs.map(
    (t) =>
      `N = ${t.sections}, ${t.bandwidth === null ? 'whole band' : `BW ${fmtNum(t.bandwidth * 100, 0)} %`}`,
  );

  const apply = (sol: MatchSolution): void => {
    const t = designs.find((d) => d.elements === sol.elements);
    if (!t) return;
    const start = f0 * 0.25;
    const stop = f0 * 1.75;
    const set = append(t.elements, start, stop);
    useDesignStore
      .getState()
      .setMessage(
        `Added a ${t.sections}-section ${t.type} transformer at ${fmtFrequency(f0)}: ${t.impedances.map((z) => fmtNum(z, 1)).join(', ')} Ω from the load${sweepText(set, start, stop)}`,
      );
    onClose();
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
            min={0.001}
            onCommit={(v) => setGammaMax(Math.min(v, 0.9))}
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
          ? `Quarter-wave sections at ${fmtFrequency(f0)} from ${fmtNum(zl, 2)} Ω (Zin) to ${fmtNum(zs, 2)} Ω (the target), by the small-reflection theory. The bandwidth is where |Γ| stays under ${fmtNum(gammaMax, 3)} (VSWR ${fmtNum((1 + gammaMax) / (1 - gammaMax), 3)}${type === 'chebyshev' ? `, ripple ${fmtNum(rippleDbFromGamma(gammaMax), 3)} dB` : ''}). Hover to preview, click to add.`
          : 'Zin and the target need a resistance above zero.'}
        {usable && Math.abs(zin.im) > 1e-3 * zl && (
          <>
            {' '}
            Zin has a reactance of {fmtNum(zin.im, 2)} Ω that a transformer does not remove; cancel
            it first for a full match.
          </>
        )}
        {usable && Math.abs(target.im) > 0 && (
          <> The target reactance is left out: the transformer goes to the target resistance.</>
        )}
      </div>
      <SolutionList
        solutions={solutions}
        labels={labels}
        empty={
          onTarget
            ? 'Zin already has the target resistance; there is nothing to transform.'
            : 'No transformer for these impedances.'
        }
        onPreview={onPreview}
        onApply={apply}
      />
    </>
  );
}

function filterName(d: StubFilterDesign): string {
  const response = d.response === 'butterworth' ? 'Butterworth' : 'Chebyshev';
  return `${response} N = ${d.order} ${d.kind === 'lowpass' ? 'low-pass' : 'high-pass'}`;
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
  const design = useDesignStore((s) => s.design);
  const [kind, setKind] = useState<StubFilterKind>('lowpass');
  const [response, setResponse] = useState<PrototypeResponse>('butterworth');
  const [order, setOrder] = useState(3);
  const [ripple, setRipple] = useState(0.5);
  const [cutoff, setCutoff] = useState(design.frequency);

  const filter = useMemo(
    () => designStubFilter({ kind, response, order, rippleDb: ripple, cutoff, z0: design.z0 }),
    [kind, response, order, ripple, cutoff, design.z0],
  );
  const solution = useMemo(
    (): MatchSolution => ({
      elements: filter.elements,
      q: 0,
      result: landing(filter.elements, zin, design.frequency),
      description: filterName(filter),
    }),
    [filter, zin, design.frequency],
  );
  const terminated = chartDistance(zin, { re: design.z0, im: 0 }, design.z0) < 0.05;
  const [lo, hi] = filter.range;

  const apply = (): void => {
    const [start, stop] = filterSweep(filter);
    const set = append(filter.elements, start, stop);
    const stubs = filter.stubImpedances.length;
    const lines = filter.lineImpedances.length;
    useDesignStore
      .getState()
      .setMessage(
        `Added a ${filterName(filter)} at ${fmtFrequency(filter.cutoff)}: ${stubs} ${stubs === 1 ? 'stub' : 'stubs'} and ${lines} ${lines === 1 ? 'line' : 'lines'}, an eighth wave at the cutoff${filter.outOfRange.length > 0 ? `; ${filter.outOfRange.length} outside ${lo} to ${hi} Ω` : ''}${sweepText(set, start, stop)}`,
      );
    onClose();
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
              min={0.001}
              onCommit={(v) => setRipple(Math.min(v, 10))}
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
          : `Shunt shorted stubs joined by Z0 lines, all an eighth wave at the cutoff and a quarter wave at ${fmtFrequency(2 * cutoff)}. The cutoff is exact; the passband shape is the classic approximation, and it passes up to ${fmtFrequency(3 * cutoff)}.`}{' '}
        Hover to preview, click to add.
      </div>
      <SolutionList
        solutions={[solution]}
        labels={[
          `${filter.stubImpedances.length} stubs, ${filter.exact ? 'exact' : 'approximate'}`,
        ]}
        empty=""
        onPreview={onPreview}
        onApply={apply}
      />
      <table className="fit-table">
        <thead>
          <tr>
            <th>From the load</th>
            <th>Z</th>
          </tr>
        </thead>
        <tbody>
          {filter.elements.map((el, i) => {
            const out = el.z0 < lo || el.z0 > hi;
            return (
              <tr key={i} className={out ? 'danger' : ''}>
                <td>
                  {i + 1}. {elementName(el)}
                </td>
                <td className="mono">
                  {fmtNum(el.z0, 1)} Ω{out ? ' (hard to build)' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filter.outOfRange.length > 0 && (
        <div className="row danger">
          {filter.outOfRange.length} of the impedances lie outside {lo} to {hi} Ω, the range a
          printed board usually makes. A lower order, a smaller ripple or another Z0 brings them
          closer.
        </div>
      )}
      {Math.abs(filter.designLoad - design.z0) > 1e-6 * design.z0 && (
        <div className="row">
          An even-order Chebyshev prototype ends in {fmtNum(filter.designLoad, 1)} Ω, not Z0; on a
          Z0 load the passband ripple grows. Odd orders end in Z0.
        </div>
      )}
      {!terminated && (
        <div className="row">
          The filter is designed between Z0 terminations; Zin here is {fmtComplex(zin, 1)} Ω, so the
          response will differ.
        </div>
      )}
    </>
  );
}
