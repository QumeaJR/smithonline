import {
  E_SERIES,
  E_SERIES_TOLERANCE,
  parseStockReport,
  type StockReport,
  type StockSkip,
} from '@smithonline/core';
import { useMemo } from 'react';
import { setBoardEnabled } from '../lib/buildActions';
import { boardSummary, SCOPE_LABELS } from '../lib/designBuild';
import { noteEmptyLibrary, noteRealizeOn } from '../lib/nextSteps';
import { openSample } from '../lib/samples';
import { realizeOnMessage } from '../lib/realize';
import { tourUi } from '../lib/tourUi';
import { useDesignBuild } from '../store/useDesignBuild';
import { useDesignStore } from '../store/useDesignStore';
import { usePartLibrary } from '../store/usePartLibrary';
import type { BuildSection } from '../store/useShell';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';

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

/** The quiet Edit… of a summary line: opens Build at its section. */
function EditLink({
  section,
  title,
  tour,
}: {
  readonly section: BuildSection;
  readonly title: string;
  readonly tour?: string;
}) {
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={() => tourUi.openBuild(section)}
      title={title}
      data-tour={tour}
    >
      Edit…
    </Button>
  );
}

/**
 * The as-built row of the network panel header (docs/09b section 5): the
 * Realize, Losses and Board switches side by side (wrapping on a narrow
 * column), modes of the live loop. While one is on, a summary line under it
 * says what it uses, with an Edit… that opens Build at its section; the
 * series stays inline for Realize. Everything here is saved with the design.
 */
export function RealizeControls() {
  const realize = useDesignStore((s) => s.design.realize);
  const losses = useDesignStore((s) => s.design.losses);
  const { setRealize, setLosses } = useDesignStore.getState();
  const libraryCount = usePartLibrary((s) => s.parts.length);
  const { board } = useDesignBuild();
  const stock = useMemo(
    () => (realize.series === 'stock' ? parseStockReport(realize.stockText) : null),
    [realize.series, realize.stockText],
  );

  return (
    <div className="realize-controls">
      <div className="row switches">
        <Switch
          className="mode"
          title="Snap values to a series, your stock or your part library"
          checked={realize.enabled}
          onChange={(enabled) => {
            setRealize({ enabled });
            // Said on the status line (a suggestion below rides on it), not the credit line.
            useDesignStore
              .getState()
              .setMessage(
                enabled
                  ? realizeOnMessage(useDesignStore.getState().design)
                  : 'Realize off: the ideal values',
              );
            if (enabled) noteRealizeOn();
          }}
          tour="network.realize"
        >
          Realize
        </Switch>
        <Switch
          className="mode"
          title="Finite Q for inductors and capacitors"
          checked={losses.enabled}
          onChange={(enabled) => setLosses({ enabled })}
        >
          Losses
        </Switch>
        <Switch
          className="mode"
          title="Include the board in the network as built: pads, a via under each shunt part, traces between parts. Saved with this design."
          checked={board.enabled}
          onChange={setBoardEnabled}
          tour="network.board"
        >
          Board
        </Switch>
      </div>
      {realize.enabled && (
        <div className="row realize-options" role="group" aria-label="Realize settings">
          <select
            value={realize.series}
            onChange={(e) => {
              setRealize({ series: e.target.value as typeof realize.series });
              if (e.target.value === 'library') noteEmptyLibrary();
            }}
            aria-label="Value series"
            data-tour="network.series"
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
          <span className="muted small build-summary">
            {SCOPE_LABELS[realize.scope]}
            {stock
              ? `, ${stock.stock.L.length + stock.stock.C.length + stock.stock.R.length} stock values`
              : ''}
          </span>
          <EditLink
            section="realization"
            title="Scope, stock list and part library, in Build, Realization"
          />
        </div>
      )}
      {realize.enabled && realize.series === 'stock' && stock && stock.skipped.length > 0 && (
        <div className="muted small">{skippedText(stock.skipped)}</div>
      )}
      {realize.enabled && realize.series === 'library' && (
        <div className="muted small library-note">
          {libraryCount === 0
            ? 'The part library is empty: each L and C stays ideal until you load part files. '
            : `${libraryCount} ${libraryCount === 1 ? 'part' : 'parts'} in the library. For each L and C the two parts that bracket its reactance at the design frequency (by effective value, from the measured data) are tried and the one with the lower VSWR is kept; an L or C with no part of its kind there stays ideal, and R and RLC blocks stay exact. `}
          <Button
            size="sm"
            variant="quiet"
            onClick={() => usePartLibrary.getState().setOpen(true)}
            title="Load S-parameter files of real parts, and see the parts you have"
            data-tour="network.partLibrary"
          >
            {libraryCount === 0 ? 'Load part files…' : 'Part library…'}
          </Button>
          {libraryCount === 0 && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => openSample('parts')}
              title="Ten made-up 0402 parts generated from equivalent circuits, named SYNTH-, not real parts"
            >
              Try sample parts
            </Button>
          )}
        </div>
      )}
      {losses.enabled && (
        <div className="row muted small build-summary-row" role="group" aria-label="Losses">
          <span className="build-summary">
            Q {losses.inductorQ} (L), {losses.capacitorQ} (C)
          </span>
          <EditLink section="losses" title="The default Q of inductors and capacitors, in Build" />
        </div>
      )}
      {board.enabled && (
        <div className="row muted small board-summary" role="group" aria-label="Board">
          <span
            className="build-summary"
            title="The board in the network as built, saved with this design"
          >
            {boardSummary(board)}
          </span>
          <EditLink
            section="board"
            title="The stackup, vias and traces, in Build, Board"
            tour="network.boardEdit"
          />
        </div>
      )}
    </div>
  );
}
