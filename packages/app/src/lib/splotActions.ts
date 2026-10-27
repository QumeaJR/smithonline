/**
 * What the S-Plot buttons do: load a file into the list, send s11 or s22 to
 * the Smith chart, use the file as the device, export converted Touchstone.
 */
import { countImport, countRefused } from './analytics/files';
import {
  complex,
  sIndex,
  writeConvertedTouchstone,
  type FrequencyUnit,
  type NetworkParameter,
  type TouchstoneFormat,
} from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';
import { useSPlotStore, type SPlotEntry } from '../store/useSPlotStore';
import { exportText } from './export';
import { fmtComplex, fmtFrequency } from './format';
import { MAX_SWEEP_LOADS } from './datapoints';
import { refusal } from './messageKind';
import { nearestIndex, portRows, readSPlotFiles } from './splot';

/** The files the S-Plot list opens: Touchstone, CITI, EZNEC and VNA CSV. */
export const SPLOT_ACCEPT = '.s1p,.s2p,.s3p,.s4p,.citi,.cti,.csv,.txt';

/**
 * The largest VNA table or EZNEC text (.txt, .csv) the S-Plot reads, bytes. Their parser
 * runs on the main thread: a larger file (a log, a binary dump) is refused before it is read.
 * Touchstone and CITI files have no such limit.
 */
export const MAX_TABLE_BYTES = 20 * 1024 * 1024;

const sizeText = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Why a file is refused before it is read, or null. */
function refusedUnread(file: File): string | null {
  if (/\.(txt|csv)$/i.test(file.name) && file.size > MAX_TABLE_BYTES) {
    return `${file.name} is ${sizeText(file.size)}; a VNA table or EZNEC file above ${sizeText(MAX_TABLE_BYTES)} is not read`;
  }
  return null;
}

/**
 * Add picked or dropped files to the S-Plot list. One file says what it added or why it
 * could not be read; several say it in one line ("Added 2 files; broken.s2p could not be
 * read: ..."), so a bad file is never hidden behind the next one's message.
 */
