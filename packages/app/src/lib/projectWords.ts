/** The words and checks of the Projects dialog (docs/11), kept apart for the tests. */
import { MAX_PROJECTS, projectDesign, type ProjectRecord } from './projectStore';
import type { ImportReport } from '../store/useProjects';

/** Whether this version opens a record's design, worked out once per record. */
const readable = new WeakMap<ProjectRecord, boolean>();
export function canOpen(record: ProjectRecord): boolean {
  let ok = readable.get(record);
  if (ok === undefined) {
    ok = 'value' in projectDesign(record);
    readable.set(record, ok);
  }
  return ok;
}

/** "28 Oct 2026, 21:05" in the browser's language; "unknown" for a time of 0. */
export function modifiedText(ms: number): string {
  if (!(ms > 0)) return 'unknown';
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The import's report in one sentence. */
export function importText(r: ImportReport): string {
  const parts: string[] = [];
  parts.push(
    r.added === 0
      ? 'No project added'
      : `Added ${r.added} ${r.added === 1 ? 'project' : 'projects'}`,
  );
  if (r.unreadable > 0) {
    parts.push(`${r.unreadable} this version cannot open, kept to open in a later one`);
  }
  if (r.duplicates > 0) parts.push(`${r.duplicates} already in the list, skipped`);
  if (r.overLimit > 0)
    parts.push(`${r.overLimit} left out: the list holds ${MAX_PROJECTS} at most`);
  if (r.skipped > 0) parts.push(`${r.skipped} entries that are not projects, skipped`);
  for (const f of r.failed) parts.push(`could not import ${f.fileName}: ${f.reason}`);
  return `${parts.join('; ')}.`;
}
