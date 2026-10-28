import { countImport, countRefused } from './analytics/files';
import { complex, formatEngineering, type SweepLoad } from '@smithonline/core';
import { create } from 'zustand';
import { useDesignStore } from '../store/useDesignStore';
import { readImportFile, SPlotOnlyError, type ImportedFile } from './import';
import { fmtFrequency } from './format';
import { MAX_SWEEP_LOADS } from './datapoints';
import { refusal } from './messageKind';
import { loadSPlotText } from './splotActions';

/**
 * The open import dialog's file, outside the header: the desktop header and
 * the phone's top bar are different components, and the dialog stays open
 * when a rotation across 700 px swaps one for the other. The workflows read
 * it too (a step that waits for the dialog, docs/09).
 */
export const useImported = create<{
  imported: { file: ImportedFile; id: number } | null;
  /** Counts the files opened into the dialog: each opens a dialog of its own. */
  count: number;
}>(() => ({ imported: null, count: 0 }));

/** Open the import dialog with a file read from a file name and its text. */
export function showImported(file: ImportedFile): void {
  const id = useImported.getState().count + 1;
  useImported.setState({ imported: { file, id }, count: id });
}

/**
 * Open a measured or S-parameter file for the chart, as File > Open does for
 * everything but designs: the rows go to the import dialog, a two-port fills
 * the device panel, a file with S-parameters goes to the S-Plot list too, and
 * a file without S11 goes to the S-Plot list only. Returns the status line,
 * and whether the dialog opened. Throws when the file cannot be read.
 */
export function openImportText(
  fileName: string,
  text: string,
): { note: string; dialog: boolean; twoPort: boolean } {
  const store = useDesignStore.getState();
  let parsed: ImportedFile;
  try {
    parsed = readImportFile(fileName, text);
  } catch (err) {
    if (!(err instanceof SPlotOnlyError)) {
      countRefused(fileName, 'rows', err instanceof Error ? err.message : String(err));
      throw err;
    }
    // No S11, so nothing for the chart: the file goes to the S-Plot list only.
    loadSPlotText(fileName, text);
    useImported.setState({ imported: null });
    const why = err.message.charAt(0).toLowerCase() + err.message.slice(1);
    return { note: `${fileName}: added to the S-Plot list; ${why}`, dialog: false, twoPort: false };
  }
  let inSPlot = false;
  if (parsed.sPlot) {
    try {
      loadSPlotText(fileName, text);
      inSPlot = true;
    } catch {
      // the chart import above accepted the file; the S-Plot list simply stays as it was
    }
  }
  let note = `${fileName}: ${parsed.rows.length} impedance ${parsed.rows.length === 1 ? 'row' : 'rows'}${inSPlot ? '; also in the S-Plot list' : ''}`;
  if (parsed.kind === 'twoPort') {
    const frequency = store.design.frequency;
    store.importTwoPort(parsed.data, parsed.fileName);
    countImport(fileName, 'device');
    const src = useDesignStore.getState().design.twoPort?.source;
    const hz = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
    note = src?.clamped
      ? `${fileName}: ${hz(frequency)} is outside the file (${hz(src.covers[0])} to ${hz(src.covers[1])}); the two-port panel holds the nearest end`
      : `${fileName}: device parameters at ${hz(frequency)} are in the two-port panel`;
  }
  showImported(parsed);
  return { note, dialog: true, twoPort: parsed.kind === 'twoPort' };
}

/** The rows of an imported file a design can use: a DC row cannot be a design frequency. */
export function usableRows(file: ImportedFile): readonly SweepLoad[] {
  return file.rows.filter((r) => r.frequency > 0);
}

/**
 * The row DP1 starts at: the one nearest the design frequency, or, when the design frequency
 * lies outside the file's band (a new design at 1 GHz and a 2.4 GHz antenna), the one nearest
 * the centre of the band rather than its edge.
 */
export function nominalRow(rows: readonly SweepLoad[], frequency: number): number {
  if (rows.length === 0) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    lo = Math.min(lo, r.frequency);
    hi = Math.max(hi, r.frequency);
  }
  const aim = frequency >= lo && frequency <= hi ? frequency : (lo + hi) / 2;
  return rows.reduce(
    (best, r, i) =>
      Math.abs(r.frequency - aim) < Math.abs((rows[best] as SweepLoad).frequency - aim) ? i : best,
    0,
  );
}

/**
 * "Use all rows as the load": the design sweeps over every row, DP1 at the nominal row, and the
 * dialog closes. Returns false when the file has fewer than two usable rows.
 */
export function sweepOverRows(file: ImportedFile): boolean {
  const store = useDesignStore.getState();
  const rows = usableRows(file);
  const start = rows[nominalRow(rows, store.design.frequency)];
  if (rows.length < 2 || !start) return false;
  // More rows than a design holds (and its links and files carry): refused with the count.
  if (rows.length > MAX_SWEEP_LOADS) {
    store.setMessage(
      refusal(
        `${file.fileName} has ${rows.length} rows; a sweep holds at most ${MAX_SWEEP_LOADS}. Set the load from one row instead.`,
      ),
    );
    return false;
  }
  const atF = start.frequency === store.design.frequency;
  store.updateFollowingDevice(
    (d) => ({
      ...d,
      load: complex(start.z.re, start.z.im),
      frequency: start.frequency,
      elements: d.elements.map((el) =>
        el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
          ? { ...el, refFrequency: start.frequency }
          : el,
      ),
      sweep: {
        ...d.sweep,
        enabled: true,
        loads: rows,
        loadsName: file.fileName,
        mode: 'datapoints',
      },
    }),
    atF
      ? `Datapoint sweep over ${rows.length} points of ${file.fileName}; DP1 is the ${fmtFrequency(start.frequency)} row, at the design frequency`
      : `Datapoint sweep over ${rows.length} points of ${file.fileName}. Design frequency set to ${fmtFrequency(start.frequency)}, the nominal row`,
  );
  useImported.setState({ imported: null });
  return true;
}