export async function openSPlotFiles(list: FileList | readonly File[] | null): Promise<void> {
  if (!list) return;
  const files = Array.from(list);
  if (files.length === 0) return;
  const { setMessage } = useDesignStore.getState();
  const added: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const file of files) {
    const early = refusedUnread(file);
    if (early) {
      failed.push({ name: file.name, reason: early });
      continue;
    }
    try {
      added.push(loadSPlotText(file.name, await file.text()));
    } catch (err) {
      failed.push({
        name: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (files.length === 1) {
    const [bad] = failed;
    if (bad) {
      const text = bad.reason.startsWith(bad.name)
        ? bad.reason
        : `Could not open ${bad.name}: ${bad.reason}`;
      setMessage(text, { error: true });
    } else setMessage(added[0] ?? null);
    return;
  }
  const parts: string[] = [];
  if (added.length > 0) parts.push(`Added ${added.length} file${added.length === 1 ? '' : 's'}`);
  for (const f of failed) {
    parts.push(f.reason.startsWith(f.name) ? f.reason : `${f.name} could not be read: ${f.reason}`);
  }
  setMessage(parts.join('; '), failed.length > 0 ? { error: true } : undefined);
}

/** Parse a file and add it to the S-Plot list; returns a status line. Throws on a bad file. */
export function loadSPlotText(fileName: string, text: string): string {
  let parsed: ReturnType<typeof readSPlotFiles>;
  try {
    parsed = readSPlotFiles(fileName, text);
  } catch (err) {
    countRefused(fileName, 'splot', err instanceof Error ? err.message : String(err));
    throw err;
  }
  useSPlotStore.getState().addFiles(parsed);
  if (parsed.length > 0) countImport(fileName, 'splot');
  const first = parsed[0];
  if (!first) return refusal(`${fileName}: no data`);
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

/**
 * Port 2 needs a two-port file, and the port's reflection term must be in it:
 * a VNA table can hold S21 without S11 or S22 (the missing ones are NaN).
 */
export function hasPort(entry: SPlotEntry, port: 1 | 2): boolean {
  if (entry.data.ports < port || entry.data.points.length === 0) return false;
  const k = sIndex(entry.data.ports, port, port);
  return entry.data.points.every((p) => Number.isFinite(p.s[k]?.re) && Number.isFinite(p.s[k]?.im));
}

/**
 * The S-parameters of ports 1 and 2 the file lacks (s11, s21, s12, s22), as
 * a VNA table without them holds NaN; empty for a complete file.
 */
export function missingParameters(entry: SPlotEntry): string[] {
  const { ports, points } = entry.data;
  const terms: readonly (readonly [string, number, number])[] =
    ports >= 2
      ? [
          ['s11', 1, 1],
          ['s21', 2, 1],
          ['s12', 1, 2],
          ['s22', 2, 2],
        ]
      : [['s11', 1, 1]];
  return terms
    .filter(([, i, j]) => {
      const k = sIndex(ports, i, j);
      return !points.every((p) => Number.isFinite(p.s[k]?.re) && Number.isFinite(p.s[k]?.im));
    })
    .map(([name]) => name);
}

/** "s12 and s22", "s11, s12 and s22". */
export function listNames(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

/** A device needs all four S-parameters of ports 1 and 2 at every point. */
export function isCompleteTwoPort(entry: SPlotEntry): boolean {
  return (
    entry.data.ports >= 2 && entry.data.points.length > 0 && missingParameters(entry).length === 0
  );
}

/**
 * Make s11 or s22 at `frequency` the design load (DP1) and the design
 * frequency, as clicking a row of the import dialog does. Switches to the chart.
 */
export function sendLoadToChart(entry: SPlotEntry, port: 1 | 2, frequency: number): string {
  if (!hasPort(entry, port)) return refusal(`${entry.fileName} has no s${port}${port}`);
  // A DC row cannot be a design frequency; it is left out of the hand-over.
  const rows = portRows(entry.data, port).filter((r) => r.frequency > 0);
  const i = nearestIndex(
    rows.map((r) => r.frequency),
    frequency,
  );
  const row = i === null ? undefined : rows[i];
  if (!row) return refusal(`${entry.fileName} has no s${port}${port}`);
  const store = useDesignStore.getState();
  const said = `Load set from ${entry.fileName} s${port}${port}: ${fmtComplex(row.z)} Ω at ${fmtFrequency(row.frequency)}`;
  // One step, named for Undo and Redo by the words it returns.
  store.updateFollowingDevice(
    (d) => ({
      ...d,
      load: complex(row.z.re, row.z.im),
      frequency: row.frequency,
      elements: d.elements.map((el) =>
        el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
          ? { ...el, refFrequency: row.frequency }
          : el,
      ),
    }),
    said,
  );
  store.setView('chart');
  return said;
}

/** Add s11 or s22 of the file as a datapoint sweep; DP1 is the row nearest the design frequency. */
export function sendSweepToChart(entry: SPlotEntry, port: 1 | 2): string {
  if (!hasPort(entry, port)) return refusal(`${entry.fileName} has no s${port}${port}`);
  // A DC row cannot be a design frequency; it is left out of the hand-over.
  const rows = portRows(entry.data, port).filter((r) => r.frequency > 0);
  if (rows.length < 2) return refusal(`${entry.fileName} needs at least two points for a sweep`);
  if (rows.length > MAX_SWEEP_LOADS) {
    return refusal(
      `${entry.fileName} has ${rows.length} points; a sweep holds at most ${MAX_SWEEP_LOADS}`,
    );
  }
  const store = useDesignStore.getState();
  const f0 = store.design.frequency;
  const near = nearestIndex(
    rows.map((r) => r.frequency),
    f0,
  );
  const start = rows[near ?? 0];
  if (!start) return refusal(`${entry.fileName} has no s${port}${port}`);
  const name = `${entry.fileName} s${port}${port}`;
  const said = `Datapoint sweep over ${rows.length} points of ${name}; DP1 is the ${fmtFrequency(start.frequency)} row`;
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
      sweep: { ...d.sweep, enabled: true, loads: rows, loadsName: name, mode: 'datapoints' },
    }),
    said,
  );
  store.setView('chart');
  return said;
}

/** Fill the two-port panel from the file at the design frequency. */
export function fillDeviceFromFile(entry: SPlotEntry): string {
  if (entry.data.ports < 2)
    return refusal(`${entry.fileName} is a ${entry.data.ports}-port; a device needs two ports`);
  if (!isCompleteTwoPort(entry))
    return refusal(
      `${entry.fileName} has no ${listNames(missingParameters(entry))}; a device needs s11, s21, s12 and s22`,
    );
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

/**
 * `amp.s2p` as Z normalized becomes `amp-z-norm.s2p`; S keeps the plain name.
 * A network entry ("Example 5 (network)") has no extension to drop.
 */
export function exportFileName(entry: SPlotEntry, choice: ExportChoice): string {
  const name = entry.fileName.replace(/\s*\[[^\]]*\]$/, '');
  const stem =
    (entry.network ? name : name.replace(/\.[^.]+$/, ''))
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'sparams';
  const tag =
    choice.parameter === 'S'
      ? ''
      : `-${choice.parameter.toLowerCase()}-${choice.normalized ? 'norm' : 'ohm'}`;
  return `${stem}${tag}.s${entry.data.ports}p`;
}

/** The Touchstone text of the entry for a choice; throws a `NetworkParameterError` text for impossible ones. */
export function exportTouchstoneText(entry: SPlotEntry, choice: ExportChoice): string {
  const missing = missingParameters(entry);
  if (missing.length > 0) {
    throw new Error(
      `the file has no ${listNames(missing)}, and a Touchstone file needs every S-parameter`,
    );
  }
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
    return refusal(
      `Could not export ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
