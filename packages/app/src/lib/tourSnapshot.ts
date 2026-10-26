import type { Design } from './design';
import { useBoard } from '../store/useBoard';
import { useDesignStore } from '../store/useDesignStore';
import { usePartLibrary } from '../store/usePartLibrary';
import { useShell } from '../store/useShell';
import { useSPlotStore } from '../store/useSPlotStore';
import { useImported } from './importDialog';
import { useTourEvents, type TourEvent } from './tourEvents';
import type { TourSnapshot } from './workflowKit';

/** The state a workflow step reads, with the event counts seen when the step came on show. */
export function tourSnapshot(
  seen: Readonly<Partial<Record<TourEvent, number>>>,
  atEntry?: Design,
): TourSnapshot {
  const designs = useDesignStore.getState();
  const shell = useShell.getState();
  const library = usePartLibrary.getState();
  const files = useSPlotStore.getState().files;
  const counts = useTourEvents.getState().counts;
  return {
    design: designs.design,
    atEntry: atEntry ?? designs.design,
    tool: shell.tool,
    matchMode: shell.matchMode,
    view: designs.view,
    importOpen: useImported.getState().imported !== null,
    libraryOpen: library.open,
    libraryCount: library.parts.length,
    boardOn: useBoard.getState().board.enabled,
    settingsOpen: shell.settings !== null,
    splotEntries: files.length,
    splotLive: files.some((f) => f.network === 'live'),
    since: (event) => (counts[event] ?? 0) - (seen[event] ?? 0),
  };
}

/** Subscribe to every store a step's predicate can read; returns the unsubscribe. */
export function watchSnapshotStores(fn: () => void): () => void {
  const offs = [
    useDesignStore.subscribe(fn),
    useShell.subscribe(fn),
    usePartLibrary.subscribe(fn),
    useBoard.subscribe(fn),
    useSPlotStore.subscribe(fn),
    useImported.subscribe(fn),
    useTourEvents.subscribe(fn),
  ];
  return () => offs.forEach((off) => off());
}
