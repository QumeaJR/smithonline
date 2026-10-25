import { formatEngineering } from '@smithonline/core';
import { designHasDatapointSweep } from '../lib/datapoints';
import { useDesignStore } from '../store/useDesignStore';
import { PowerInput } from './PowerInput';
import { Field } from './ui/Field';

/**
 * The design strip: name, f, source power and Z0. In the desktop header as one
 * bordered group; in the sheet the phone's design chip opens.
 */
export function DesignFields() {
  const design = useDesignStore((s) => s.design);
  const { setName, setFrequency, setZ0 } = useDesignStore.getState();
  /** f changed with a frequency sweep on: offer to scale the sweep range with it. */
  const commitFrequency = (f: number): void => {
    const old = design.frequency;
    setFrequency(f);
    const { start, stop } = design.sweep;
    if (!(old > 0) || f === old || designHasDatapointSweep(design) || !design.sweep.enabled) return;
    if (useDesignStore.getState().design.frequency !== f) return;
    const ratio = f / old;
    const hz = (v: number): string => formatEngineering(v, { unit: 'Hz', digits: 4 });
    const store = useDesignStore.getState();
    const prior = store.message;
    const offer = `f is now ${hz(f)}; the sweep still runs ${hz(start)} to ${hz(stop)}. Scale sweep makes it ${hz(start * ratio)} to ${hz(stop * ratio)}.`;
    // A prior message that ends in a full stop is not given a second one.
    store.setMessage(prior ? `${prior.replace(/\.$/, '')}. ${offer}` : offer, {
      action: {
        label: 'Scale sweep',
        run: () => {
          // The label is the message and names the step for Undo and Redo.
          useDesignStore
            .getState()
            .setSweep(
              { start: start * ratio, stop: stop * ratio },
              `Scaled the sweep to ${hz(start * ratio)} to ${hz(stop * ratio)}`,
            );
        },
      },
    });
  };

  return (
    <>
      <input
        className="name-input"
        value={design.name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Design name"
        spellCheck={false}
      />
      <Field
        className="field"
        label="f"
        value={design.frequency}
        unit="Hz"
        digits={6}
        min={1}
        onCommit={commitFrequency}
        ariaLabel="Design frequency"
      />
      <PowerInput />
      <Field
        className="field"
        label="Z0"
        value={design.z0}
        unit={'Ω'}
        min={1e-3}
        width="calc(6ch + 8px)"
        onCommit={setZ0}
        ariaLabel="Reference impedance"
      />
    </>
  );
}
