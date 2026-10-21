import { E_SERIES, E_SERIES_TOLERANCE, parseStock, type RealizeScope } from '@smithonline/core';
import { useMemo } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { ValueInput } from './ValueInput';

const SCOPE_LABELS: Readonly<Record<RealizeScope, string>> = {
  all: 'All parts',
  L: 'Inductors only',
  C: 'Capacitors only',
  R: 'Resistors only',
  pairs: 'L-C pairs, keep resonance',
};

/**
 * The Realize and Losses switches of the network panel header with their
 * settings: series or own stock, scope, and the default Q values.
 */
export function RealizeControls() {
  const realize = useDesignStore((s) => s.design.realize);
  const losses = useDesignStore((s) => s.design.losses);
  const { setRealize, setLosses } = useDesignStore.getState();
  const stock = useMemo(
    () => (realize.series === 'stock' ? parseStock(realize.stockText) : null),
    [realize.series, realize.stockText],
  );

  return (
    <div className="realize-controls">
      <div className="row">
        <label
          className="check"
          title="Snap the values to standard parts and show the realized network"
        >
          <input
            type="checkbox"
            checked={realize.enabled}
            onChange={(e) => setRealize({ enabled: e.target.checked })}
          />
          Realize
        </label>
        {realize.enabled && (
          <>
            <select
              value={realize.series}
              onChange={(e) => setRealize({ series: e.target.value as typeof realize.series })}
              aria-label="Value series"
              title="Standard series after IEC 60063, or the values you have in stock"
            >
              {E_SERIES.map((s) => (
                <option key={s} value={s}>
                  {s} ({Math.round(E_SERIES_TOLERANCE[s] * 100)} %)
                </option>
              ))}
              <option value="stock">My stock</option>
            </select>
            <select
              value={realize.scope}
              onChange={(e) => setRealize({ scope: e.target.value as RealizeScope })}
              aria-label="Realize scope"
              title="Which parts are snapped"
            >
              {(Object.keys(SCOPE_LABELS) as RealizeScope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABELS[s]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {realize.enabled && realize.series === 'stock' && (
        <div className="stock">
          <textarea
            value={realize.stockText}
            onChange={(e) => setRealize({ stockText: e.target.value })}
            placeholder={
              'Values you have, one per line or comma separated:\n10 nH, 15 nH, 22 nH\n4.7 pF, 10 pF\n51 Ω'
            }
            rows={4}
            spellCheck={false}
            aria-label="Stock list"
          />
          {stock && (
            <div className="muted small">
              {stock.L.length} inductor, {stock.C.length} capacitor and {stock.R.length} resistor
              values. A value without a unit counts for all three.
            </div>
          )}
        </div>
      )}
      <div className="row">
        <label
          className="check"
          title="Give inductors and capacitors without a Q of their own these default Q values"
        >
          <input
            type="checkbox"
            checked={losses.enabled}
            onChange={(e) => setLosses({ enabled: e.target.checked })}
          />
          Losses
        </label>
        {losses.enabled && (
          <>
            <label className="field" title="Default inductor Q">
              Q<sub>L</sub>
              <ValueInput
                value={losses.inductorQ}
                plain
                min={0}
                width="4.5em"
                onCommit={(inductorQ) => setLosses({ inductorQ })}
                ariaLabel="Default inductor Q"
              />
            </label>
            <label className="field" title="Default capacitor Q">
              Q<sub>C</sub>
              <ValueInput
                value={losses.capacitorQ}
                plain
                min={0}
                width="4.5em"
                onCommit={(capacitorQ) => setLosses({ capacitorQ })}
                ariaLabel="Default capacitor Q"
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
