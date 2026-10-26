/**
 * Sample files for Learn > Sample files and the guided workflows (docs/09
 * section 3.0). Every one is synthetic and named so: the antenna is a series
 * R, L and C with a shunt C written by scripts/synth-antenna.mjs, the
 * amplifier the made-up two-port of the reader tests, the parts the D5
 * equivalent circuits. No vendor data. Opening one goes through the real
 * import path, so the import dialog opens with it as with a file of yours.
 */
import antennaText from '../../../core/test/fixtures/sparams/antenna-2g4-synthetic.s1p?raw';
import amplifierText from '../../../core/test/fixtures/sparams/amp-synthetic.s2p?raw';
import { useDesignStore } from '../store/useDesignStore';
import { MAX_LIBRARY_PARTS, syntheticLibraryParts, usePartLibrary } from '../store/usePartLibrary';
import { useSPlotStore } from '../store/useSPlotStore';
import { readImportFile } from './import';
import { openImportText, showImported } from './importDialog';
import { noteDevice } from './nextSteps';
import type { SampleId } from './workflowKit';

export interface Sample {
  readonly id: SampleId;
  readonly title: string;
  readonly description: string;
  /** The file name, with "synthetic" in it. */
  readonly fileName: string;
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'antenna',
    title: 'Antenna at 2.4 GHz (synthetic .s1p)',
    description: '101 rows from 2.2 to 2.7 GHz: a series R, L and C with a shunt C, not measured',
    fileName: 'antenna-2g4-synthetic.s1p',
  },
  {
    id: 'amplifier',
    title: 'Amplifier (synthetic .s2p)',
    description: 'A made-up small-signal two-port with noise data, 0.5 to 6 GHz',
    fileName: 'amp-synthetic.s2p',
  },
  {
    id: 'parts',
    title: 'Part library: synthetic 0402 parts',
    description: 'Ten made-up inductors and capacitors from equivalent circuits, named SYNTH-',
    fileName: 'SYNTH-*.s2p',
  },
];

const TEXTS: Readonly<Record<Exclude<SampleId, 'parts'>, string>> = {
  antenna: antennaText,
  amplifier: amplifierText,
};

/** The text of a sample file. */
export function sampleText(id: Exclude<SampleId, 'parts'>): string {
  return TEXTS[id];
}

/**
 * Open a sample: a file through the import path (the dialog opens with its rows, on the
 * chart view), or the synthetic parts into the part library.
 */
export function openSample(id: SampleId): void {
  const store = useDesignStore.getState();
  if (id === 'parts') {
    void usePartLibrary
      .getState()
      .addParts(syntheticLibraryParts())
      .then(({ added, skipped }) =>
        useDesignStore
          .getState()
          .setMessage(
            skipped > 0
              ? `Added ${added} of the synthetic example parts; ${skipped} left out, the part library holds ${MAX_LIBRARY_PARTS} parts at most`
              : 'Added the synthetic example parts: made from equivalent circuits, not measured',
            skipped > 0 && added === 0 ? { error: true } : undefined,
          ),
      );
    return;
  }
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return;
  // The S-Plot view keeps its own list; a sample for the chart opens on the chart.
  if (store.view === 'splot') store.setView('chart');
  try {
    // The device is this sample already (a second press): its rows show, nothing is added.
    if (store.design.twoPort?.source?.fileName === sample.fileName) {
      showImported(readImportFile(sample.fileName, sampleText(id)));
      store.setMessage(`${sample.fileName} is the device already`);
      return;
    }
    // One S-Plot entry per sample: opening it again replaces the one there.
    useSPlotStore.setState((sp) => {
      const files = sp.files.filter((f) => f.fileName !== sample.fileName || f.network);
      return files.length === sp.files.length
        ? {}
        : {
            files,
            activeId: files.some((f) => f.id === sp.activeId)
              ? sp.activeId
              : (files[files.length - 1]?.id ?? null),
            selected: null,
          };
    });
    const { note, twoPort } = openImportText(sample.fileName, sampleText(id));
    store.setMessage(note);
    if (twoPort) noteDevice();
  } catch (err) {
    store.setMessage(
      `Could not open ${sample.fileName}: ${err instanceof Error ? err.message : String(err)}`,
      { error: true },
    );
  }
}
