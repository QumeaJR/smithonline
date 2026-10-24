import { complex } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { MAX_DATAPOINTS, startIndex, userDatapoints, twinOf } from '../lib/datapoints';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { Button, IconButton } from './ui/Button';
import { Field } from './ui/Field';
import { IconClose } from './ui/icons';
import { Switch } from './ui/Switch';

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
          <Switch
            checked={input}
            onChange={setDatapointInput}
            disabled={full && !input}
            title="Datapoint input: every click on the chart adds a user datapoint at the design frequency. Escape or this switch ends it."
          >
            Click chart
          </Switch>
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
              <IconButton
                size="sm"
                icon={<IconClose size={13} />}
                label={`Remove DP${i + 1}`}
                onClick={() => removeDatapoint(i)}
              />
              <div className="dp-fields">
                <Field
                  value={p.frequency}
                  unit="Hz"
                  min={1}
                  onCommit={(frequency) => setDatapoint(i, { frequency })}
                  ariaLabel={`DP${i + 1} frequency`}
                />
                <Field
                  value={p.z.re}
                  unit={'Ω'}
                  onCommit={(re) => setDatapoint(i, { z: complex(re, p.z.im) })}
                  ariaLabel={`DP${i + 1} resistance`}
                />
                <Field
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
        <Field
          label="f"
          value={draft.frequency ?? design.frequency}
          unit="Hz"
          min={1}
          onCommit={(frequency) => setDraft({ ...draft, frequency })}
          ariaLabel="New datapoint frequency"
          title="Frequency of the new datapoint"
        />
        <Field
          label="R"
          value={draft.re}
          unit={'Ω'}
          onCommit={(re) => setDraft({ ...draft, re })}
          ariaLabel="New datapoint resistance"
          title="Resistance R of the new datapoint, Z = R + jX"
        />
        <Field
          label="X"
          value={draft.im}
          unit={'Ω'}
          onCommit={(im) => setDraft({ ...draft, im })}
          ariaLabel="New datapoint reactance"
          title="Reactance X of the new datapoint, Z = R + jX"
        />
        <Button
          size="sm"
          disabled={full}
          onClick={add}
          title="Add a user datapoint with these values"
        >
          Add DP{points.length + 1}
        </Button>
      </div>
    </div>
  );
}
