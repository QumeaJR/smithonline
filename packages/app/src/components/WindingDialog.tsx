/**
 * Inductor winding helper opened from an inductor card: an air-core solenoid
 * (Wheeler) or a toroid (AL value), the turns and the wire length, and a
 * button that writes the result into the card's note.
 */
import {
  formatEngineering,
  solenoidTurns,
  TOROID_CORES,
  toroidTurnLength,
  toroidTurns,
  type ToroidCore,
} from '@smithonline/core';
import { useMemo, useState } from 'react';
import { loadCores, saveCores, solenoidNote, toroidNote } from '../lib/winding';
import { useDesignStore } from '../store/useDesignStore';
import { ValueInput } from './ValueInput';
import { Dialog } from './ui/Dialog';
import { IconClose } from './ui/icons';

interface WindingDialogProps {
  /** Index of the inductor in the ladder. */
  readonly index: number;
  readonly onClose: () => void;
}

type Mode = 'air' | 'toroid';

const mm = (m: number): string => `${Number((m * 1e3).toPrecision(4))} mm`;

export function WindingDialog({ index, onClose }: WindingDialogProps) {
  const element = useDesignStore((s) => s.design.elements[index]);
  const { updateElement, setMessage } = useDesignStore.getState();
  const [mode, setMode] = useState<Mode>('air');
  const [inductance, setInductance] = useState(element?.kind === 'L' ? element.value : 1e-6);
  const [leads, setLeads] = useState(0.04);
  // Air core.
  const [diameter, setDiameter] = useState(0.01);
  const [by, setBy] = useState<'length' | 'pitch'>('pitch');
  const [length, setLength] = useState(0.02);
  const [pitch, setPitch] = useState(0.0012);
  // Toroid.
  const [cores, setCores] = useState<ToroidCore[]>(loadCores);
  const [coreName, setCoreName] = useState(cores[0]?.name ?? '');
  const [tableOpen, setTableOpen] = useState(false);
  const [saved, setSaved] = useState(true);

  const core = cores.find((c) => c.name === coreName) ?? cores[0];
  const air = useMemo(
    () =>
      solenoidTurns({
        inductance,
        diameter,
        leads,
        ...(by === 'length' ? { length } : { pitch }),
      }),
    [inductance, diameter, leads, by, length, pitch],
  );
  const toroid = useMemo(
    () =>
      core
        ? toroidTurns({
            inductance,
            al: core.al,
            turnLength: toroidTurnLength(core),
            leads,
          })
        : null,
    [inductance, core, leads],
  );

  const changeCores = (next: ToroidCore[]): void => {
    setCores(next);
    setSaved(saveCores(next));
  };
  const editCore = (i: number, patch: Partial<ToroidCore>): void =>
    changeCores(cores.map((c, k) => (k === i ? { ...c, ...patch } : c)));

  if (!element) return null;

  const write = (): void => {
    const note =
      mode === 'air'
        ? air && solenoidNote(air, diameter, by === 'pitch' ? pitch : null)
        : toroid && core && toroidNote(core.name, toroid);
    if (!note) return;
    updateElement(index, { ...element, note });
    setMessage('Winding written to the note of the inductor');
    onClose();
  };
  const result = mode === 'air' ? air : toroid;

  return (
    <Dialog
      title="Winding"
      subtitle="turns and wire for an inductor"
      onClose={onClose}
      closeLabel="Close winding dialog"
      className="winding"
      draggable="winding"
      footer={
        <>
          <button className="btn primary" onClick={write} disabled={result === null}>
            Write note to the card
          </button>
          <button className="btn dialog-close" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="winding-row">
        <label>
          Inductance
          <ValueInput
            value={inductance}
            unit="H"
            min={1e-12}
            onCommit={setInductance}
            ariaLabel="Inductance to wind"
            width="8em"
          />
        </label>
        <label>
          Leads, total
          <ValueInput
            value={leads}
            unit="m"
            min={0}
            onCommit={setLeads}
            ariaLabel="Wire for the leads"
            width="6em"
          />
        </label>
        <span className="tabs" role="tablist" aria-label="Winding type">
          <button
            className={`btn ${mode === 'air' ? 'on' : ''}`}
            role="tab"
            aria-selected={mode === 'air'}
            onClick={() => setMode('air')}
          >
            Air-core solenoid
          </button>
          <button
            className={`btn ${mode === 'toroid' ? 'on' : ''}`}
            role="tab"
            aria-selected={mode === 'toroid'}
            onClick={() => setMode('toroid')}
          >
            Toroid
          </button>
        </span>
      </div>

      {mode === 'air' ? (
        <div className="winding-row">
          <label title="Diameter of the winding measured to the centre of the wire">
            Mean diameter
            <ValueInput
              value={diameter}
              unit="m"
              min={1e-4}
              onCommit={setDiameter}
              ariaLabel="Mean diameter of the winding"
              width="6em"
            />
          </label>
          <label>
            Given
            <select
              value={by}
              aria-label="Length or pitch"
              onChange={(e) => setBy(e.target.value as 'length' | 'pitch')}
            >
              <option value="pitch">turn pitch (wire diameter if close wound)</option>
              <option value="length">winding length</option>
            </select>
          </label>
          {by === 'pitch' ? (
            <label>
              Pitch
              <ValueInput
                value={pitch}
                unit="m"
                min={1e-5}
                onCommit={setPitch}
                ariaLabel="Turn pitch"
                width="6em"
              />
            </label>
          ) : (
            <label>
              Length
              <ValueInput
                value={length}
                unit="m"
                min={1e-4}
                onCommit={setLength}
                ariaLabel="Winding length"
                width="6em"
              />
            </label>
          )}
        </div>
      ) : (
        <div className="winding-row">
          <label>
            Core
            <select
              value={core?.name ?? ''}
              aria-label="Toroid core"
              onChange={(e) => setCoreName(e.target.value)}
            >
              {cores.map((c, i) => (
                <option key={i} value={c.name}>
                  {c.name} (AL {c.al} nH)
                </option>
              ))}
            </select>
          </label>
          {core && (
            <span className="muted small">
              {core.od} x {core.id} x {core.height} mm, one turn is {mm(toroidTurnLength(core))} of
              wire
            </span>
          )}
          <button className="btn tiny" onClick={() => setTableOpen(!tableOpen)}>
            {tableOpen ? 'Hide core table' : 'Edit core table'}
          </button>
        </div>
      )}

      {mode === 'toroid' && tableOpen && (
        <div className="core-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>AL, nH</th>
                <th>OD, mm</th>
                <th>ID, mm</th>
                <th>Height, mm</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cores.map((c, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={c.name}
                      aria-label={`Core name ${i + 1}`}
                      onChange={(e) => {
                        if (c.name === coreName) setCoreName(e.target.value);
                        editCore(i, { name: e.target.value });
                      }}
                    />
                  </td>
                  {(['al', 'od', 'id', 'height'] as const).map((k) => (
                    <td key={k}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={c[k]}
                        aria-label={`${c.name} ${k}`}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (v > 0) editCore(i, { [k]: v });
                        }}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="btn icon sm"
                      aria-label={`Remove core ${c.name}`}
                      onClick={() => changeCores(cores.filter((_, k) => k !== i))}
                      disabled={cores.length <= 1}
                    >
                      <IconClose size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <button
              className="btn tiny"
              onClick={() =>
                changeCores([
                  ...cores,
                  { name: `Core ${cores.length + 1}`, al: 10, od: 20, id: 10, height: 8 },
                ])
              }
            >
              Add core
            </button>
            <button className="btn tiny" onClick={() => changeCores([...TOROID_CORES])}>
              Reset to the built-in table
            </button>
            <span className="muted small">
              AL values were written from memory of the public data sheets: check them before
              winding.{saved ? '' : ' The table is not kept (browser storage is blocked).'}
            </span>
          </div>
        </div>
      )}

      <div className="winding-result" aria-live="polite">
        {result === null ? (
          <span className="muted">Enter positive values.</span>
        ) : mode === 'air' && air ? (
          <>
            <div>
              <strong>
                {air.turns} {air.turns === 1 ? 'turn' : 'turns'}
              </strong>{' '}
              <span className="muted">({air.exactTurns.toFixed(2)} exactly)</span>, winding length{' '}
              {mm(air.length)}, wire {mm(air.wireLength)}.
            </div>
            <div>
              With whole turns: {formatEngineering(air.inductance, { unit: 'H', digits: 4 })} (
              {(((air.inductance - inductance) / inductance) * 100).toFixed(1)} %).
            </div>
            {air.warning && <div className="warn">{air.warning}</div>}
          </>
        ) : toroid ? (
          <>
            <div>
              <strong>
                {toroid.turns} {toroid.turns === 1 ? 'turn' : 'turns'}
              </strong>{' '}
              <span className="muted">({toroid.exactTurns.toFixed(2)} exactly)</span>, wire{' '}
              {toroid.wireLength !== null ? mm(toroid.wireLength) : 'unknown'}.
            </div>
            <div>
              With whole turns: {formatEngineering(toroid.inductance, { unit: 'H', digits: 4 })} (
              {(((toroid.inductance - inductance) / inductance) * 100).toFixed(1)} %). Count each
              pass through the hole as one turn; AL has a tolerance of several percent.
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
