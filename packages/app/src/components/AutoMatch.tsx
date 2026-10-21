import { complex, type Complex, type MatchSolution } from '@smithonline/core';
import { useMemo, useState } from 'react';
import { fmtComplex, fmtNum } from '../lib/format';
import { matchSolutions, minimumQ, type Topology } from '../lib/match';
import { useDesignStore } from '../store/useDesignStore';
import { SolutionList } from './SolutionList';
import { ValueInput } from './ValueInput';

interface AutoMatchProps {
  /** The impedance the network starts from: Zin of the current ladder. */
  readonly zin: Complex;
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
}

/**
 * Closed-form matching from Zin to a target: the L-networks, or a Pi or T at
 * a chosen loaded Q. Solutions are ranked by Q; hovering one previews it on
 * the chart, clicking adds its elements at the source end of the ladder.
 */
export function AutoMatch({ zin, onPreview, onClose }: AutoMatchProps) {
  const design = useDesignStore((s) => s.design);
  const [useZ0, setUseZ0] = useState(true);
  const [typed, setTyped] = useState<Complex>(() => complex(design.z0, 0));
  const [topology, setTopology] = useState<Topology>('L');
  const target = useZ0 ? complex(design.z0, 0) : typed;
  const minQ = useMemo(
    () => (topology === 'L' ? 0 : minimumQ(topology, zin, target)),
    [topology, zin, target],
  );
  const [q, setQ] = useState<number | null>(null);
  // The first Q on offer sits a little above the lowest one that works.
  const effectiveQ = q ?? (Number.isFinite(minQ) ? Math.ceil(minQ + 1) : 5);
  const solutions = useMemo(
    () => matchSolutions(topology, zin, target, design.z0, design.frequency, effectiveQ),
    [topology, zin, target, design.z0, design.frequency, effectiveQ],
  );

  const apply = (sol: MatchSolution): void => {
    const store = useDesignStore.getState();
    for (const el of sol.elements) store.addElement(el);
    store.setMessage(`Added ${sol.description} (Q ${fmtNum(sol.q, 2)})`);
    onClose();
  };

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
          <input type="radio" checked={useZ0} onChange={() => setUseZ0(true)} />
          Z0 = {fmtNum(design.z0, 1)} &#937;
        </label>
        <label>
          <input type="radio" checked={!useZ0} onChange={() => setUseZ0(false)} />
          Target
        </label>
        <label>
          R
          <ValueInput
            value={typed.re}
            unit="Ω"
            min={1e-6}
            onCommit={(re) => {
              setTyped({ ...typed, re });
              setUseZ0(false);
            }}
            width="5.5em"
            ariaLabel="Target resistance"
          />
        </label>
        <label>
          X
          <ValueInput
            value={typed.im}
            unit="Ω"
            onCommit={(im) => {
              setTyped({ ...typed, im });
              setUseZ0(false);
            }}
            width="5.5em"
            ariaLabel="Target reactance"
          />
        </label>
      </div>
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
          ? 'One- and two-element networks, lowest Q first. Hover to preview, click to add.'
          : Number.isFinite(minQ)
            ? `Loaded Q of the network; it must be above ${fmtNum(minQ, 2)}, the Q of the plain L-network, and a higher Q is a narrower match. Hover to preview, click to add.`
            : 'The target and Zin need a resistance above zero.'}
      </div>
      <SolutionList
        solutions={solutions}
        empty={
          topology === 'L'
            ? 'No one- or two-element network reaches this target from Zin.'
            : `No ${topology} network at this Q; raise it above ${fmtNum(minQ, 2)}.`
        }
        onPreview={onPreview}
        onApply={apply}
      />
    </div>
  );
}
