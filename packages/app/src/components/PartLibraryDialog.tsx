import { partKey, type PartFixture } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import {
  addReportText,
  MANUFACTURER_PAGES,
  partNominalText,
  partRangeText,
  partSrfText,
  partTitle,
  placementWords,
} from '../lib/parts';
import type { StoredPart } from '../lib/partStore';
import { effectiveElements, realizeDesign } from '../lib/realize';
import { useDesignStore } from '../store/useDesignStore';
import { MAX_LIBRARY_PARTS, syntheticLibraryParts, usePartLibrary } from '../store/usePartLibrary';
import { HelpLink } from './HelpLink';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface PartLibraryDialogProps {
  readonly onClose: () => void;
}

/** What the dialog's status line says, with the records a removal can put back. */
interface Status {
  readonly text: string;
  readonly error: boolean;
  readonly undo?: readonly StoredPart[];
}

/**
 * The library parts the realized network uses now (Realize on with the part library as the
 * source), by their key: removing one of them changes the realized network.
 */
function realizedKeys(): Set<string> {
  const { design } = useDesignStore.getState();
  if (!design.realize.enabled || design.realize.series !== 'library') return new Set();
  const r = realizeDesign(design, effectiveElements(design));
  return new Set(
    (r?.elements ?? []).flatMap((e) =>
      e.ideal.kind !== 'part' && e.realized.kind === 'part' ? [partKey(e.realized.part)] : [],
    ),
  );
}

/**
 * The part library: real parts from the S-parameter files their
 * manufacturers publish. Load one or many .s2p files, see what each part is
 * (manufacturer, part number, kind, nominal value, self-resonance, frequency
 * range, the fixture it was measured in), add it to the network in series or
 * in shunt, remove it (with Undo), or remove them all. The files stay in this
 * browser. The row's actions stay in view: a sticky last column on a wide
 * screen, a card per part on a phone (index.css, part library).
 */
