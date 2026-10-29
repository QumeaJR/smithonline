import { useEffect, useMemo, useRef, useState } from 'react';
import { canOpen, importText, modifiedText } from '../lib/projectWords';
import { projectDesign, type ProjectRecord } from '../lib/projectStore';
import { useDesignStore, type MessageOptions } from '../store/useDesignStore';
import { useCoarsePointer } from '../lib/pointer';
import {
  compareNames,
  deletedKeptInBrowser,
  exportRecord,
  FROM_THIS_TAB,
  needsName,
  savedWords,
  useOpenProject,
  useProjects,
} from '../store/useProjects';
import { HelpLink } from './HelpLink';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { OverflowMenu } from './ui/OverflowMenu';
import { Segmented } from './ui/Segmented';

interface ProjectsDialogProps {
  readonly onClose: () => void;
}

type Sort = 'modified' | 'name';

/** Where the sort choice is remembered. */
const SORT_KEY = 'smithonline.projects.sort';

function readSort(): Sort {
  try {
    return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'modified';
  } catch {
    return 'modified';
  }
}

/** What the dialog's status line says, with the records a deletion can put back. */
interface Status {
  readonly text: string;
  readonly error: boolean;
  readonly undo?: readonly ProjectRecord[];
  /** A button the status carries (Export it, after a refused Undo). */
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** The status line's Undo of a delete: named for what it does. */
const UNDO_DELETE = 'Undo delete';

/** The thumbnail: the chart's outline and the network's trace (docs/11 section 2). */
function Thumb({ path }: { readonly path: string | undefined }) {
  return (
    <svg className="project-thumb" viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true">
      <circle cx="0" cy="0" r="1" className="project-thumb-rim" />
      <line x1="-1" y1="0" x2="1" y2="0" className="project-thumb-rim" />
      {path && <path d={path} className="project-thumb-trace" />}
    </svg>
  );
}

/** The inline rename field: Enter commits, Escape cancels, a blur commits. */
function RenameField({
  name,
  onDone,
  cancelRef,
}: {
  readonly name: string;
  readonly onDone: (name: string | null) => void;
  /** Escape in the dialog cancels the rename through it (the dialog stays open). */
  readonly cancelRef: { current: (() => void) | null };
}) {
  const [draft, setDraft] = useState(name);
  const done = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const finish = (value: string | null): void => {
    if (done.current) return;
    done.current = true;
    cancelRef.current = null;
    onDone(value);
  };
  useEffect(() => {
    cancelRef.current = () => finish(null);
    return () => {
      cancelRef.current = null;
    };
  });
  // The name is selected, so typing replaces it.
  useEffect(() => field.current?.select(), []);
  return (
    <input
      ref={field}
      type="text"
      className="project-rename"
      value={draft}
      maxLength={200}
      aria-label={`New name for ${name}`}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(draft);
        } else if (e.key === 'Escape') {
          // The dialog stays open (its onEscape): Escape leaves the field only.
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(draft)}
    />
  );
}

/** Why this version cannot open a record, for the row and its Open button. */
function cannotOpenWhy(record: ProjectRecord): string {
  const read = projectDesign(record);
  return 'problem' in read ? read.problem : 'it cannot be read';
}

/**
 * The local projects (docs/11): the designs kept in this browser. Search, sort by modified or
 * name, open, rename, duplicate, delete with Undo, export one or all as .json, import .json
 * files. Save to projects keeps the design on show here (asking for a name when it has none).
 * A full-screen sheet on a phone.
 */
