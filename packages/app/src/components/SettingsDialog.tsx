import { isDefaultRow, type PackageId } from '@smithonline/core';
import { useState } from 'react';
import {
  COLOR_LABELS,
  WIDTH_RANGE,
  type ColorKey,
  type LabelDensity,
  type SchematicDirection,
} from '../lib/settings';
import { usePackages } from '../store/usePackages';
import { useSettings } from '../store/useSettings';
import { ValueInput } from './ValueInput';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { Slider } from './ui/Slider';

/** The four editable numbers of a package row, with the unit each is typed in. */
const PACKAGE_FIELDS: readonly {
  readonly key: 'esl' | 'cp' | 'esr' | 'pad';
  readonly label: string;
  readonly unit: string;
  readonly title: string;
}[] = [
  { key: 'esl', label: 'ESL', unit: 'H', title: 'Series inductance of a chip capacitor' },
  { key: 'cp', label: 'Cp', unit: 'F', title: 'Parallel capacitance of a chip inductor' },
  { key: 'esr', label: 'ESR', unit: 'Ω', title: 'Series resistance of a chip inductor' },
  { key: 'pad', label: 'Pads', unit: 'F', title: 'Capacitance of both pads to ground' },
];

/**
 * The parasitics table behind the package selector on the L and C cards:
 * one row per package, every number editable, the source note as a tooltip
 * and under the table, a reset per changed row.
 */
/** A label inside a sentence: "Impedance grid" reads "impedance grid", "VSWR circles" stays. */
function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

function PackageTableEditor() {
  const table = usePackages((s) => s.table);
  const { setRow, resetRow } = usePackages.getState();
  const [noteFor, setNoteFor] = useState<PackageId>('0402');
  const shown = table.find((p) => p.id === noteFor) ?? table[0];
  return (
    <div className="package-table">
      {/* The table scrolls sideways on its own, the package names kept in view; the dialog
          and its sticky actions row stay put on a phone. */}
      <div className="package-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Package</th>
              {PACKAGE_FIELDS.map((f) => (
                <th scope="col" key={f.key} title={f.title}>
                  {f.label}
                </th>
              ))}
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {table.map((row) => {
              const isDefault = isDefaultRow(row);
              return (
                <tr key={row.id} className={row.id === noteFor ? 'shown' : ''}>
                  <th scope="row">
                    <Button
                      variant="quiet"
                      size="sm"
                      className="plain"
                      onClick={() => setNoteFor(row.id)}
                      title={row.source}
                    >
                      {row.label}
                    </Button>
                  </th>
                  {PACKAGE_FIELDS.map((f) => {
                    const applies =
                      f.key === 'pad' ||
                      (f.key === 'esl' ? row.parts.includes('C') : row.parts.includes('L'));
                    return (
                      <td key={f.key}>
                        {applies ? (
                          <ValueInput
                            value={row[f.key]}
                            unit={f.unit}
                            min={0}
                            width="5.5em"
                            onCommit={(v) => setRow(row.id, { [f.key]: v })}
                            ariaLabel={`${row.label} ${f.label}`}
                          />
                        ) : (
                          <span className="muted">n/a</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <Button
                      size="sm"
                      disabled={isDefault}
                      onClick={() => resetRow(row.id)}
                      title={isDefault ? 'Default values' : 'Back to the default values'}
                    >
                      {isDefault ? 'default' : 'Reset'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown && (
        <p className="muted small">
          <strong>{shown.label}:</strong> {shown.source}
        </p>
      )}
    </div>
  );
}

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
  const resetPackages = usePackages((s) => s.reset);
  const [, redraw] = useState(0);

  return (
    <Dialog
      title="Settings"
      subtitle="stored in this browser"
      onClose={onClose}
      closeLabel="Close settings"
      className="settings"
      footer={
        <>
          <Button
            onClick={() => {
              reset();
              resetPackages();
              redraw((n) => n + 1);
            }}
          >
            Reset all
          </Button>
          <Button variant="primary" className="dialog-close" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
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
              <Button
                size="sm"
                disabled={own === null}
                onClick={(e) => {
                  e.preventDefault();
                  setColor(key, null);
                  redraw((n) => n + 1);
                }}
                title={`Back to the theme colour: ${inSentence(COLOR_LABELS[key])}`}
                aria-label={`Back to the theme colour: ${inSentence(COLOR_LABELS[key])}`}
              >
                Theme
              </Button>
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
          <Slider
            {...WIDTH_RANGE}
            value={settings.gridWidth}
            onChange={(gridWidth) => update({ gridWidth })}
            ariaLabel="Grid line width"
          />
          <span className="mono small">{settings.gridWidth} px</span>
        </label>
        <label className="slider-row">
          <span>Loci and sweep</span>
          <Slider
            {...WIDTH_RANGE}
            value={settings.locusWidth}
            onChange={(locusWidth) => update({ locusWidth })}
            ariaLabel="Locus line width"
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
        <Field
          className="select-row"
          label="Frequency"
          value={settings.defaultFrequency}
          unit="Hz"
          digits={6}
          min={1}
          onCommit={(defaultFrequency) => update({ defaultFrequency })}
          ariaLabel="Default frequency"
        />
        <Field
          className="select-row"
          label="Z0"
          value={settings.defaultZ0}
          unit={'Ω'}
          min={1e-3}
          onCommit={(defaultZ0) => update({ defaultZ0 })}
          ariaLabel="Default reference impedance"
        />
      </div>

      <h3>Schematic</h3>
      <div className="settings-grid" role="radiogroup" aria-label="Schematic direction">
        {(['horizontal', 'vertical'] as const satisfies readonly SchematicDirection[]).map((d) => (
          <label key={d} className="check">
            <input
              type="radio"
              name="schematic-direction"
              checked={settings.schematic === d}
              onChange={() => update({ schematic: d })}
            />
            {d === 'horizontal' ? 'Horizontal, load left' : 'Vertical, load at the top'}
          </label>
        ))}
      </div>

      <h3>Component packages</h3>
      <PackageTableEditor />
    </Dialog>
  );
}
