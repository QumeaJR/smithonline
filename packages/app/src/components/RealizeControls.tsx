import {
  E_SERIES,
  E_SERIES_TOLERANCE,
  parseStockReport,
  type RealizeScope,
  type StockReport,
  type StockSkip,
} from '@smithonline/core';
import { useMemo } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { useBoard } from '../store/useBoard';
import { useShell } from '../store/useShell';
import { openSample } from '../lib/samples';
import { noteBoardOn, noteEmptyLibrary, noteRealizeOn } from '../lib/nextSteps';
import { realizeOnMessage } from '../lib/realize';
import type { BoardSettings } from '@smithonline/core';
import { usePartLibrary } from '../store/usePartLibrary';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';

const SCOPE_LABELS: Readonly<Record<RealizeScope, string>> = {
  all: 'All parts',
  L: 'Inductors only',
  C: 'Capacitors only',
  R: 'Resistors only',
  pairs: 'L-C pairs, keep resonance',
};

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

/** The board in one line: "FR-4 1.6 mm, 1 via per shunt part, traces 0 mm". */
function boardSummary(board: BoardSettings): string {
  const st = board.stackup;
  const laminate = st.name || `εr ${st.er}, ${fmtMm(st.h)} mm`;
  const vias = `${board.viasPerShunt} ${board.viasPerShunt === 1 ? 'via' : 'vias'} per shunt part`;
  return `${laminate}, ${vias}, traces ${fmtMm(board.traceLength)} mm`;
}

function fmtMm(m: number): string {
  return String(Math.round(m * 1e5) / 100);
}

/**
 * The as-built row of the network panel header: the Realize, Losses and
 * Board switches side by side (wrapping on a narrow column), with their
 * settings under them only while they are on: series or own stock and scope
 * for Realize, the default Q values for Losses, the board in one line with
 * Edit board (docs/09 section 2).
 */
export function RealizeControls() {
  const realize = useDesignStore((s) => s.design.realize);
  const losses = useDesignStore((s) => s.design.losses);
  const { setRealize, setLosses } = useDesignStore.getState();
  const libraryCount = usePartLibrary((s) => s.parts.length);
  const board = useBoard((s) => s.board);
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
          title="Include the board in the network as built: pads, a via under each shunt part, traces between parts. Kept for every design in this browser"
          checked={board.enabled}
          onChange={(enabled) => {
            useBoard.getState().setBoard({ enabled });
            if (enabled) noteBoardOn();
          }}
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
        </div>
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
      {realize.enabled && realize.series === 'stock' && (
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
            <div className="muted small">
              {stock.stock.L.length} inductor, {stock.stock.C.length} capacitor and{' '}
              {stock.stock.R.length} resistor values. A value without a unit counts for all three
              only when no value has a unit; R notation (4R7) is a resistor.
              {stock.skipped.length > 0 && <> {skippedText(stock.skipped)}</>}
            </div>
          )}
        </div>
      )}
      {board.enabled && (
        <div className="muted small board-summary" role="group" aria-label="Board">
          <span title="The board in the network as built, for every design in this browser">
            {boardSummary(board)}
          </span>{' '}
          <Button
            size="sm"
            variant="quiet"
            onClick={() => useShell.getState().openSettings('board')}
            title="The stackup, vias and traces, in Settings, Board"
            data-tour="network.boardEdit"
          >
            Edit board…
          </Button>
        </div>
      )}
      {losses.enabled && (
        <div className="row loss-options" role="group" aria-label="Default Q values">
          <Field
            className="field"
            label={
              <>
                Q<sub>L</sub>
              </>
            }
            title="Default inductor Q"
            value={losses.inductorQ}
            plain
            min={0}
            width="calc(6ch + 8px)"
            onCommit={(inductorQ) => setLosses({ inductorQ })}
            ariaLabel="Default inductor Q"
          />
          <Field
            className="field"
            label={
              <>
                Q<sub>C</sub>
              </>
            }
            title="Default capacitor Q"
            value={losses.capacitorQ}
            plain
            min={0}
            width="calc(6ch + 8px)"
            onCommit={(capacitorQ) => setLosses({ capacitorQ })}
            ariaLabel="Default capacitor Q"
          />
        </div>
      )}
    </div>
  );
}
