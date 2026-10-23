import {
  chartDistance,
  complex,
  fitToTarget,
  fittableIndices,
  type Complex,
  type Element,
  type FitResult,
  type MatchSolution,
} from '@smithonline/core';
import { useMemo, useState } from 'react';
import { targetOf, type DesignElement, type RealizeSettings } from '../lib/design';
import { elementName, elementSummary, primaryValue, withPrimaryValue } from '../lib/elements';
import { fmtComplex, fmtNum } from '../lib/format';
import { matchSolutions, minimumQ, type Topology } from '../lib/match';
import { snapFit, snapSolutions } from '../lib/realize';
import { useDesignStore } from '../store/useDesignStore';
import { BroadbandMatch } from './BroadbandMatch';
import { SolutionList } from './SolutionList';
import { ValueInput } from './ValueInput';

interface AutoMatchProps {
  /** The impedance the network starts from: Zin of the current ladder. */
  readonly zin: Complex;
  /** The elements as evaluated (with the loss model when it is on). */
  readonly elements: readonly DesignElement[];
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
}

type Mode = 'add' | 'tune' | 'broadband';

/** "E24" or "your stock": the values Realize snaps to, for the notes. */
function sourceName(realize: RealizeSettings): string {
  return realize.series === 'stock' ? 'your stock' : realize.series;
}

/**
 * Two ways to reach the design target. "Add parts" is the closed-form
 * synthesis from Zin: the L-networks, or a Pi or T at a chosen loaded Q,
 * ranked by Q; hovering previews, clicking appends. "Tune parts" keeps the
 * network as built and solves the values of the parts you free up so that
 * Zin lands on the target, which is how you match with the coils you have.
 * With Realize on both return standard or stocked values and report the
 * mismatch those leave.
 */
export function AutoMatch({ zin, elements, onPreview, onClose }: AutoMatchProps) {
  const design = useDesignStore((s) => s.design);
  const { setTarget } = useDesignStore.getState();
  const target = targetOf(design);
  const [mode, setMode] = useState<Mode>(elements.length > 0 ? 'tune' : 'add');

  return (
    <div className="tool-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-head">
        <strong>Auto match</strong>
        <span className="muted">from Zin = {fmtComplex(zin, 1)} &#937;</span>
        <button className="btn tiny" onClick={onClose} aria-label="Close auto match">
          &#215;
        </button>
      </div>
      <div className="fields">
        <label>
          Target R
          <ValueInput
            value={target.re}
            unit="Ω"
            min={1e-6}
            onCommit={(re) => setTarget(complex(re, target.im))}
            width="5.5em"
            ariaLabel="Target resistance"
          />
        </label>
        <label>
          X
          <ValueInput
            value={target.im}
            unit="Ω"
            onCommit={(im) => setTarget(complex(target.re, im))}
            width="5.5em"
            ariaLabel="Target reactance"
          />
        </label>
        <button
          className={`btn tiny ${design.target === null ? 'on' : ''}`}
          onClick={() => setTarget(null)}
          title="Match to the reference impedance, the centre of the chart"
        >
          = Z0
        </button>
      </div>
      <div className="fields modes" role="tablist" aria-label="Matching method">
        <button
          className={`btn tiny ${mode === 'tune' ? 'on' : ''}`}
          role="tab"
          aria-selected={mode === 'tune'}
          onClick={() => {
            onPreview(null);
            setMode('tune');
          }}
        >
          Tune existing parts
        </button>
        <button
          className={`btn tiny ${mode === 'add' ? 'on' : ''}`}
          role="tab"
          aria-selected={mode === 'add'}
          onClick={() => setMode('add')}
        >
          Add parts
        </button>
        <button
          className={`btn tiny ${mode === 'broadband' ? 'on' : ''}`}
          role="tab"
          aria-selected={mode === 'broadband'}
          onClick={() => {
            onPreview(null);
            setMode('broadband');
          }}
        >
          Broadband
        </button>
      </div>
      {mode === 'add' ? (
        <AddParts
          zin={zin}
          elements={elements}
          target={target}
          onPreview={onPreview}
          onClose={onClose}
        />
      ) : mode === 'broadband' ? (
        <BroadbandMatch
          elements={elements}
          target={target}
          onPreview={onPreview}
          onClose={onClose}
        />
      ) : (
        <TuneParts elements={elements} target={target} onClose={onClose} />
      )}
    </div>
  );
}

interface AddPartsProps {
  readonly zin: Complex;
  readonly elements: readonly DesignElement[];
  readonly target: Complex;
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
}

