import type { PartFixture } from '@smithonline/core';
import { useRef, useState } from 'react';
import {
  addReportText,
  MANUFACTURER_PAGES,
  partNominalText,
  partRangeText,
  partSrfText,
  partTitle,
} from '../lib/parts';
import { useDesignStore } from '../store/useDesignStore';
import { syntheticLibraryParts, usePartLibrary } from '../store/usePartLibrary';
import { HelpLink } from './HelpLink';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface PartLibraryDialogProps {
  readonly onClose: () => void;
}

/**
 * The part library: real parts from the S-parameter files their
 * manufacturers publish. Load one or many .s2p files, see what each part is
 * (manufacturer, part number, kind, nominal value, self-resonance, frequency
 * range, the fixture it was measured in), add it to the network in series or
 * in shunt, remove it. The files stay in this browser.
 */
export function PartLibraryDialog({ onClose }: PartLibraryDialogProps) {
  const parts = usePartLibrary((s) => s.parts);
  const persistent = usePartLibrary((s) => s.persistent);
  const ready = usePartLibrary((s) => s.ready);
  const frequency = useDesignStore((s) => s.design.frequency);
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const say = (text: string, error = false): void => {
    setStatus({ text, error });
    useDesignStore.getState().setMessage(text, error ? { error: true } : undefined);
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

  const add = (key: string, orientation: 'series' | 'shunt'): void => {
    const record = usePartLibrary.getState().parts.find((p) => p.key === key);
    if (!record) return;
    const { addElement, design } = useDesignStore.getState();
    const name = `${orientation === 'series' ? 'Series' : 'Shunt'} ${record.part.type} part`;
    addElement(
      { kind: 'part', orientation, part: record.part },
      `Added ${name} ${design.elements.length + 1}: ${record.part.partNumber}`,
    );
  };

  const setFixture = async (key: string, fixture: PartFixture): Promise<void> => {
    const problem = await usePartLibrary.getState().setFixture(key, fixture);
    if (problem) say(`Could not read the part as ${fixture}-through: ${problem}`, true);
    else say(`Read as measured ${fixture === 'series' ? 'in series' : 'to ground'}`);
  };

  return (
    <Dialog
      title="Part library"
      subtitle={persistent ? 'stored in this browser' : 'kept until the page closes'}
      onClose={onClose}
      closeLabel="Close the part library"
      className="settings part-library"
      footer={
        <Button variant="primary" className="dialog-close" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="small">
        Real inductors and capacitors from the S-parameter files (.s2p) their manufacturers publish.
        Download the files from the manufacturer and load them here; they stay in this browser and
        are never sent anywhere. A part in the network evaluates from its measured data, and Realize
        can choose library parts.{' '}
        <HelpLink section="analysis-for-building" topic="the part library" />
      </p>
      {!persistent && (
        <p className="small warn-text" role="note">
          This browser does not let the app store files (a private window?): the library lasts until
          the page is closed.
        </p>
      )}
      <div className="row part-library-actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          title="Read one or many two-port Touchstone files (.s2p) of parts"
        >
          Load .s2p files…
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            void usePartLibrary
              .getState()
              .addParts(syntheticLibraryParts())
              .then(() =>
                say('Added the synthetic examples: made from equivalent circuits, not measured'),
              );
          }}
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
      {status && (
        <p className={`small ${status.error ? 'error-text' : 'muted'}`} role="status">
          {status.text}
        </p>
      )}

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
            <table>
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
                  <th scope="col">Add</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => {
                  const inRange =
                    frequency >= p.part.range[0] * (1 - 1e-9) &&
                    frequency <= p.part.range[1] * (1 + 1e-9);
                  return (
                    <tr key={p.key}>
                      <th scope="row" title={`${partTitle(p.part)}, from ${p.fileName}`}>
                        <span className="part-name">
                          <span className="mono">{p.part.partNumber}</span>
                          <span className="muted">
                            {p.part.manufacturer || 'manufacturer not named'}
                          </span>
                        </span>
                      </th>
                      <td>{p.part.type}</td>
                      <td className="mono">{partNominalText(p.part)}</td>
                      <td className="mono">{partSrfText(p.part)}</td>
                      <td
                        className={`mono ${inRange ? '' : 'warn-text'}`}
                        title={
                          inRange ? undefined : 'The design frequency is outside this part’s data'
                        }
                      >
                        {partRangeText(p.part)}
                      </td>
                      <td>
                        <select
                          value={p.part.data?.fixture ?? 'series'}
                          aria-label={`${p.part.partNumber} measured`}
                          onChange={(e) => void setFixture(p.key, e.target.value as PartFixture)}
                        >
                          <option value="series">in series</option>
                          <option value="shunt">to ground</option>
                        </select>
                      </td>
                      <td>
                        <span className="part-row-actions">
                          <Button
                            size="sm"
                            onClick={() => add(p.key, 'series')}
                            title={`Add ${p.part.partNumber} at the source end, in series`}
                            aria-label={`Add ${p.part.partNumber} in series`}
                          >
                            Series
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => add(p.key, 'shunt')}
                            title={`Add ${p.part.partNumber} at the source end, to ground`}
                            aria-label={`Add ${p.part.partNumber} in shunt`}
                          >
                            Shunt
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              void usePartLibrary.getState().remove(p.key);
                              say(
                                `Removed ${p.part.partNumber} from the library; designs that use it keep their copy`,
                              );
                            }}
                            aria-label={`Remove ${p.part.partNumber} from the library`}
                            title="Remove from the library; a design that uses the part keeps its own copy"
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
      <ul className="small manufacturer-links">
        {MANUFACTURER_PAGES.map((m) => (
          <li key={m.url}>
            <a href={m.url} target="_blank" rel="noopener noreferrer">
              {m.name}
            </a>{' '}
            <span className="muted">{m.what}</span>
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