export function ProjectsDialog({ onClose }: ProjectsDialogProps) {
  const records = useProjects((s) => s.records);
  const ready = useProjects((s) => s.ready);
  const persistent = useProjects((s) => s.persistent);
  const busyStore = useProjects((s) => s.busy);
  const problem = useProjects((s) => s.problem);
  const skipped = useProjects((s) => s.skipped);
  const failed = useProjects((s) => s.failed);
  const lastExport = useProjects((s) => s.lastExport);
  const open = useOpenProject();
  const designName = useDesignStore((s) => s.design.name);
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<Sort>(readSort);
  const [status, setStatus] = useState<Status | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The project whose Delete asks first (the open one, or one with changes not stored). */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Save to projects asks for a name (the design is untitled). */
  const [naming, setNaming] = useState<string | null>(null);
  /** Save to projects found a project holding the same design. */
  const [same, setSame] = useState<ProjectRecord | null>(null);
  const cancelRename = useRef<(() => void) | null>(null);
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const coarse = useCoarsePointer();
  /** The row whose whole name shows (a phone: a tap on the name). */
  const [expanded, setExpanded] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  /** The head's first button: Save to projects, or Import while the design is a project. */
  const firstButton = (): HTMLButtonElement | null => saveButton.current ?? importButton.current;
  const list = useRef<HTMLUListElement>(null);
  /** After a change, the row whose Open button takes the focus (null: the head's first button). */
  const focusId = useRef<string | null | undefined>(undefined);
  /**
   * The dialog's status line is the one live region while it is open; what it said last goes to
   * the app's status line when it closes (with its Undo, for another 8 s), unless an action
   * that closes it said something there itself.
   */
  const handOver = useRef<Status | null>(null);
  const mounted = useRef(true);

  const setSort = (next: Sort): void => {
    setSortState(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // Remembered for this dialog only.
    }
  };

  // Once the change is done (the row's buttons are enabled again), the focus goes to the row.
  useEffect(() => {
    const id = focusId.current;
    if (id === undefined || working) return;
    focusId.current = undefined;
    const target =
      id === null
        ? null
        : list.current?.querySelector<HTMLElement>(
            `[data-project-id="${CSS.escape(id)}"] .project-open`,
          );
    (target ?? firstButton())?.focus();
  }, [records, working]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q ? records.filter((r) => r.name.toLowerCase().includes(q)) : [...records];
    return sort === 'name'
      ? found.sort((a, b) => compareNames(a.name, b.name) || b.modified - a.modified)
      : found.sort((a, b) => b.modified - a.modified);
  }, [records, query, sort]);

  /** The app's message for a status: Undo rides on it, so the toast and status line offer it. */
  const messageOf = (s: Status): MessageOptions | undefined =>
    s.action
      ? { error: s.error, action: s.action }
      : s.error
        ? { error: true }
        : s.undo && s.undo.length > 0
          ? { action: { label: UNDO_DELETE, run: () => void undo(s.undo ?? []), timed: true } }
          : undefined;

  const say = (
    text: string,
    error = false,
    removed?: readonly ProjectRecord[],
    action?: Status['action'],
  ): void => {
    const next: Status = {
      text,
      error,
      ...(removed ? { undo: removed } : {}),
      ...(action ? { action } : {}),
    };
    if (!mounted.current) {
      useDesignStore.getState().setMessage(text, messageOf(next));
      return;
    }
    setStatus(next);
    handOver.current = next;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const last = handOver.current;
      if (last) useDesignStore.getState().setMessage(last.text, messageOf(last));
    };
    // The status at closing time is read from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Close after an action that put its own message in the app's status line. */
  const closeQuietly = (): void => {
    handOver.current = null;
    onClose();
  };

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setWorking(true);
    // A stale message does not stay under a later action.
    setStatus(null);
    handOver.current = null;
    try {
      await fn();
    } finally {
      if (mounted.current) setWorking(false);
    }
  };

  const saveNow = async (): Promise<void> => {
    const name = useDesignStore.getState().design.name.trim();
    const why = await useProjects.getState().saveCurrent();
    if (why) say(why, true);
    else {
      const id = useDesignStore.getState().projectId;
      if (id) focusId.current = id;
      say(savedWords(name, useDesignStore.getState().design.name));
    }
  };

  /** Save to projects: a name first when it has none; the same design offers its project. */
  const save = (): Promise<void> =>
    run(async () => {
      setSame(null);
      if (needsName(useDesignStore.getState().design.name)) {
        setNaming('');
        return;
      }
      const found = useProjects.getState().sameProject();
      if (found) {
        setSame(found);
        return;
      }
      await saveNow();
    });

  const saveNamed = (given: string): Promise<void> =>
    run(async () => {
      const name = given.trim();
      if (needsName(name)) {
        say('Give the design a name to save it to projects', true);
        nameField.current?.focus();
        return;
      }
      setNaming(null);
      if (name !== useDesignStore.getState().design.name) {
        useDesignStore.getState().setName(name);
      }
      const found = useProjects.getState().sameProject();
      if (found) {
        setSame(found);
        return;
      }
      await saveNow();
    });

  const adoptSame = (record: ProjectRecord): void => {
    setSame(null);
    const why = useProjects.getState().linkTo(record.id);
    if (why) say(`Could not open "${record.name}": ${why}`, true);
    else {
      focusId.current = record.id;
      say(`"${record.name}" holds this design already: it is the open project now`);
    }
  };

  // Opened by Save to projects (File, the chip): the save starts at once.
  const startedSaving = useRef(false);
  useEffect(() => {
    if (startedSaving.current || !ready || !useProjects.getState().saving) return;
    startedSaving.current = true;
    // After this render (not a state change inside the effect itself).
    if (!open) queueMicrotask(() => void save());
    // Once, when the list is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    if (naming !== null) nameField.current?.focus();
  }, [naming]);

  const openOne = (record: ProjectRecord): Promise<void> =>
    run(async () => {
      if (open?.id === record.id) {
        onClose();
        return;
      }
      const why = await useProjects.getState().openProject(record.id);
      if (why) say(`Could not open "${record.name}": ${why}`, true);
      else closeQuietly();
    });

  const rename = (record: ProjectRecord, name: string | null): Promise<void> =>
    run(async () => {
      setRenaming(null);
      focusId.current = record.id;
      if (name === null || name.trim() === record.name) {
        // Nothing changed: the focus goes back to the row.
        focusId.current = undefined;
        list.current
          ?.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(record.id)}"] .project-open`)
          ?.focus();
        return;
      }
      const why = await useProjects.getState().rename(record.id, name);
      if (why) say(`Could not rename "${record.name}": ${why}`, true);
      else say(`Renamed "${record.name}" to "${name.trim()}"`);
    });

  const duplicate = (record: ProjectRecord): Promise<void> =>
    run(async () => {
      const result = await useProjects.getState().duplicate(record.id);
      if ('problem' in result) {
        say(`Could not duplicate "${record.name}": ${result.problem}`, true);
        return;
      }
      focusId.current = result.id;
      const copy = useProjects.getState().records.find((r) => r.id === result.id);
      say(`Duplicated "${record.name}" as "${copy?.name ?? 'a copy'}"`);
    });

  /** The delete question answered No (Cancel, Escape): the focus goes back to the row's More actions. */
  /** The row whose More actions takes the focus once the delete question is gone. */
  const moreFocus = useRef<string | null>(null);
  const cancelConfirm = (id: string): void => {
    moreFocus.current = id;
    setConfirming(null);
  };
  useEffect(() => {
    const id = moreFocus.current;
    if (id === null || confirming !== null) return;
    moreFocus.current = null;
    list.current
      ?.querySelector<HTMLElement>(
        `[data-project-id="${CSS.escape(id)}"] button[aria-haspopup="menu"]`,
      )
      ?.focus();
  }, [confirming]);

  /** Delete asks first for the open project (its changes may not all be stored yet). */
  const askRemove = (record: ProjectRecord): void => {
    setStatus(null);
    if (open?.id === record.id || failed === record.id) setConfirming(record.id);
    else void remove(record);
  };

  const remove = (record: ProjectRecord): Promise<void> =>
    run(async () => {
      setConfirming(null);
      const at = shown.findIndex((r) => r.id === record.id);
      const next = shown[at + 1] ?? shown[at - 1] ?? null;
      focusId.current = next ? next.id : null;
      const wasOpen = open?.id === record.id;
      const removed = await useProjects.getState().remove(record.id);
      if (!removed) {
        const p = useProjects.getState().problem;
        say(
          `Could not delete "${record.name}"${p ? ': this browser refused the change' : ''}`,
          true,
        );
        return;
      }
      say(
        `Deleted "${record.name}" from projects.${wasOpen ? ' The design on show stays, unsaved.' : ''}`,
        false,
        [removed],
      );
    });

  async function undo(removed: readonly ProjectRecord[]): Promise<void> {
    const state = useProjects.getState();
    // Once: the dialog's Undo and the message's Undo are the same step.
    if (removed.every((r) => state.records.some((p) => p.id === r.id))) return;
    focusId.current = removed[0]?.id ?? null;
    const result = await state.restore(removed);
    if (result === 'ok') {
      say(
        removed.length === 1
          ? `Put "${removed[0]?.name ?? 'the project'}" back in projects`
          : `Put ${removed.length} projects back`,
      );
      return;
    }
    // Refused: never "Put back". Where it is kept, and what to do now.
    const first = removed[0];
    const name = first?.name ?? 'the project';
    const kept = removed.every((r) => deletedKeptInBrowser(r.id));
    const why =
      useProjects.getState().problem === 'full'
        ? 'browser storage is full'
        : 'this browser refused to store it';
    say(
      `Could not put "${name}" back: ${why}. ${
        kept
          ? 'It is kept in this browser (Settings, Data in this browser), and this tab puts it back once the browser takes a write.'
          : 'It is kept in this page only, so export it before you close the tab.'
      } Export it now, or delete other projects to free space and try ${UNDO_DELETE} again.`,
      true,
      removed,
      first ? { label: 'Export it', run: () => exportRecord(first) } : undefined,
    );
  }

  const exportOne = (record: ProjectRecord): Promise<void> =>
    run(async () => {
      const file = await useProjects.getState().exportOne(record.id);
      if (file) say(`Exported ${file}`);
    });

  const exportAll = (): Promise<void> =>
    run(async () => {
      const n = await useProjects.getState().exportAll();
      if (n === 0) return;
      const files = useProjects.getState().exportedFiles;
      const what = `${n} ${n === 1 ? 'project' : 'projects'}`;
      say(
        files.length === 1
          ? `Exported ${what} in ${files[0] ?? 'one .json file'}`
          : `Exported ${what} in ${files.length} files, each one importable: ${files.join(', ')}`,
      );
    });

  const importFiles = (files: readonly File[]): Promise<void> =>
    run(async () => {
      if (files.length === 0) return;
      try {
        const texts = await Promise.all(
          files.map(async (f) => ({ name: f.name, text: await f.text() })),
        );
        const report = await useProjects.getState().importFiles(texts);
        say(importText(report), report.added === 0);
      } catch (err) {
        say(`Could not read the files: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    });

  const storeNote = !persistent ? (
    busyStore ? (
      <p className="small warn-text" role="note">
        The projects stored in this browser could not be read: another tab of SmithChart.Online may
        hold them. Close it and reload this page; until then the list lasts until the page is
        closed.
      </p>
    ) : (
      <p className="small warn-text" role="note">
        This browser does not let the app store projects (a private window?): they last until the
        page is closed. Export all keeps them as a file.
      </p>
    )
  ) : problem === 'full' ? (
    <p className="small warn-text" role="note">
      This browser has no room for more projects. Export all keeps them as a file; delete some to
      make room.
    </p>
  ) : null;

  return (
    <Dialog
      title="Projects"
      subtitle={persistent ? 'stored in this browser' : 'kept until the page closes'}
      onClose={onClose}
      closeLabel="Close projects"
      onEscape={
        renaming
          ? () => cancelRename.current?.()
          : confirming
            ? () => cancelConfirm(confirming)
            : naming !== null
              ? () => setNaming(null)
              : same
                ? () => setSame(null)
                : undefined
      }
      className="settings projects-dialog"
      initialFocus={() =>
        // On a touch screen a focused search field would raise the keyboard over the list.
        useProjects.getState().saving || coarse
          ? firstButton()
          : (searchField.current ?? firstButton())
      }
      footer={
        <>
          <span className="small muted projects-backup-note">
            {lastExport > 0
              ? `Last Export all: ${modifiedText(lastExport)}`
              : 'No Export all from this browser yet'}
          </span>
          <Button
            disabled={records.length === 0 || working}
            onClick={() => void exportAll()}
            title="Every project in .json files: your backup, which Import puts back in any browser"
          >
            Export all
          </Button>
          <Button variant="primary" className="dialog-close" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p className="small">
        Your designs, kept in this browser and sent nowhere. The open project saves itself as you
        work; clearing the site&apos;s data deletes them, so Export all now and then.{' '}
        <HelpLink section="projects" topic="projects" />
      </p>
      {storeNote}
      {skipped > 0 && (
        <p className="small muted" role="note">
          {skipped} stored {skipped === 1 ? 'record' : 'records'} could not be read and{' '}
          {skipped === 1 ? 'is' : 'are'} left as {skipped === 1 ? 'it is' : 'they are'}.
        </p>
      )}
      <div className="row projects-head">
        {open ? (
          <span className="small projects-open-note">
            {'Open now: '}
            <strong>{open.name}</strong>
            {failed === open.id
              ? ', not saved: the browser refused the last change'
              : ', saved as you work'}
          </span>
        ) : (
          <Button
            ref={saveButton}
            variant="primary"
            disabled={working || !ready}
            onClick={() => void save()}
            title={
              ready
                ? `Keep "${designName}" in this list; it then saves itself as you work`
                : 'The list is still being read'
            }
          >
            Save to projects
          </Button>
        )}
        <Button
          ref={importButton}
          disabled={working}
          onClick={() => fileInput.current?.click()}
          title="Add .json design files, or Export all files, to the list"
        >
          Import .json…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          aria-label="Project files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importFiles(files);
          }}
        />
      </div>
      {naming !== null && (
        <form
          className="projects-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNamed(naming);
          }}
        >
          <label className="small" htmlFor="projects-name">
            Name for the project
          </label>
          <input
            id="projects-name"
            ref={nameField}
            type="text"
            className="projects-search projects-name"
            value={naming}
            maxLength={200}
            placeholder="Untitled"
            onChange={(e) => setNaming(e.target.value)}
          />
          <Button type="submit" variant="primary" size="sm" disabled={working}>
            Save
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setNaming(null)}>
            Cancel
          </Button>
        </form>
      )}
      {same && (
        <div className="projects-ask" role="group" aria-label="The same design is in projects">
          <span className="small">&quot;{same.name}&quot; in the list holds this same design.</span>
          <Button size="sm" variant="primary" onClick={() => adoptSame(same)}>
            Use that project
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(async () => {
                setSame(null);
                await saveNow();
              })
            }
          >
            Save a copy
          </Button>
        </div>
      )}
      {records.length > 0 && (
        <div className="row projects-filter">
          <input
            ref={searchField}
            type="search"
            className="projects-search"
            value={query}
            placeholder="Search by name"
            aria-label="Search by name"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Segmented
            ariaLabel="Sort by"
            size="sm"
            radio
            value={sort}
            onChange={setSort}
            options={[
              { value: 'modified', label: 'Modified', title: 'Modified, newest first' },
              { value: 'name', label: 'Name', title: 'Name, A to Z' },
            ]}
          />
        </div>
      )}
      <p
        className={`small projects-status${status?.error ? ' error-text' : ''}`}
        role="status"
        aria-live="polite"
      >
        {status?.text}
        {status?.action && (
          <Button size="sm" variant="quiet" onClick={status.action.run}>
            {status.action.label}
          </Button>
        )}
        {status?.undo && status.undo.length > 0 && (
          <Button size="sm" variant="quiet" onClick={() => void undo(status.undo ?? [])}>
            {UNDO_DELETE}
          </Button>
        )}
      </p>
      {!ready ? (
        <p className="small muted">Reading the projects…</p>
      ) : records.length === 0 ? (
        <p className="small muted projects-empty">
          No projects yet. Save to projects keeps the design on show here; Import .json adds saved
          files.
        </p>
      ) : shown.length === 0 ? (
        <p className="small muted">No project name contains &quot;{query.trim()}&quot;.</p>
      ) : (
        <ul ref={list} className="projects-list" aria-label="Projects">
          {shown.map((r) => {
            const isOpen = open?.id === r.id;
            const ok = canOpen(r);
            const why = ok ? null : `This version cannot open it: ${cannotOpenWhy(r)}`;
            return (
              <li
                key={r.id}
                className={`project-row${isOpen ? ' is-open' : ''}`}
                data-project-id={r.id}
              >
                <Thumb path={r.thumb} />
                <div className="project-main">
                  {renaming === r.id ? (
                    <RenameField
                      name={r.name}
                      cancelRef={cancelRename}
                      onDone={(name) => void rename(r, name)}
                    />
                  ) : coarse ? (
                    // On a phone a tap shows the whole name (no tooltip there).
                    <button
                      type="button"
                      className={`project-name project-name-tap${expanded === r.id ? ' expanded' : ''}`}
                      aria-expanded={expanded === r.id}
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      {r.name}
                    </button>
                  ) : (
                    <span className="project-name" title={r.name}>
                      {r.name}
                    </span>
                  )}
                  <span className="project-meta small muted">
                    {isOpen && <span className="project-open-tag">Open now</span>}
                    {isOpen && <span className="visually-hidden">, </span>}
                    Modified {modifiedText(r.modified)}
                    {why && <span className="warn-text"> · {why}</span>}
                  </span>
                  {fromThisTab(r.name) && (
                    <span className="project-meta small muted project-tab-note">
                      Kept beside a project another tab changed: compare the two and delete the one
                      you do not need.
                    </span>
                  )}
                </div>
                <div className="project-actions">
                  <Button
                    size="sm"
                    className="project-open"
                    disabled={working || !ok}
                    onClick={() => void openOne(r)}
                    aria-label={`Open ${r.name}`}
                    title={why ?? `Open "${r.name}"`}
                  >
                    Open
                  </Button>
                  <OverflowMenu
                    label={`More actions for ${r.name}`}
                    title={r.name}
                    closeLabel={`Close ${r.name}`}
                    items={[
                      { label: 'Rename', disabled: !ok, onSelect: () => setRenaming(r.id) },
                      { label: 'Duplicate', onSelect: () => void duplicate(r) },
                      { label: 'Export .json', onSelect: () => void exportOne(r) },
                      { label: 'Delete', destructive: true, onSelect: () => askRemove(r) },
                    ]}
                  />
                </div>
                {confirming === r.id && (
                  <div className="project-confirm" role="group" aria-label={`Delete ${r.name}?`}>
                    <span className="small warn-text">
                      Delete &quot;{r.name}&quot;? It is the design on show: it stays, unsaved, and
                      Undo puts the project back.
                    </span>
                    <Button size="sm" variant="destructive" onClick={() => void remove(r)}>
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      // The safe answer has the focus.
                      autoFocus
                      onClick={() => cancelConfirm(r.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

/** A design kept beside a project another tab changed ("X (from this tab)"). */
function fromThisTab(name: string): boolean {
  return (
    name.endsWith(`(${FROM_THIS_TAB})`) || new RegExp(`\\(${FROM_THIS_TAB} \\d+\\)$`).test(name)
  );
}
