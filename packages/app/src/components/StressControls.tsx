import { useDesignStore } from '../store/useDesignStore';
import { stressSettings } from '../lib/stress';
import { Field } from './ui/Field';

const KINDS = [
  { kind: 'L', label: 'Inductors' },
  { kind: 'C', label: 'Capacitors' },
  { kind: 'R', label: 'Resistors' },
] as const;

/**
 * The limits of the stress columns (Build, Part ratings): the largest peak
 * voltage and RMS current each part kind may see. They apply once a source
 * power is set in the design strip; a part above its limit is flagged on the
 * ladder card and in the bill of materials.
 */
export function StressControls() {
  const stress = useDesignStore((s) => stressSettings(s.design));
  const setStress = useDesignStore((s) => s.setStress);
  if (!(stress.power > 0)) {
    return (
      <p className="muted small stress-controls">
        Needs a source power P in the design strip: the cards then show each part&#39;s peak voltage
        and RMS current against these ratings.
      </p>
    );
  }

  const set = (kind: 'L' | 'C' | 'R', field: 'vPeak' | 'iRms', value: number): void => {
    const current = stress.limits[kind] ?? {};
    const next = { ...current, [field]: value > 0 ? value : undefined };
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    const limits = { ...stress.limits };
    if (Object.keys(cleaned).length === 0) delete limits[kind];
    else limits[kind] = cleaned;
    setStress({ limits });
  };

  return (
    <div className="stress-controls">
      <div className="row muted small">
        Stress limits per part kind; 0 means no limit. Parts above a limit are marked red.
      </div>
      {KINDS.map(({ kind, label }) => (
        <div className="row" key={kind}>
          <span className="kind">{label}</span>
          <Field
            label="V pk"
            value={stress.limits[kind]?.vPeak ?? 0}
            unit="V"
            min={0}
            width="100%"
            onCommit={(v) => set(kind, 'vPeak', v)}
            ariaLabel={`${label} peak voltage limit`}
          />
          <Field
            label="I rms"
            value={stress.limits[kind]?.iRms ?? 0}
            unit="A"
            min={0}
            width="100%"
            onCommit={(v) => set(kind, 'iRms', v)}
            ariaLabel={`${label} RMS current limit`}
          />
        </div>
      ))}
    </div>
  );
}
