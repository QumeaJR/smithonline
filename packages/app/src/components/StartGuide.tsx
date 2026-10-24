import { startSteps } from '../lib/startGuide';
import { focusQuietly } from '../lib/overlay';
import { useDesignStore } from '../store/useDesignStore';
import { useShell } from '../store/useShell';
import { useTourStore } from '../store/useTourStore';
import { Button, IconButton } from './ui/Button';
import { IconClose } from './ui/icons';

/** Focus the first field of a card in the network panel, scrolling its column to it. */
function focusCard(selector: string): void {
  const field = document.querySelector<HTMLElement>(`${selector} input`);
  if (!field) return;
  field.scrollIntoView?.({ block: 'nearest' });
  focusQuietly(field);
}

export interface StartGuideProps {
  /** Opens Auto match, the third step's button. */
  readonly onAutoMatch: () => void;
}

/**
 * The start guide (docs/07 section 4): a card at the head of the ladder,
 * directly above the load card where the chain begins, with the three steps of
 * a match that tick off as they are done, each with a button that goes to the
 * control it needs. Its close button hides it for good in this browser; Help
 * brings it back. It never sits over the chart.
 */
export function StartGuide({ onAutoMatch }: StartGuideProps) {
  const design = useDesignStore((s) => s.design);
  const closed = useShell((s) => s.guideClosed);
  const touring = useTourStore((s) => s.tour !== null);
  if (closed || touring) return null;
  const done = startSteps(design);
  const steps = [
    {
      key: 'load',
      done: done.load,
      title: 'Set the load',
      text: 'Type DP1 in the load card below, or open a measured file.',
      action: 'Load',
      label: 'Go to the load fields',
      run: () => focusCard('.card.load'),
    },
    {
      key: 'target',
      done: done.target,
      title: 'Set the target',
      text: 'Z0 is the default; type another R and X in the target card.',
      action: 'Target',
      label: 'Go to the target card',
      run: () => focusCard('.card.target'),
    },
    {
      key: 'match',
      done: done.match,
      title: 'Match',
      text: 'Add parts from the palette, double-click the chart, or press Auto match.',
      action: 'Auto match',
      label: 'Open Auto match',
      run: onAutoMatch,
    },
  ] as const;
  // The first step not yet done is the open one.
  const open = steps.findIndex((s) => !s.done);

  return (
    <section className="card start-guide" aria-label="Start guide">
      <div className="row">
        <strong className="name">Start a match</strong>
        <span className="muted small">
          {steps.filter((s) => s.done).length} of {steps.length} done
        </span>
        <IconButton
          size="sm"
          className="start-guide-close"
          icon={<IconClose size={13} />}
          label="Close the start guide"
          title="Hide the guide; Help shows it again"
          onClick={() => useShell.getState().closeGuide()}
        />
      </div>
      <ol className="start-steps">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={`${s.done ? 'done' : ''}${i === open ? ' open' : ''}`}
            data-step={s.key}
          >
            <span className="step-mark" aria-hidden="true">
              {s.done ? '✓' : i + 1}
            </span>
            <span className="step-text">
              <span className="step-title">
                {s.title}
                {s.done && <span className="visually-hidden">, done</span>}
              </span>
              {i === open && <span className="muted small">{s.text}</span>}
            </span>
            <Button size="sm" onClick={s.run} aria-label={s.label}>
              {s.action}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
