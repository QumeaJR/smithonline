/**
 * What the S-Plot buttons do: load a file into the list, send s11 or s22 to
 * the Smith chart, use the file as the device, export converted Touchstone.
 */
import {
  complex,
  writeConvertedTouchstone,
  type FrequencyUnit,
  type NetworkParameter,
  type TouchstoneFormat,
} from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';
import { useSPlotStore, type SPlotEntry } from '../store/useSPlotStore';
import { exportText } from './export';
import { fmtComplex, fmtFrequency } from './format';
import { nearestIndex, portRows, readSPlotFiles } from './splot';

/** Parse a file and add it to the S-Plot list; returns a status line. Throws on a bad file. */
export function loadSPlotText(fileName: string, text: string): string {
  const parsed = readSPlotFiles(fileName, text);
  useSPlotStore.getState().addFiles(parsed);
  const first = parsed[0];
  if (!first) return `${fileName}: no data`;
  const n = first.data.points.length;
  return parsed.length > 1
    ? `${fileName}: ${parsed.length} packages added to the S-Plot list`
    : `${fileName}: ${first.data.ports}-port, ${n} point${n === 1 ? '' : 's'} added to the S-Plot list`;
}

/** The frequency "send" and "use" buttons refer to: the selected row, else the graph cursor, else the first sample. */
export function referenceFrequency(
  entry: SPlotEntry,
  selected: number | null,
  cursor: number | null,
): number | null {
  const freqs = entry.data.points.map((p) => p.frequency);
  if (selected !== null && freqs[selected] !== undefined) return freqs[selected] as number;
  if (cursor !== null) {
    const i = nearestIndex(freqs, cursor);
    if (i !== null) return freqs[i] as number;
  }
  return freqs[0] ?? null;
}

/** Port 2 needs a two-port file. */
export function hasPort(entry: SPlotEntry, port: 1 | 2): boolean {
  return entry.data.ports >= port && entry.data.points.length > 0;
}

/**
 * Make s11 or s22 at `frequency` the design load (DP1) and the design
 * frequency, as clicking a row of the import dialog does. Switches to the chart.
 */
export function sendLoadToChart(entry: SPlotEntry, port: 1 | 2, frequency: number): string {
  const rows = portRows(entry.data, port);
  const i = nearestIndex(
    rows.map((r) => r.frequency),
    frequency,
  );
  const row = i === null ? undefined : rows[i];
  if (!row) return `${entry.fileName} has no s${port}${port}`;
  const store = useDesignStore.getState();
  store.updateFollowingDevice((d) => ({
    ...d,
    load: complex(row.z.re, row.z.im),
    frequency: row.frequency,
    elements: d.elements.map((el) =>
      el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
        ? { ...el, refFrequency: row.frequency }
        : el,
    ),
  }));
  store.setView('chart');
  return `Load set from ${entry.fileName} s${port}${port}: ${fmtComplex(row.z)} Ω at ${fmtFrequency(row.frequency)}`;
}

/** Add s11 or s22 of the file as a datapoint sweep; DP1 is the row nearest the design frequency. */
export function sendSweepToChart(entry: SPlotEntry, port: 1 | 2): string {
  const rows = portRows(entry.data, port);
  if (rows.length < 2) return `${entry.fileName} needs at least two points for a sweep`;
  const store = useDesignStore.getState();
  const f0 = store.design.frequency;
  const near = nearestIndex(
    rows.map((r) => r.frequency),
    f0,
  );
  const start = rows[near ?? 0];
  if (!start) return `${entry.fileName} has no s${port}${port}`;
  const name = `${entry.fileName} s${port}${port}`;
  store.updateFollowingDevice((d) => ({
    ...d,
    load: complex(start.z.re, start.z.im),
    frequency: start.frequency,
    elements: d.elements.map((el) =>
      el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
        ? { ...el, refFrequency: start.frequency }
        : el,
    ),
    sweep: { ...d.sweep, enabled: true, loads: rows, loadsName: name, mode: 'datapoints' },
  }));
  store.setView('chart');
  return `Datapoint sweep over ${rows.length} points of ${name}; DP1 is the ${fmtFrequency(start.frequency)} row`;
}

/** Fill the two-port panel from the file at the design frequency. */
export function fillDeviceFromFile(entry: SPlotEntry): string {
  if (entry.data.ports < 2)
    return `${entry.fileName} is a ${entry.data.ports}-port; a device needs two ports`;
  const store = useDesignStore.getState();
  store.importTwoPort(entry.data, entry.fileName);
  return (
    useDesignStore.getState().message ??
    `Device filled from ${entry.fileName} at ${fmtFrequency(store.design.frequency)}`
  );
}

export interface ExportChoice {
  readonly parameter: NetworkParameter;
  readonly normalized: boolean;
  readonly format: TouchstoneFormat;
  readonly unit: FrequencyUnit;
}

/** `amp.s2p` as Z normalized becomes `amp-z-norm.s2p`; S keeps the plain name. */
export function exportFileName(entry: SPlotEntry, choice: ExportChoice): string {
  const stem =
    entry.fileName
      .replace(/\s*\[[^\]]*\]$/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w.-]+/g, '_') || 'sparams';
  const tag =
    choice.parameter === 'S'
      ? ''
      : `-${choice.parameter.toLowerCase()}-${choice.normalized ? 'norm' : 'ohm'}`;
  return `${stem}${tag}.s${entry.data.ports}p`;
}

/** The Touchstone text of the entry for a choice; throws a `NetworkParameterError` text for impossible ones. */
export function exportTouchstoneText(entry: SPlotEntry, choice: ExportChoice): string {
  return writeConvertedTouchstone(entry.data, choice.parameter, {
    normalized: choice.normalized,
    format: choice.format,
    frequencyUnit: choice.unit,
    comments: [`Smith Online S-Plot export of ${entry.fileName}`],
  });
}

/** Convert and download; returns a status line. */
export function exportEntry(entry: SPlotEntry, choice: ExportChoice): string {
  try {
    const text = exportTouchstoneText(entry, choice);
    const name = exportFileName(entry, choice);
    exportText(name, text);
    return `Exported ${name}`;
  } catch (err) {
    return `Could not export ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
