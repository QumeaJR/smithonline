import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { toolInfo, type ToolId } from '../lib/tools';
import { useJobs } from '../store/useJobs';
import { useShell } from '../store/useShell';

/** How long a finished job's result line stays in the row, ms. */
export const RESULT_LINE_MS = 8000;

export interface JobRowProps {
  /** Show the tool again (its panel and result). */
  readonly onShow: (id: ToolId) => void;
}

/**
 * The job row at the top of the column (docs/10 section 5.1): a tool closed
 * while its search ran shows its progress here with Show and Stop; when the
 * search finishes the row turns into its result line for 8 s. Nothing shows
 * when no closed tool is busy.
 */
export function JobRow({ onShow }: JobRowProps) {
  const background = useShell((s) => s.background);
  const jobs = useJobs((s) => s.jobs);
  const finished = useJobs((s) => s.finished);
  const stops = useJobs((s) => s.stops);
  const [recent, setRecent] = useState<Partial<Record<ToolId, string>>>({});
  const seen = useRef(finished);
  const timers = useRef(new Map<ToolId, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const before = seen.current;
    seen.current = finished;
    for (const id of background) {
      const text = finished[id];
      if (text === undefined || text === before[id]) continue;
      setRecent((r) => ({ ...r, [id]: text }));
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setRecent((r) => {
            const next = { ...r };
            delete next[id];
            return next;
          });
        }, RESULT_LINE_MS),
      );
    }
  }, [finished, background]);
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const rows = background.filter((id) => jobs[id] !== undefined || recent[id] !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="job-rows">
      {rows.map((id) => {
        const info = toolInfo(id);
        const job = jobs[id];
        const stop = stops[id];
        return (
          <div className="job-row" key={id} data-job={id}>
            {job ? (
              <Progress
                className="job-progress"
                ariaLabel={info.label}
                done={job.done}
                total={job.total}
                label={`${info.label}: ${job.label}`}
              />
            ) : (
              <span className="job-result" role="status">
                {recent[id]}
              </span>
            )}
            <span className="job-actions">
              <Button size="sm" variant="quiet" onClick={() => onShow(id)}>
                Show
              </Button>
              {job && stop && (
                <Button size="sm" onClick={stop}>
                  Stop
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