export function PartLibraryDialog({ onClose }: PartLibraryDialogProps) {
  const parts = usePartLibrary((s) => s.parts);
  const persistent = usePartLibrary((s) => s.persistent);
  const ready = usePartLibrary((s) => s.ready);
  const frequency = useDesignStore((s) => s.design.frequency);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadButton = useRef<HTMLButtonElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  /** After a removal, the row whose Remove button takes the focus (null: the Load button). */
  const focusKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const key = focusKey.current;
    if (key === undefined) return;
    focusKey.current = undefined;
    const target =
      key === null
        ? loadButton.current
        : table.current?.querySelector<HTMLElement>(
            `[data-part-key="${CSS.escape(key)}"] .part-remove`,
          );
    (target ?? loadButton.current)?.focus();
  }, [parts]);

  const setFocus = (key: string | null): void => {
    focusKey.current = key;
  };

  const say = (text: string, error = false, removed?: readonly StoredPart[]): void => {
    setStatus({ text, error, ...(removed ? { undo: removed } : {}) });
    // A removal's Undo rides on the message too, so the phone's toast offers it where the
    // dialog's own status line is scrolled out of sight.
    const action =
      removed && removed.length > 0
        ? { label: 'Undo', run: () => void undo(removed), timed: true }
        : undefined;
    useDesignStore
      .getState()
      .setMessage(text, error ? { error: true } : action ? { action } : undefined);
  };

  const load = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const texts = await Promise.all(
        files.map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      const report = await usePartLibrary.getState().addFiles(texts);
      say(addReportText(report), report.added.length + report.replaced.length === 0);
    } catch (err) {
      say(`Could not read the files: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const addExamples = async (): Promise<void> => {
    const { added, skipped } = await usePartLibrary.getState().addParts(syntheticLibraryParts());
    say(
      skipped > 0
        ? `Added ${added} of the synthetic examples; ${skipped} left out, the library holds ${MAX_LIBRARY_PARTS} parts at most`
        : 'Added the synthetic examples: made from equivalent circuits, not measured',
      skipped > 0 && added === 0,
    );
  };

  const add = (key: string, orientation: 'series' | 'shunt'): void => {
    const record = usePartLibrary.getState().parts.find((p) => p.key === key);
    if (!record) return;
    const { addElement, design } = useDesignStore.getState();
    const name = `${orientation === 'series' ? 'Series' : 'Shunt'} ${record.part.type} part`;
    const label = `Added ${name} ${design.elements.length + 1}: ${record.part.partNumber}`;
    addElement({ kind: 'part', orientation, part: record.part }, label);
    // The dialog's own status says it too: the status line may be behind the dialog.
    setStatus({
      text: `${label}, ${placementWords(orientation)}, at the source end`,
      error: false,
    });
  };

  /** What a removal does to the realized network, as the end of the status sentence. */
  const realizeEffect = (removed: readonly StoredPart[], before: Set<string>): string => {
    const used = removed.filter((r) => before.has(r.key)).length;
    if (used === 0) return '';
    return ` Realize used ${used === 1 ? 'it' : `${used} of them`}: the realized network and the BOM change.`;
  };

  const remove = async (record: StoredPart): Promise<void> => {
    const before = realizedKeys();
    const list = usePartLibrary.getState().parts;
    const at = list.findIndex((p) => p.key === record.key);
    const next = list[at + 1] ?? list[at - 1] ?? null;
    // Set before the list changes: the effect on the new list moves the focus.
    setFocus(next ? next.key : null);
    const removed = await usePartLibrary.getState().remove(record.key);
    if (!removed) return;
    say(
      `Removed ${record.part.partNumber} from the library; designs that use it keep their copy.${realizeEffect([removed], before)}`,
      false,
      [removed],
    );
  };

  const removeAll = async (): Promise<void> => {
    const before = realizedKeys();
    setFocus(null);
    const removed = await usePartLibrary.getState().removeAll();
    setConfirmAll(false);
    say(
      `Removed all ${removed.length} parts from the library; designs that use them keep their copies.${realizeEffect(removed, before)}`,
      false,
      removed,
    );
  };

  const undo = async (records: readonly StoredPart[]): Promise<void> => {
    // Once: the dialog's Undo and the message's Undo are the same step.
    if (
      records.length > 0 &&
      records.every((r) => usePartLibrary.getState().parts.some((p) => p.key === r.key))
    )
      return;
    setFocus(records[0]?.key ?? null);
    await usePartLibrary.getState().restore(records);
    say(
      records.length === 1
        ? `Put ${records[0]?.part.partNumber ?? 'the part'} back in the library`
        : `Put ${records.length} parts back in the library`,
    );
  };

  const setFixture = async (key: string, fixture: PartFixture): Promise<void> => {
    const name = usePartLibrary.getState().parts.find((p) => p.key === key)?.part.partNumber;
    const what = name ?? 'the part';
    const problem = await usePartLibrary.getState().setFixture(key, fixture);
    if (problem)
      say(`Could not read ${what} as measured ${placementWords(fixture)}: ${problem}`, true);
    else say(`Read ${what} as measured ${placementWords(fixture)}`);
  };

  return (
    <Dialog
      title="Part library"
      subtitle={persistent ? 'stored in this browser' : 'kept until the page closes'}
      onClose={onClose}
      onEscape={confirmAll ? () => setConfirmAll(false) : undefined}
      closeLabel="Close the part library"
      className="settings part-library"
      initialFocus={() => loadButton.current}
      footer={
        confirmAll ? (
          <>
            <span className="settings-confirm small" role="alert">
              Remove all {parts.length} parts from the library?
            </span>
            <Button variant="destructive" onClick={() => void removeAll()}>
              Remove all
            </Button>
            <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
          </>
        ) : (
          <>
            {parts.length > 0 && (
              <Button
                onClick={() => setConfirmAll(true)}
                title="Take every part out of the library; asks first, and Undo puts them back"
              >
                Remove all…
              </Button>
            )}
            <Button variant="primary" className="dialog-close" onClick={onClose}>
              Close
            </Button>
          </>
        )
      }
    >
      <p className="small">
        Real inductors and capacitors from the S-parameter files (.s2p) their manufacturers publish.
        Download the files from the manufacturer and load them here; they stay in this browser and
        are never sent anywhere. A part in the network evaluates from its measured data, and Realize
        can choose library parts. <HelpLink section="part-library" topic="the part library" />
      </p>
      {!persistent && (
        <p className="small warn-text" role="note">
          This browser does not let the app store files (a private window?): the library lasts until
          the page is closed.
        </p>
      )}
      <div className="row part-library-actions" data-tour="partLibrary.load">
        <Button
          ref={loadButton}
          variant="primary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          title="Read one or many two-port Touchstone files (.s2p) of parts"
        >
          Load .s2p files…
        </Button>
        <Button
          disabled={busy}
          onClick={() => void addExamples()}
          title="Ten made-up 0402 parts generated from equivalent circuits, to try the library without downloading anything; not real parts"
        >
          Add synthetic examples
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".s2p,.S2P"
          multiple
          hidden
          aria-label="Part files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void load(files);
          }}
        />
      </div>
      <p
        className={`small part-library-status ${status?.error ? 'error-text' : 'muted'}`}
        role="status"
      >
        {status?.text}
        {status?.undo && status.undo.length > 0 && (
          <>
            {' '}
            <Button
              size="sm"
              onClick={() => {
                const records = status.undo ?? [];
                void undo(records);
              }}
              title="Put the removed parts back in the library"
            >
              Undo
            </Button>
          </>
        )}
      </p>

      <h3>Parts</h3>
      {!ready ? (
        <p className="muted small">Reading the stored parts…</p>
      ) : parts.length === 0 ? (
        <p className="muted small">
          No parts yet. Load the .s2p files of the parts you have, or add the synthetic examples to
          try it.
        </p>
      ) : (
        <div className="package-table part-table">
          <div className="package-table-scroll">
            <table ref={table}>
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col" title="C: a capacitor, L: an inductor (below its resonance)">
                    Kind
                  </th>
                  <th scope="col" title="Effective value at the lowest frequency of the data">
                    Nominal
                  </th>
                  <th scope="col" title="Self-resonant frequency found in the data">
                    SRF
                  </th>
                  <th
                    scope="col"
                    title="The frequencies the data covers; outside them the part has no value"
                  >
                    Data
                  </th>
                  <th
                    scope="col"
                    title="How the part sat when it was measured: in series between the ports, or from the line to ground. Detected from the data; change it if the detection is wrong."
                  >
                    Measured
                  </th>
                  <th scope="col" className="part-actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => {
                  const inRange =
                    frequency >= p.part.range[0] * (1 - 1e-9) &&
                    frequency <= p.part.range[1] * (1 + 1e-9);
                  return (
                    <tr key={p.key} data-part-key={p.key}>
                      <th scope="row" title={`${partTitle(p.part)}, from ${p.fileName}`}>
                        <span className="part-name">
                          <span className="mono">{p.part.partNumber}</span>
                          <span className="muted">
                            {p.part.manufacturer || 'manufacturer not named'}
                          </span>
                        </span>
                      </th>
                      <td data-label="Kind">{p.part.type}</td>
                      <td data-label="Nominal" className="mono">
                        {partNominalText(p.part)}
                      </td>
                      <td data-label="SRF" className="mono">
                        {partSrfText(p.part)}
                      </td>
                      <td
                        data-label="Data"
                        className={`mono ${inRange ? '' : 'warn-text'}`}
                        title={
                          inRange ? undefined : 'The design frequency is outside this part’s data'
                        }
                      >
                        {partRangeText(p.part)}
                      </td>
                      <td data-label="Measured">
                        <select
                          value={p.part.data?.fixture ?? 'series'}
                          aria-label={`${p.part.partNumber} measured`}
                          onChange={(e) => void setFixture(p.key, e.target.value as PartFixture)}
                        >
                          <option value="series">in series</option>
                          <option value="shunt">to ground</option>
                        </select>
                      </td>
                      <td className="part-actions">
                        <span className="part-row-actions">
                          <Button
                            size="sm"
                            onClick={() => add(p.key, 'series')}
                            title={`Add ${p.part.partNumber} at the source end, in series`}
                            aria-label={`Add ${p.part.partNumber} in series`}
                          >
                            Add series
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => add(p.key, 'shunt')}
                            title={`Add ${p.part.partNumber} at the source end, to ground`}
                            aria-label={`Add ${p.part.partNumber} in shunt`}
                          >
                            Add shunt
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="part-remove"
                            onClick={() => void remove(p)}
                            aria-label={`Remove ${p.part.partNumber} from the library`}
                            title="Remove from the library (Undo puts it back); a design that uses the part keeps its own copy"
                          >
                            Remove
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3>Where to get the files</h3>
      <ul className="small manufacturer-links" data-tour="partLibrary.links">
        {MANUFACTURER_PAGES.map((m) => (
          <li key={m.url}>
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${m.name} ${m.line} (opens in a new tab)`}
            >
              {m.name} {m.line}
            </a>{' '}
            <span className="muted">{m.what}, opens in a new tab</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Each manufacturer's terms apply to its files (most allow simulation, not redistribution),
        which is why the app links to them and ships none. The synthetic examples are made up from
        equivalent circuits for trying the library; they are not real parts.
      </p>
    </Dialog>
  );
}
