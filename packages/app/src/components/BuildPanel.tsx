import {
  boardActive,
  boardTraceWidth,
  boardViaInductance,
  E_SERIES,
  E_SERIES_TOLERANCE,
  formatEngineering,
  MICROSTRIP_RANGE,
  nanohenries,
  packagePadCapacitance,
  parseStockReport,
  stackupProblem,
  BOARD_LIMITS,
  type PackageId,
  type PackageParasitics,
  type RealizeScope,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resetBuildToDefaults,
  resetPackageRow,
  setBoardEnabled,
  setBoardNumber,
  setPackageForAll,
  setPackageNumber,
} from '../lib/buildActions';
import {
  keepAsDefaults,
  PACKAGE_LIMITS,
  rowChanged,
  SCOPE_LABELS,
  type PackageNumber,
} from '../lib/designBuild';
import { useLayout } from '../lib/layout';
import { useDesignBuild } from '../store/useDesignBuild';
import { useDesignStore } from '../store/useDesignStore';
import { useLaminates } from '../store/useLaminates';
import { usePartLibrary } from '../store/usePartLibrary';
import { useShell, type BuildSection } from '../store/useShell';
import { HelpLink } from './HelpLink';
import { MeasuredBoardSection } from './MeasuredBoardSection';
import { ShowMe } from './ShowMe';
import { StackupFields } from './StackupFields';
import { StressControls } from './StressControls';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';

const eng = (v: number, unit: string): string => formatEngineering(v, { unit, digits: 3 });

/** A length that shows "0 mm" at zero (not a bare "0"), else the engineering format. */
function zeroMm(v: number): string {
  return v === 0 ? '0 mm' : formatEngineering(v, { unit: 'm', digits: 4 });
}

const fmtRatio = (v: number): string => String(Number(v.toPrecision(3)));

