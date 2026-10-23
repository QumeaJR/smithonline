import { useDesignStore } from '../store/useDesignStore';
import { stressSettings } from '../lib/stress';
import { ValueInput } from './ValueInput';

const KINDS = [
  { kind: 'L', label: 'Inductors' },
  { kind: 'C', label: 'Capacitors' },
  { kind: 'R', label: 'Resistors' },
] as const;

/**
 * The limits of the stress columns: the largest peak voltage and RMS current
 * each part kind may see. Shown once a source power is set; a part above its
 * limit is flagged on the ladder card and in the bill of materials.
 */
export function StressControls() {
  const stress = useDesignStore((s) => stressSettings(s.design));
  const setStress = useDesignStore((s) => s.setStress);
  if (!(stress.power > 0)) return null;

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
          <label>
            V pk
            <ValueInput
              value={stress.limits[kind]?.vPeak ?? 0}
              unit="V"
              min={0}
              width="100%"
              onCommit={(v) => set(kind, 'vPeak', v)}
              ariaLabel={`${label} peak voltage limit`}
            />
          </label>
          <label>
            I rms
            <ValueInput
              value={stress.limits[kind]?.iRms ?? 0}
              unit="A"
              min={0}
              width="100%"
              onCommit={(v) => set(kind, 'iRms', v)}
              ariaLabel={`${label} RMS current limit`}
            />
          </label>
        </div>
      ))}
    </div>
  );
}
