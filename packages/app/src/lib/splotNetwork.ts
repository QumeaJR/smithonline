/**
 * "Add the network to S-Plot": the two-port S-parameters of the matching
 * network as built, written as Touchstone and read back through the S-Plot
 * reader, so the entry behaves like any loaded .s2p file. A live entry
 * follows the design and the package table through a store subscription
 * here, outside the design store; the S-Plot list is not part of the design
 * history, so none of this is undone.
 */
import { writeLadderS2p, type PackageTable } from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';
import { usePackages } from '../store/usePackages';
import { useSPlotStore } from '../store/useSPlotStore';
import type { Design } from './design';
import { fmtFrequency } from './format';
import { builtNetwork, exportBand, exportFrequencies } from './simexport';
import { readSPlotFiles, type ParsedSPlotFile } from './splot';

/** How long a live entry waits after the last design change before it recomputes, ms. */
export const LIVE_NETWORK_DELAY_MS = 300;

/**
 * The network the chart evaluates as built (realized values or the ideal ones
 * with the loss model, and the component packages); shared with the .s2p export.
 */
export { builtNetwork };

/**
 * The frequencies of the entry, the same as the .s2p export: the design's
 * frequency sweep when it is on with a usable range, else half to twice the
 * design frequency in 201 points.
 */
export const networkBand = exportBand;

/** "Example 5 (network)". */
export function networkEntryName(design: Pick<Design, 'name'>): string {
  return `${design.name.trim() || 'Design'} (network)`;
}

/** The design's network as an S-Plot file. Throws when the network cannot be evaluated. */
export function networkSPlotFile(design: Design, table: PackageTable): ParsedSPlotFile {
  const frequencies = exportFrequencies(design);
  const { ladder, realized, packaged } = builtNetwork(design, table);
  const text = writeLadderS2p(ladder, frequencies, { name: design.name });
  const [parsed] = readSPlotFiles('network.s2p', text);
  if (!parsed) throw new Error('the network gave no data');
  const parts = [realized ? 'realized values' : 'ideal values'];
  if (design.losses.enabled) parts.push('losses');
  if (packaged) parts.push('packages');
  const as =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`
      : (parts[0] as string);
  return {
    ...parsed,
    fileName: networkEntryName(design),
    description: `Network of ${design.name.trim() || 'the design'}, ${as}, Z0 ${design.z0} Ω, the load not included`,
  };
}

/** "201 points, 225 MHz to 900 MHz". */
function pointsAndRange(file: ParsedSPlotFile): string {
  const f = file.data.points.map((p) => p.frequency);
  const n = f.length;
  return `${n} point${n === 1 ? '' : 's'}, ${fmtFrequency(f[0] ?? 0)} to ${fmtFrequency(f[n - 1] ?? 0)}`;
}

/**
 * The action: compute the network, put it in the S-Plot list (replacing the
 * live entry of the design when there is one) and switch to the S-Plot view.
 * Returns the status line.
 */
export function addNetworkToSPlot(): string {
  const design = useDesignStore.getState().design;
  let file: ParsedSPlotFile;
  try {
    file = networkSPlotFile(design, usePackages.getState().table);
  } catch (err) {
    return `Could not add the network to S-Plot: ${err instanceof Error ? err.message : String(err)}`;
  }
  const { replaced } = useSPlotStore.getState().putNetwork(file);
  useDesignStore.getState().setView('splot');
  return replaced
    ? `Updated ${file.fileName} in S-Plot: ${pointsAndRange(file)}`
    : `Added ${file.fileName} to S-Plot: ${pointsAndRange(file)}`;
}

/** Recompute the live entry from the current design; false when there is none or it fails. */
export function refreshLiveNetwork(): boolean {
  if (!useSPlotStore.getState().files.some((f) => f.network === 'live')) return false;
  try {
    const file = networkSPlotFile(useDesignStore.getState().design, usePackages.getState().table);
    return useSPlotStore.getState().refreshNetwork(file);
  } catch {
    // A network that cannot be evaluated for a moment (a value being typed) keeps the last curve.
    return false;
  }
}

/** "Example 5 (network snapshot 2)": the first number no entry uses yet. */
export function snapshotName(fileName: string, taken: readonly string[]): string {
  const base = fileName.endsWith(' (network)')
    ? `${fileName.slice(0, -' (network)'.length)} (network snapshot`
    : `${fileName} (snapshot`;
  for (let n = 1; ; n++) {
    const name = `${base} ${n})`;
    if (!taken.includes(name)) return name;
  }
}

/** Stop the entry following the design; it stays as a named snapshot. */
export function freezeNetworkEntry(id: string): string {
  const { files, freezeNetwork } = useSPlotStore.getState();
  const entry = files.find((f) => f.id === id);
  if (!entry || entry.network !== 'live') return '';
  const name = snapshotName(
    entry.fileName,
    files.map((f) => f.fileName),
  );
  freezeNetwork(id, name);
  return `${name} keeps the curves as they are; Add the network again for a live entry`;
}

/**
 * Keep the live entry in step with the design and the package table,
 * `delay` ms after the last change. Returns the unsubscribe function.
 */
export function startLiveNetworkSync(delay = LIVE_NETWORK_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (!useSPlotStore.getState().files.some((f) => f.network === 'live')) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refreshLiveNetwork();
    }, delay);
  };
  const offDesign = useDesignStore.subscribe((s, prev) => {
    if (s.design !== prev.design) schedule();
  });
  const offPackages = usePackages.subscribe((s, prev) => {
    if (s.table !== prev.table) schedule();
  });
  return () => {
    offDesign();
    offPackages();
    if (timer !== null) clearTimeout(timer);
  };
}
