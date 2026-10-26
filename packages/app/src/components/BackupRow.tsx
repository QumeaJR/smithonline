import {
  autosaveHold,
  keepUnreadableAutosave,
  readAutosaveText,
  readBackup,
  removeBackup,
  type Backup,
} from '../lib/autosave';
import { openedDesign } from '../lib/designBuild';
import { download } from '../lib/export';
import { designFileOfText, designFileText } from '../lib/share';
import { useDesignStore } from '../store/useDesignStore';
import { ClearButton } from './ClearButton';
import { Button } from './ui/Button';

/** The file name a backup is saved under: what it holds, in words a file list shows. */
function fileName(backup: Backup, name: string | null): string {
  const safe = (name ?? '').replace(/[^\w .-]+/g, '').trim();
  return backup.kind === 'replaced'
    ? `${safe || 'design'} (replaced by a link).json`
    : 'smithonline-unreadable-autosave.json';
}

/**
 * One backup in Settings, Data in this browser (lib/autosave.ts): an autosave this version
 * could not open, with the reason, or the design a share link replaced, which opens again as an
 * undoable step. Save a copy writes a design file File, Open reads; Clear asks first.
 */
export function BackupRow({
  backup,
  onRemoved,
  onOpened,
}: {
  readonly backup: Backup;
  readonly onRemoved: () => void;
  /** After Open: Settings closes, so the design shows. */
  readonly onOpened: () => void;
}) {
  const text = readBackup(backup.key);
  const read = text === null ? null : readAutosaveText(text);
  const design = read && 'value' in read ? read.value : null;
  const what =
    backup.kind === 'replaced'
      ? design
        ? `"${design.name}", the design a share link replaced`
        : 'A design a share link replaced'
      : `An autosaved design this version could not open${read && 'problem' in read ? `: ${read.problem}` : ''}`;
  const save = (): void => {
    if (text === null) return;
    const file = design ? designFileText(design) : designFileOfText(text);
    download(
      fileName(backup, design?.name ?? null),
      new Blob([file], { type: 'application/json' }),
    );
  };
  const open = (): void => {
    if (!design) return;
    const opened = openedDesign(design);
    useDesignStore
      .getState()
      .loadDesign(
        opened.design,
        `Opened "${opened.design.name}", kept when a share link replaced it`,
      );
    onOpened();
  };
  return (
    <div className="settings-line">
      <span>{what}</span>
      <span className="settings-ask">
        {backup.kind === 'replaced' && design && (
          <Button
            size="sm"
            onClick={open}
            title="Open it as the design on show; Undo brings back the design you have open now"
            aria-label={`Open the kept design "${design.name}"`}
          >
            Open
          </Button>
        )}
        <Button
          size="sm"
          onClick={save}
          title="Save it as a design file, which File, Open reads"
          aria-label={
            design ? `Save a copy of "${design.name}"` : 'Save a copy of the kept autosave'
          }
        >
          Save a copy
        </Button>
        <ClearButton
          question={
            backup.kind === 'replaced'
              ? 'Remove the kept design from this browser?'
              : 'Remove the kept autosave from this browser?'
          }
          onClear={() => {
            removeBackup(backup.key);
            // A paused autosave (no free backup) goes on once its unreadable design is kept.
            if (autosaveHold.held && keepUnreadableAutosave()?.key !== null) {
              autosaveHold.held = false;
            }
            onRemoved();
          }}
        />
      </span>
    </div>
  );
}
