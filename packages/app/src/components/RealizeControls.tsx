import {
  E_SERIES,
  E_SERIES_TOLERANCE,
  parseStockReport,
  type RealizeScope,
  type StockReport,
  type StockSkip,
} from '@smithonline/core';
import { useMemo } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';

const SCOPE_LABELS: Readonly<Record<RealizeScope, string>> = {
  all: 'All parts',
  L: 'Inductors only',
  C: 'Capacitors only',
  R: 'Resistors only',
  pairs: 'L-C pairs, keep resonance',
};

const SKIP_REASONS: Readonly<Record<StockSkip, string>> = {
  unreadable: 'not a number',
  'no unit': 'no unit, while other values have one',
  'decimal comma':
    'a decimal comma or a separator? write a decimal point, and a blank after each comma',
  thousands:
    'a thousands separator or a decimal comma? leave the comma out or write a decimal point',
  unit: 'not H, F or Ω',
};

/** The entries the stock list left out, quoted with the reason: `Skipped "47" (no unit ...).` */
function skippedText(skipped: StockReport['skipped']): string {
  const shown = skipped
    .slice(0, 4)
    .map(
      (s) =>
        `"${s.text.length > 16 ? `${s.text.slice(0, 15)}…` : s.text}" (${SKIP_REASONS[s.reason]})`,
    );
  const more = skipped.length > 4 ? ` and ${skipped.length - 4} more` : '';
  return `Skipped ${shown.join(', ')}${more}.`;
}

/**
 * The Realize and Losses switches of the network panel header, side by side
 * on one row, with their settings under them only while they are on: series
 * or own stock and scope for Realize, the default Q values for Losses.
 */
export function RealizeControls() {
  const realize = useDesignStore((s) => s.design.realize);
  const losses = useDesignStore((s) => s.design.losses);
  const { setRealize, setLosses } = useDesignStore.getState();
  const stock = useMemo(
    () => (realize.series === 'stock' ? parseStockReport(realize.stockText) : null),
    [realize.series, realize.stockText],
  );

  return (
    <div className="realize-controls">
      <div className="row switches">
        <Switch
          className="mode"
          title="Snap the values to standard parts and show the realized network"
          checked={realize.enabled}
          onChange={(enabled) => setRealize({ enabled })}
        >
          Realize
        </Switch>
        <Switch
          className="mode"
          title="Give inductors and capacitors without a Q of their own these default Q values"
          checked={losses.enabled}
          onChange={(enabled) => setLosses({ enabled })}
        >
          Losses
        </Switch>
      </div>
      {realize.enabled && (
        <div className="row realize-options" role="group" aria-label="Realize settings">
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
        </div>
      )}
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
              {stock.stock.L.length} inductor, {stock.stock.C.length} capacitor and{' '}
              {stock.stock.R.length} resistor values. A value without a unit counts for all three
              only when no value has a unit; R notation (4R7) is a resistor.
              {stock.skipped.length > 0 && <> {skippedText(stock.skipped)}</>}
            </div>
          )}
        </div>
      )}
      {losses.enabled && (
        <div className="row loss-options" role="group" aria-label="Default Q values">
          <Field
            className="field"
            label={
              <>
                Q<sub>L</sub>
              </>
            }
            title="Default inductor Q"
            value={losses.inductorQ}
            plain
            min={0}
            width="calc(6ch + 8px)"
            onCommit={(inductorQ) => setLosses({ inductorQ })}
            ariaLabel="Default inductor Q"
          />
          <Field
            className="field"
            label={
              <>
                Q<sub>C</sub>
              </>
            }
            title="Default capacitor Q"
            value={losses.capacitorQ}
            plain
            min={0}
            width="calc(6ch + 8px)"
            onCommit={(capacitorQ) => setLosses({ capacitorQ })}
            ariaLabel="Default capacitor Q"
          />
        </div>
      )}
    </div>
  );
}
