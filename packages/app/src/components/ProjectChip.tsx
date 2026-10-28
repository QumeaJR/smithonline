import { useOpenProject, useProjects } from '../store/useProjects';
import { Button } from './ui/Button';
import { IconCheck } from './ui/icons';

/**
 * Beside the design name (docs/11 section 4): "In projects" when the design on show is a local
 * project that saves itself as you work, "Unsaved" when it is not in the list. Opens the list.
 * `compact` (the desktop header, one 48 px row at 1440 px): a 24 px mark, a check or a ring,
 * with the words in its name and tooltip.
 */
export function ProjectChip({ compact = false }: { readonly compact?: boolean }) {
  const open = useOpenProject();
  const ready = useProjects((s) => s.ready);
  if (!ready) return null;
  const words = open ? 'In projects' : 'Unsaved';
  return (
    <Button
      size="sm"
      variant="quiet"
      className={`project-chip${open ? ' is-saved' : ' is-unsaved'}${compact ? ' compact' : ''}`}
      onClick={() => useProjects.getState().setOpen(true)}
      title={
        open
          ? `In projects as "${open.name}"; changes are saved there as you work. Opens the list.`
          : 'Unsaved: not in Projects yet (the autosave still keeps it). Opens the list, where Save to projects keeps it.'
      }
      aria-label={`${words}: open the project list`}
    >
      {compact ? (
        open ? (
          <IconCheck size={14} />
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )
      ) : (
        words
      )}
    </Button>
  );
}