function AddParts({ zin, elements, target, onPreview, onClose }: AddPartsProps) {
  const design = useDesignStore((s) => s.design);
  const [topology, setTopology] = useState<Topology>('L');
  const minQ = useMemo(
    () => (topology === 'L' ? 0 : minimumQ(topology, zin, target)),
    [topology, zin, target],
  );
  const [q, setQ] = useState<number | null>(null);
  // The first Q on offer sits a little above the lowest one that works.
  const effectiveQ = q ?? (Number.isFinite(minQ) ? Math.ceil(minQ + 1) : 5);
  // Within a hundredth of the chart (VSWR 1.02) there is nothing worth adding.
  const onTarget = chartDistance(zin, target, design.z0) < 0.01;
  const ideal = useMemo(
    () =>
      onTarget
        ? []
        : matchSolutions(topology, zin, target, design.z0, design.frequency, effectiveQ),
    [onTarget, topology, zin, target, design.z0, design.frequency, effectiveQ],
  );
  /** With Realize on: the same solutions with snapped values, ranked by the VSWR after snapping. */
  const snapped = useMemo(() => snapSolutions(design, elements, ideal), [design, elements, ideal]);
  const solutions = useMemo(
    (): readonly MatchSolution[] =>
      snapped
        ? snapped.map((r) => ({ ...r.solution, elements: r.elements, result: r.zin }))
        : ideal,
    [snapped, ideal],
  );
  const labels = snapped?.map((r) => `VSWR ${fmtNum(r.vswr, 3)}`);

  const apply = (sol: MatchSolution): void => {
    const store = useDesignStore.getState();
    store.addElements(sol.elements);
    const r = snapped?.find((s) => s.elements === sol.elements);
    store.setMessage(
      r
        ? `Added ${sol.description} with ${sourceName(design.realize)} values: VSWR ${fmtNum(r.vswr, 3)} towards the target (Q ${fmtNum(sol.q, 2)})`
        : `Added ${sol.description} (Q ${fmtNum(sol.q, 2)})`,
    );
    onClose();
  };

  const hover = 'Hover to preview, click to add.';
  return (
    <>
      <div className="fields">
        <label>
          Topology
          <select
            className="btn"
            value={topology}
            onChange={(e) => setTopology(e.target.value as Topology)}
            aria-label="Topology"
          >
            <option value="L">L (two elements)</option>
            <option value="Pi">Pi (shunt, series, shunt)</option>
            <option value="T">T (series, shunt, series)</option>
          </select>
        </label>
        {topology !== 'L' && (
          <label>
            Q
            <ValueInput
              value={effectiveQ}
              plain
              digits={3}
              min={0.01}
              onCommit={setQ}
              width="4.5em"
              ariaLabel="Target Q"
            />
          </label>
        )}
      </div>
      <div className="dropdown-note">
        {topology === 'L'
          ? `One- and two-element networks appended at the source side, lowest Q first. ${hover}`
          : Number.isFinite(minQ)
            ? `Loaded Q of the network; it must be above ${fmtNum(minQ, 2)}, the Q of the plain L-network, and a higher Q is a narrower match. ${hover}`
            : 'The target and Zin need a resistance above zero.'}
        {snapped && (
          <>
            {' '}
            Realize is on: the values are snapped to {sourceName(design.realize)} and the networks
            are ranked by the VSWR they then give towards the target.
          </>
        )}
      </div>
      <SolutionList
        solutions={solutions}
        labels={labels}
        empty={
          onTarget
            ? 'Zin is already on the target; there is nothing to add.'
            : topology === 'L'
              ? 'No one- or two-element network reaches this target from Zin.'
              : `No ${topology} network at this Q; raise it above ${fmtNum(minQ, 2)}.`
        }
        onPreview={onPreview}
        onApply={apply}
      />
    </>
  );
}

interface TunePartsProps {
  readonly elements: readonly DesignElement[];
  readonly target: Complex;
  readonly onClose: () => void;
}

