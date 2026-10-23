/**
 * The small panel of the response view that adds and removes limit areas and
 * shows how each one stands against the current curves.
 */
import {
  formatEngineering,
  limitStatus,
  type LimitArea,
  type LimitQuantity,
  type Response,
} from '@smithonline/core';
import { useState } from 'react';
import { ValueInput } from '../components/ValueInput';
import { newId } from '../lib/design';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';

interface QuantityInfo {
  readonly key: LimitQuantity;
  readonly label: string;
  /** Unit of the limit value; `plain` fields are not given SI prefixes. */
  readonly unit: string;
  readonly plain: boolean;
  /** A sensible first limit when the quantity is picked. */
  readonly kind: 'min' | 'max';
  readonly value: number;
}

const LIMIT_INFO: readonly QuantityInfo[] = [
  { key: 's21Db', label: '|S21|', unit: 'dB', plain: true, kind: 'min', value: -1 },
  { key: 's11Db', label: '|S11|', unit: 'dB', plain: true, kind: 'max', value: -10 },
  { key: 'vswr', label: 'VSWR', unit: '', plain: true, kind: 'max', value: 2 },
  { key: 'r', label: 'R', unit: 'Ω', plain: false, kind: 'min', value: 25 },
  { key: 'x', label: 'X', unit: 'Ω', plain: false, kind: 'max', value: 25 },
  { key: 'phaseDeg', label: 'Phase S21', unit: '°', plain: true, kind: 'max', value: 0 },
  { key: 'groupDelay', label: 'Group delay', unit: 's', plain: false, kind: 'max', value: 1e-9 },
];

const INFO: Readonly<Record<LimitQuantity, QuantityInfo>> = Object.fromEntries(
  LIMIT_INFO.map((q) => [q.key, q]),
) as Record<LimitQuantity, QuantityInfo>;

/** "VSWR at most 2" style text of one area. */
function limitText(a: LimitArea): string {
  const q = INFO[a.quantity];
  const value = q.plain
    ? `${fmtNum(a.value, 3)}${q.unit ? ` ${q.unit}` : ''}`
    : formatEngineering(a.value, { unit: q.unit, digits: 3 });
  const lo = Math.min(a.f1, a.f2);
  const hi = Math.max(a.f1, a.f2);
  return `${q.label} ${a.kind === 'max' ? 'at most' : 'at least'} ${value}, ${fmtFrequency(lo)} to ${fmtFrequency(hi)}`;
}

interface LimitPanelProps {
  readonly response: Response | null;
}

export function LimitPanel({ response }: LimitPanelProps) {
  const limits = useDesignStore((s) => s.design.limits) ?? [];
  const sweep = useDesignStore((s) => s.design.sweep);
  const setLimits = useDesignStore((s) => s.setLimits);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<LimitArea, 'id'>>(() => ({
    quantity: 'vswr',
    f1: sweep.start,
    f2: sweep.stop,
    kind: 'max',
    value: 2,
  }));
  const info = INFO[draft.quantity];

  const add = (): void => {
    if (!(draft.f1 > 0) || !(draft.f2 > 0) || !Number.isFinite(draft.value)) return;
    setLimits([...limits, { id: newId(), ...draft }]);
  };

  return (
    <details
      className="limit-panel"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        Limit areas
        {limits.length > 0 && <span className="muted small"> ({limits.length})</span>}
      </summary>
      <div className="limit-form">
        <label>
          Quantity
          <select
            value={draft.quantity}
            aria-label="Limit quantity"
            onChange={(e) => {
              const q = INFO[e.target.value as LimitQuantity];
              setDraft({ ...draft, quantity: q.key, kind: q.kind, value: q.value });
            }}
          >
            {LIMIT_INFO.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Curve must stay
          <select
            value={draft.kind}
            aria-label="Limit direction"
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'min' | 'max' })}
          >
            <option value="max">below</option>
            <option value="min">above</option>
          </select>
        </label>
        <label>
          Value
          <ValueInput
            value={draft.value}
            unit={info.unit}
            plain={info.plain}
            digits={4}
            onCommit={(value) => setDraft({ ...draft, value })}
            ariaLabel="Limit value"
            width="86px"
          />
        </label>
        <label>
          From
          <ValueInput
            value={draft.f1}
            unit="Hz"
            min={1}
            onCommit={(f1) => setDraft({ ...draft, f1 })}
            ariaLabel="Limit start frequency"
            width="86px"
          />
        </label>
        <label>
          to
          <ValueInput
            value={draft.f2}
            unit="Hz"
            min={1}
            onCommit={(f2) => setDraft({ ...draft, f2 })}
            ariaLabel="Limit stop frequency"
            width="86px"
          />
        </label>
        <button className="btn" onClick={add} title="Add this area to the plots and the design">
          Add
        </button>
      </div>
      {limits.length > 0 && (
        <ul className="limit-list">
          {limits.map((a) => {
            const status = response ? limitStatus(a, response) : null;
            const q = INFO[a.quantity];
            const amount = (v: number): string =>
              q.plain
                ? `${fmtNum(Math.abs(v), 3)}${q.unit ? ` ${q.unit}` : ''}`
                : formatEngineering(Math.abs(v), { unit: q.unit, digits: 3 });
            return (
              <li key={a.id} className={status && status.worst > 0 ? 'breached' : ''}>
                <span className="text">{limitText(a)}</span>
                <span className="status small">
                  {status === null
                    ? response
                      ? 'no sweep point inside'
                      : ''
                    : status.worst > 0
                      ? `breached by ${Number.isFinite(status.worst) ? amount(status.worst) : 'a total reflection'} at ${fmtFrequency(status.frequency)}`
                      : `margin ${amount(status.worst)}`}
                </span>
                <button
                  className="btn tiny"
                  onClick={() => setLimits(limits.filter((l) => l.id !== a.id))}
                  aria-label={`Remove limit: ${limitText(a)}`}
                  title="Remove"
                >
                  &#215;
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
