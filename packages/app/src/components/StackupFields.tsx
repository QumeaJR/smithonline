import {
  STACKUP_LIMITS,
  STACKUP_PRESETS,
  stackupPreset,
  stackupProblem,
  type Stackup,
} from '@smithonline/core';
import { substrateHeight } from '../lib/format';
import { useBoard } from '../store/useBoard';
import { Field } from './ui/Field';

interface StackupFieldsProps {
  /** Show the frequency and roughness fields too (Settings); the Dimensions dialog keeps it short. */
  readonly full?: boolean;
}

/**
 * The reason a changed number makes the stackup unusable, or null: the rule of
 * isUsableStackup with the field's new value, so a reference frequency outside
 * the Djordjevic-Sarkar band, or an εr, tanδ and frequency whose permittivity
 * falls below 1 by 110 GHz, is refused with its reason before it is stored.
 */
function stackupFieldProblem(stackup: Stackup, patch: Partial<Stackup>): string | null {
  return stackupProblem({ ...stackup, ...patch })?.reason ?? null;
}

/**
 * The board's stackup: a laminate preset and the numbers the microstrip model
 * reads. Shared by Settings > Board and the Dimensions dialog; a change applies
 * and is stored at once. An entry the model cannot use is refused with its
 * reason next to the field.
 */
export function StackupFields({ full = false }: StackupFieldsProps) {
  const stackup = useBoard((s) => s.board.stackup);
  const { setStackup, applyPreset } = useBoard.getState();
  const preset = stackupPreset(stackup);
  const check =
    (key: keyof Stackup) =>
    (v: number): string | null =>
      stackupFieldProblem(stackup, { [key]: v });
  const L = STACKUP_LIMITS;
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
        min={L.h.min}
        max={L.h.max}
        validate={check('h')}
        inlineMessage
        onCommit={(h) => setStackup({ h })}
        ariaLabel="Substrate height"
      />
      <Field
        label={<>&#949;r</>}
        title="Relative permittivity at the reference frequency"
        value={stackup.er}
        plain
        min={L.er.min}
        max={L.er.max}
        validate={check('er')}
        inlineMessage
        onCommit={(er) => setStackup({ er })}
        ariaLabel="Substrate relative permittivity"
      />
      <Field
        label={<>tan&#948;</>}
        title="Loss tangent at the reference frequency"
        value={stackup.tanD}
        plain
        min={L.tanD.min}
        max={L.tanD.max}
        validate={check('tanD')}
        inlineMessage
        onCommit={(tanD) => setStackup({ tanD })}
        ariaLabel="Loss tangent"
      />
      {full && (
        <Field
          label={<>at f</>}
          title="The frequency at which εr and tanδ hold, above 1 kHz and below 1 THz; the Djordjevic-Sarkar model carries them to every other frequency"
          value={stackup.fRef}
          unit="Hz"
          validate={check('fRef')}
          inlineMessage
          onCommit={(fRef) => setStackup({ fRef })}
          ariaLabel="Reference frequency of the permittivity"
        />
      )}
      <Field
        label="t"
        title="Copper thickness; 0 is an infinitely thin, lossless strip"
        value={stackup.t}
        unit="m"
        min={L.t.min}
        max={L.t.max}
        validate={check('t')}
        inlineMessage
        onCommit={(t) => setStackup({ t })}
        ariaLabel="Conductor thickness"
      />
      {full && (
        <Field
          label="Rq"
          title="RMS roughness of the copper on the dielectric side (Hammerstad-Jensen roughness factor; raises the conductor loss up to twofold)"
          value={stackup.roughness}
          unit="m"
          min={L.roughness.min}
          max={L.roughness.max}
          validate={check('roughness')}
          inlineMessage
          onCommit={(roughness) => setStackup({ roughness })}
          ariaLabel="Copper roughness"
        />
      )}
    </div>
  );
}
