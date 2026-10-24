import { useState } from 'react';
import { LOAD_FORMS, loadFromFields, loadToFields, type LoadForm } from '../lib/loadForm';
import { useDesignStore } from '../store/useDesignStore';
import { Field } from './ui/Field';

/**
 * The two fields of the load card in the form the user picked: R + jX,
 * G + jB in millisiemens, or |Gamma| with its angle in degrees. The design
 * always keeps the impedance; the other forms convert on the way in and out
 * and are redrawn from the stored load, so a change in one form shows up in
 * the others at once.
 */
export function LoadFields() {
  const load = useDesignStore((s) => s.design.load);
  const z0 = useDesignStore((s) => s.design.z0);
  const [form, setForm] = useState<LoadForm>('z');
  const { setLoad, setMessage } = useDesignStore.getState();
  const spec = LOAD_FORMS[form];
  const values = loadToFields(form, load, z0);

  const commit = (index: 0 | 1, value: number): void => {
    const next: [number, number] = [values[0], values[1]];
    next[index] = value;
    const z = loadFromFields(form, next[0], next[1], z0);
    if (z) setLoad(z);
    else
      setMessage(
        `${spec.name} ${next[0]} ${next[1]} is not a load the chart can hold (open circuit).`,
      );
  };

  return (
    <div className="row fields load-fields">
      <select
        value={form}
        onChange={(e) => setForm(e.target.value as LoadForm)}
        aria-label="Load entry form"
        title="Type the load as impedance, admittance or reflection coefficient"
        onClick={(e) => e.stopPropagation()}
      >
        {(Object.keys(LOAD_FORMS) as LoadForm[]).map((f) => (
          <option key={f} value={f}>
            {LOAD_FORMS[f].name}
          </option>
        ))}
      </select>
      {spec.fields.map((field, i) => (
        <Field
          // A form change remounts the field so it drops any text typed in the old form.
          key={`${form}${i}`}
          label={field.label}
          value={values[i as 0 | 1]}
          {...(form === 'z' ? { unit: field.unit } : { plain: true })}
          {...(form !== 'z' && field.unit ? { suffix: field.unit } : {})}
          {...(field.min !== undefined ? { min: field.min } : {})}
          onCommit={(v) => commit(i as 0 | 1, v)}
          ariaLabel={field.aria}
        />
      ))}
    </div>
  );
}
