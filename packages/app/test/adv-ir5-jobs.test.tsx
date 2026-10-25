// @vitest-environment jsdom
/**
 * Adversarial: useJobs and useReportJob with two jobs, StrictMode double
 * effects, a job that ends while its panel is hidden, and the badge after the
 * tool closes.
 */
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolId } from '../src/lib/tools';
import { useJobs, useReportJob, type JobProgress } from '../src/store/useJobs';

let setters: Partial<Record<ToolId, (p: JobProgress | null) => void>> = {};
function Reporter({ tool }: { tool: ToolId }) {
  const [p, setP] = useState<JobProgress | null>(null);
  useEffect(() => {
    setters[tool] = setP;
  }, [tool]);
  useReportJob(tool, p);
  return null;
}

beforeEach(() => {
  setters = {};
  useJobs.setState({ jobs: {} });
});
afterEach(cleanup);

describe('useReportJob', () => {
  it('StrictMode: a running job is reported once it runs and cleared when it ends', () => {
    render(
      <StrictMode>
        <Reporter tool="optimize" />
      </StrictMode>,
    );
    act(() => setters.optimize?.({ done: 1, total: 8, label: 'a' }));
    expect(useJobs.getState().jobs.optimize).toEqual({ done: 1, total: 8, label: 'a' });
    act(() => setters.optimize?.(null));
    expect(useJobs.getState().jobs.optimize).toBeUndefined();
  });

  it('StrictMode mount with a job already running keeps the entry', () => {
    function Running() {
      useReportJob('montecarlo', { done: 2, total: 10, label: 'run' });
      return null;
    }
    render(
      <StrictMode>
        <Running />
      </StrictMode>,
    );
    expect(useJobs.getState().jobs.montecarlo?.done).toBe(2);
  });

  it('two jobs: one ending leaves the other', () => {
    render(
      <>
        <Reporter tool="optimize" />
        <Reporter tool="match" />
      </>,
    );
    act(() => {
      setters.optimize?.({ done: 1, total: 8, label: 'o' });
      setters.match?.({ done: 3, total: 40, label: 'm' });
    });
    act(() => setters.match?.(null));
    expect(Object.keys(useJobs.getState().jobs)).toEqual(['optimize']);
  });

  it('the panel unmounts mid-job: no badge left behind', () => {
    const { unmount } = render(<Reporter tool="optimize" />);
    act(() => setters.optimize?.({ done: 1, total: 8, label: 'o' }));
    unmount();
    expect(useJobs.getState().jobs.optimize).toBeUndefined();
  });

  it('NaN and Infinity totals are kept as given (the bar decides)', () => {
    render(<Reporter tool="optimize" />);
    act(() => setters.optimize?.({ done: Number.NaN, total: Infinity, label: '' }));
    expect(useJobs.getState().jobs.optimize?.total).toBe(Infinity);
    // A second report with NaN again must not loop (NaN !== NaN in deps).
    act(() => setters.optimize?.({ done: Number.NaN, total: Infinity, label: '' }));
    expect(useJobs.getState().jobs.optimize).toBeDefined();
  });
});
