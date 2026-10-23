import { useEffect, useState } from 'react';
import {
  COLOR_LABELS,
  WIDTH_RANGE,
  type ColorKey,
  type LabelDensity,
  type SchematicDirection,
} from '../lib/settings';
import { useSettings } from '../store/useSettings';
import { ValueInput } from './ValueInput';

interface SettingsDialogProps {
  readonly onClose: () => void;
}

const COLOR_KEYS = Object.keys(COLOR_LABELS) as ColorKey[];

/** The colour a theme shows for a setting that has none of its own, read from the stylesheet. */
function themeColor(key: ColorKey): string {
  const name = {
    gridZ: '--grid-z',
    gridY: '--grid-y',
    datapoints: '--marker',
    sweep: '--sweep',
    vswr: '--vswr',
    q: '--q',
  }[key];
  // The root's inline style holds the user's colours; the theme's own value is what a reset brings back.
  const root = document.documentElement;
  const inline = root.style.getPropertyValue(name);
  root.style.removeProperty(name);
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  if (inline) root.style.setProperty(name, inline);
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080';
}

/**
 * The original's settings dialog: colours, line widths, label density,
 * the frequency and Z0 a new design starts with and the schematic direction.
 * Changes apply and are stored at once.
 */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const settings = useSettings((s) => s.settings);
  const { update, setColor, setPaletteColor, reset } = useSettings.getState();
  const [, redraw] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="tool-head">
          <strong id="settings-title">Settings</strong>
          <span className="muted">stored in this browser</span>
          <button className="btn tiny" onClick={onClose} aria-label="Close settings">
            &#215;
          </button>
        </div>

        <h3>Colours</h3>
        <div className="settings-grid">
          {COLOR_KEYS.map((key) => {
            const own = settings.colors[key];
            return (
              <label key={key} className="swatch-row">
                <input
                  type="color"
                  value={own ?? themeColor(key)}
                  onChange={(e) => setColor(key, e.target.value)}
                  aria-label={`${COLOR_LABELS[key]} colour`}
                />
                <span>{COLOR_LABELS[key]}</span>
                <button
                  className="btn tiny"
                  disabled={own === null}
                  onClick={(e) => {
                    e.preventDefault();
                    setColor(key, null);
                    redraw((n) => n + 1);
                  }}
                  title="Back to the theme colour"
                >
                  Theme
                </button>
              </label>
            );
          })}
        </div>

        <h3>Element colours</h3>
        <div
          className="palette-row"
          role="group"
          aria-label="Element colours, in the order new elements get them"
        >
          {settings.palette.map((c, i) => (
            <input
              key={i}
              type="color"
              value={c}
              onChange={(e) => setPaletteColor(i, e.target.value)}
              aria-label={`Element colour ${i + 1}`}
            />
          ))}
        </div>
        <p className="muted small">
          Used for new elements; those already in the network keep theirs.
        </p>

        <h3>Lines and labels</h3>
        <div className="settings-grid">
          <label className="slider-row">
            <span>Grid lines</span>
            <input
              type="range"
              {...WIDTH_RANGE}
              value={settings.gridWidth}
              onChange={(e) => update({ gridWidth: Number(e.target.value) })}
              aria-label="Grid line width"
            />
            <span className="mono small">{settings.gridWidth} px</span>
          </label>
          <label className="slider-row">
            <span>Loci and sweep</span>
            <input
              type="range"
              {...WIDTH_RANGE}
              value={settings.locusWidth}
              onChange={(e) => update({ locusWidth: Number(e.target.value) })}
              aria-label="Locus line width"
            />
            <span className="mono small">{settings.locusWidth} px</span>
          </label>
          <label className="select-row">
            <span>Chart labels</span>
            <select
              value={settings.labelDensity}
              onChange={(e) => update({ labelDensity: e.target.value as LabelDensity })}
              aria-label="Label density"
            >
              <option value="few">Few</option>
              <option value="auto">As the grid</option>
              <option value="many">Many</option>
            </select>
          </label>
        </div>

        <h3>New designs</h3>
        <div className="settings-grid">
          <label className="select-row">
            <span>Frequency</span>
            <ValueInput
              value={settings.defaultFrequency}
              unit="Hz"
              digits={6}
              min={1}
              onCommit={(defaultFrequency) => update({ defaultFrequency })}
              ariaLabel="Default frequency"
              width="8em"
            />
          </label>
          <label className="select-row">
            <span>Z0</span>
            <ValueInput
              value={settings.defaultZ0}
              unit={'Ω'}
              min={1e-3}
              onCommit={(defaultZ0) => update({ defaultZ0 })}
              ariaLabel="Default reference impedance"
              width="6em"
            />
          </label>
        </div>

        <h3>Schematic</h3>
        <div className="settings-grid" role="radiogroup" aria-label="Schematic direction">
          {(['horizontal', 'vertical'] as const satisfies readonly SchematicDirection[]).map(
            (d) => (
              <label key={d} className="check">
                <input
                  type="radio"
                  name="schematic-direction"
                  checked={settings.schematic === d}
                  onChange={() => update({ schematic: d })}
                />
                {d === 'horizontal' ? 'Horizontal, load left' : 'Vertical, load at the top'}
              </label>
            ),
          )}
        </div>

        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              reset();
              redraw((n) => n + 1);
            }}
          >
            Reset all
          </button>
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
