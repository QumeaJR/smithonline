import { useHelp } from '../store/useHelp';
import { browserOptOut } from '../lib/analytics/track';
import { E_SERIES, E_SERIES_TOLERANCE, TOROID_CORES } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../store/useShell';
import {
  COLOR_LABELS,
  resetPreferences,
  WIDTH_RANGE,
  type ChartDensity,
  type ColorKey,
  type DefaultSeries,
  type LabelDensity,
  type SchematicDirection,
  type Settings,
} from '../lib/settings';
import {
  browserBuildDefaults,
  defaultsSummary,
  keepAsDefaults,
  resetDefaults,
} from '../lib/designBuild';
import { loadCores, saveCores } from '../lib/winding';
import { autosaveBackups } from '../lib/autosave';
import { BackupRow } from './BackupRow';
import { ClearButton } from './ClearButton';
import { WORKFLOWS_KEY } from '../lib/workflowKit';
import { WORKFLOWS } from '../lib/workflows';
import { isShipped } from '../lib/workflowKit';
import type { Theme } from '../lib/theme';
import { useBoard } from '../store/useBoard';
import { useDesignStore } from '../store/useDesignStore';
import { useLaminates } from '../store/useLaminates';
import { useOverlays } from '../store/useOverlays';
import { usePackages } from '../store/usePackages';
import { usePartLibrary } from '../store/usePartLibrary';
import { useSettings } from '../store/useSettings';
import { useTourStore } from '../store/useTourStore';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { vswrLimitRefusal } from '../lib/tolerance';
import { Segmented } from './ui/Segmented';
import { Slider } from './ui/Slider';

/** A label inside a sentence: "Impedance grid" reads "impedance grid", "VSWR circles" stays. */
function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

interface SettingsDialogProps {
  readonly onClose: () => void;
  /** The colour theme and its setter (App keeps it; the header toggle stays). */
  readonly theme?: Theme;
  readonly onTheme?: (theme: Theme) => void;
}

