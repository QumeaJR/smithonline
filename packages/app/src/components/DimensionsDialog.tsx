import {
  formatEngineering,
  lineDimensions,
  microstripDimensions,
  stackupLabel,
  type Coax,
} from '@smithonline/core';
import { elementName } from '../lib/elements';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignBuild } from '../store/useDesignBuild';
import { useDesignStore } from '../store/useDesignStore';
import { useSubstrateStore } from '../store/useSubstrateStore';
import { StackupFields } from './StackupFields';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Field } from './ui/Field';
import { Segmented } from './ui/Segmented';

interface DimensionsDialogProps {
  /** Index of the line or stub in the design. */
  readonly index: number;
  readonly onClose: () => void;
}

/**
 * QuickSmith's "dimensions instead of ohms": the track width and physical
 * length that realize a line or stub on the board's stackup (the microstrip
 * model with dispersion and loss, at the line's frequency), or the diameters
 * of a coax line.
 */
export function DimensionsDialog({ index, onClose }: DimensionsDialogProps) {
  const design = useDesignStore((s) => s.design);
  const substrate = useSubstrateStore((s) => s.substrate);
  const stackup = useDesignBuild().board.stackup;
  const { setSubstrate } = useSubstrateStore.getState();
  const el = design.elements[index];

  if (!el || (el.kind !== 'line' && el.kind !== 'openStub' && el.kind !== 'shortStub')) {
    return null;
  }

  const frequency = el.refFrequency ?? design.frequency;
  const microstrip = substrate.medium === 'microstrip';
  const coax: Coax = {
    medium: 'coax',
    er: substrate.coaxEr,
    given: substrate.coaxGiven,
    diameter: substrate.coaxDiameter,
  };
  const ms = microstrip ? microstripDimensions(stackup, el.z0, el.length, frequency) : null;
  const cx = microstrip ? null : lineDimensions(coax, el.z0, el.length, frequency);
  /** The effective permittivity a line element should take to have the physical length shown. */
  const eeff = ms ? ms.at.eeff.re : cx ? cx.eeff : null;
  const metric = (v: number): string => formatEngineering(v, { unit: 'm', digits: 4 });

  return (
    <Dialog
      title="Dimensions"
      subtitle={
        <>
          {elementName(el)} {index + 1}: Z0 {fmtNum(el.z0, 2)} Ω, l/&#955; {el.length.toFixed(5)} at{' '}
          {fmtFrequency(frequency)}
        </>
      }
      onClose={onClose}
      closeLabel="Close dimensions dialog"
      className="dimensions"
      draggable="dimensions"
      footer={
        <>
          {el.kind === 'line' && ms && (
            <Button
              title="Replace the line by a microstrip element of this width and length on the stackup: it then has the microstrip's own dispersion and loss over frequency"
              onClick={() => {
                useDesignStore
                  .getState()
                  .step(
                    `Line ${index + 1} built as a microstrip on ${stackupLabel(stackup)}`,
                    (d) => ({
                      ...d,
                      elements: d.elements.map((e, i) =>
                        i === index
                          ? {
                              id: e.id,
                              color: e.color,
                              kind: 'microstrip' as const,
                              width: ms.width,
                              length: ms.length,
                              stackup,
                            }
                          : e,
                      ),
                    }),
                  );
                onClose();
              }}
            >
              Use microstrip
            </Button>
          )}
          {el.kind === 'line' && eeff !== null && (
            <Button
              variant="primary"
              disabled={Math.abs((el.er ?? 1) - eeff) < 1e-9}
              title="Use the effective permittivity as the line's er, so its physical length matches"
              onClick={() => {
                // One step, named by its message for Undo and Redo.
                useDesignStore
                  .getState()
                  .step(`Line ${index + 1}: εr set to ${eeff.toFixed(4)} (εeff)`, (d) => ({
                    ...d,
                    elements: d.elements.map((e, i) => (i === index ? { ...el, er: eeff } : e)),
                  }));
              }}
            >
              Set line &#949;r = &#949;eff
            </Button>
          )}
          <Button className="dialog-close" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="seg">
        <Segmented
          ariaLabel="Medium"
          value={microstrip ? 'microstrip' : 'coax'}
          onChange={(medium) => setSubstrate({ medium })}
          options={[
            { value: 'microstrip', label: 'Microstrip' },
            { value: 'coax', label: 'Coax' },
          ]}
        />
      </div>

      {microstrip ? (
        <StackupFields />
      ) : (
        <div className="dim-fields">
          <Field
            label={<>&#949;r</>}
            value={substrate.coaxEr}
            plain
            min={1}
            onCommit={(coaxEr) => setSubstrate({ coaxEr })}
            ariaLabel="Dielectric relative permittivity"
          />
          <label title="Which diameter you know; the impedance fixes the other one">
            Given
            <select
              value={substrate.coaxGiven}
              aria-label="Which diameter is given"
              onChange={(e) => setSubstrate({ coaxGiven: e.target.value as 'inner' | 'outer' })}
            >
              <option value="outer">Outer bore</option>
              <option value="inner">Inner conductor</option>
            </select>
          </label>
          <Field
            label={<>&#8960;</>}
            value={substrate.coaxDiameter}
            unit="m"
            min={1e-9}
            onCommit={(coaxDiameter) => setSubstrate({ coaxDiameter })}
            ariaLabel="Given diameter"
          />
        </div>
      )}

      {ms ? (
        <dl className="dim-results" aria-label="Dimensions">
          <dt>Track width</dt>
          <dd className="mono big">{metric(ms.width)}</dd>
          <dt>W/h</dt>
          <dd className="mono">{fmtNum(ms.wOverH, 3)}</dd>
          <dt>Z0 at {fmtFrequency(frequency)}</dt>
          <dd
            className="mono"
            title="Real part; the dielectric loss gives Z0 a small imaginary part"
          >
            {fmtNum(ms.at.z0.re, 2)} &#937; (static {fmtNum(ms.at.z0Static.re, 2)} &#937;)
          </dd>
          <dt>&#949;eff at {fmtFrequency(frequency)}</dt>
          <dd className="mono">
            {fmtNum(ms.at.eeff.re, 4)} (static {fmtNum(ms.at.eeffStatic.re, 4)})
          </dd>
          <dt>Physical length</dt>
          <dd className="mono big">{metric(ms.length)}</dd>
          <dt>Loss</dt>
          <dd className="mono">{fmtNum(ms.lossDb, 3)} dB</dd>
        </dl>
      ) : cx ? (
        <dl className="dim-results" aria-label="Dimensions">
          <dt>Inner conductor</dt>
          <dd className="mono big">&#8960; {metric(cx.inner ?? 0)}</dd>
          <dt>Outer bore</dt>
          <dd className="mono big">&#8960; {metric(cx.outer ?? 0)}</dd>
          <dt>Outer / inner</dt>
          <dd className="mono">{fmtNum(cx.ratio ?? 0, 4)}</dd>
          <dt>&#949;eff</dt>
          <dd className="mono">{fmtNum(cx.eeff, 4)}</dd>
          <dt>Physical length</dt>
          <dd className="mono big">{metric(cx.length)}</dd>
        </dl>
      ) : (
        <p className="hint">
          {microstrip
            ? 'No track width on this stackup gives that impedance (W/h from 0.001 to 1000), or a value is not usable.'
            : 'Enter positive values to see the dimensions.'}
        </p>
      )}

      <div className="dropdown-note">
        {microstrip ? (
          <>
            The stackup is the board&#39;s (Settings &gt; Board) and is kept in this browser. Width
            for the Z0 at {fmtFrequency(frequency)} with Kirschning-Jansen dispersion
            (Hammerstad-Jensen static model, good to about 1 % for W/h from 0.1 to 100), length from
            the dispersed &#949;eff, loss from the copper and the dielectric.
            {ms && !ms.at.inRange ? ' Outside the dispersion model’s stated range.' : ''}
          </>
        ) : (
          <>The coax dielectric is shared by all lines and stubs and is kept in this browser.</>
        )}
      </div>
    </Dialog>
  );
}
