import { useEffect, useMemo, useRef, useState } from 'react';
import { canOpen, importText, modifiedText } from '../lib/projectWords';
import type { ProjectRecord } from '../lib/projectStore';
import { useDesignStore } from '../store/useDesignStore';
import { useOpenProject, useProjects } from '../store/useProjects';
import { HelpLink } from './HelpLink';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { OverflowMenu } from './ui/OverflowMenu';
import { Segmented } from './ui/Segmented';

interface ProjectsDialogProps {
  readonly onClose: () => void;
}

type Sort = 'modified' | 'name';

/** What the dialog's status line says, with the records a deletion can put back. */
interface Status {
  readonly text: string;
  readonly error: boolean;
  readonly undo?: readonly ProjectRecord[];
}

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
  return (
    <input
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

/**
 * The local projects (docs/11): the designs kept in this browser. Search, sort by modified or
 * name, open, rename, duplicate, delete with Undo, export one or all as .json, import .json
 * files. Save to projects keeps the design on show here. A full-screen sheet on a phone.
 */
export function ProjectsDialog({ onClose }: ProjectsDialogProps) {
  const records = useProjects((s) => s.records);
  const ready = useProjects((s) => s.ready);
  const persistent = useProjects((s) => s.persistent);
  const busyStore = useProjects((s) => s.busy);
  const problem = useProjects((s) => s.problem);
  const skipped = useProjects((s) => s.skipped);
  const open = useOpenProject();
  const designName = useDesignStore((s) => s.design.name);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('modified');
  const [status, setStatus] = useState<Status | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const cancelRename = useRef<(() => void) | null>(null);
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  /** The head's first button: Save to projects, or Import while the design is a project. */
  const firstButton = (): HTMLButtonElement | null => saveButton.current ?? importButton.current;
  const list = useRef<HTMLUListElement>(null);
  /** After a change, the row whose Open button takes the focus (null: the head's first button). */
  const focusId = useRef<string | null | undefined>(undefined);

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
      ? found.sort((a, b) => a.name.localeCompare(b.name) || b.modified - a.modified)
      : found.sort((a, b) => b.modified - a.modified);
  }, [records, query, sort]);

  const say = (text: string, error = false, removed?: readonly ProjectRecord[]): void => {
    setStatus({ text, error, ...(removed ? { undo: removed } : {}) });
    // The Undo rides on the message too, so the phone's toast offers it.
    const action =
      removed && removed.length > 0
        ? { label: 'Undo', run: () => void undo(removed), timed: true }
        : undefined;
    useDesignStore
      .getState()
      .setMessage(text, error ? { error: true } : action ? { action } : undefined);
  };

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };

  const save = (): Promise<void> =>
    run(async () => {
      const name = useDesignStore.getState().design.name;
      const why = await useProjects.getState().saveCurrent();
      if (why) say(why, true);
      else {
        const id = useDesignStore.getState().projectId;
        if (id) focusId.current = id;
        say(`Saved "${name}" to projects; changes are saved there as you work`);
      }
    });

  const openOne = (record: ProjectRecord): Promise<void> =>
    run(async () => {
      if (open?.id === record.id) {
        onClose();
        return;
      }
      const why = await useProjects.getState().openProject(record.id);
      if (why) say(`Could not open "${record.name}": ${why}`, true);
      else onClose();
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

  const remove = (record: ProjectRecord): Promise<void> =>
    run(async () => {
      const at = shown.findIndex((r) => r.id === record.id);
      const next = shown[at + 1] ?? shown[at - 1] ?? null;
      focusId.current = next ? next.id : null;
      const wasOpen = open?.id === record.id;
      const removed = await useProjects.getState().remove(record.id);
      if (!removed) return;
      say(
        `Deleted "${record.name}" from projects.${wasOpen ? ' The design on show stays, unsaved.' : ''}`,
        false,
        [removed],
      );
    });

  const undo = async (removed: readonly ProjectRecord[]): Promise<void> => {
    const state = useProjects.getState();
    // Once: the dialog's Undo and the message's Undo are the same step.
    if (removed.every((r) => state.records.some((p) => p.id === r.id))) return;
    focusId.current = removed[0]?.id ?? null;
    await state.restore(removed);
    say(
      removed.length === 1
        ? `Put "${removed[0]?.name ?? 'the project'}" back in projects`
        : `Put ${removed.length} projects back`,
    );
  };

  const exportOne = (record: ProjectRecord): void => {
    const file = useProjects.getState().exportOne(record.id);
    if (file) say(`Exported ${file}`);
  };

  const exportAll = (): void => {
    const n = useProjects.getState().exportAll();
    if (n > 0) say(`Exported ${n} ${n === 1 ? 'project' : 'projects'} in one .json file`);
  };

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
        The projects stored in this browser could not be read: another tab of Smith Online may hold
        them. Close it and reload this page; until then the list lasts until the page is closed.
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
      onEscape={renaming ? () => cancelRename.current?.() : undefined}
      className="settings projects-dialog"
      initialFocus={firstButton}
      footer={
        <>
          <Button
            disabled={records.length === 0}
            onClick={exportAll}
            title="Every project in one .json file: your backup, which Import puts back in any browser"
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
            Open now: <strong>{open.name}</strong>, saved as you work
          </span>
        ) : (
          <Button
            ref={saveButton}
            variant="primary"
            disabled={working || !ready}
            onClick={() => void save()}
            title={`Keep "${designName}" in this list; it then saves itself as you work`}
          >
            Save to projects
          </Button>
        )}
        <Button
          ref={importButton}
          disabled={working}
          onClick={() => fileInput.current?.click()}
          title="Add .json design files, or an Export all file, to the list"
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
      {records.length > 0 && (
        <div className="row projects-filter">
          <input
            type="search"
            className="projects-search"
            value={query}
            placeholder="Search by name"
            aria-label="Search projects by name"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Segmented
            ariaLabel="Sort projects"
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'modified', label: 'Modified', title: 'Newest first' },
              { value: 'name', label: 'Name', title: 'A to Z' },
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
        {status?.undo && status.undo.length > 0 && (
          <Button size="sm" variant="quiet" onClick={() => void undo(status.undo ?? [])}>
            Undo
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
                  ) : (
                    <span className="project-name">{r.name}</span>
                  )}
                  <span className="project-meta small muted">
                    {isOpen && <span className="project-open-tag">Open now</span>}
                    Modified {modifiedText(r.modified)}
                    {!ok && <span className="warn-text"> · This version cannot open it</span>}
                  </span>
                </div>
                <div className="project-actions">
                  <Button
                    size="sm"
                    className="project-open"
                    disabled={working || !ok}
                    onClick={() => void openOne(r)}
                    aria-label={`Open ${r.name}`}
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
                      { label: 'Export .json', onSelect: () => exportOne(r) },
                      { label: 'Delete', destructive: true, onSelect: () => void remove(r) },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
