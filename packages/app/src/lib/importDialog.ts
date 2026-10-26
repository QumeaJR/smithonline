import { formatEngineering } from '@smithonline/core';
import { create } from 'zustand';
import { useDesignStore } from '../store/useDesignStore';
import { readImportFile, SPlotOnlyError, type ImportedFile } from './import';
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
    if (!(err instanceof SPlotOnlyError)) throw err;
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
  let note = `${fileName}: ${parsed.rows.length} impedance rows${inSPlot ? '; also in the S-Plot list' : ''}`;
  if (parsed.kind === 'twoPort') {
    const frequency = store.design.frequency;
    store.importTwoPort(parsed.data, parsed.fileName);
    const src = useDesignStore.getState().design.twoPort?.source;
    const hz = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
    note = src?.clamped
      ? `${fileName}: ${hz(frequency)} is outside the file (${hz(src.covers[0])} to ${hz(src.covers[1])}); the two-port panel holds the nearest end`
      : `${fileName}: device parameters at ${hz(frequency)} are in the two-port panel`;
  }
  showImported(parsed);
  return { note, dialog: true, twoPort: parsed.kind === 'twoPort' };
}
