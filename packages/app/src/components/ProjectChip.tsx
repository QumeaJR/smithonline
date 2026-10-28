import { standingWords, useProjectStanding } from '../store/projectStanding';
import { useProjects } from '../store/useProjects';
import { Button } from './ui/Button';

/**
 * Beside the design name (docs/11 section 4): "Saved" when the design on show is a local
 * project that saves itself as you work, "Unsaved" when it is not in the list, "Not saved" when
 * the browser refused its last write. A quiet chip with words; it opens the list.
 */
export function ProjectChip({ compact = false }: { readonly compact?: boolean }) {
  const { ready, standing, name } = useProjectStanding();
  const full = useProjects((s) => s.problem === 'full');
  if (!ready) return null;
  const { words, title } = standingWords(standing, name, full);
  return (
    <Button
      size="sm"
      variant="quiet"
      className={`project-chip is-${standing}${compact ? ' compact' : ''}`}
      onClick={() => useProjects.getState().setOpen(true)}
      title={title}
      aria-label={`${words}: open the project list`}
    >
      {words}
    </Button>
  );
}
