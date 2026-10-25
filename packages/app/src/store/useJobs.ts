import { useEffect, useLayoutEffect } from 'react';
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
  /**
   * Jobs that finished, by tool, with what they found: the tool's segment or Tools entry
   * carries a check dot until its panel is on show again.
   */
  readonly finished: Partial<Record<ToolId, string>>;
  report: (tool: ToolId, progress: JobProgress | null) => void;
  /** A job finished with this result (the status message says it too). */
  finish: (tool: ToolId, result: string) => void;
  /** The tool's panel is on show: its result has been seen. */
  seen: (tool: ToolId) => void;
}

/**
 * The running jobs by tool, so the tool strip can show a job's progress and
 * the header button its badge dot while the tool's segment is not on show.
 */
export const useJobs = create<JobsState>()((set, get) => ({
  jobs: {},
  finished: {},
  report: (tool, progress) =>
    set((s) => {
      const jobs = { ...s.jobs };
      if (progress) jobs[tool] = progress;
      else delete jobs[tool];
      return { jobs };
    }),
  finish: (tool, result) => set((s) => ({ finished: { ...s.finished, [tool]: result } })),
  seen: (tool) => {
    if (get().finished[tool] === undefined) return;
    set((s) => {
      const finished = { ...s.finished };
      delete finished[tool];
      return { finished };
    });
  },
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
  useEffect(
    () => () => {
      useJobs.getState().report(tool, null);
      // A closed tool has no result to come back to.
      useJobs.getState().seen(tool);
    },
    [tool],
  );
}

/** While the tool's panel is on show, a finished job's result counts as seen. */
export function useSeenWhileShown(tool: ToolId | null, shown: boolean): void {
  const finished = useJobs((s) => (tool ? s.finished[tool] : undefined));
  useLayoutEffect(() => {
    if (tool && shown && finished !== undefined) useJobs.getState().seen(tool);
  }, [tool, shown, finished]);
}
