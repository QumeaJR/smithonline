import { useEffect, useLayoutEffect, useRef } from 'react';
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
  /** How to stop each running job: the job row's Stop when its tool is closed (docs/10 5.1). */
  readonly stops: Partial<Record<ToolId, () => void>>;
  report: (tool: ToolId, progress: JobProgress | null, stop?: () => void) => void;
  /** A job finished with this result (the status message says it too). */
  finish: (tool: ToolId, result: string) => void;
  /** The tool's panel is on show: its result has been seen. */
  seen: (tool: ToolId) => void;
}

/**
 * The running jobs by tool, so the job row can show a job's progress and
 * the header button its badge dot while the tool's segment is not on show.
 */
export const useJobs = create<JobsState>()((set, get) => ({
  jobs: {},
  finished: {},
  stops: {},
  report: (tool, progress, stop) =>
    set((s) => {
      const jobs = { ...s.jobs };
      const stops = { ...s.stops };
      if (progress) jobs[tool] = progress;
      else delete jobs[tool];
      if (progress && stop) stops[tool] = stop;
      else delete stops[tool];
      return { jobs, stops };
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
export function useReportJob(tool: ToolId, progress: JobProgress | null, stop?: () => void): void {
  const done = progress?.done ?? -1;
  const total = progress?.total ?? -1;
  const label = progress?.label ?? '';
  const running = progress !== null;
  // The latest stop function, called through a stable wrapper.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  const hasStop = stop !== undefined;
  useEffect(() => {
    useJobs
      .getState()
      .report(
        tool,
        running ? { done, total, label } : null,
        hasStop ? () => stopRef.current?.() : undefined,
      );
  }, [tool, running, done, total, label, hasStop]);
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