/** A caption heading of the inspector, with the anchor the network row's Edit… scrolls to. */
function Caption({ id, children }: { readonly id: BuildSection; readonly children: string }) {
  return (
    <h3 className="build-caption" data-build-section={id}>
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------ realization */

function Realization() {
  const realize = useDesignStore((s) => s.design.realize);
  const setRealize = useDesignStore((s) => s.setRealize);
  const libraryCount = usePartLibrary((s) => s.parts.length);
  const stock = useMemo(
    () => (realize.series === 'stock' ? parseStockReport(realize.stockText) : null),
    [realize.series, realize.stockText],
  );
  return (
    <section className="build-section" aria-label="Realization">
      <Caption id="realization">Realization</Caption>
      <div className="build-grid">
        <label className="select-row">
          <span>Series</span>
          <select
            value={realize.series}
            onChange={(e) => setRealize({ series: e.target.value as typeof realize.series })}
            aria-label="Value series in Build"
            data-tour="build.realization.series"
            title="Standard series after IEC 60063, the values you have in stock, or the parts of your part library"
          >
            {E_SERIES.map((s) => (
              <option key={s} value={s}>
                {s} ({Math.round(E_SERIES_TOLERANCE[s] * 100)} %)
              </option>
            ))}
            <option value="stock">My stock</option>
            <option value="library">Part library</option>
          </select>
        </label>
        <label className="select-row">
          <span>Scope</span>
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
        </label>
      </div>
      {realize.series === 'stock' && (
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
            <p className="muted small">
              {stock.stock.L.length} inductor, {stock.stock.C.length} capacitor and{' '}
              {stock.stock.R.length} resistor values
              {stock.skipped.length > 0 ? `; ${stock.skipped.length} entries skipped` : ''}.
            </p>
          )}
        </div>
      )}
      <div className="row build-library">
        <Button
          size="sm"
          onClick={() => usePartLibrary.getState().setOpen(true)}
          title="Load S-parameter files of real parts, and see the parts you have"
          data-tour="build.partLibrary"
        >
          Part library…
        </Button>
        <span className="muted small">
          {libraryCount} {libraryCount === 1 ? 'part' : 'parts'} in this browser
        </span>
      </div>
      {!realize.enabled && (
        <p className="muted small">Realize is off in the network row; these apply once it is on.</p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- losses */

function Losses() {
  const losses = useDesignStore((s) => s.design.losses);
  const setLosses = useDesignStore((s) => s.setLosses);
  return (
    <section className="build-section" aria-label="Losses" data-tour="build.losses">
      <Caption id="losses">Losses</Caption>
      <div className="build-grid">
        <Field
          className="select-row"
          label="Default Q, inductors"
          value={losses.inductorQ}
          plain
          min={0}
          width="calc(7ch + 8px)"
          onCommit={(inductorQ) => setLosses({ inductorQ })}
          ariaLabel="Default inductor Q"
        />
        <Field
          className="select-row"
          label="Default Q, capacitors"
          value={losses.capacitorQ}
          plain
          min={0}
          width="calc(7ch + 8px)"
          onCommit={(capacitorQ) => setLosses({ capacitorQ })}
          ariaLabel="Default capacitor Q"
        />
      </div>
      <p className="muted small">
        Per-part Q on the cards overrides these.
        {losses.enabled ? '' : ' Losses is off in the network row; they apply once it is on.'}
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- packages */

const PACKAGE_FIELDS: readonly {
  readonly key: PackageNumber;
  readonly label: string;
  readonly unit: string;
  readonly title: string;
}[] = [
  { key: 'esl', label: 'ESL', unit: 'H', title: 'Series inductance of a chip capacitor' },
  { key: 'cp', label: 'Cp', unit: 'F', title: 'Parallel capacitance of a chip inductor' },
  { key: 'esr', label: 'ESR', unit: 'Ω', title: 'Series resistance of a chip inductor' },
  {
    key: 'padLength',
    label: 'Land l',
    unit: 'm',
    title: 'Length of one land (pad) along the part; 0 keeps the Pads value with the board on',
  },
  { key: 'padWidth', label: 'Land w', unit: 'm', title: 'Width of one land across the part' },
  {
    key: 'pad',
    label: 'Pads',
    unit: 'F',
    title:
      'Capacitance of both pads to ground, a typical figure; with the board on and a land size it is computed from the lands and the stackup instead',
  },
];

function applies(row: PackageParasitics, key: PackageNumber): boolean {
  if (key === 'esl') return row.parts.includes('C');
  if (key === 'cp' || key === 'esr') return row.parts.includes('L');
  return true;
}

function PackageCard({
  row,
  count,
  open,
}: {
  readonly row: PackageParasitics;
  readonly count: number;
  readonly open: boolean;
}) {
  const { board, table } = useDesignBuild();
  const changed = rowChanged(table, row.id);
  const computed = boardActive(board) ? packagePadCapacitance(row, board.stackup) : null;
  const head = [
    row.label,
    count > 0 ? `${count} ${count === 1 ? 'part' : 'parts'}` : 'not used',
    changed ? 'changed for this design' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <details className="build-package" open={open}>
      <summary title={row.source}>
        <span>{head}</span>
      </summary>
      <div className="build-grid two">
        {PACKAGE_FIELDS.map((f) => {
          if (!applies(row, f.key)) return null;
          if (f.key === 'pad' && computed !== null) {
            return (
              <span
                key={f.key}
                className="ui-field select-row computed"
                title="Computed from the land size and the stackup while the board is on"
              >
                <span className="ui-field-label">Pads</span>
                <span className="mono">{eng(computed, 'F')}</span>
              </span>
            );
          }
          return (
            <Field
              key={f.key}
              className="select-row"
              label={f.label}
              title={f.title}
              value={row[f.key]}
              unit={f.unit}
              min={PACKAGE_LIMITS[f.key].min}
              max={PACKAGE_LIMITS[f.key].max}
              width="calc(9ch + 8px)"
              inlineMessage
              onCommit={(v) => setPackageNumber(row.id, f.key, v)}
              ariaLabel={`${row.label} ${f.label}`}
            />
          );
        })}
      </div>
      <div className="row build-package-foot">
        {changed ? (
          <>
            <span className="tag small">Changed for this design</span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => resetPackageRow(row.id)}
              aria-label={`Reset ${row.label} to the built-in values`}
              title={`${row.label}: back to the built-in values`}
            >
              Reset
            </Button>
          </>
        ) : (
          <span className="muted small">Built-in values</span>
        )}
      </div>
    </details>
  );
}

function Packages() {
  const elements = useDesignStore((s) => s.design.elements);
  const { table } = useDesignBuild();
  const phone = useLayout() === 'phone';
  const [all, setAll] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<PackageId, number>();
    for (const el of elements) {
      if ((el.kind === 'L' || el.kind === 'C') && el.package) {
        m.set(el.package, (m.get(el.package) ?? 0) + 1);
      }
    }
    return m;
  }, [elements]);
  const lumped = elements.some((el) => el.kind === 'L' || el.kind === 'C');
  const rows = table.filter((row) => all || counts.has(row.id));
  return (
    <section className="build-section" aria-label="Packages" data-tour="build.packages">
      <Caption id="packages">Packages</Caption>
      {rows.length === 0 && (
        <p className="muted small">
          No part names a package yet. A package adds its parasitics: the dotted locus is the
          network as built.
        </p>
      )}
      {rows.map((row) => (
        <PackageCard key={row.id} row={row} count={counts.get(row.id) ?? 0} open={!phone} />
      ))}
      <div className="row build-actions">
        <Button
          size="sm"
          disabled={!lumped}
          onClick={() => setPackageForAll('0402')}
          title={
            lumped
              ? 'Every inductor and capacitor in a 0402 package, as one step'
              : 'Add an inductor or a capacitor first'
          }
          data-tour="build.packages.all"
        >
          Use 0402 for all parts
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setAll((v) => !v)} aria-pressed={all}>
          {all ? 'Show the packages used' : 'Show all packages'}
        </Button>
      </div>
      <p className="muted small">
        Typical figures to start from; the tooltip of each package says where they come from.
        Changes here are for this design; Use as default keeps them for new designs.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ board */

function Board() {
  const { board, table } = useDesignBuild();
  const z0 = useDesignStore((s) => s.design.z0);
  const frequency = useDesignStore((s) => s.design.frequency);
  const [naming, setNaming] = useState<string | null>(null);
  const width = boardTraceWidth(board, { z0, frequency });
  const pad0402 = table.find((p) => p.id === '0402');
  const padC = pad0402 ? packagePadCapacitance(pad0402, board.stackup) : null;
  const widthOut =
    width !== null &&
    (width / board.stackup.h < MICROSTRIP_RANGE.uMin ||
      width / board.stackup.h > MICROSTRIP_RANGE.uMax);
  const problem = board.enabled ? stackupProblem(board.stackup) : null;
  return (
    <section className="build-section" aria-label="Board">
      <Caption id="board">Board</Caption>
      <Switch
        checked={board.enabled}
        onChange={setBoardEnabled}
        title="Include the board in the network as built: pads from each package's land size and the stackup, a via under every shunt part and a trace between neighbouring parts. A circuit-level estimate, not an EM simulation."
        tour="build.board"
      >
        Include the board (pads, vias, traces)
      </Switch>
      <StackupFields full />
      <div className="row build-laminate">
        {naming === null ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setNaming(board.stackup.name ?? 'My laminate')}
            title="Keep this stackup in your laminates in this browser, to pick it in other designs"
          >
            Save as my laminate
          </Button>
        ) : (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const saved = useLaminates.getState().save(naming, board.stackup);
              setNaming(null);
              useDesignStore.getState().setMessage(`Saved "${saved.label}" in your laminates`);
            }}
          >
            <input
              type="text"
              value={naming}
              maxLength={80}
              onChange={(e) => setNaming(e.target.value)}
              aria-label="Name of the laminate"
              autoFocus
            />
            <Button size="sm" type="submit" variant="primary">
              Save
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setNaming(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
      <div className="build-grid">
        <Field
          className="select-row"
          label="Via drill"
          title="Drill diameter of the via from a shunt part to the ground plane"
          value={board.viaDrill}
          unit="m"
          min={BOARD_LIMITS.viaDrill.min}
          max={BOARD_LIMITS.viaDrill.max}
          inlineMessage
          onCommit={(v) => setBoardNumber('viaDrill', v)}
          ariaLabel="Via drill diameter"
        />
        <Field
          className="select-row"
          label="Vias per shunt part"
          title="How many vias in parallel take each shunt part to the ground plane: a whole number from 1 to 100. N vias count as one via's inductance divided by N (their mutual inductance is left out, so closely spaced vias are a little worse)"
          value={board.viasPerShunt}
          plain
          digits={3}
          min={BOARD_LIMITS.viasPerShunt.min}
          max={BOARD_LIMITS.viasPerShunt.max}
          validate={(v) => (Number.isInteger(v) ? null : 'is not a whole number of vias')}
          inlineMessage
          onCommit={(v) => setBoardNumber('viasPerShunt', v)}
          ariaLabel="Vias per shunt part"
        />
        <Field
          className="select-row"
          label="Trace between parts"
          title="Length of the track between two neighbouring lumped parts; 0 leaves the traces out"
          value={board.traceLength}
          unit="m"
          format={zeroMm}
          min={BOARD_LIMITS.traceLength.min}
          max={BOARD_LIMITS.traceLength.max}
          inlineMessage
          onCommit={(v) => setBoardNumber('traceLength', v)}
          ariaLabel="Trace length between parts"
        />
        <Field
          className="select-row"
          label="Trace width"
          title="Width of those traces; 0 uses the width whose Z0 is the design's Z0 at the design frequency"
          value={board.traceWidth}
          unit="m"
          format={zeroMm}
          min={0}
          max={BOARD_LIMITS.traceWidth.max}
          validate={(v) =>
            v === 0 || v >= BOARD_LIMITS.traceWidth.min
              ? null
              : 'is below 1 µm (0 follows the design Z0)'
          }
          inlineMessage
          onCommit={(v) => setBoardNumber('traceWidth', v)}
          ariaLabel="Trace width"
        />
      </div>
      <p className="muted small" aria-live="polite">
        Via {nanohenries(boardViaInductance(board))} per shunt part (Goldfarb-Pucel
        {board.viasPerShunt > 1 ? `, ${board.viasPerShunt} in parallel` : ''}).
        {pad0402
          ? padC !== null
            ? ` 0402 pads ${eng(padC, 'F')} both, from the land size.`
            : ` 0402 pads ${eng(pad0402.pad, 'F')} both, the table value (no land size).`
          : ''}{' '}
        {board.traceLength > 0
          ? width !== null
            ? `Traces ${eng(board.traceLength, 'm')} long, ${eng(width, 'm')} wide${board.traceWidth > 0 ? '' : ` (${z0} Ω at the design frequency)`}${widthOut ? `; W/h ${fmtRatio(width / board.stackup.h)} is outside the dispersion model's range (0.1 to 10)` : ''}.`
            : `No width gives ${z0} Ω on this stackup: the traces are left out.`
          : 'Traces between parts: off (length 0).'}
        {problem ? ` The stackup is not usable (${problem.reason}): the board is left out.` : ''}
      </p>
      <p className="muted small board-limits">
        Circuit-level estimates: no EM simulation, no coupling or discontinuities, the pad estimate
        may be low for lands much smaller than h, vias without mutual inductance. Microstrip
        elements keep the stackup they were made on.{' '}
        <HelpLink section="analysis-for-building" topic="the board in the network" />
      </p>
    </section>
  );
}

/* ------------------------------------------------------------ the panel */

/**
 * The Build inspector (docs/09b section 5): how this network is made, saved
 * with the design and edited beside the chart, so the as-built locus moves
 * while a number is typed. Realization, losses, package models, the board and
 * the part ratings; every change is one named step of Undo.
 */
export function BuildPanel() {
  const ask = useShell((s) => s.buildSection);
  const root = useRef<HTMLDivElement>(null);
  // Edit… in the network row or a next step asks for a section: it heads the panel.
  useEffect(() => {
    if (!ask) return;
    const head = root.current?.querySelector<HTMLElement>(`[data-build-section="${ask.section}"]`);
    head?.scrollIntoView?.({ block: 'start' });
  }, [ask]);
  return (
    <div className="tool-panel build-panel" ref={root} onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-head">
        <strong>Build</strong>
        <span className="muted">saved with this design</span>
        <span className="tool-head-links">
          <ShowMe tool="build" />
          <HelpLink section="analysis-for-building" topic="the build of a design" />
        </span>
      </div>
      <Realization />
      <Losses />
      <Packages />
      <Board />
      <MeasuredBoardSection />
      <section className="build-section" aria-label="Part ratings" data-tour="build.ratings">
        <Caption id="ratings">Part ratings</Caption>
        <StressControls />
      </section>
      <div className="build-foot">
        <p className="muted small">Saved with this design.</p>
        <div className="row build-actions">
          <Button
            size="sm"
            onClick={() => {
              keepAsDefaults(useDesignStore.getState().design);
              useDesignStore
                .getState()
                .setMessage(
                  'This build is now the default for new designs (Settings, New designs)',
                );
            }}
            title="New designs start with this board, these package models, default Q and series (kept in this browser)"
            data-tour="build.default"
          >
            Use as default for new designs
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={resetBuildToDefaults}
            title="The board, the package models, the default Q and the series back to the defaults for new designs, as one step of Undo; part ratings and the stock list stay"
          >
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  );
}