/** What "Reset all" took away, for its undo while the dialog stays open. */
interface ResetSnapshot {
  readonly settings: Settings;
  readonly theme: Theme | undefined;
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

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Settings (docs/09b section 5): app preferences only, all kept in this
 * browser. Appearance, the schematic direction, the defaults new designs
 * start with, behaviour, your libraries and the data kept here. How a design
 * is built (the board, the package models) is not here: it is saved with the
 * design and edited in Build. Changes apply and are stored at once.
 */
export function SettingsDialog({ onClose, theme, onTheme }: SettingsDialogProps) {
  const settings = useSettings((s) => s.settings);
  const { update, setColor, setPaletteColor } = useSettings.getState();
  const [, redraw] = useState(0);
  /** "Reset all" asks first; after it, its undo stays offered until the dialog closes. */
  const [confirming, setConfirming] = useState(false);
  // Autosaves this version could not open and designs a share link replaced, kept under backup
  // keys (main.tsx).
  const [backups, setBackups] = useState(() => autosaveBackups());
  const [undo, setUndo] = useState<ResetSnapshot | null>(null);
  const [laminatesOpen, setLaminatesOpen] = useState(false);
  const [cores, setCores] = useState(() => loadCores().length);
  // The defaults for new designs, read through their stores so a change shows at once.
  const defaultBoard = useBoard((s) => s.board);
  const defaultTable = usePackages((s) => s.table);
  void defaultBoard;
  void defaultTable;
  const summary = defaultsSummary(settings, browserBuildDefaults());
  const libraryCount = usePartLibrary((s) => s.parts.length);
  const laminates = useLaminates((s) => s.laminates);
  const curves = useOverlays((s) => s.overlays.length);
  const completed = useTourStore((s) => s.completed);
  const workflows = WORKFLOWS.filter(isShipped);
  const seen = workflows.filter((w) => completed.has(w.id)).length;
  const guideClosed = useShell((s) => s.guideClosed);
  // Global Privacy Control or Do Not Track: the usage counts are off whatever the switch says.
  const optOut = browserOptOut();
  // Opened at a section: that section heads the dialog.
  const section = useShell((s) => s.settings?.section ?? null);
  const manageParts = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!section) return;
    const head = document.querySelector<HTMLElement>(
      `.settings [data-settings-section="${section}"]`,
    );
    head?.scrollIntoView?.({ block: 'start' });
  }, [section]);

  const resetAll = (): void => {
    setUndo({ settings: useSettings.getState().settings, theme });
    update(resetPreferences(useSettings.getState().settings));
    useDesignStore.getState().setChart(resetPreferences(settings).chart);
    if (onTheme && theme !== 'auto') onTheme('auto');
    setConfirming(false);
    redraw((n) => n + 1);
  };
  const undoReset = (): void => {
    if (!undo) return;
    update(undo.settings);
    useDesignStore.getState().setChart(undo.settings.chart);
    if (onTheme && undo.theme) onTheme(undo.theme);
    setUndo(null);
    redraw((n) => n + 1);
  };
  const setChartAtStart = (patch: Partial<Settings['chart']>): void => {
    update({ chart: { ...settings.chart, ...patch } });
    // The chart on show follows, so the choice is seen at once.
    useDesignStore.getState().setChart(patch);
  };

  return (
    <Dialog
      title="Settings"
      subtitle="for this browser"
      onClose={onClose}
      onEscape={confirming ? () => setConfirming(false) : undefined}
      closeLabel="Close settings"
      className="settings"
      // Back from the part library (opened by Manage… at Libraries): the focus returns to it.
      {...(section === 'libraries' ? { initialFocus: () => manageParts.current } : {})}
      footer={
        confirming ? (
          <>
            <span className="settings-confirm small" role="alert">
              Reset appearance, schematic and behaviour? Defaults for new designs, libraries and
              every design stay.
            </span>
            <Button variant="destructive" onClick={resetAll}>
              Reset all
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <>
            {undo ? (
              <>
                <span className="settings-confirm small" role="status">
                  Appearance, schematic and behaviour reset.
                </span>
                <Button
                  onClick={undoReset}
                  title="Put back the settings as they were before the reset"
                >
                  Undo reset
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setConfirming(true)}
                title="Appearance, schematic and behaviour back to their defaults; the defaults for new designs, your libraries and the build of every design stay. Asks first"
              >
                Reset all…
              </Button>
            )}
            <Button variant="primary" className="dialog-close" onClick={onClose}>
              Close
            </Button>
          </>
        )
      }
    >
      <h3 data-settings-section="appearance">Appearance</h3>
      {theme && onTheme && (
        <div className="settings-grid">
          <div className="select-row">
            <span>Theme</span>
            <Segmented
              ariaLabel="Theme"
              size="sm"
              value={theme}
              onChange={onTheme}
              options={THEMES}
            />
          </div>
        </div>
      )}
      <h4>Colours</h4>
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

      <h4>Element colours</h4>
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

      <h4>Lines and labels</h4>
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

      <h4>Chart at start</h4>
      <div className="settings-grid" role="group" aria-label="Chart at start">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.chart.zGrid}
            onChange={(e) => setChartAtStart({ zGrid: e.target.checked })}
          />
          Impedance (Z) grid
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.chart.yGrid}
            onChange={(e) => setChartAtStart({ yGrid: e.target.checked })}
          />
          Admittance (Y) grid
        </label>
        <label className="select-row">
          <span>Grid density</span>
          <select
            value={settings.chart.density}
            onChange={(e) => setChartAtStart({ density: e.target.value as ChartDensity })}
            aria-label="Grid density at start"
          >
            <option value="coarse">Coarse</option>
            <option value="normal">Normal</option>
            <option value="fine">Fine</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.chart.labels}
            onChange={(e) => setChartAtStart({ labels: e.target.checked })}
          />
          Grid labels
        </label>
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

      <h3 data-settings-section="new-designs">New designs</h3>
      <div className="settings-grid">
        <Field
          className="select-row"
          label="Frequency"
          value={settings.defaultFrequency}
          unit="Hz"
          digits={6}
          min={1}
          inlineMessage
          onCommit={(defaultFrequency) => update({ defaultFrequency })}
          ariaLabel="Default frequency"
        />
        <Field
          className="select-row"
          label="Z0"
          value={settings.defaultZ0}
          unit={'Ω'}
          min={1e-3}
          inlineMessage
          onCommit={(defaultZ0) => update({ defaultZ0 })}
          ariaLabel="Default reference impedance"
        />
        <label className="select-row">
          <span>Series</span>
          <select
            value={settings.defaultSeries}
            onChange={(e) => update({ defaultSeries: e.target.value as DefaultSeries })}
            aria-label="Default value series"
          >
            {E_SERIES.map((s) => (
              <option key={s} value={s}>
                {s} ({Math.round(E_SERIES_TOLERANCE[s] * 100)} %)
              </option>
            ))}
            <option value="library">Part library</option>
          </select>
        </label>
        <Field
          className="select-row"
          label="Tolerance"
          title="The tolerance of every part in a new design's Tolerance panel; empty takes it from the series"
          value={settings.defaultTolerancePercent ?? 0}
          empty={settings.defaultTolerancePercent === null}
          placeholder="series"
          onClear={() => update({ defaultTolerancePercent: null })}
          plain
          min={0}
          max={100}
          suffix="%"
          width="calc(9ch + 8px)"
          inlineMessage
          onCommit={(v) => update({ defaultTolerancePercent: v })}
          ariaLabel="Default part tolerance in percent"
        />
        <Field
          className="select-row"
          label="VSWR limit"
          title="The VSWR limit of a new design: its usable bandwidth, Tolerance and the next steps"
          value={settings.defaultVswrLimit}
          plain
          validate={vswrLimitRefusal}
          inlineMessage
          onCommit={(defaultVswrLimit) => update({ defaultVswrLimit })}
          ariaLabel="Default VSWR limit"
        />
      </div>
      <div className="settings-build">
        <p className="small">
          <span className="muted">Build: </span>
          <span data-testid="defaults-summary">{summary}</span>
        </p>
        <div className="row">
          <Button
            size="sm"
            onClick={() => {
              keepAsDefaults(useDesignStore.getState().design);
              redraw((n) => n + 1);
            }}
            title="The board, package models, default Q and series of the open design become the defaults for new designs"
          >
            Take from the open design
          </Button>
          <ClearButton
            label="Reset"
            question="Back to the built-in build defaults?"
            onClear={() => {
              resetDefaults();
              redraw((n) => n + 1);
            }}
          />
        </div>
        <p className="muted small">
          A new design copies these. Each design keeps its own build, edited in Build; a design
          saved before 0.6.0 opens with these.
        </p>
      </div>

      <h3 data-settings-section="behaviour">Behaviour</h3>
      <label
        className="check"
        title="After a match, a run or an export, offer the step an RF engineer takes next, one at a time, at the foot of the network panel"
      >
        <input
          type="checkbox"
          checked={settings.suggestNextSteps}
          onChange={(e) => update({ suggestNextSteps: e.target.checked })}
        />
        Suggest next steps
      </label>
      <label className="check" title="The short guide over the network panel of a new design">
        <input
          type="checkbox"
          checked={!guideClosed}
          onChange={(e) =>
            e.target.checked ? useShell.getState().showGuide() : useShell.getState().closeGuide()
          }
        />
        Show the start guide on new designs
      </label>
      <div className="settings-usage">
        <label
          className="check"
          title="Counts which tools and workflows are used, never your designs, values or files"
        >
          <input
            type="checkbox"
            checked={settings.shareUsageCounts && !optOut}
            disabled={optOut}
            onChange={(e) => update({ shareUsageCounts: e.target.checked })}
          />
          Share anonymous usage counts
        </label>
        <p className="muted small">
          {optOut
            ? 'Off: your browser asks sites not to track.'
            : 'Counts which tools and workflows are used, never your designs, values or files.'}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onClose();
              useHelp.getState().openHelp('feedback-and-privacy');
            }}
          >
            What is sent
          </button>
        </p>
      </div>
      <div className="settings-line">
        <span>
          Workflow progress: {seen} of {workflows.length} seen to the end
        </span>
        <ClearButton
          label="Reset"
          disabled={seen === 0}
          question="Forget which workflows were seen?"
          onClear={() => {
            try {
              localStorage.removeItem(WORKFLOWS_KEY);
            } catch {
              // nothing kept
            }
            useTourStore.setState({ completed: new Set() });
          }}
        />
      </div>

      <h3 data-settings-section="libraries">Libraries</h3>
      <div className="settings-line">
        <span>
          Part library: {libraryCount} {libraryCount === 1 ? 'part' : 'parts'}
        </span>
        <Button
          ref={manageParts}
          size="sm"
          aria-label="Manage the part library"
          onClick={() => {
            onClose();
            // Closing the library comes back here (App.tsx).
            usePartLibrary.getState().setOpen(true, true);
          }}
        >
          Manage…
        </Button>
      </div>
      <div className="settings-line">
        <span>Laminates: {laminates.length} of your own</span>
        <Button
          size="sm"
          aria-expanded={laminatesOpen}
          aria-label="Manage your laminates"
          disabled={laminates.length === 0}
          onClick={() => setLaminatesOpen((v) => !v)}
          title="Save a laminate from Build, Board, Save as my laminate"
        >
          Manage…
        </Button>
      </div>
      {laminatesOpen && laminates.length > 0 && (
        <ul className="settings-list">
          {laminates.map((l) => (
            <li key={l.id}>
              <span>{l.label}</span>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => useLaminates.getState().remove(l.id)}
                aria-label={`Remove the laminate ${l.label}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-line">
        <span>
          Winding cores: {cores}
          {cores !== TOROID_CORES.length ? ' (edited)' : ''}
        </span>
        <ClearButton
          label="Reset…"
          question="Back to the built-in cores?"
          onClear={() => {
            saveCores([...TOROID_CORES]);
            setCores(TOROID_CORES.length);
          }}
        />
      </div>
      <p className="muted small">
        A design keeps a copy of each part and laminate it uses, so it opens the same without them.
      </p>

      <h3 data-settings-section="data">Data in this browser</h3>
      <div className="settings-line">
        <span>The open design, saved as you work</span>
      </div>
      {backups.map((backup) => (
        <BackupRow
          key={backup.key}
          backup={backup}
          onRemoved={() => setBackups(autosaveBackups())}
          onOpened={onClose}
        />
      ))}
      <div className="settings-line">
        <span>Stored curves: {curves}</span>
        <ClearButton
          disabled={curves === 0}
          question={`Clear ${curves} stored ${curves === 1 ? 'curve' : 'curves'}?`}
          onClear={() => useOverlays.getState().clear()}
        />
      </div>
      <div className="settings-line">
        <span>
          Part library: {libraryCount} {libraryCount === 1 ? 'part' : 'parts'}
        </span>
        <ClearButton
          disabled={libraryCount === 0}
          question={`Remove all ${libraryCount} parts?`}
          onClear={() => void usePartLibrary.getState().removeAll()}
        />
      </div>
      <div className="settings-line">
        <span>Laminates: {laminates.length}</span>
        <ClearButton
          disabled={laminates.length === 0}
          question="Remove all your laminates?"
          onClear={() => useLaminates.getState().clear()}
        />
      </div>
      <p className="muted small">
        Nothing leaves this browser: designs, curves and libraries are kept here and are sent
        nowhere. A share link carries the design in the link itself.
      </p>
    </Dialog>
  );
}
