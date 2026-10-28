import { trackDynamic } from '../lib/analytics/track';
import { turnOffNextSteps, useNextStep, withdraw } from '../lib/nextSteps';
import { useSettings } from '../store/useSettings';
import { useTourStore } from '../store/useTourStore';
import { useStartGuideVisible } from './useStartGuideVisible';
import { Button, IconButton } from './ui/Button';
import { IconClose } from './ui/icons';

/**
 * The next-step chip at the foot of the network panel (docs/09 section 4):
 * the one suggestion on offer, its button, Show me when a workflow covers
 * it, and a close button that turns the suggestions off (with an Undo on the
 * message). The start guide on a new design carries its own next steps, so
 * the chip waits while the guide shows.
 */
export function NextStepChip() {
  const suggestion = useNextStep((s) => s.suggestion);
  const enabled = useSettings((s) => s.settings.suggestNextSteps);
  const touring = useTourStore((s) => s.tour !== null);
  const guide = useStartGuideVisible();
  if (!suggestion || !enabled || touring || guide) return null;
  const { workflow } = suggestion;
  return (
    <section className="card next-step" aria-label="Next step" role="status">
      <div className="row">
        <span className="next-step-text">
          <span className="muted small">Next step: </span>
          {suggestion.text}
        </span>
        <IconButton
          size="sm"
          className="next-step-close"
          icon={<IconClose size={13} />}
          label="Turn next-step suggestions off"
          title="Turn the suggestions off; Settings, New designs brings them back"
          onClick={turnOffNextSteps}
        />
      </div>
      <div className="row next-step-actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            trackDynamic('next_step', suggestion.id, 'taken');
            withdraw();
            suggestion.run();
          }}
        >
          {suggestion.label}
        </Button>
        {workflow && (
          <Button
            size="sm"
            variant="quiet"
            title="Start the guided workflow that walks this step"
            onClick={() => {
              withdraw();
              useTourStore.getState().startWorkflow(workflow.id, {
                keep: true,
                ...(workflow.at ? { at: workflow.at } : {}),
              });
            }}
          >
            Show me
          </Button>
        )}
      </div>
    </section>
  );
}
