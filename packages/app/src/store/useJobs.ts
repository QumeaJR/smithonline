import { useEffect } from 'react';
import { create } from 'zustand';
import type { ToolId } from '../lib/tools';

/** A worker job of a tool panel: the broadband search, the band optimizer, Monte Carlo. */
export interface JobProgress {
  readonly done: number;
  /** 0 while the job has not said yet. */
  readonly total: number;
  /** The line under the bar, such as "Searching ladder 12 of 40". */
  readonly label: string;
}

interface JobsState {
  readonly jobs: Partial<Record<ToolId, JobProgress>>;
  report: (tool: ToolId, progress: JobProgress | null) => void;
}

/**
 * The running jobs by tool, so the tool strip can show a job's progress and
 * the header button its badge dot while the tool's segment is not on show.
 */
export const useJobs = create<JobsState>()((set) => ({
  jobs: {},
  report: (tool, progress) =>
    set((s) => {
      const jobs = { ...s.jobs };
      if (progress) jobs[tool] = progress;
      else delete jobs[tool];
      return { jobs };
    }),
}));

/** Report a tool's job while it runs; the entry goes when the job ends or the panel closes. */
export function useReportJob(tool: ToolId, progress: JobProgress | null): void {
  const done = progress?.done ?? -1;
  const total = progress?.total ?? -1;
  const label = progress?.label ?? '';
  const running = progress !== null;
  useEffect(() => {
    useJobs.getState().report(tool, running ? { done, total, label } : null);
  }, [tool, running, done, total, label]);
  useEffect(() => () => useJobs.getState().report(tool, null), [tool]);
}
