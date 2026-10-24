/**
 * Left column of the S-Plot view: the file manager, trace and axis switches,
 * the hand-over to the Smith chart and the Touchstone export.
 */
import {
  formatEngineering,
  supportedParameters,
  type FrequencyUnit,
  type NetworkParameter,
  type TouchstoneFormat,
} from '@smithonline/core';
import { useRef, useState } from 'react';
import { fmtFrequency } from '../lib/format';
import { FREQUENCY_UNITS } from '../lib/splot';
import {
  exportEntry,
  fillDeviceFromFile,
  hasPort,
  isCompleteTwoPort,
  listNames,
  loadSPlotText,
  missingParameters,
  referenceFrequency,
  sendLoadToChart,
  sendSweepToChart,
} from '../lib/splotActions';
import { addNetworkToSPlot, freezeNetworkEntry } from '../lib/splotNetwork';
import { useDesignStore } from '../store/useDesignStore';
import { activeEntry, useSPlotStore, type SPlotEntry, type TraceKey } from '../store/useSPlotStore';
import { QUANTITY_COLORS } from './style';
import { IconClose } from '../components/ui/icons';

const ACCEPT = '.s1p,.s2p,.s3p,.s4p,.citi,.cti,.csv,.txt';
const TRACES: readonly TraceKey[] = ['s11', 's21', 's12', 's22'];
const UNIT_LABEL: Readonly<Record<FrequencyUnit, string>> = {
  HZ: 'Hz',
  KHZ: 'kHz',
  MHZ: 'MHz',
  GHZ: 'GHz',
};
const PARAMETER_LABEL: Readonly<Record<NetworkParameter, string>> = {
  S: 'S',
  Z: 'Z',
  Y: 'Y',
  H: 'H',
  ABCD: 'ABCD',
};

function range(entry: SPlotEntry): string {
  const f = entry.data.points.map((p) => p.frequency);
  const lo = f[0];
  const hi = f[f.length - 1];
  if (lo === undefined || hi === undefined) return 'no points';
  const fmt = (v: number): string => formatEngineering(v, { unit: 'Hz', digits: 4 });
  return lo === hi ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
}

