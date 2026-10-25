import { layoutForWidth } from '../lib/layout';
import { startSteps } from '../lib/startGuide';
import { focusQuietly } from '../lib/overlay';
import { useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
import { useDesignStore } from '../store/useDesignStore';
import { useShell } from '../store/useShell';
import { useTourStore } from '../store/useTourStore';
import { Button, IconButton } from './ui/Button';
import { IconClose } from './ui/icons';

/**
 * Focus the first field of a card in the network panel, scrolling its column
 * to it: on the phone to the middle of the visible sheet, where the keyboard
 * that comes up does not cover it; wider, just into view.
 */
function focusCard(selector: string): boolean {
  const field = document.querySelector<HTMLElement>(`${selector} input`);
  if (!field) return false;
  const phone = layoutForWidth(window.innerWidth) === 'phone';
  field.scrollIntoView?.({ block: phone ? 'center' : 'nearest' });
  focusQuietly(field);
  return true;
}

/**
 * The open tool's first control that matters once it is on show: Auto match's target R
 * field, else its method control, else the first field, select or button (never the help
 * link at the head of the panel).
 */
function focusToolPanel(): void {
  const panel = document.querySelector<HTMLElement>('.slot-tool .tool-panel, .tool-panel');
  const target =
    panel?.querySelector<HTMLElement>('.fields input:not([type="hidden"]):not(:disabled)') ??
    panel?.querySelector<HTMLElement>(
      '.method-chooser .chooser-row, .modes [role="tab"][aria-selected="true"]',
    ) ??
    panel?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea, button:not(:disabled):not(.help-link)',
    );
  const el = target ?? panel;
  el?.scrollIntoView?.({
    block: layoutForWidth(window.innerWidth) === 'phone' ? 'center' : 'nearest',
  });
  focusQuietly(el);
}

export interface StartGuideProps {
  /** Opens Auto match, the third step's button. */
  readonly onAutoMatch: () => void;
}

/**
 * The start guide (docs/07 section 4): a card at the head of the ladder,
 * directly above the load card where the chain begins, with the three steps of
 * a match that tick off as they are done, each with a button that goes to the
 * control it needs. It shows on a new design only (not on an opened file, an
 * example or a share link) unless Help brought it back. Its close button
 * hides it for good in this browser and gives the focus to the load card.
 * It never sits over the chart.
 */
export function StartGuide({ onAutoMatch }: StartGuideProps) {
  const design = useDesignStore((s) => s.design);
  const fresh = useDesignStore((s) => s.fresh);
  const createdLoad = useDesignStore((s) => s.createdLoad);
  const closed = useShell((s) => s.guideClosed);
  const shown = useShell((s) => s.guideShown);
  const touring = useTourStore((s) => s.tour !== null);
  const hints = pointerHints(useCoarsePointer());
  if (closed || touring || !(fresh || shown)) return null;
  const done = startSteps(design, createdLoad);
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
      text: hints.startMatch,
      action: 'Auto match',
      label: 'Open Auto match',
      run: () => {
        onAutoMatch();
        // The panel renders with the next commit: the focus moves into it then.
        setTimeout(focusToolPanel, 0);
      },
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
          onClick={() => {
            useShell.getState().closeGuide();
            // The guide goes from under the focus: the load card below it takes it.
            if (!focusCard('.card.load')) focusQuietly(document.querySelector<HTMLElement>('main'));
          }}
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