function TuneParts({ elements, target, onClose }: TunePartsProps) {
  const design = useDesignStore((s) => s.design);
  const ladder = useMemo(
    () => ({ z0: design.z0, frequency: design.frequency, load: design.load, elements }),
    [design.z0, design.frequency, design.load, elements],
  );
  const fittable = useMemo(() => fittableIndices(ladder), [ladder]);
  // Free parts: every fittable one that is not locked, until the user says otherwise.
  const [free, setFree] = useState<ReadonlySet<number>>(
    () => new Set(fittable.filter((i) => !elements[i]?.locked)),
  );
  // The last solution, remembered with what it was solved for: a changed network or target
  // makes it stale and it is no longer shown.
  const [solved, setSolved] = useState<{
    readonly ladder: typeof ladder;
    readonly target: Complex;
    readonly fit: FitResult | null;
  } | null>(null);
  const fit =
    solved &&
    solved.ladder === ladder &&
    solved.target.re === target.re &&
    solved.target.im === target.im
      ? solved.fit
      : null;
  /** With Realize on: the fitted values snapped, and the mismatch that leaves. */
  const snapped = useMemo(
    () => (fit && fit.after < fit.before ? snapFit(design, elements, fit) : null),
    [design, elements, fit],
  );

  const solve = (): void => {
    const indices = fittable.filter((i) => free.has(i));
    setSolved({ ladder, target, fit: fitToTarget(ladder, target, { indices }) });
  };
  const apply = (): void => {
    if (!fit) return;
    const store = useDesignStore.getState();
    // Only the primary values of the fitted parts change; the design's own elements keep
    // their Q, lock and identity.
    const source = snapped ? snapped.elements : fit.elements;
    const values: Element[] = [];
    for (const i of fit.indices) {
      const el = design.elements[i];
      const next = source[i];
      const v = next ? primaryValue(next) : null;
      if (el && v) values[i] = withPrimaryValue(el, v.value);
    }
    store.setElementValues(values);
    const n = fit.indices.length;
    const parts = `${n} part${n === 1 ? '' : 's'}`;
    store.setMessage(
      snapped
        ? `Tuned ${parts} to ${sourceName(design.realize)} values; Zin = ${fmtComplex(snapped.zin, 1)} Ω, VSWR ${fmtNum(snapped.vswr, 3)} towards the target`
        : fit.exact
          ? `Tuned ${parts} onto the target`
          : `Tuned ${parts}; nearest point is ${fmtComplex(fit.zin, 1)} Ω`,
    );
    onClose();
  };

  if (elements.length === 0) {
    return (
      <div className="dropdown-note">
        There are no parts to tune yet. Add some from the palette, or switch to "Add parts".
      </div>
    );
  }
  return (
    <>
      <div className="dropdown-note">
        Tick the parts that may change; locked and RLC parts stay as they are. Solve finds the
        values that put Zin on the target, nearest to the current ones.
        {design.realize.enabled &&
          ` Realize is on: the solved values are snapped to ${sourceName(design.realize)} and Apply uses the snapped ones.`}
      </div>
      <div className="free-parts">
        {elements.map((el, i) => {
          const can = fittable.includes(i);
          return (
            <label key={el.id} className={`check ${can ? '' : 'disabled'}`}>
              <input
                type="checkbox"
                disabled={!can}
                checked={can && free.has(i)}
                onChange={(e) => {
                  const next = new Set(free);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setFree(next);
                }}
              />
              <span className="idx" style={{ background: el.color }}>
                {i + 1}
              </span>
              {elementName(el)} <span className="mono muted">{elementSummary(el)}</span>
              {el.locked && <span className="muted small">locked</span>}
            </label>
          );
        })}
      </div>
      <div className="actions">
        <button
          className="btn primary"
          onClick={solve}
          disabled={!fittable.some((i) => free.has(i))}
        >
          Solve
        </button>
        {fit && (
          <button className="btn" onClick={apply} disabled={fit.after >= fit.before}>
            Apply
          </button>
        )}
      </div>
      {fit && (
        <>
          <div className={`row result ${fit.exact ? '' : 'danger'}`}>
            {fit.exact
              ? `Exact: Zin lands on ${fmtComplex(target, 1)} Ω.`
              : fit.after < fit.before
                ? `No exact solution with these parts; nearest is Zin = ${fmtComplex(fit.zin, 1)} Ω (chart distance ${fmtNum(fit.after, 3)}, was ${fmtNum(fit.before, 3)}).`
                : 'These parts cannot get any closer; free another one or add a part.'}
          </div>
          {snapped && (
            <div className="row result">
              With {snapped.sourceLabel} values: Zin = {fmtComplex(snapped.zin, 1)} &#937;, VSWR{' '}
              {fmtNum(snapped.vswr, 3)} towards the target (chart distance{' '}
              {fmtNum(snapped.distance, 3)}).
            </div>
          )}
          {fit.after < fit.before && (
            <table className="fit-table">
              {snapped && (
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Now</th>
                    <th>Solved</th>
                    <th>{snapped.sourceLabel}</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {fit.indices.map((i) => {
                  const next = fit.elements[i];
                  const el = elements[i];
                  if (!el || !next) return null;
                  const snap = snapped?.elements[i];
                  return (
                    <tr key={el.id}>
                      <td>
                        <span className="idx" style={{ background: el.color }}>
                          {i + 1}
                        </span>{' '}
                        {elementName(el)}
                      </td>
                      <td className="mono muted">{elementSummary(el)}</td>
                      <td className={`mono ${snapped ? 'muted' : ''}`}>
                        {elementSummary({ ...el, ...next })}
                      </td>
                      {snapped && (
                        <td className="mono">{snap ? elementSummary({ ...el, ...snap }) : ''}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
