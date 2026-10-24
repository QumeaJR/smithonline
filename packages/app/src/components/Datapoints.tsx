import { complex } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { MAX_DATAPOINTS, startIndex, userDatapoints, twinOf } from '../lib/datapoints';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { ValueInput } from './ValueInput';

/**
 * The user datapoints DP1..DPn: pick the one the network starts from, edit
 * or remove each, and add more by typing impedance and frequency or by
 * clicking the chart in datapoint input mode. The start is the one in the
 * load card above; its row here follows it.
 */
export function Datapoints() {
  const design = useDesignStore((s) => s.design);
  const input = useDesignStore((s) => s.datapointInput);
  const { setDatapointInput, setStartDatapoint, setDatapoint, removeDatapoint, addDatapoint } =
    useDesignStore.getState();
  const points = userDatapoints(design);
  const start = startIndex(design);
  // The new datapoint's frequency follows the design until the user types one.
  const [draft, setDraft] = useState<{ re: number; im: number; frequency: number | null }>({
    re: 50,
    im: 0,
    frequency: null,
  });
  const rowRef = useRef<HTMLDivElement>(null);
  const add = (): void => {
    const frequency = draft.frequency ?? design.frequency;
    const z = complex(draft.re, draft.im);
    const n = points.length + 1;
    const twin = twinOf(points, { frequency, z });
    if (twin >= 0) {
      useDesignStore
        .getState()
        .setMessage(`DP${twin + 1} already has these values; nothing added.`);
      return;
    }
    addDatapoint({ frequency, z });
    if (userDatapoints(useDesignStore.getState().design).length === n) {
      // The store announces the point; the row starts afresh so a second Enter cannot add it twice.
      setDraft({ re: 50, im: 0, frequency: null });
    }
    // Keep typing: the focus stays in the row for the next datapoint.
    rowRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  };
  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  });
  const full = points.length >= MAX_DATAPOINTS;

  return (
    <div className="card datapoints-card">
      <div className="row">
        <span className="name">Datapoints</span>
        <span className="muted small">
          {points.length === 1 ? 'one user datapoint' : `${points.length} user datapoints`}
        </span>
        <span className="actions">
          <button
            className={`btn tiny ${input ? 'on' : ''}`}
            onClick={() => setDatapointInput(!input)}
            aria-pressed={input}
            disabled={full && !input}
            title="Datapoint input: every click on the chart adds a user datapoint at the design frequency. Escape or this button ends it."
          >
            Click chart
          </button>
        </span>
      </div>
      {input && (
        <p className="muted small hint">
          Datapoint input: click the chart to add DP{points.length + 1}, press Escape to stop.
        </p>
      )}
      {points.length > 1 && (
        <ul className="dp-list" aria-label="User datapoints">
          {points.map((p, i) => (
            <li key={i} className={i === start ? 'start' : ''}>
              <label className="start-pick" title="The network starts from this datapoint">
                <input
                  type="radio"
                  name="dp-start"
                  checked={i === start}
                  onChange={() => setStartDatapoint(i)}
                  aria-label={`Start the network at DP${i + 1}`}
                />
                <span className="dp-name">DP{i + 1}</span>
              </label>
              <span className="mono muted small dp-sum">
                {fmtComplex(p.z)} Ω at {fmtFrequency(p.frequency)}
              </span>
              <button
                className="btn tiny"
                onClick={() => removeDatapoint(i)}
                title={`Remove DP${i + 1}`}
                aria-label={`Remove DP${i + 1}`}
              >
                &#215;
              </button>
              <div className="dp-fields">
                <ValueInput
                  value={p.frequency}
                  unit="Hz"
                  min={1}
                  onCommit={(frequency) => setDatapoint(i, { frequency })}
                  ariaLabel={`DP${i + 1} frequency`}
                />
                <ValueInput
                  value={p.z.re}
                  unit={'Ω'}
                  onCommit={(re) => setDatapoint(i, { z: complex(re, p.z.im) })}
                  ariaLabel={`DP${i + 1} resistance`}
                />
                <ValueInput
                  value={p.z.im}
                  unit={'Ω'}
                  onCommit={(im) => setDatapoint(i, { z: complex(p.z.re, im) })}
                  ariaLabel={`DP${i + 1} reactance`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div
        className="row fields dp-add"
        ref={rowRef}
        onKeyDown={(e) => {
          // Enter in a field adds the row; the field commits its own value first, so add on the
          // next tick. The button activates itself on Enter, so it is left alone.
          if ((e.target as HTMLElement).tagName === 'BUTTON') return;
          if (e.key === 'Enter' && !full) setTimeout(() => addRef.current(), 0);
        }}
      >
        <ValueInput
          value={draft.frequency ?? design.frequency}
          unit="Hz"
          min={1}
          onCommit={(frequency) => setDraft({ ...draft, frequency })}
          ariaLabel="New datapoint frequency"
          title="Frequency of the new datapoint"
        />
        <ValueInput
          value={draft.re}
          unit={'Ω'}
          onCommit={(re) => setDraft({ ...draft, re })}
          ariaLabel="New datapoint resistance"
        />
        <ValueInput
          value={draft.im}
          unit={'Ω'}
          onCommit={(im) => setDraft({ ...draft, im })}
          ariaLabel="New datapoint reactance"
        />
        <button
          className="btn tiny"
          disabled={full}
          onClick={add}
          title="Add a user datapoint with these values"
        >
          Add DP{points.length + 1}
        </button>
      </div>
    </div>
  );
}
