import { formatEngineering, lineDimensions, type LineMedium } from '@smithonline/core';
import { useEffect, useRef } from 'react';
import { elementName } from '../lib/elements';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { SUBSTRATE_PRESETS, useSubstrateStore } from '../store/useSubstrateStore';
import { useHelp } from '../store/useHelp';
import { ValueInput } from './ValueInput';

interface DimensionsDialogProps {
  /** Index of the line or stub in the design. */
  readonly index: number;
  readonly onClose: () => void;
}

const metric = (v: number): string => formatEngineering(v, { unit: 'm', digits: 4 });

/**
 * QuickSmith's "dimensions instead of ohms": the track width and physical
 * length that realize a line or stub on the global substrate.
 */
export function DimensionsDialog({ index, onClose }: DimensionsDialogProps) {
  const design = useDesignStore((s) => s.design);
  const substrate = useSubstrateStore((s) => s.substrate);
  const { setSubstrate } = useSubstrateStore.getState();
  const { updateElement, setMessage } = useDesignStore.getState();
  const el = design.elements[index];
  const dialog = useRef<HTMLDivElement>(null);

  // Focus moves into the dialog, Tab stays inside it, and focus goes back to where it was on close.
  useEffect(() => {
    const before = document.activeElement;
    dialog.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>('input, select, button:not(:disabled)'),
      ];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onTab, true);
    return () => {
      window.removeEventListener('keydown', onTab, true);
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // the help dialog stacked on top takes the Escape
      if (e.key === 'Escape' && !useHelp.getState().open) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!el || (el.kind !== 'line' && el.kind !== 'openStub' && el.kind !== 'shortStub')) {
    return null;
  }

  const frequency = el.refFrequency ?? design.frequency;
  const microstrip = substrate.medium === 'microstrip';
  const medium: LineMedium = microstrip
    ? { medium: 'microstrip', er: substrate.er, h: substrate.h, t: substrate.t }
    : {
        medium: 'coax',
        er: substrate.coaxEr,
        given: substrate.coaxGiven,
        diameter: substrate.coaxDiameter,
      };
  const dims = lineDimensions(medium, el.z0, el.length, frequency);
  const preset = SUBSTRATE_PRESETS.find((p) => p.er === substrate.er && p.h === substrate.h);

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        ref={dialog}
        className="modal dimensions"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dimensions-title"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tool-head">
          <strong id="dimensions-title">Dimensions</strong>
          <span className="muted">
            {elementName(el)} {index + 1}: Z0 {fmtNum(el.z0, 2)} Ω, l/&#955; {el.length.toFixed(5)}{' '}
            at {fmtFrequency(frequency)}
          </span>
          <button className="btn tiny" onClick={onClose} aria-label="Close dimensions dialog">
            &#215;
          </button>
        </div>

        <div className="seg" role="group" aria-label="Medium">
          <button
            className={`btn ${microstrip ? 'on' : ''}`}
            onClick={() => setSubstrate({ medium: 'microstrip' })}
          >
            Microstrip
          </button>
          <button
            className={`btn ${microstrip ? '' : 'on'}`}
            onClick={() => setSubstrate({ medium: 'coax' })}
          >
            Coax
          </button>
        </div>

        {microstrip ? (
          <div className="dim-fields">
            <label>
              Substrate
              <select
                value={preset?.id ?? 'custom'}
                aria-label="Substrate preset"
                onChange={(e) => {
                  const p = SUBSTRATE_PRESETS.find((x) => x.id === e.target.value);
                  if (p) setSubstrate({ er: p.er, h: p.h });
                }}
              >
                {SUBSTRATE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {!preset && <option value="custom">Custom</option>}
              </select>
            </label>
            <label>
              &#949;r
              <ValueInput
                value={substrate.er}
                plain
                min={1}
                onCommit={(er) => setSubstrate({ er })}
                ariaLabel="Substrate relative permittivity"
              />
            </label>
            <label title="Substrate height">
              h
              <ValueInput
                value={substrate.h}
                unit="m"
                min={1e-9}
                onCommit={(h) => setSubstrate({ h })}
                ariaLabel="Substrate height"
              />
            </label>
            <label title="Copper thickness; 0 ignores it. It makes the track electrically wider, so the same impedance needs a narrower track">
              t
              <ValueInput
                value={substrate.t}
                unit="m"
                min={0}
                onCommit={(t) => setSubstrate({ t })}
                ariaLabel="Conductor thickness"
              />
            </label>
          </div>
        ) : (
          <div className="dim-fields">
            <label>
              &#949;r
              <ValueInput
                value={substrate.coaxEr}
                plain
                min={1}
                onCommit={(coaxEr) => setSubstrate({ coaxEr })}
                ariaLabel="Dielectric relative permittivity"
              />
            </label>
            <label title="Which diameter you know; the impedance fixes the other one">
              Given
              <select
                value={substrate.coaxGiven}
                aria-label="Which diameter is given"
                onChange={(e) => setSubstrate({ coaxGiven: e.target.value as 'inner' | 'outer' })}
              >
                <option value="outer">Outer bore</option>
                <option value="inner">Inner conductor</option>
              </select>
            </label>
            <label>
              &#8960;
              <ValueInput
                value={substrate.coaxDiameter}
                unit="m"
                min={1e-9}
                onCommit={(coaxDiameter) => setSubstrate({ coaxDiameter })}
                ariaLabel="Given diameter"
              />
            </label>
          </div>
        )}

        {dims ? (
          <dl className="dim-results" aria-label="Dimensions">
            {dims.medium === 'microstrip' ? (
              <>
                <dt>Track width</dt>
                <dd className="mono big">{metric(dims.width ?? 0)}</dd>
                <dt>W/h</dt>
                <dd className="mono">{fmtNum(dims.wOverH ?? 0, 3)}</dd>
              </>
            ) : (
              <>
                <dt>Inner conductor</dt>
                <dd className="mono big">&#8960; {metric(dims.inner ?? 0)}</dd>
                <dt>Outer bore</dt>
                <dd className="mono big">&#8960; {metric(dims.outer ?? 0)}</dd>
                <dt>Outer / inner</dt>
                <dd className="mono">{fmtNum(dims.ratio ?? 0, 4)}</dd>
              </>
            )}
            <dt>&#949;eff</dt>
            <dd className="mono">{fmtNum(dims.eeff, 4)}</dd>
            <dt>Physical length</dt>
            <dd className="mono big">{metric(dims.length)}</dd>
          </dl>
        ) : (
          <p className="hint">Enter positive values to see the dimensions.</p>
        )}

        <div className="dropdown-note">
          The substrate is shared by all lines and stubs and is kept in this browser. Quasi-static
          model, good to about 1 % for W/h from 0.05 to 20; no dispersion.
        </div>
        <div className="actions">
          {el.kind === 'line' && dims && (
            <button
              className="btn primary"
              disabled={Math.abs((el.er ?? 1) - dims.eeff) < 1e-9}
              title="Use the effective permittivity as the line's er, so its physical length matches"
              onClick={() => {
                updateElement(index, { ...el, er: dims.eeff });
                setMessage(`Line ${index + 1}: εr set to ${dims.eeff.toFixed(4)} (εeff)`);
              }}
            >
              Set line &#949;r = &#949;eff
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