export function FilePanel() {
  const files = useSPlotStore((s) => s.files);
  const activeId = useSPlotStore((s) => s.activeId);
  const selected = useSPlotStore((s) => s.selected);
  const cursor = useSPlotStore((s) => s.cursor);
  const traces = useSPlotStore((s) => s.traces);
  const logX = useSPlotStore((s) => s.logX);
  const { removeFile, setActive, setVisible, setColor, setUnit, toggleTrace, setLogX } =
    useSPlotStore.getState();
  const entry = activeEntry({ files, activeId });
  const setMessage = useDesignStore.getState().setMessage;
  const input = useRef<HTMLInputElement>(null);
  const [sendMode, setSendMode] = useState<'load' | 'sweep'>('load');
  const [parameter, setParameter] = useState<NetworkParameter>('S');
  const [normalized, setNormalized] = useState(true);
  const [format, setFormat] = useState<TouchstoneFormat | null>(null);
  const [unit, setExportUnit] = useState<FrequencyUnit | null>(null);

  const openFiles = async (list: FileList | null): Promise<void> => {
    if (!list) return;
    for (const file of Array.from(list)) {
      try {
        setMessage(loadSPlotText(file.name, await file.text()));
      } catch (err) {
        setMessage(
          `Could not open ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  const refF = entry ? referenceFrequency(entry, selected, cursor) : null;
  const missing = entry ? missingParameters(entry) : [];
  const lacks = listNames(missing);
  const supported = entry ? supportedParameters(entry.data.ports) : (['S'] as const);
  const chosen: NetworkParameter = supported.includes(parameter) ? parameter : 'S';
  const send = (port: 1 | 2): void => {
    if (!entry) return;
    if (sendMode === 'load') {
      if (refF === null) return;
      setMessage(sendLoadToChart(entry, port, refF));
    } else {
      setMessage(sendSweepToChart(entry, port));
    }
  };

  return (
    <div className="splot-side-panel">
      <h2>S-parameter files</h2>
      <div className="row">
        <button className="btn" onClick={() => input.current?.click()}>
          Add file&#8230;
        </button>
        <button
          className="btn"
          onClick={() => setMessage(addNetworkToSPlot())}
          title="The S-parameters of the design's network as built, over the sweep range; the entry follows the design until you freeze it"
        >
          Add the network
        </button>
      </div>
      <p className="muted small">
        Touchstone, CITI, EZNEC, VNA CSV. Open in the File menu works too.
      </p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          void openFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {files.length === 0 ? (
        <p className="hint small">
          No file loaded. Add a Touchstone (.s1p to .s4p), CITI, EZNEC Lastz.txt or VNA CSV file to
          plot its S-parameters, stability and gain.
        </p>
      ) : (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id} className={f.id === activeId ? 'active' : ''}>
              <div className="file-head">
                <input
                  type="checkbox"
                  checked={f.visible}
                  onChange={(e) => setVisible(f.id, e.target.checked)}
                  aria-label={`Show ${f.fileName}`}
                />
                <input
                  type="color"
                  value={f.color}
                  onChange={(e) => setColor(f.id, e.target.value)}
                  aria-label={`Colour of ${f.fileName}`}
                  title="Curve colour when several files are shown"
                />
                <button
                  className="file-name"
                  onClick={() => setActive(f.id)}
                  title={`${f.description}. Click to use it for the table, readout and export.`}
                  aria-pressed={f.id === activeId}
                >
                  {f.fileName}
                </button>
                {f.network === 'live' && (
                  <>
                    <span
                      className="badge accent"
                      title="Follows the design: changes to the network show here after a moment"
                    >
                      live
                    </span>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => setMessage(freezeNetworkEntry(f.id))}
                      aria-label={`Freeze ${f.fileName}`}
                      title="Stop following the design and keep these curves as a snapshot to compare against"
                    >
                      freeze
                    </button>
                  </>
                )}
                {f.network === 'frozen' && (
                  <span
                    className="badge neutral"
                    title="A snapshot of the network; it no longer follows the design"
                  >
                    snapshot
                  </span>
                )}
                <button
                  type="button"
                  className="btn icon sm"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Remove ${f.fileName}`}
                  title="Remove from the list"
                >
                  <IconClose size={13} />
                </button>
              </div>
              <div className="file-info muted small">
                {f.data.ports}-port, {f.data.points.length} point
                {f.data.points.length === 1 ? '' : 's'}, {range(f)}, Z0 {f.data.z0} Ω
                {f.data.ports > 2 ? '; graphs use ports 1 and 2' : ''}
                {missingParameters(f).length > 0 ? `; no ${listNames(missingParameters(f))}` : ''}
              </div>
              {f.network === undefined && (
                <label className="file-unit small muted">
                  f unit
                  <select
                    className="btn tiny"
                    value={f.unit}
                    onChange={(e) => setUnit(f.id, e.target.value as FrequencyUnit)}
                    aria-label={`Frequency unit of ${f.fileName}`}
                    title="Read the frequency numbers of the file as this unit"
                  >
                    {FREQUENCY_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABEL[u]}
                      </option>
                    ))}
                  </select>
                  {f.unit !== f.original.frequencyUnit && (
                    <span>
                      {' '}
                      (file says {UNIT_LABEL[f.original.frequencyUnit]}){' '}
                      <button
                        className="btn tiny"
                        onClick={() => setUnit(f.id, f.original.frequencyUnit)}
                      >
                        reset
                      </button>
                    </span>
                  )}
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Graphs</h2>
      <div className="row wrap" role="group" aria-label="Traces">
        {TRACES.map((k) => (
          <button
            key={k}
            className={`btn tiny ${traces[k] ? 'on' : ''}`}
            aria-pressed={traces[k]}
            onClick={() => toggleTrace(k)}
            title={`Show or hide ${k}`}
          >
            <span className="sw" style={{ background: QUANTITY_COLORS[k] }} />
            {k}
          </button>
        ))}
      </div>
      <div className="row" role="group" aria-label="Frequency axis">
        <button
          className={`btn tiny ${logX ? '' : 'on'}`}
          aria-pressed={!logX}
          onClick={() => setLogX(false)}
        >
          Linear f
        </button>
        <button
          className={`btn tiny ${logX ? 'on' : ''}`}
          aria-pressed={logX}
          onClick={() => setLogX(true)}
        >
          Log f
        </button>
      </div>

      <h2>To the Smith chart</h2>
      {!entry ? (
        <p className="hint small">Select a file first.</p>
      ) : (
        <>
          <div className="row wrap" role="radiogroup" aria-label="What to send">
            <label className="check small">
              <input
                type="radio"
                name="splot-send"
                checked={sendMode === 'load'}
                onChange={() => setSendMode('load')}
              />
              load at {refF === null ? 'the cursor frequency' : fmtFrequency(refF)}
            </label>
            <label className="check small">
              <input
                type="radio"
                name="splot-send"
                checked={sendMode === 'sweep'}
                onChange={() => setSendMode('sweep')}
              />
              datapoint sweep of all points
            </label>
          </div>
          <p className="muted small">
            The frequency is the selected table row, else the cursor in the graphs.
          </p>
          <div className="row">
            <button
              className="btn"
              onClick={() => send(1)}
              disabled={!hasPort(entry, 1)}
              title={hasPort(entry, 1) ? undefined : 'The file has no s11'}
            >
              Send s11 to chart
            </button>
            <button
              className="btn"
              onClick={() => send(2)}
              disabled={!hasPort(entry, 2)}
              title={
                hasPort(entry, 2)
                  ? undefined
                  : entry.data.ports < 2
                    ? 'A one-port file has no s22'
                    : 'The file has no s22'
              }
            >
              Send s22 to chart
            </button>
          </div>
          <div className="row">
            <button
              className="btn"
              onClick={() => setMessage(fillDeviceFromFile(entry))}
              disabled={!isCompleteTwoPort(entry)}
              title={
                isCompleteTwoPort(entry)
                  ? 'Fill the two-port panel with the S-parameters at the design frequency; the device then follows it'
                  : entry.data.ports < 2
                    ? 'A device needs a two-port file'
                    : `A device needs s11, s21, s12 and s22; the file has no ${lacks}`
              }
            >
              Use as device
            </button>
          </div>

          <h2>Export</h2>
          <div className="export-grid">
            <label>
              Parameters
              <select
                className="btn"
                value={chosen}
                onChange={(e) => setParameter(e.target.value as NetworkParameter)}
                aria-label="Parameter type"
              >
                {supported.map((p) => (
                  <option key={p} value={p}>
                    {PARAMETER_LABEL[p]}
                    {p === 'ABCD' ? ' (A)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={normalized}
                disabled={chosen === 'S'}
                onChange={(e) => setNormalized(e.target.checked)}
              />
              normalized to Z0 {entry.data.z0} Ω
            </label>
            <label>
              Number format
              <select
                className="btn"
                value={format ?? entry.data.format}
                onChange={(e) => setFormat(e.target.value as TouchstoneFormat)}
                aria-label="Number format"
              >
                <option value="MA">mag, angle</option>
                <option value="DB">dB, angle</option>
                <option value="RI">re, im</option>
              </select>
            </label>
            <label>
              Frequency unit
              <select
                className="btn"
                value={unit ?? entry.unit}
                onChange={(e) => setExportUnit(e.target.value as FrequencyUnit)}
                aria-label="Export frequency unit"
              >
                {FREQUENCY_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button
              className="btn primary"
              disabled={missing.length > 0}
              title={
                missing.length > 0
                  ? `A Touchstone file needs every S-parameter; the file has no ${lacks}`
                  : undefined
              }
              onClick={() =>
                setMessage(
                  exportEntry(entry, {
                    parameter: chosen,
                    normalized,
                    format: format ?? entry.data.format,
                    unit: unit ?? entry.unit,
                  }),
                )
              }
            >
              Save Touchstone
            </button>
          </div>
          <p className="muted small">
            {entry.kind === 'citi'
              ? 'CITI to Touchstone: S saves the CITI data as a Touchstone file. '
              : ''}
            {chosen === 'S'
              ? 'S-parameters keep the noise block of a two-port.'
              : normalized
                ? `Values divided by Z0 as Touchstone ${chosen} files expect; the option line says R ${entry.data.z0}.`
                : 'Values in ohm and siemens; the option line says R 1 so a reader following the format reads them as they are.'}
            {chosen === 'ABCD' ? ' ABCD is written with the letter A, columns A B C D.' : ''}
          </p>
        </>
      )}
    </div>
  );
}
