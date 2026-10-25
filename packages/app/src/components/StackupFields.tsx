import { STACKUP_PRESETS, stackupPreset } from '@smithonline/core';
import { substrateHeight } from '../lib/format';
import { useBoard } from '../store/useBoard';
import { Field } from './ui/Field';

interface StackupFieldsProps {
  /** Show the frequency and roughness fields too (Settings); the Dimensions dialog keeps it short. */
  readonly full?: boolean;
}

/**
 * The board's stackup: a laminate preset and the numbers the microstrip model
 * reads. Shared by Settings > Board and the Dimensions dialog; a change applies
 * and is stored at once.
 */
export function StackupFields({ full = false }: StackupFieldsProps) {
  const stackup = useBoard((s) => s.board.stackup);
  const { setStackup, applyPreset } = useBoard.getState();
  const preset = stackupPreset(stackup);
  return (
    <div className="dim-fields stackup-fields">
      <label title={preset?.source}>
        Laminate
        <select
          value={preset?.id ?? 'custom'}
          aria-label="Stackup preset"
          onChange={(e) => applyPreset(e.target.value)}
        >
          {STACKUP_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {!preset && <option value="custom">Custom</option>}
        </select>
      </label>
      <Field
        label="h"
        title="Dielectric height between the track and the ground plane"
        value={stackup.h}
        unit="m"
        format={substrateHeight}
        min={1e-6}
        onCommit={(h) => setStackup({ h })}
        ariaLabel="Substrate height"
      />
      <Field
        label={<>&#949;r</>}
        title="Relative permittivity at the reference frequency"
        value={stackup.er}
        plain
        min={1.0001}
        max={100}
        onCommit={(er) => setStackup({ er })}
        ariaLabel="Substrate relative permittivity"
      />
      <Field
        label={<>tan&#948;</>}
        title="Loss tangent at the reference frequency"
        value={stackup.tanD}
        plain
        min={0}
        max={0.5}
        onCommit={(tanD) => setStackup({ tanD })}
        ariaLabel="Loss tangent"
      />
      {full && (
        <Field
          label={<>at f</>}
          title="The frequency at which εr and tanδ hold; the Djordjevic-Sarkar model carries them to every other frequency"
          value={stackup.fRef}
          unit="Hz"
          min={1}
          onCommit={(fRef) => setStackup({ fRef })}
          ariaLabel="Reference frequency of the permittivity"
        />
      )}
      <Field
        label="t"
        title="Copper thickness; 0 is an infinitely thin, lossless strip"
        value={stackup.t}
        unit="m"
        min={0}
        onCommit={(t) => setStackup({ t })}
        ariaLabel="Conductor thickness"
      />
      {full && (
        <Field
          label="Rq"
          title="RMS roughness of the copper on the dielectric side (Hammerstad-Jensen roughness factor; raises the conductor loss up to twofold)"
          value={stackup.roughness}
          unit="m"
          min={0}
          onCommit={(roughness) => setStackup({ roughness })}
          ariaLabel="Copper roughness"
        />
      )}
    </div>
  );
}
