import { formatEngineering } from '@smithonline/core';
import { useState } from 'react';
import { designHasDatapointSweep } from '../lib/datapoints';
import { MAX_DESIGN_NAME } from '../lib/design';
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
      <NameInput name={design.name} onCommit={setName} />
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

/**
 * The design name, typed like the other fields: the text is a draft until Enter or the blur
 * commits it as one named step ("Renamed the design to ..."); Escape reverts it. One step per
 * rename, however long the name, so typing never pushes earlier steps out of the history.
 */
function NameInput({
  name,
  onCommit,
}: {
  readonly name: string;
  readonly onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null && draft !== name) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="name-input"
      value={draft ?? name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape' && draft !== null) {
          // The first Escape reverts and keeps the focus; a second one goes on to the sheet.
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
      {...(draft !== null ? { 'data-editing': '' } : {})}
      aria-label="Design name"
      maxLength={MAX_DESIGN_NAME}
      spellCheck={false}
    />
  );
}
