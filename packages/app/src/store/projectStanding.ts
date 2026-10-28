import { useOpenProject, useProjects } from './useProjects';

/** Where the design on show stands with the projects (docs/11 section 4). */
export type ProjectStanding = 'saved' | 'unsaved' | 'failed';

/** The design on show: saved in its project, unsaved, or its last write-back refused. */
export function useProjectStanding(): {
  readonly ready: boolean;
  readonly standing: ProjectStanding;
  readonly name: string | null;
} {
  const open = useOpenProject();
  const ready = useProjects((s) => s.ready);
  const failed = useProjects((s) => s.failed);
  const problem = useProjects((s) => s.problem);
  const standing: ProjectStanding = !open
    ? 'unsaved'
    : failed === open.id && problem !== null
      ? 'failed'
      : 'saved';
  return { ready, standing, name: open?.name ?? null };
}

/** The chip's words and tooltip for a standing. */
export function standingWords(
  standing: ProjectStanding,
  name: string | null,
  full: boolean,
): { readonly words: string; readonly title: string } {
  if (standing === 'saved') {
    return {
      words: 'Saved',
      title: `Saved in projects as "${name ?? ''}"; changes are saved there as you work. Opens the list.`,
    };
  }
  if (standing === 'failed') {
    return {
      words: 'Not saved',
      title: `Not saved: ${full ? 'browser storage is full' : 'this browser refused to store it'}. Project "${name ?? ''}" keeps its last version; the autosave keeps your design. Opens the list.`,
    };
  }
  return {
    words: 'Unsaved',
    title:
      'Unsaved: not in Projects yet (the autosave still keeps it). Opens the list, where Save to projects keeps it.',
  };
}
