/**
 * The board fit's Web Worker (src/workers/boardfit.worker.ts) run in this thread, for tests:
 * `vi.stubGlobal('Worker', BoardFitWorker)`. Any other worker refuses to start, so the measured
 * load falls back to interpolation as it does without Workers.
 */
import { fitBuild, type BuildFitOutcome } from '@smithonline/core';
import type { BoardFitMessage, BoardFitRequest } from '../src/workers/boardfit.worker';

export class BoardFitWorker {
  onmessage: ((e: MessageEvent<BoardFitMessage>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: URL | string) {
    if (!String(url).includes('boardfit')) throw new Error('no Worker in tests');
  }

  postMessage(req: BoardFitRequest): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const post = (data: BoardFitMessage): void => this.onmessage?.({ data } as MessageEvent);
      let outcome: BuildFitOutcome;
      try {
        outcome = fitBuild(req.model, req.measured, {
          ...(req.free ? { free: req.free } : {}),
          accuracy: req.accuracy,
          onProgress: (p) => post({ type: 'progress', ...p }),
        });
      } catch (err) {
        outcome = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      post({ type: 'result', outcome });
    });
  }

  terminate(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
